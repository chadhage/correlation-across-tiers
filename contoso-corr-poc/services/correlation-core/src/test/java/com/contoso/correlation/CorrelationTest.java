package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;

import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

class CorrelationTest {
    @Test void trustedUuidAndDuplicates() {
        var id = InvocationId.generate();
        assertEquals(id, InvocationIds.resolve(List.of(id.value()), true));
        assertNotEquals(id, InvocationIds.resolve(List.of(id.value()), false));
        assertNotEquals(id, InvocationIds.resolve(List.of(id.value(), id.value()), true));
        for (String bad : List.of("", " " + id.value(), id.value().toUpperCase(),
                "00000000-0000-0000-0000-000000000000", id.value() + "\n")) {
            assertThrows(IllegalArgumentException.class, () -> InvocationId.parse(bad));
        }
    }

    @Test void generatedAndAdversarialInvocationIdsPreserveTrustAndNamespace() {
        var random = new java.util.Random(4262026);
        for (int i = 0; i < 1000; i++) {
            var id = InvocationId.generate();
            assertEquals(36, id.value().length());
            assertEquals('4', id.value().charAt(14));
            assertEquals(id, InvocationIds.resolve(List.of(id.value()), true));
            assertNotEquals(id, InvocationIds.resolve(List.of(id.value()), false));
            String malformed = switch (random.nextInt(5)) {
                case 0 -> id.value().substring(0, random.nextInt(36));
                case 1 -> id.value() + "," + id.value();
                case 2 -> id.value().substring(0, 14) + "1" + id.value().substring(15);
                case 3 -> id.value() + "\r\n";
                default -> "customer:" + id.value();
            };
            assertThrows(IllegalArgumentException.class, () -> InvocationId.parse(malformed));
            var resolved = InvocationIds.resolve(List.of(malformed), true);
            assertDoesNotThrow(() -> InvocationId.parse(resolved.value()));
            assertNotEquals(malformed, resolved.value());
        }
    }

    @Test void messagePositionsAndErrorCategoriesCannotCarryPayloads() {
        var id = InvocationId.generate();
        try (var span = Correlation.start("contoso.message.position", SpanKind.CONSUMER, Context.root(), id,
                Map.of("messaging.destination.partition.id", "3",
                    "messaging.eventhubs.message.offset", "9223372036854775807",
                    "contoso.context.rejection", "INVALID_PARENT"))) {
            span.attribute("contoso.original.message.id", id.value());
            span.attribute("contoso.causation.id", InvocationId.generate().value());
            assertThrows(IllegalArgumentException.class, () ->
                span.attribute("contoso.context.rejection", "rejected token or request body"));
            assertThrows(IllegalArgumentException.class, () ->
                span.attribute("messaging.eventhubs.message.offset", "customer-key"));
            assertThrows(IllegalArgumentException.class, () ->
                span.attribute("messaging.destination.partition.id", "0\n"));
            assertThrows(IllegalArgumentException.class, () -> span.attribute("contoso.causation.id", "customer-order"));
        }
    }

    @Test void threadContextAndMdcRestore() throws Exception {
        var id = InvocationId.generate();
        MDC.put("prior", "safe");
        try (var pool = Executors.newSingleThreadExecutor();
             var bound = Correlation.bind(id)) {
            assertEquals(id.value(), MDC.get(Correlation.ATTRIBUTE));
            var wrapped = Correlation.wrap((java.util.concurrent.Callable<String>) () -> {
                assertEquals(id, Correlation.invocation(Context.current()));
                return MDC.get(Correlation.ATTRIBUTE);
            });
            assertEquals(id.value(), pool.submit(wrapped).get());
            assertNull(pool.submit(() -> MDC.get(Correlation.ATTRIBUTE)).get());
        }
        assertEquals("safe", MDC.get("prior"));
        MDC.clear();
    }

    @Test void rejectSensitiveAttributesAndUnboundedLinks() {
        assertThrows(IllegalArgumentException.class, () -> Correlation.start(
            "contoso.pg.lookup", SpanKind.CLIENT, Context.root(), InvocationId.generate(),
            Map.of("db.statement", "SELECT SECRET")));
        var valid = SpanContext.create("12345678901234567890123456789012",
            "1234567890123456", TraceFlags.getDefault(), TraceState.getDefault());
        assertThrows(IllegalArgumentException.class, () -> Correlation.startLinked(
            "contoso.batch", SpanKind.INTERNAL, null,
            java.util.Collections.nCopies(33, valid), Map.of()));
    }

    @Test void closingSpanDoesNotCloseCallerScope() {
        var id = InvocationId.generate();
        var span = Correlation.start("contoso.test", SpanKind.INTERNAL, Context.root(), id, Map.of());
        try (var scope = span.makeCurrent()) {
            span.close();
            span.close();
            assertEquals(id, Correlation.invocation(Context.current()));
        }
        assertNull(Correlation.invocation(Context.current()));
    }

    @Test void safeLogDoesNotCaptureUnapprovedMdc() {
        var captured = new java.util.ArrayList<Map<String, String>>();
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("contoso.safe-log-test");
        var appender = new ch.qos.logback.core.AppenderBase<ch.qos.logback.classic.spi.ILoggingEvent>() {
            protected void append(ch.qos.logback.classic.spi.ILoggingEvent event) {
                event.prepareForDeferredProcessing();
                captured.add(Map.copyOf(event.getMDCPropertyMap()));
            }
        };
        appender.setContext(logger.getLoggerContext());
        appender.start();
        logger.addAppender(appender);
        MDC.put("Authorization", "synthetic-never-exported");
        try {
            Correlation.log(logger, "test_event", "SUCCESS");
            assertFalse(captured.getFirst().containsKey("Authorization"));
            assertEquals("synthetic-never-exported", MDC.get("Authorization"));
        } finally {
            MDC.clear(); logger.detachAppender(appender); appender.stop();
        }
    }
}
