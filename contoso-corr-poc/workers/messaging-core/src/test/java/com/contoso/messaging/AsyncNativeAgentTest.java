package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.RuntimeGuard;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class AsyncNativeAgentTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void actualSingleAgentProcessRetryReplayFanInBatchAndPersistedEffects() throws Exception {
        var mapper = NativeTestCapture.JSON;
        var capture = new NativeTestCapture();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", capture::receive);
        Path agent = Path.of(System.getenv("CONTOSO_AGENT_JAR"));
        assertEquals(RuntimeGuard.AGENT_SHA256, HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(agent))));
        Path extension = Path.of(System.getenv("CONTOSO_PARENT_SAFE_JAR"));
        assertTrue(Files.isRegularFile(extension));
        Path root = Path.of(System.getProperty("basedir"), "..", "..").toAbsolutePath().normalize();
        Path working = NativeTestCapture.epoch(Path.of(System.getProperty("basedir"), "target", "native-agent", "epochs"));
        Path database = working.resolve("notify-topic-db");
        server.start();
        try {
            var children = new ArrayList<ChildExecution>();
            children.add(runChild(agent, extension, working, server.getAddress().getPort(), capture, "baseline",
                "contoso-fulfillment-worker", AsyncNativeProbe.class.getName(), List.of()));
            for (String phase : List.of("prepare", "notify", "skip")) {
                children.add(runChild(agent, extension, working, server.getAddress().getPort(), capture, phase,
                    NotifyTopicReplayProbe.role(phase), NotifyTopicReplayProbe.class.getName(),
                    List.of(phase, database.toString())));
            }
            assertEquals(4, children.stream().map(ChildExecution::pid).distinct().count());
            server.stop(0);
            NativeTestCapture.ApprovedCapture approved = capture.approve(root);
            var spans = approved.rows().stream().filter(node -> node.path("data").path("baseData").path("name").asText().startsWith("contoso.")).toList();
            assertFalse(spans.isEmpty(), "actual native spans were not collected");
            assertEquals(Set.of("contoso-fulfillment-worker", "contoso-notify-worker"),
                spans.stream().map(node -> node.path("tags").path("ai.cloud.role").asText()).collect(java.util.stream.Collectors.toSet()));
            var states = children.stream().filter(child -> !child.phase().equals("baseline"))
                .map(AsyncNativeAgentTest::runtimeState).toList();
            var fulfillmentSpans = spans.stream().filter(node ->
                node.path("tags").path("ai.cloud.role").asText().equals("contoso-fulfillment-worker")).toList();
            var retry = fulfillmentSpans.stream().filter(node -> name(node).equals("contoso.fulfillment.process") &&
                property(node, "contoso.outcome").equals("SUCCESS")).findFirst().orElseThrow();
            String messageId = property(retry, "contoso.message.id");
            assertFalse(messageId.isEmpty(), "actual native message identity attribute is missing");
            var attempts = fulfillmentSpans.stream().filter(node -> name(node).equals("contoso.fulfillment.process") &&
                property(node, "contoso.message.id").equals(messageId)).toList();
            assertEquals(3, attempts.size());
            assertEquals(3, attempts.stream().map(AsyncNativeAgentTest::id).distinct().count());
            assertEquals(1, attempts.stream().map(AsyncNativeAgentTest::trace).distinct().count());
            assertEquals(1, attempts.stream().map(AsyncNativeAgentTest::parent).distinct().count());
            assertEquals(List.of(1, 2, 3), attempts.stream().map(node -> Integer.parseInt(property(node, "contoso.process.attempt"))).sorted().toList());
            var replay = fulfillmentSpans.stream().filter(node -> name(node).equals("contoso.replay.send")).findFirst().orElseThrow();
            assertFalse(property(replay, "contoso.original.message.id").isEmpty());
            assertNotEquals(property(replay, "contoso.original.message.id"), property(replay, "contoso.message.id"));
            assertTrue(parent(replay).isEmpty());
            assertEquals(1, links(mapper, replay).size());
            assertNotifyReplay(mapper, spans, states);
            var fanin = spans.stream().filter(node -> name(node).equals("contoso.fanin.process")).findFirst().orElseThrow();
            assertEquals("INTERNAL", property(fanin, "contoso.span.kind"));
            assertTrue(parent(fanin).isEmpty());
            assertEquals(4, links(mapper, fanin).size());
            var batch = spans.stream().filter(node -> name(node).equals("contoso.eventhubs.batch.process") &&
                parent(node).isEmpty() && !property(node, "_MS.links").isEmpty()).findFirst().orElseThrow();
            assertTrue(parent(batch).isEmpty());
            assertEquals(2, links(mapper, batch).size());
            assertEquals(2, links(mapper, batch).stream().map(link -> link.path("operation_Id").asText()).distinct().count());
            var sanitized = spans.stream().map(node -> Map.of(
                "name", name(node), "traceId", trace(node), "spanId", id(node), "parentSpanId", parent(node),
                "kind", property(node, "contoso.span.kind"), "businessInvocationId", property(node, "business.invocation_id"),
                "messageId", property(node, "contoso.message.id"), "attempt", property(node, "contoso.process.attempt"),
                "roleName", node.path("tags").path("ai.cloud.role").asText(),
                "links", linksUnchecked(mapper, node))).toList();
            Path inspection = working.resolve("native-safe-inspection.json");
            NativeTestCapture.writeNew(inspection,
                spans.stream().map(node -> Map.of("name", name(node), "id", id(node), "traceId", trace(node),
                    "parentId", parent(node), "properties", safeProperties(node))).toList(), List.of(approved));
            Path proof = working.resolve("native-proof.json");
            NativeTestCapture.writeNew(proof, Map.ofEntries(
                Map.entry("schemaVersion", 1), Map.entry("evidenceKind", "real-local-agent-loopback"), Map.entry("certified", false),
                Map.entry("scope", "Four actual one-agent JVMs, Fulfillment and Notify roles, sequential H2/SDK-carrier topic replay; not Azure broker/Functions/MI or distributed-workflow proof"),
                Map.entry("agentSha256", RuntimeGuard.AGENT_SHA256), Map.entry("spans", sanitized),
                Map.entry("nativeChildPid", children.getFirst().pid()), Map.entry("nativeChildren", children.stream().map(ChildExecution::metadata).toList()),
                Map.entry("notifyReplayRuntimeResults", states), Map.entry("originalPrivacyCapture", approved.summary()),
                Map.entry("nativeSafeInspectionSha256", NativeTestCapture.sha256(Files.readAllBytes(inspection)))), List.of(approved));
            System.out.println("ASYNC_NATIVE_CAPTURE_RECEIPT " + mapper.writeValueAsString(Map.of(
                "path", proof.toAbsolutePath().toString(), "sha256", NativeTestCapture.sha256(Files.readAllBytes(proof)),
                "certification", "NOT_CERTIFIED")));
        } finally {
            server.stop(0);
            for (String suffix : List.of(".mv.db", ".trace.db", ".lock.db")) Files.deleteIfExists(Path.of(database + suffix));
        }
    }

    private record ChildExecution(long pid, int exitCode, String phase, String configuredRole, String startedAtUtc,
        String endedAtUtc, byte[] output) {
        Map<String, Object> metadata() {
            return Map.of("pid", pid, "exitCode", exitCode, "phase", phase, "configuredRole", configuredRole,
                "startedAtUtc", startedAtUtc, "endedAtUtc", endedAtUtc);
        }
    }

    private static ChildExecution runChild(Path agent, Path extension, Path working, int port,
        NativeTestCapture capture, String phase, String role, String mainClass, List<String> parameters) throws Exception {
        String publisher = UUID.randomUUID().toString();
        capture.publisher(publisher);
        var arguments = new ArrayList<String>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
            "-javaagent:" + agent, "-Dotel.javaagent.extensions=" + extension, "-Djava.io.tmpdir=" + working));
        RuntimeGuard.MANUAL_MODULES.forEach(module -> arguments.add("-Dotel.instrumentation." + module + ".enabled=false"));
        arguments.addAll(List.of("-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")), mainClass));
        arguments.addAll(parameters);
        var builder = new ProcessBuilder(arguments).redirectErrorStream(true);
        var env = builder.environment();
        for (String key : List.of("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "MAVEN_OPTS",
            "APPLICATIONINSIGHTS_AUTHENTICATION_STRING", "APPLICATIONINSIGHTS_CONFIGURATION_FILE",
            "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "AZURE_CLIENT_SECRET", "AZURE_CLIENT_ID")) env.remove(key);
        env.put("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=" + publisher + ";IngestionEndpoint=http://127.0.0.1:" + port);
        env.put("APPLICATIONINSIGHTS_ROLE_NAME", role);
        env.put("OTEL_SERVICE_NAME", role);
        env.put("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT", "{\"sampling\":{\"percentage\":100},\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"},\"instrumentation\":{\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false},\"redis\":{\"enabled\":false}}}");
        Process child = builder.start();
        String startedAtUtc = java.time.Instant.now().toString();
        var output = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
            try { return NativeTestCapture.bounded(child.getInputStream(), NativeTestCapture.CONTROL_LIMIT); }
            catch (java.io.IOException unsafe) { throw new IllegalStateException("ASYNC_NATIVE_CHILD_OUTPUT_BOUND"); }
        });
        try {
            assertTrue(child.waitFor(Duration.ofSeconds(75)), "ASYNC_NATIVE_CHILD_DEADLINE");
            assertEquals(0, child.exitValue(), "ASYNC_NATIVE_CHILD_FAILED_" + phase);
            byte[] stdout = output.get(3, TimeUnit.SECONDS);
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(stdout)).toString();
            assertTrue(text.contains(phase.equals("baseline") ? "ASYNC_NATIVE_PROBE_COMPLETE" :
                "ASYNC_NOTIFY_TOPIC_PROBE_COMPLETE"), "ASYNC_NATIVE_COMPLETION_MISSING");
            return new ChildExecution(child.pid(), child.exitValue(), phase, role, startedAtUtc, java.time.Instant.now().toString(), stdout);
        } finally {
            if (child.isAlive()) child.destroyForcibly().waitFor();
        }
    }

    private static JsonNode runtimeState(ChildExecution child) {
        String text = new String(child.output(), StandardCharsets.UTF_8);
        var lines = text.lines().filter(line -> line.startsWith("ASYNC_NOTIFY_REPLAY_STATE ")).toList();
        assertEquals(1, lines.size(), "ASYNC_NOTIFY_STATE_COUNT");
        JsonNode state = NativeTestCapture.control(lines.getFirst().substring("ASYNC_NOTIFY_REPLAY_STATE ".length()).getBytes(StandardCharsets.UTF_8));
        var actualKeys = new java.util.HashSet<String>();
        state.fieldNames().forEachRemaining(actualKeys::add);
        assertEquals(Set.of("schema", "phase", "businessInvocationId", "workflowId", "originalMessageId", "replayMessageId",
            "replayOf", "causationId", "originalTraceId", "originalSpanId", "replayTraceId", "replaySpanId", "replaySource",
            "replayOwner", "replayRecordCount", "fulfillmentEffects", "notifyEffects", "fulfillmentReplayInbox", "notifyReplayInbox",
            "notifyEffectOwner", "notifyReplayReceiver", "notifyReplayPublisher", "fulfillmentFaultBudget", "fulfillmentPaused",
            "retainedFulfillmentDeadLetters", "topicSkipSettled", "fixtureOnly"), actualKeys);
        for (String field : List.of("schema", "phase", "businessInvocationId", "workflowId", "originalMessageId",
            "replayMessageId", "replayOf", "causationId", "originalTraceId", "originalSpanId",
            "replayTraceId", "replaySpanId", "replaySource", "replayOwner",
            "notifyEffectOwner", "notifyReplayReceiver", "notifyReplayPublisher")) {
            assertTrue(state.path(field).isTextual(), "ASYNC_NOTIFY_STATE_STRING");
        }
        assertEquals(NotifyTopicReplayFixture.SCHEMA, state.path("schema").asText());
        assertEquals(child.phase(), state.path("phase").asText());
        for (String field : List.of("businessInvocationId", "workflowId", "originalMessageId")) {
            com.contoso.correlation.InvocationId.parse(state.path(field).asText());
        }
        for (String field : List.of("originalTraceId", "originalSpanId")) {
            String value = state.path(field).asText();
            assertTrue(value.matches(field.endsWith("TraceId") ? "[0-9a-f]{32}" : "[0-9a-f]{16}") &&
                !value.chars().allMatch(character -> character == '0'), "ASYNC_NOTIFY_ACTUAL_PRODUCER_CONTEXT");
        }
        for (String field : List.of("replayRecordCount", "fulfillmentEffects", "notifyEffects",
            "fulfillmentReplayInbox", "notifyReplayInbox", "retainedFulfillmentDeadLetters")) {
            assertTrue(state.path(field).isIntegralNumber() && state.path(field).canConvertToInt() && state.path(field).asInt() >= 0 &&
                state.path(field).asInt() <= 1, "ASYNC_NOTIFY_STATE_COUNTER");
        }
        assertTrue(state.path("fulfillmentFaultBudget").isIntegralNumber() &&
            state.path("fulfillmentFaultBudget").canConvertToInt() && state.path("fulfillmentFaultBudget").asInt() == 3);
        for (String field : List.of("fulfillmentPaused", "topicSkipSettled", "fixtureOnly")) {
            assertTrue(state.path(field).isBoolean(), "ASYNC_NOTIFY_STATE_BOOLEAN");
        }
        if (child.phase().equals("prepare")) {
            for (String field : List.of("replayMessageId", "replayOf", "causationId", "replayTraceId", "replaySpanId",
                "replaySource", "replayOwner", "notifyEffectOwner", "notifyReplayReceiver", "notifyReplayPublisher")) {
                assertEquals("", state.path(field).asText());
            }
        } else {
            for (String field : List.of("replayMessageId", "replayOf", "causationId")) {
                com.contoso.correlation.InvocationId.parse(state.path(field).asText());
            }
            for (String field : List.of("replayTraceId", "replaySpanId")) {
                String value = state.path(field).asText();
                assertTrue(value.matches(field.endsWith("TraceId") ? "[0-9a-f]{32}" : "[0-9a-f]{16}") &&
                    !value.chars().allMatch(character -> character == '0'), "ASYNC_NOTIFY_ACTUAL_REPLAY_CONTEXT");
            }
        }
        assertTrue(state.path("fixtureOnly").isBoolean() && state.path("fixtureOnly").booleanValue());
        return state;
    }

    private static void assertNotifyReplay(ObjectMapper mapper, List<JsonNode> spans, List<JsonNode> states) throws Exception {
        JsonNode prepared = states.get(0), notified = states.get(1), skipped = states.get(2);
        assertEquals(List.of("prepare", "notify", "skip"), states.stream().map(state -> state.path("phase").asText()).toList());
        for (String key : List.of("businessInvocationId", "workflowId", "originalMessageId", "originalTraceId", "originalSpanId")) {
            assertEquals(prepared.path(key), notified.path(key));
            assertEquals(prepared.path(key), skipped.path(key));
        }
        for (String key : List.of("replayMessageId", "replayOf", "causationId", "replaySource", "replayOwner", "replayTraceId", "replaySpanId")) {
            assertEquals(notified.path(key), skipped.path(key));
        }
        for (String key : List.of("replayRecordCount", "fulfillmentEffects", "notifyEffects", "fulfillmentReplayInbox", "notifyReplayInbox")) {
            assertEquals(0, prepared.path(key).asInt());
        }
        assertFalse(prepared.path("topicSkipSettled").booleanValue());
        assertFalse(notified.path("topicSkipSettled").booleanValue());
        assertEquals(1, notified.path("notifyEffects").asInt());
        assertEquals(1, notified.path("notifyReplayInbox").asInt());
        assertEquals(0, notified.path("fulfillmentEffects").asInt());
        assertEquals(0, notified.path("fulfillmentReplayInbox").asInt());
        assertEquals("NOTIFY_DLQ", skipped.path("replaySource").asText());
        assertNotEquals(skipped.path("originalMessageId").asText(), skipped.path("replayMessageId").asText());
        assertEquals(skipped.path("originalMessageId"), skipped.path("replayOf"));
        assertEquals(skipped.path("originalMessageId"), skipped.path("causationId"));
        assertEquals(1, skipped.path("replayRecordCount").asInt());
        for (String key : List.of("notifyEffects", "notifyReplayInbox", "retainedFulfillmentDeadLetters")) assertEquals(1, skipped.path(key).asInt());
        for (String key : List.of("fulfillmentEffects", "fulfillmentReplayInbox")) assertEquals(0, skipped.path(key).asInt());
        assertEquals(3, skipped.path("fulfillmentFaultBudget").asInt());
        assertTrue(skipped.path("fulfillmentPaused").isBoolean() && skipped.path("fulfillmentPaused").booleanValue());
        assertTrue(skipped.path("topicSkipSettled").isBoolean() && skipped.path("topicSkipSettled").booleanValue());
        for (String key : List.of("replayOwner", "notifyEffectOwner", "notifyReplayReceiver", "notifyReplayPublisher")) {
            assertEquals(MessagingFixture.NOTIFY, skipped.path(key).asText().toLowerCase(java.util.Locale.ROOT));
        }
        String originalId = skipped.path("originalMessageId").asText(), replayId = skipped.path("replayMessageId").asText();
        String business = skipped.path("businessInvocationId").asText();
        var original = spans.stream().filter(node -> name(node).equals("contoso.servicebus.send") &&
            property(node, "contoso.message.id").equals(originalId)).findFirst().orElseThrow();
        assertEquals("contoso-fulfillment-worker", original.path("tags").path("ai.cloud.role").asText());
        assertEquals(skipped.path("originalTraceId").asText(), trace(original));
        assertEquals(skipped.path("originalSpanId").asText(), id(original));
        var notifyRows = spans.stream().filter(node -> node.path("tags").path("ai.cloud.role").asText()
            .equals("contoso-notify-worker")).toList();
        var notifyAttempts = notifyRows.stream().filter(node -> name(node).equals("contoso.notify.process") &&
            property(node, "contoso.message.id").equals(originalId)).toList();
        assertEquals(2, notifyAttempts.size());
        assertEquals(2, notifyAttempts.stream().map(AsyncNativeAgentTest::id).distinct().count());
        assertEquals(List.of(1, 2), notifyAttempts.stream().map(node ->
            Integer.parseInt(property(node, "contoso.process.attempt"))).sorted().toList());
        assertEquals(Set.of("RETRY", "DEAD_LETTERED"), notifyAttempts.stream().map(node ->
            property(node, "contoso.outcome")).collect(java.util.stream.Collectors.toSet()));
        for (JsonNode attempt : notifyAttempts) {
            assertEquals(trace(original), trace(attempt));
            assertEquals(id(original), parent(attempt));
            assertEquals(business, property(attempt, "business.invocation_id"));
        }
        var process = notifyRows.stream().filter(node -> name(node).equals("contoso.replay.process") &&
            property(node, "contoso.outcome").equals("REPLAY_QUEUED")).findFirst().orElseThrow();
        var send = notifyRows.stream().filter(node -> name(node).equals("contoso.replay.send") &&
            property(node, "contoso.message.id").equals(replayId)).findFirst().orElseThrow();
        assertEquals("CONSUMER", property(process, "contoso.span.kind"));
        assertEquals("PRODUCER", property(send, "contoso.span.kind"));
        assertTrue(parent(process).isEmpty());
        assertTrue(parent(send).isEmpty());
        assertNotEquals(trace(process), trace(send));
        assertNotEquals(trace(original), trace(process));
        assertNotEquals(trace(original), trace(send));
        for (JsonNode node : List.of(process, send)) {
            assertEquals(business, property(node, "business.invocation_id"));
            var actualLinks = links(mapper, node);
            assertEquals(1, actualLinks.size());
            assertEquals(trace(original), actualLinks.getFirst().path("operation_Id").asText());
            assertEquals(id(original), actualLinks.getFirst().path("id").asText());
        }
        assertEquals(originalId, property(send, "contoso.original.message.id"));
        assertEquals(originalId, property(send, "contoso.causation.id"));
        assertEquals(skipped.path("replayTraceId").asText(), trace(send));
        assertEquals(skipped.path("replaySpanId").asText(), id(send));
        var effect = notifyRows.stream().filter(node -> name(node).equals("contoso.notify.process") &&
            property(node, "contoso.message.id").equals(replayId) && property(node, "contoso.outcome").equals("SUCCESS")).findFirst().orElseThrow();
        assertEquals(trace(send), trace(effect));
        assertEquals(id(send), parent(effect));
        var other = spans.stream().filter(node -> node.path("tags").path("ai.cloud.role").asText().equals("contoso-fulfillment-worker") &&
            name(node).equals("contoso.fulfillment.process") && property(node, "contoso.message.id").equals(replayId) &&
            property(node, "contoso.outcome").equals("SKIPPED_TARGET")).findFirst().orElseThrow();
        assertEquals(trace(send), trace(other));
        assertEquals(id(send), parent(other));
    }
    private static String name(JsonNode node) { return node.path("data").path("baseData").path("name").asText(); }
    private static String id(JsonNode node) { return node.path("data").path("baseData").path("id").asText(); }
    private static String trace(JsonNode node) { return node.path("tags").path("ai.operation.id").asText(); }
    private static String parent(JsonNode node) { return node.path("tags").path("ai.operation.parentId").asText(); }
    private static String property(JsonNode node, String key) {
        JsonNode value = node.path("data").path("baseData").path("properties").get(key);
        if (value == null) value = node.path("data").path("baseData").path("measurements").get(key);
        return value == null ? "" : value.asText();
    }
    private static Map<String, String> safeProperties(JsonNode node) {
        var values = new java.util.TreeMap<String, String>();
        for (String key : List.of("business.invocation_id", "contoso.span.kind", "contoso.message.id", "contoso.workflow.id",
            "contoso.branch", "contoso.outcome", "contoso.process.attempt", "contoso.publish.attempt", "contoso.link.count",
            "contoso.context.rejection", "contoso.original.message.id", "contoso.causation.id", "messaging.message.id",
            "messaging.operation.name", "_MS.links")) {
            String value = property(node, key);
            if (!value.isEmpty()) values.put(key, value);
        }
        return Map.copyOf(values);
    }
    private static List<JsonNode> links(ObjectMapper mapper, JsonNode node) throws Exception {
        String value = property(node, "_MS.links");
        if (value.isEmpty()) return List.of();
        var result = new ArrayList<JsonNode>(); mapper.readTree(value).forEach(result::add); return List.copyOf(result);
    }
    private static List<JsonNode> linksUnchecked(ObjectMapper mapper, JsonNode node) {
        try { return links(mapper, node); }
        catch (Exception ignored) { throw new IllegalStateException("invalid_actual_native_links"); }
    }
}
