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
