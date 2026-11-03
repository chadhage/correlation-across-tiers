package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.azure.core.models.CloudEvent;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.workflow.RunScenario;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

class EnvelopeTest {
    private final EnvelopeCodec codec = new EnvelopeCodec();
    @Test void versionedStrictEnvelopeRoundTrips() {
        for (RunScenario scenario : RunScenario.values()) {
            var envelope = MessagingFixture.envelope(scenario);
            assertEquals(envelope, codec.decode(codec.encode(envelope)));
            assertTrue(codec.json(envelope).contains("\"business.invocation_id\""));
            assertFalse(envelope.toString().contains(envelope.payload().sku()));
            assertEquals(64, codec.fingerprint(envelope).length());
        }
    }
    @Test void malformedDuplicateUnknownMissingAndTrailingFieldsFailClosed() {
        String json = codec.json(MessagingFixture.envelope(RunScenario.RETRY));
        for (String bad : List.of("{", json + "{}", json.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            json.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"),
            json.replace("\"schemaVersion\":1", "\"schemaVersion\":\"1\""),
            json.replace("\"quantity\":1", "\"quantity\":1.0"),
            json.replace("\"quantity\":1", "\"quantity\":101"),
            json.replace("\"payload\":", "\"producer\":\"claimed-not-trusted\",\"payload\":"),
            json.replace("\"causationId\":null,", ""))) {
            assertThrows(MessagingFailure.class, () -> codec.decode(bad));
        }
    }
    @Test void byteAndContextLimitsApplyBeforeDataCanBeLogged() {
        assertEquals(MessagingFailure.Code.ENVELOPE_TOO_LARGE,
            assertThrows(MessagingFailure.class, () -> codec.decode(new byte[Envelope.MAX_BYTES + 1])).code());
        String json = codec.json(MessagingFixture.envelope(RunScenario.SYNC));
        assertThrows(MessagingFailure.class, () -> codec.decode(json.replace(MessagingFixture.TP, "x".repeat(513))));
        assertThrows(MessagingFailure.class, () -> codec.decode("[".repeat(9) + "0" + "]".repeat(9)));
        assertThrows(MessagingFailure.class, () -> codec.decode(new byte[]{(byte) 0xc3, 0x28}));
    }
    @Test void standardsParserDoesNotPromoteUnsampledAndDropsInvalidStateIndependently() {
        var sampled = TraceContexts.extract(MessagingFixture.TP, "contoso=test");
        assertTrue(sampled.spanContext().isValid()); assertTrue(sampled.spanContext().isSampled());
        var unsampled = TraceContexts.extract(MessagingFixture.TP.replace("-01", "-00"), "contoso=test");
        assertTrue(unsampled.spanContext().isValid()); assertFalse(unsampled.spanContext().isSampled());
        var invalidState = TraceContexts.extract(MessagingFixture.TP, "bad state");
        assertTrue(invalidState.spanContext().isValid()); assertTrue(invalidState.spanContext().getTraceState().isEmpty());
        for (String parent : List.of("malformed", "ff" + MessagingFixture.TP.substring(2),
            MessagingFixture.TP.replace("1234567890123456", "0000000000000000"))) {
            assertFalse(TraceContexts.extract(parent, "contoso=test").spanContext().isValid());
        }
    }
    @Test void replayIsNewIdentityPreservingOriginalBusinessAndContext() {
        var original = MessagingFixture.envelope(RunScenario.DLQ);
        var replay = original.replay(InvocationId.generate().value());
        assertEquals(original.businessInvocationId(), replay.businessInvocationId());
        assertEquals(original.messageId(), replay.replayOf());
        assertEquals(original.messageId(), replay.causationId());
        assertEquals(original.traceparent(), replay.traceparent());
        assertThrows(MessagingFailure.class, () -> original.replay(original.messageId()));
    }
    @Test void realServiceBusObjectCarriesDiagnosticIdAndSeparateBusinessIdentity() {
        var carriers = new AzureCarriers(codec);
        var envelope = MessagingFixture.envelope(RunScenario.RETRY);
        var message = carriers.serviceBus(envelope);
        assertEquals(envelope.traceparent(), message.getApplicationProperties().get("Diagnostic-Id"));
        assertEquals(envelope.businessInvocationId(), message.getApplicationProperties().get("business.invocation_id"));
        assertEquals(envelope, carriers.serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties()));
        message.getApplicationProperties().put("Diagnostic-Id", "not-an-authorized-context");
        assertThrows(MessagingFailure.class, () -> carriers.serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties()));
    }
    @Test void realCloudEventsUseExtensionsNotEventIdAsTraceIdentity() {
        var carriers = new AzureCarriers(codec);
        var envelope = MessagingFixture.envelope(RunScenario.EVENT_GRID);
        CloudEvent event = carriers.cloudEvent(envelope);
        assertEquals(envelope.messageId(), event.getId());
        assertNotEquals(TraceContexts.extract(envelope).spanContext().getTraceId(), event.getId());
        assertEquals(envelope.traceparent(), event.getExtensionAttributes().get("traceparent"));
        assertEquals(envelope, carriers.cloudEvent(event));
        event.setId(InvocationId.generate().value());
        assertThrows(MessagingFailure.class, () -> carriers.cloudEvent(event));
    }
    @Test void realEventDataAndQueueBinaryCarriersEnforceExactContext() {
        var carriers = new AzureCarriers(codec);
        var envelope = MessagingFixture.envelope(RunScenario.BATCH);
        var event = carriers.eventHub(envelope);
        assertEquals(envelope, carriers.eventHub(event));
        assertEquals(envelope, carriers.queue(carriers.queue(envelope)));
        event.getProperties().put("business.invocation_id", InvocationId.generate().value());
        assertThrows(MessagingFailure.class, () -> carriers.eventHub(event));
    }
    @Test void noTracingClientOptionsAndEndpointConfigurationFailClosed() {
        assertFalse(MessagingSettings.noTracing().getTracingOptions().isEnabled());
        assertThrows(MessagingFailure.class, () -> MessagingSettings.from(java.util.Map.of()));
        var settings = new MessagingSettings("contoso-test-bus.servicebus.windows.net",
            "https://contoso-test.centralus-1.eventgrid.azure.net/api/events",
            "contoso-test-hub.servicebus.windows.net", "https://contosotest.queue.core.windows.net",
            null, "ORDERS", "FULFILLMENT", "NOTIFY", "AGGREGATOR", 2, 2);
        assertEquals(2, settings.batchSize());
        assertFalse(settings.toString().contains("queue.core"));
        assertThrows(MessagingFailure.class, () -> new MessagingSettings(settings.serviceBusNamespace(),
            "https://third-party.example/api/events", settings.eventHubsNamespace(), settings.queueEndpoint(),
            null, "ORDERS", "FULFILLMENT", "NOTIFY", "AGGREGATOR", 2, 3));
    }
    @Test void unsafeSdkLoggerCannotBypassExplicitHttpLogNone() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("com.azure");
        var previous = logger.getLevel();
        try {
            logger.setLevel(ch.qos.logback.classic.Level.WARN);
            assertThrows(IllegalStateException.class, MessagingLoggingGuard::verify);
            logger.setLevel(ch.qos.logback.classic.Level.OFF);
            assertDoesNotThrow(MessagingLoggingGuard::verify);
        } finally { logger.setLevel(previous); }
    }
}
