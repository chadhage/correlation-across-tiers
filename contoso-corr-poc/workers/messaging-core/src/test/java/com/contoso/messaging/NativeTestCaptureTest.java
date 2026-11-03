package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;

class NativeTestCaptureTest {
    @Test void strictOriginalParsingRejectsPlainEscapedAndNestedDuplicateKeys() {
        for (String original : new String[] {
            "{\"iKey\":\"a\",\"iKey\":\"b\"}", "{\"iKey\":\"a\",\"\\u0069Key\":\"b\"}",
            "{\"data\":{\"value\":1,\"value\":2}}", "{\"data\":{},\"data\":{}}"
        }) {
            var failure = assertThrows(IllegalStateException.class,
                () -> NativeTestCapture.originals(bytes(original), "identity"));
            assertNull(failure.getCause());
            assertFalse(failure.toString().contains(original));
        }
    }

    @Test void jsonArrayObjectAndNdjsonGzipPreserveActualEnvelopeCounts() throws Exception {
        assertEquals(1, NativeTestCapture.originals(bytes("{\"iKey\":\"a\"}"), "identity").size());
        assertEquals(2, NativeTestCapture.originals(bytes("[{\"iKey\":\"a\"},{\"iKey\":\"b\"}]"), "identity").size());
        String ndjson = "{\"iKey\":\"a\"}\n{\"iKey\":\"b\"}\n";
        assertEquals(2, NativeTestCapture.originals(bytes(ndjson), "identity").size());
        assertEquals(2, NativeTestCapture.originals(gzip(bytes(ndjson)), "gzip").size());
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(bytes("{\"iKey\":\"a\"}{\"iKey\":\"b\"}"), "identity"));
    }

    @Test void wireDecodedEnvelopeUtf8KeyScalarAndDepthLimitsFailClosedWithoutTruncation() throws Exception {
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(new byte[NativeTestCapture.PAYLOAD_LIMIT + 1], "identity"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(gzip(new byte[NativeTestCapture.PAYLOAD_LIMIT + 1]), "gzip"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(new byte[] { (byte) 0xff }, "identity"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(bytes("{\"iKey\":\"a\"}"), "br"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.originals(bytes("[" + "{\"iKey\":\"a\"},".repeat(512) + "{\"iKey\":\"a\"}]"), "identity"));
        for (String value : new String[] { "A".repeat(4097), "é".repeat(2049) }) {
            assertThrows(IllegalStateException.class,
                () -> NativeTestCapture.originals(bytes("{\"value\":\"" + value + "\"}"), "identity"));
        }
        assertNotNull(NativeTestCapture.strictTree("{\"value\":\"" + "é".repeat(2048) + "\"}"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.strictTree("{\"" + "é".repeat(65) + "\":1}"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.strictTree("[".repeat(33) + "0" + "]".repeat(33)));
    }

    @Test void onlyActualRegisteredPublisherAndCompleteCaptureCanProceed() {
        String publisher = UUID.randomUUID().toString();
        var capture = new NativeTestCapture();
        capture.publisher(publisher);
        assertEquals(1, capture.accept(bytes("{\"iKey\":\"" + publisher + "\"}"), "identity"));
        assertEquals(1, capture.envelopeCount());
        assertEquals(1, capture.payloads().size());
        assertThrows(IllegalStateException.class,
            () -> capture.accept(bytes("{\"iKey\":\"" + UUID.randomUUID() + "\"}"), "identity"));
        assertThrows(IllegalStateException.class, capture::payloads);
        assertThrows(IllegalStateException.class, () -> new NativeTestCapture().payloads());
        assertThrows(IllegalStateException.class,
            () -> new NativeTestCapture().publisher("00000000-0000-1000-8000-000000000001"));
    }

    @Test void controlsAndValidatorStreamsAreBoundedWithoutRetainingRejectedBytes() throws Exception {
        assertEquals(128, NativeTestCapture.bounded(new ByteArrayInputStream(new byte[128]), 128).length);
        assertThrows(java.io.IOException.class,
            () -> NativeTestCapture.bounded(new ByteArrayInputStream(new byte[129]), 128));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.strictTree("{\"traceparent\":\"a\",\"traceparent\":\"b\"}"));
    }

    @Test void controlsRejectUnknownFieldsAndCannotIntroduceUnverifiedNativeDecisions() throws Exception {
        var decision = NativeTestCapture.JSON.createObjectNode()
            .put("traceId", "a".repeat(32)).put("spanId", "b".repeat(16)).put("sampled", false);
        var control = NativeTestCapture.JSON.createObjectNode();
        for (String name : new String[] { "unlinkedRoot", "ordinaryProcess", "replaySend", "fanIn" }) control.set(name, decision);
        control.putArray("resultSends").add(decision).add(decision);
        control.putArray("batchItems").add(decision).add(decision);
        var inputs = control.putArray("inputContexts");
        for (int index = 0; index < 5; index++) inputs.add(decision);
        control.put("scope", "Actual current provider/source carriers and runtime/H2 outcomes; no Azure broker or permission proof");
        assertEquals(control, NativeTestCapture.decisions(NativeTestCapture.JSON.writeValueAsBytes(control)));
        control.put("unexpected", "RAW_CONTROL_CANARY");
        var failure = assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.decisions(NativeTestCapture.JSON.writeValueAsBytes(control)));
        assertFalse(failure.toString().contains("CANARY"));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.control(new byte[] { (byte) 0xff }));
        assertThrows(IllegalStateException.class,
            () -> NativeTestCapture.carriers(bytes("[]")));
    }

    @Test void completeOriginalPolicyBridgeBindsActualNodePidRawBytesCountsAndSourceBeforeProjection() throws Exception {
        String publisher = UUID.randomUUID().toString();
        var capture = new NativeTestCapture();
        capture.publisher(publisher);
        byte[] original = bytes("{\"iKey\":\"" + publisher + "\",\"time\":\"2026-11-01T23:00:00.000Z\"," +
            "\"tags\":{\"ai.cloud.role\":\"contoso-fixture\",\"ai.operation.id\":\"" + "a".repeat(32) + "\"}," +
            "\"data\":{\"baseType\":\"RemoteDependencyData\",\"baseData\":{\"id\":\"" + "b".repeat(16) +
            "\",\"name\":\"contoso.fixture\",\"type\":\"InProc\",\"properties\":{}}}}");
        capture.accept(original, "identity");
        var approved = capture.approve(java.nio.file.Path.of(System.getProperty("basedir"), "..", "..").toAbsolutePath().normalize());
        var receipt = approved.summary().path("payloadReceipts").get(0);
        assertEquals(NativeTestCapture.sha256(original), receipt.path("originalPayloadSha256").asText());
        assertEquals(original.length, receipt.path("originalPayloadBytes").asInt());
        assertTrue(receipt.path("strictDuplicateKeysVerified").asBoolean());
        assertTrue(receipt.path("scannedAllOriginalValues").asBoolean());
        assertTrue(receipt.path("projectedAfterScan").asBoolean());
        assertFalse(receipt.path("originalPayloadRetained").asBoolean());
        assertTrue(approved.summary().path("validatorPid").asLong() > 0);
        assertEquals(1, approved.rows().size());
        assertEquals("b".repeat(16), approved.rows().getFirst().path("data").path("baseData").path("id").asText());
        assertFalse(approved.rows().getFirst().has("iKey"));
        assertFalse(approved.summary().toString().contains(publisher));
    }

    @Test void sharedOriginalPolicyRejectsTokensObjectMarkersAndPrivateRemovedTagsWithoutPartialProof() {
        for (String location : new String[] { "property-token", "property-oid", "removed-tag" }) {
            String publisher = UUID.randomUUID().toString();
            String tokenMarker = "EXACT_TOKEN_CANARY_" + UUID.randomUUID();
            String objectMarker = UUID.randomUUID().toString();
            var capture = new NativeTestCapture(java.util.List.of(tokenMarker, objectMarker));
            capture.publisher(publisher);
            var original = NativeTestCapture.JSON.createObjectNode().put("iKey", publisher);
            var tags = original.putObject("tags");
            var properties = original.putObject("data").putObject("baseData").putObject("properties");
            if (location.equals("removed-tag")) tags.put("ai.cloud.roleInstance", tokenMarker);
            else properties.put("unclassified", location.equals("property-token") ? tokenMarker : objectMarker);
            capture.accept(bytes(original.toString()), "identity");
            var failure = assertThrows(IllegalStateException.class, () -> capture.approve(
                java.nio.file.Path.of(System.getProperty("basedir"), "..", "..").toAbsolutePath().normalize()));
            assertNull(failure.getCause());
            assertFalse(failure.toString().contains(tokenMarker));
            assertFalse(failure.toString().contains(objectMarker));
            assertThrows(IllegalStateException.class, capture::payloads);
        }
        String conflictingPublisher = UUID.randomUUID().toString();
        var conflicting = new NativeTestCapture(java.util.List.of(conflictingPublisher));
        conflicting.publisher(conflictingPublisher);
        conflicting.accept(bytes("{\"iKey\":\"" + conflictingPublisher + "\"}"), "identity");
        assertThrows(IllegalStateException.class, () -> conflicting.approve(
            java.nio.file.Path.of(System.getProperty("basedir"), "..", "..").toAbsolutePath().normalize()));
        assertThrows(IllegalStateException.class, conflicting::payloads);
    }

    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    private static byte[] gzip(byte[] bytes) throws Exception {
        var output = new ByteArrayOutputStream();
        try (var gzip = new GZIPOutputStream(output)) { gzip.write(bytes); }
        return output.toByteArray();
    }
}
