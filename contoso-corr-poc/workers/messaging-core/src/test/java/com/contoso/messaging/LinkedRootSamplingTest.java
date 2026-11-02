package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.RuntimeGuard;
import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class LinkedRootSamplingTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void keepRequired00RootsUnsampledAndDelegate01MixedAndUnlinkedToExistingProvider() throws Exception {
        var mapper = NativeTestCapture.JSON;
        Path root = Path.of(System.getProperty("basedir"), "..", "..").toAbsolutePath().normalize();
        Path output = NativeTestCapture.epoch(Path.of(System.getProperty("basedir"), "target", "linked-root-sampling", "1.1.0", "epochs"));
        Path extension = Path.of(System.getenv("CONTOSO_PARENT_SAFE_JAR"));
        String extensionHash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
            .digest(Files.readAllBytes(extension)));
        var lock = mapper.readTree(Path.of(System.getProperty("basedir"), "..", "..", "config", "versions.lock.json").toFile());
        JsonNode pinned = java.util.stream.StreamSupport.stream(lock.path("extensions").spliterator(), false)
            .filter(value -> value.path("artifactId").asText().equals("contoso-parent-safe-sampler")).findFirst().orElseThrow();
        assertEquals("1.1.0", pinned.path("version").asText());
        assertEquals(extensionHash, pinned.path("sha256").asText());
        var observations = new ArrayList<Map<String, Object>>();
        var approvals = new ArrayList<NativeTestCapture.ApprovedCapture>();
        var capture = new NativeTestCapture();
        var sourceInputs = new java.util.HashMap<Integer, Envelope[]>();
        for (int sourcePercentage : List.of(0, 100, -1)) {
            var carriers = new AtomicReference<byte[]>();
            var decisions = new AtomicReference<JsonNode>();
            var children = new ArrayList<Map<String, Object>>();
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                if (!List.of("/carriers", "/decisions").contains(path)) {
                    capture.receive(exchange);
                    return;
                }
                try {
                    if (exchange.getRequestURI().getRawQuery() != null) throw new IllegalStateException("ASYNC_NATIVE_CONTROL_ROUTE");
                    if (path.equals("/carriers")) {
                        if (exchange.getRequestMethod().equals("POST")) {
                            byte[] bytes = NativeTestCapture.bounded(exchange.getRequestBody(), NativeTestCapture.CONTROL_LIMIT);
                            NativeTestCapture.carriers(bytes);
                            if (!carriers.compareAndSet(null, bytes)) throw new IllegalStateException("ASYNC_NATIVE_DUPLICATE_CONTROL");
                            exchange.sendResponseHeaders(200, -1);
                        } else if (exchange.getRequestMethod().equals("GET")) {
                            byte[] bytes = carriers.get();
                            if (bytes == null) throw new IllegalStateException("ASYNC_NATIVE_CARRIER_MISSING");
                            exchange.sendResponseHeaders(200, bytes.length);
                            exchange.getResponseBody().write(bytes);
                        } else throw new IllegalStateException("ASYNC_NATIVE_CONTROL_ROUTE");
                    } else {
                        if (!exchange.getRequestMethod().equals("POST")) throw new IllegalStateException("ASYNC_NATIVE_CONTROL_ROUTE");
                        JsonNode value = NativeTestCapture.decisions(NativeTestCapture.bounded(
                            exchange.getRequestBody(), NativeTestCapture.CONTROL_LIMIT));
                        if (!decisions.compareAndSet(null, value)) throw new IllegalStateException("ASYNC_NATIVE_DUPLICATE_CONTROL");
                        exchange.sendResponseHeaders(200, -1);
                    }
                } catch (java.io.IOException | RuntimeException unsafe) {
                    capture.rejectControl();
                    exchange.sendResponseHeaders(400, -1);
                } finally {
                    exchange.close();
                }
            });
            server.start();
            String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
            try {
                if (sourcePercentage >= 0) children.add(run("produce", sourcePercentage, endpoint, output, capture));
                else {
                    Envelope[] zero = sourceInputs.get(0), one = sourceInputs.get(100);
                    carriers.set(mapper.writeValueAsBytes(List.of(one[0], one[1], one[2], zero[3], one[4])));
                }
                assertNotNull(carriers.get(), "actual producer carrier was not transferred");
                var source = NativeTestCapture.carriers(carriers.get());
                for (int index = 0; index < source.length; index++) {
                    var envelope = source[index];
                    var span = TraceContexts.extract(envelope).spanContext();
                    assertTrue(span.isValid());
                    assertEquals(sourcePercentage == 100 || sourcePercentage == -1 && index != 3, span.isSampled());
                }
                if (sourcePercentage >= 0) sourceInputs.put(sourcePercentage, source);
                int producerCount = capture.envelopeCount();
                children.add(run("consume", 100, endpoint, output, capture));
                server.stop(0);
                NativeTestCapture.ApprovedCapture approved = capture.approve(root);
                approvals.add(approved);
                List<JsonNode> nativeRows = approved.rows();
                JsonNode observed = decisions.get();
                assertNotNull(observed, "actual consumer decision was not transferred");
                assertEquals(2, observed.path("resultSends").size());
                assertEquals(2, observed.path("batchItems").size());
                assertTrue(observed.path("unlinkedRoot").path("sampled").asBoolean(),
                    "unlinked root must retain the existing consumer100 delegate decision");
                assertEquals(sourcePercentage != 0, observed.path("ordinaryProcess").path("sampled").asBoolean());
                assertEquals(observed.path("inputContexts").get(0).path("traceId").asText(), observed.path("ordinaryProcess").path("traceId").asText());
                if (sourcePercentage != 0) {
                    assertTrue(observed.path("replaySend").path("sampled").asBoolean());
                    assertTrue(observed.path("fanIn").path("sampled").asBoolean());
                    observed.path("resultSends").forEach(value -> assertTrue(value.path("sampled").asBoolean()));
                    observed.path("batchItems").forEach(value -> assertTrue(value.path("sampled").asBoolean()));
                }
                String ordinaryId = observed.path("ordinaryProcess").path("spanId").asText();
                var consumer = nativeRows.subList(producerCount, nativeRows.size()).stream().filter(value ->
                    value.path("data").path("baseType").asText().equals("RequestData") ||
                    value.path("data").path("baseType").asText().equals("RemoteDependencyData")).toList();
                long exportedOrdinary = consumer.stream().filter(value -> value.path("data").path("baseData").path("id").asText().equals(ordinaryId)).count();
                assertEquals(sourcePercentage != 0 ? 1 : 0, exportedOrdinary);
                var exported = consumer.stream().map(value -> Map.of(
                    "name", value.path("data").path("baseData").path("name").asText(),
                    "traceId", value.path("tags").path("ai.operation.id").asText(),
                    "spanId", value.path("data").path("baseData").path("id").asText(),
                    "parentId", value.path("tags").path("ai.operation.parentId").asText(),
                    "links", value.path("data").path("baseData").path("properties").path("_MS.links").asText())).toList();
                boolean everyOutgoingZero = sourcePercentage == 0 && !observed.path("replaySend").path("sampled").asBoolean() &&
                    !observed.path("fanIn").path("sampled").asBoolean() &&
                    java.util.stream.StreamSupport.stream(observed.path("resultSends").spliterator(), false).noneMatch(value -> value.path("sampled").asBoolean()) &&
                    java.util.stream.StreamSupport.stream(observed.path("batchItems").spliterator(), false).noneMatch(value -> value.path("sampled").asBoolean());
                if (sourcePercentage == 0) {
                    assertTrue(everyOutgoingZero, "required authenticated00 linked-root outputs must all remain unsampled");
                    var outputContexts = new ArrayList<JsonNode>(List.of(observed.path("ordinaryProcess"),
                        observed.path("replaySend"), observed.path("fanIn")));
                    observed.path("resultSends").forEach(outputContexts::add);
                    observed.path("batchItems").forEach(outputContexts::add);
                    for (var context : outputContexts) {
                        assertFalse(context.path("sampled").asBoolean());
                        assertTrue(consumer.stream().noneMatch(value -> value.path("data").path("baseData").path("id")
                            .asText().equals(context.path("spanId").asText())), "all-unsampled linked work is intentionally unexported");
                    }
                }
                assertNotEquals(observed.path("inputContexts").get(1).path("traceId").asText(),
                    observed.path("replaySend").path("traceId").asText());
                assertNotEquals(observed.path("inputContexts").get(2).path("traceId").asText(),
                    observed.path("fanIn").path("traceId").asText());
                observations.add(Map.of("sourcePercentage", sourcePercentage, "inputMode",
                    sourcePercentage < 0 ? "mixed-native-producer-0-and-100" : "actual-native-producer-" + sourcePercentage, "consumerPercentage", 100,
                    "actualDecisions", observed, "exportedOrdinaryCount", exportedOrdinary,
                    "everyOutgoingZeroSatisfied", everyOutgoingZero, "actualNativeSpans", exported,
                    "originalPrivacyCapture", approved.summary(), "nativeChildren", children));
            } finally { server.stop(0); }
        }
        assertEquals(extensionHash, java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
            .digest(Files.readAllBytes(extension))), "qualification candidate changed during the probe");
        Path qualification = output.resolve("qualification.json");
        NativeTestCapture.writeNew(qualification, Map.of(
            "schemaVersion", 1, "scope", "Actual current provider, producer SDK-carrier contexts and runtime/H2 outcomes; no Azure/permission/Functions proof",
            "certified", false, "guardArtifactVersion", "1.1.0", "extensionSha256", extensionHash,
            "guardPolicy", "DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS", "observations", observations), approvals);
        System.out.println("ASYNC_NATIVE_CAPTURE_RECEIPT " + mapper.writeValueAsString(Map.of(
            "path", qualification.toAbsolutePath().toString(), "sha256", NativeTestCapture.sha256(Files.readAllBytes(qualification)),
            "certification", "NOT_CERTIFIED")));
    }

    private Map<String, Object> run(String phase, int percentage, String endpoint, Path execution,
                                    NativeTestCapture capture) throws Exception {
        Path scratch = Files.createDirectory(execution.resolve(phase + "-" + percentage + "-" + UUID.randomUUID()));
        var arguments = new ArrayList<String>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
            "-javaagent:" + System.getenv("CONTOSO_AGENT_JAR"), "-Dotel.javaagent.extensions=" + System.getenv("CONTOSO_PARENT_SAFE_JAR"),
            "-Djava.io.tmpdir=" + scratch));
        RuntimeGuard.MANUAL_MODULES.forEach(module -> arguments.add("-Dotel.instrumentation." + module + ".enabled=false"));
        arguments.addAll(List.of("-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
            LinkedSamplingProbe.class.getName(), phase, endpoint));
        var builder = new ProcessBuilder(arguments).redirectErrorStream(true);
        var env = builder.environment();
        for (String key : List.of("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "APPLICATIONINSIGHTS_CONFIGURATION_FILE",
            "APPLICATIONINSIGHTS_AUTHENTICATION_STRING", "APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE", "APPLICATIONINSIGHTS_SAMPLING_REQUESTS_PER_SECOND",
            "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "AZURE_CLIENT_SECRET", "AZURE_CLIENT_ID")) env.remove(key);
        String publisher = UUID.randomUUID().toString();
        capture.publisher(publisher);
        env.put("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=" + publisher + ";IngestionEndpoint=" + endpoint);
        env.put("APPLICATIONINSIGHTS_ROLE_NAME", phase.equals("produce") ? "contoso-orders-api" : "contoso-fulfillment-worker");
        env.put("OTEL_SERVICE_NAME", env.get("APPLICATIONINSIGHTS_ROLE_NAME"));
        env.put("APPLICATIONINSIGHTS_STATSBEAT_DISABLED", "true");
        env.put("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT", "{\"sampling\":{\"percentage\":" + percentage +
            ",\"overrides\":[]},\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"},\"instrumentation\":{\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false},\"redis\":{\"enabled\":false}}}");
        Process child = builder.start();
        String startedAtUtc = java.time.Instant.now().toString();
        var output = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
            try { return NativeTestCapture.bounded(child.getInputStream(), 65_536); }
            catch (java.io.IOException unsafe) { throw new IllegalStateException("ASYNC_NATIVE_CHILD_OUTPUT_BOUND"); }
        });
        try {
            assertTrue(child.waitFor(Duration.ofSeconds(75)), "ASYNC_NATIVE_CHILD_TIMEOUT");
            output.get(3, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(0, child.exitValue(), "ASYNC_NATIVE_CHILD_FAILED");
            return Map.of("phase", phase, "percentage", percentage, "pid", child.pid(), "startedAtUtc", startedAtUtc,
                "endedAtUtc", java.time.Instant.now().toString(), "exitCode", child.exitValue());
        } finally { if (child.isAlive()) child.destroyForcibly().waitFor(); }
    }
}
