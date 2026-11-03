package com.contoso.messaging;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPInputStream;

final class NativeTestCapture {
    static final int PAYLOAD_LIMIT = 1_048_576;
    static final int ENVELOPE_LIMIT = 512;
    static final int PAYLOAD_COUNT_LIMIT = 16;
    static final int TOTAL_BYTE_LIMIT = 4 * PAYLOAD_LIMIT;
    static final int CONTROL_LIMIT = 65_536;
    static final int SCALAR_BYTE_LIMIT = 4096;
    static final int KEY_BYTE_LIMIT = 128;
    static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(32)
            .maxStringLength(SCALAR_BYTE_LIMIT).maxNameLength(KEY_BYTE_LIMIT).maxNumberLength(128).build())
        .build()).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    record Payload(byte[] original, String encoding, int envelopes, int decodedBytes) {
        Payload { original = original.clone(); }
        @Override public byte[] original() { return original.clone(); }
    }

    private final Set<String> publishers = new HashSet<>();
    private final List<Payload> payloads = new ArrayList<>();
    private final List<String> forbiddenValues;
    private final AtomicReference<String> failure = new AtomicReference<>();
    private final AtomicInteger excludedHttpRequests = new AtomicInteger();
    private int envelopeCount;
    private int totalBytes;
    private int totalDecodedBytes;

    NativeTestCapture() {
        this(List.of("ASYNC_TOKEN_CANARY_" + UUID.randomUUID(), UUID.randomUUID().toString()));
    }

    NativeTestCapture(List<String> forbiddenValues) {
        this.forbiddenValues = List.copyOf(forbiddenValues);
        if (this.forbiddenValues.size() > 64 || this.forbiddenValues.stream().anyMatch(value ->
            value.getBytes(StandardCharsets.UTF_8).length < 8 || value.getBytes(StandardCharsets.UTF_8).length > 16384) ||
            this.forbiddenValues.stream().mapToInt(value -> value.getBytes(StandardCharsets.UTF_8).length).sum() > 65_536) {
            throw rejected("MARKER_CONFIGURATION");
        }
    }

    synchronized void publisher(String value) {
        if (value == null || !value.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") ||
            publishers.size() >= 8) throw rejected("PUBLISHER_CONFIGURATION");
        publishers.add(value);
    }

    synchronized int accept(byte[] bytes, String encoding) {
        try {
            if (payloads.size() >= PAYLOAD_COUNT_LIMIT || totalBytes + bytes.length > TOTAL_BYTE_LIMIT) {
                throw rejected("TOTAL_BOUND");
            }
            Decoded decoded = decode(bytes, encoding);
            List<JsonNode> envelopes = decoded.envelopes();
            if (totalDecodedBytes + decoded.bytes() > TOTAL_BYTE_LIMIT) throw rejected("TOTAL_BOUND");
            if (envelopeCount + envelopes.size() > ENVELOPE_LIMIT) throw rejected("ENVELOPE_BOUND");
            for (JsonNode envelope : envelopes) {
                if (!envelope.path("iKey").isTextual() || !publishers.contains(envelope.path("iKey").textValue())) {
                    throw rejected("PUBLISHER_UNEXPECTED");
                }
            }
            payloads.add(new Payload(bytes, encoding, envelopes.size(), decoded.bytes()));
            totalBytes += bytes.length;
            totalDecodedBytes += decoded.bytes();
            envelopeCount += envelopes.size();
            return envelopes.size();
        } catch (RuntimeException unsafe) {
            failure.compareAndSet(null, "ASYNC_NATIVE_ORIGINAL_REJECTED");
            throw rejected("ORIGINAL_REJECTED");
        }
    }

    void receive(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod()) ||
            !Set.of("/v2/track", "/v2.1/track").contains(exchange.getRequestURI().getPath())) {
            excludedHttpRequests.incrementAndGet();
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
            return;
        }
        try {
            if (exchange.getRequestURI().getRawQuery() != null) throw rejected("TRACKING_ROUTE");
            String encoding = exchange.getRequestHeaders().getFirst("Content-Encoding");
            if (encoding == null) encoding = "identity";
            int count = accept(bounded(exchange.getRequestBody(), PAYLOAD_LIMIT), encoding);
            byte[] response = ("{\"itemsReceived\":" + count + ",\"itemsAccepted\":" + count + ",\"errors\":[]}")
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
        } catch (IOException | RuntimeException unsafe) {
            failure.compareAndSet(null, "ASYNC_NATIVE_ORIGINAL_REJECTED");
            exchange.sendResponseHeaders(400, -1);
        } finally {
            exchange.close();
        }
    }

    synchronized int envelopeCount() { return envelopeCount; }
    synchronized List<Payload> payloads() {
        if (failure.get() != null || payloads.isEmpty()) throw rejected("CAPTURE_INCOMPLETE");
        return List.copyOf(payloads);
    }
    synchronized List<String> publishers() { return List.copyOf(publishers); }
    void healthy() { if (failure.get() != null) throw rejected("CAPTURE_INCOMPLETE"); }
    void rejectControl() { failure.compareAndSet(null, "ASYNC_NATIVE_CONTROL_REJECTED"); }

    static Path epoch(Path parent) throws IOException {
        Files.createDirectories(parent);
        String id = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssSSS'Z'").withZone(ZoneOffset.UTC).format(Instant.now()) +
            "-" + UUID.randomUUID();
        return Files.createDirectory(parent.resolve(id));
    }

    static void writeNew(Path path, Object value, List<ApprovedCapture> approvals) throws IOException {
        if (approvals.isEmpty() || approvals.stream().anyMatch(java.util.Objects::isNull)) {
            throw rejected("ORIGINAL_POLICY_REQUIRED");
        }
        Files.write(path, JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(value),
            StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    static final class ApprovedCapture {
        private final JsonNode summary;
        private final List<JsonNode> rows;
        private ApprovedCapture(JsonNode summary, List<JsonNode> rows) {
            this.summary = summary.deepCopy();
            this.rows = rows.stream().map(value -> value.<JsonNode>deepCopy()).toList();
        }
        JsonNode summary() { return summary.deepCopy(); }
        List<JsonNode> rows() { return rows.stream().map(value -> value.<JsonNode>deepCopy()).toList(); }
    }

    ApprovedCapture approve(Path root) throws Exception {
        healthy();
        List<Payload> packets = payloads();
        var sources = List.of("tools\\security\\Scan-NativePayloads.mjs", "tools\\security\\native-payload.mjs",
            "tools\\security\\values.mjs");
        Map<String, String> before = sourceHashes(root, sources);
        var input = JSON.createObjectNode();
        input.set("publisherKeys", JSON.valueToTree(publishers()));
        input.set("forbiddenValues", JSON.valueToTree(forbiddenValues));
        var originalPayloads = input.putArray("payloads");
        for (Payload payload : packets) {
            originalPayloads.addObject().put("rawBase64", Base64.getEncoder().encodeToString(payload.original()))
                .put("encoding", payload.encoding());
        }
        var builder = new ProcessBuilder("node", root.resolve(sources.getFirst()).toString());
        builder.environment().remove("NODE_OPTIONS");
        builder.environment().remove("NODE_PATH");
        Process validator = builder.start();
        String startedAtUtc = Instant.now().toString();
        String executable = validator.info().command().orElse("");
        var output = CompletableFuture.supplyAsync(() -> validatorBytes(validator.getInputStream(), 8 * PAYLOAD_LIMIT));
        var errors = CompletableFuture.supplyAsync(() -> validatorBytes(validator.getErrorStream(), 4096));
        var writer = CompletableFuture.runAsync(() -> {
            try (var stream = validator.getOutputStream()) { stream.write(JSON.writeValueAsBytes(input)); }
            catch (IOException unsafe) { throw rejected("VALIDATOR_PIPE_FAILED"); }
        });
        try {
            require(!executable.isBlank());
            String executableHashBefore = fileSha256(Path.of(executable));
            if (!validator.waitFor(20, TimeUnit.SECONDS)) throw rejected("VALIDATOR_TIMEOUT");
            writer.get(2, TimeUnit.SECONDS);
            byte[] stdout = output.get(2, TimeUnit.SECONDS);
            errors.get(2, TimeUnit.SECONDS);
            if (validator.exitValue() != 0) throw rejected("ORIGINAL_POLICY_REJECTED");
            JsonNode capture = JSON.readTree(stdout);
            require("contoso.native-api-safe-capture.v1".equals(capture.path("schema").asText()));
            require(capture.path("verified").isBoolean() && capture.path("verified").booleanValue());
            require(capture.path("validatorPid").asLong() == validator.pid());
            require(capture.path("nodeVersion").asText().matches("v[0-9]+\\.[0-9]+\\.[0-9]+"));
            require(before.get(sources.get(0)).equals(capture.path("validatorCliSourceSha256").asText()));
            require(before.get(sources.get(1)).equals(capture.path("validatorSourceSha256").asText()));
            require(before.get(sources.get(2)).equals(capture.path("sharedPolicySha256").asText()));
            require(before.equals(sourceHashes(root, sources)));
            String executableHashAfter = fileSha256(Path.of(executable));
            require(executableHashBefore.equals(executableHashAfter));
            require("NOT_CERTIFIED".equals(capture.path("certification").asText()));
            for (String flag : List.of("sourceAcceptanceIsCertification", "independentProducerAuthorityVerified", "allTablePrivacyGateVerified")) {
                require(capture.path(flag).isBoolean() && !capture.path(flag).booleanValue());
            }
            JsonNode receipts = capture.path("payloadReceipts"), rows = capture.path("nativeEnvelopes");
            require(receipts.isArray() && receipts.size() == packets.size() && rows.isArray());
            int raw = 0, decoded = 0, envelopes = 0;
            for (int index = 0; index < packets.size(); index++) {
                Payload payload = packets.get(index);
                JsonNode receipt = receipts.get(index);
                require(sha256(payload.original()).equals(receipt.path("originalPayloadSha256").asText()));
                require(payload.original().length == receipt.path("originalPayloadBytes").asInt());
                require(payload.decodedBytes() == receipt.path("decodedPayloadBytes").asInt());
                require(payload.envelopes() == receipt.path("originalEnvelopeCount").asInt());
                for (String flag : List.of("strictDuplicateKeysVerified", "scannedAllOriginalValues", "projectedAfterScan")) {
                    require(receipt.path(flag).isBoolean() && receipt.path(flag).booleanValue());
                }
                require(receipt.path("originalPayloadRetained").isBoolean() && !receipt.path("originalPayloadRetained").booleanValue());
                raw += payload.original().length;
                decoded += payload.decodedBytes();
                envelopes += payload.envelopes();
            }
            require(capture.path("actualCounts").path("payloads").asInt() == packets.size());
            require(capture.path("actualCounts").path("originalRawBytes").asInt() == raw);
            require(capture.path("actualCounts").path("decodedBytes").asInt() == decoded);
            require(capture.path("actualCounts").path("envelopes").asInt() == envelopes && rows.size() == envelopes);
            var projection = new ArrayList<JsonNode>();
            rows.forEach(projection::add);
            var summary = ((com.fasterxml.jackson.databind.node.ObjectNode) capture.deepCopy());
            summary.remove("nativeEnvelopes");
            summary.put("validatorStartedAtUtc", startedAtUtc).put("validatorEndedAtUtc", Instant.now().toString());
            summary.put("validatorExecutable", executable).put("validatorExecutableSha256Before", executableHashBefore)
                .put("validatorExecutableSha256After", executableHashAfter);
            summary.set("sourceHashesBefore", JSON.valueToTree(before));
            summary.set("sourceHashesAfter", JSON.valueToTree(sourceHashes(root, sources)));
            summary.put("knownPublisherCount", publishers().size()).put("exactForbiddenMarkerCount", forbiddenValues.size());
            summary.put("excludedNonTelemetryHttpRequests", excludedHttpRequests.get());
            summary.put("oneWholeExecutionCaptureWithoutReset", true).put("cumulativeOriginalPayloadsRescanned", true);
            healthy();
            return new ApprovedCapture(summary, projection);
        } catch (Exception unsafe) {
            failure.compareAndSet(null, "ASYNC_NATIVE_ORIGINAL_POLICY_REJECTED");
            throw rejected("ORIGINAL_POLICY_REJECTED");
        } finally {
            if (validator.isAlive()) { validator.destroyForcibly(); validator.waitFor(2, TimeUnit.SECONDS); }
        }
    }

    private static byte[] validatorBytes(InputStream stream, int maximum) {
        try { return bounded(stream, maximum); }
        catch (IOException unsafe) { throw rejected("VALIDATOR_OUTPUT_BOUND"); }
    }

    private static Map<String, String> sourceHashes(Path root, List<String> sources) throws Exception {
        var result = new LinkedHashMap<String, String>();
        for (String source : sources) result.put(source, sha256(Files.readAllBytes(root.resolve(source))));
        return Map.copyOf(result);
    }

    static String sha256(byte[] bytes) throws java.security.NoSuchAlgorithmException {
        return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String fileSha256(Path path) throws Exception {
        var digest = java.security.MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        try (var stream = Files.newInputStream(path)) {
            byte[] buffer = new byte[8192];
            for (int length; (length = stream.read(buffer)) != -1;) {
                bytes += length;
                if (bytes > 268_435_456) throw rejected("VALIDATOR_TOOL_BOUND");
                digest.update(buffer, 0, length);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static void require(boolean valid) { if (!valid) throw rejected("VALIDATOR_BINDING_UNVERIFIED"); }

    static byte[] bounded(InputStream stream, int maximum) throws IOException {
        byte[] bytes = stream.readNBytes(maximum + 1);
        if (bytes.length > maximum) throw new IOException("ASYNC_NATIVE_BYTE_BOUND");
        return bytes;
    }

    private record Decoded(List<JsonNode> envelopes, int bytes) {}

    static List<JsonNode> originals(byte[] original, String encoding) { return decode(original, encoding).envelopes(); }

    private static Decoded decode(byte[] original, String encoding) {
        try {
            if (original == null || original.length == 0 || original.length > PAYLOAD_LIMIT ||
                !Set.of("identity", "gzip").contains(encoding)) throw rejected("WIRE_BOUND_OR_ENCODING");
            byte[] decoded = original;
            if ("gzip".equals(encoding)) {
                try (var gzip = new GZIPInputStream(new ByteArrayInputStream(original))) {
                    decoded = bounded(gzip, PAYLOAD_LIMIT);
                }
            }
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(decoded)).toString();
            var envelopes = new ArrayList<JsonNode>();
            try {
                append(envelopes, strictTree(text));
            } catch (RuntimeException invalidWholeDocument) {
                envelopes.clear();
                for (String line : text.split("\\r?\\n", -1)) {
                    if (!line.isBlank()) append(envelopes, strictTree(line));
                }
            }
            if (envelopes.isEmpty()) throw rejected("EMPTY_ENVELOPES");
            return new Decoded(List.copyOf(envelopes), decoded.length);
        } catch (IOException | RuntimeException unsafe) {
            throw rejected("ORIGINAL_REJECTED");
        }
    }

    static JsonNode strictTree(String text) {
        try {
            JsonNode value = JSON.readTree(text);
            if (value == null) throw rejected("EMPTY_JSON");
            validateBounds(value, 0, new int[] { 0 });
            return value;
        } catch (IOException | RuntimeException unsafe) {
            throw rejected("JSON_REJECTED");
        }
    }

    static JsonNode control(byte[] bytes) {
        try {
            if (bytes.length == 0 || bytes.length > CONTROL_LIMIT) throw rejected("CONTROL_BOUND");
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return strictTree(text);
        } catch (IOException | RuntimeException unsafe) {
            throw rejected("CONTROL_REJECTED");
        }
    }

    static Envelope[] carriers(byte[] bytes) {
        JsonNode value = control(bytes);
        if (!value.isArray() || value.size() != 5) throw rejected("CARRIER_SCHEMA");
        var codec = new EnvelopeCodec();
        var envelopes = new ArrayList<Envelope>();
        for (JsonNode item : value) {
            try { envelopes.add(codec.decode(JSON.writeValueAsBytes(item))); }
            catch (IOException | RuntimeException unsafe) { throw rejected("CARRIER_SCHEMA"); }
        }
        return envelopes.toArray(Envelope[]::new);
    }

    static JsonNode decisions(byte[] bytes) {
        JsonNode value = control(bytes);
        var keys = new HashSet<String>();
        value.fieldNames().forEachRemaining(keys::add);
        if (!value.isObject() || !keys.equals(Set.of("unlinkedRoot", "ordinaryProcess", "replaySend", "resultSends",
            "fanIn", "batchItems", "inputContexts", "scope")) ||
            !"Actual current provider/source carriers and runtime/H2 outcomes; no Azure broker or permission proof"
                .equals(value.path("scope").asText())) throw rejected("DECISION_SCHEMA");
        for (String name : List.of("unlinkedRoot", "ordinaryProcess", "replaySend", "fanIn")) decision(value.path(name));
        for (String name : List.of("resultSends", "batchItems", "inputContexts")) {
            JsonNode array = value.path(name);
            if (!array.isArray() || array.size() != (name.equals("inputContexts") ? 5 : 2)) throw rejected("DECISION_SCHEMA");
            array.forEach(NativeTestCapture::decision);
        }
        return value;
    }

    private static void decision(JsonNode value) {
        var keys = new HashSet<String>();
        value.fieldNames().forEachRemaining(keys::add);
        if (!value.isObject() || !keys.equals(Set.of("traceId", "spanId", "sampled")) ||
            !value.path("traceId").isTextual() || !value.path("spanId").isTextual() ||
            !value.path("sampled").isBoolean() || !value.path("traceId").asText().matches("(?!0{32}$)[0-9a-f]{32}") ||
            !value.path("spanId").asText().matches("(?!0{16}$)[0-9a-f]{16}")) throw rejected("DECISION_SCHEMA");
    }

    private static void append(List<JsonNode> envelopes, JsonNode value) {
        if (value.isArray()) {
            if (value.isEmpty()) throw rejected("EMPTY_ENVELOPES");
            for (JsonNode item : value) {
                if (!item.isObject()) throw rejected("ENVELOPE_SCHEMA");
                envelopes.add(item);
            }
        } else if (value.isObject()) {
            envelopes.add(value);
        } else throw rejected("ENVELOPE_SCHEMA");
        if (envelopes.size() > ENVELOPE_LIMIT) throw rejected("ENVELOPE_BOUND");
    }

    private static void validateBounds(JsonNode value, int depth, int[] fields) {
        if (++fields[0] > 8192 || depth > 32) throw rejected("JSON_BOUND");
        if (value.isTextual() && value.textValue().getBytes(StandardCharsets.UTF_8).length > SCALAR_BYTE_LIMIT) {
            throw rejected("SCALAR_BOUND");
        }
        if (value.isObject()) {
            var entries = value.fields();
            while (entries.hasNext()) {
                var entry = entries.next();
                if (entry.getKey().getBytes(StandardCharsets.UTF_8).length > KEY_BYTE_LIMIT) throw rejected("KEY_BOUND");
                validateBounds(entry.getValue(), depth + 1, fields);
            }
        } else if (value.isArray()) {
            for (JsonNode item : value) validateBounds(item, depth + 1, fields);
        }
    }

    private static IllegalStateException rejected(String code) {
        return new IllegalStateException("ASYNC_NATIVE_" + code);
    }
}
