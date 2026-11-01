package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class SingleAgentExportTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void actualSingleAgentExportsNativeParentsKindsAndLinksAtShutdown() throws Exception {
        execute(AgentProbe.class, false);
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void actualBootHttpServerClientParentage() throws Exception {
        execute(HttpAgentProbe.class, true);
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void restartingSameBuildRetainsRoleAndGeneratesFreshReceivedSpans() throws Exception {
        var first = execute(AgentProbe.class, false);
        var second = execute(AgentProbe.class, false);
        assertTrue(java.util.Collections.disjoint(first, second));
    }

    private java.util.Set<String> execute(Class<?> mainClass, boolean http) throws Exception {
        Path agent = Path.of(System.getenv("CONTOSO_AGENT_JAR"));
        Path extension = System.getenv("CONTOSO_PARENT_SAFE_JAR") == null
            ? Path.of(System.getProperty("basedir")).resolve("../../extensions/parent-safe-sampler/target/contoso-parent-safe-sampler-1.0.0.jar").normalize()
            : Path.of(System.getenv("CONTOSO_PARENT_SAFE_JAR"));
        assertTrue(Files.isRegularFile(extension), "The one hash-frozen parent-safe extension is required");
        assertEquals(RuntimeGuard.AGENT_SHA256, java.util.HexFormat.of().formatHex(
            java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(agent))));
        var mapper = new ObjectMapper();
        List<JsonNode> received = new CopyOnWriteArrayList<>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            if ("gzip".equalsIgnoreCase(exchange.getRequestHeaders().getFirst("Content-Encoding"))) {
                body = new GZIPInputStream(new ByteArrayInputStream(body)).readAllBytes();
            }
            int count = 0;
            try (var parser = mapper.getFactory().createParser(body)) {
                while (parser.nextToken() != null) {
                    JsonNode payload = mapper.readTree(parser);
                    if (payload.isArray()) { payload.forEach(received::add); count += payload.size(); }
                    else { received.add(payload); count++; }
                }
            }
            byte[] response = ("{\"itemsReceived\":" + count +
                ",\"itemsAccepted\":" + count + ",\"errors\":[]}")
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        Process child = null;
        try {
            var builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-javaagent:" + agent, "-Dotel.javaagent.extensions=" + extension, "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                mainClass.getName()).redirectErrorStream(true);
            var env = builder.environment();
            for (String key : List.of("AZURE_CLIENT_SECRET", "APPLICATIONINSIGHTS_AUTHENTICATION_STRING",
                    "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "APPLICATIONINSIGHTS_CONFIGURATION_FILE")) {
                env.remove(key);
            }
            // Synthetic loopback destination/identifier, generated in memory; no Azure resource receives data.
            env.put("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=" + UUID.randomUUID() +
                ";IngestionEndpoint=http://127.0.0.1:" + server.getAddress().getPort());
            env.put("APPLICATIONINSIGHTS_ROLE_NAME", "contoso-oracle");
            env.put("OTEL_SERVICE_NAME", "contoso-oracle");
            env.put("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT",
                "{\"sampling\":{\"percentage\":100},\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"}," +
                "\"instrumentation\":{\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false},\"redis\":{\"enabled\":false}}}");
            child = builder.start();
            final Process running = child;
            var captured = new StringBuffer();
            Thread reader = Thread.ofVirtual().start(() -> running.inputReader(StandardCharsets.UTF_8).lines().forEach(line -> {
                if (captured.length() < 65536) captured.append(line).append('\n');
            }));
            assertTrue(child.waitFor(Duration.ofSeconds(60)), "Probe did not terminate gracefully: " + captured);
            reader.join(3000);
            String output = captured.toString();
            assertEquals(0, child.exitValue(), output);
            if (http) {
                var wire = Pattern.compile("HTTP_ORACLE ([0-9a-f]{32}) ([0-9a-f]{16}) ([0-9a-f]{16}) ([0-9a-f]{16})").matcher(output);
                assertTrue(wire.find(), output);
                var clientSpan = received.stream().filter(node -> wire.group(4).equals(node.path("data").path("baseData").path("id").asText())).findFirst().orElseThrow();
                var serverSpan = received.stream().filter(node -> wire.group(3).equals(node.path("data").path("baseData").path("id").asText())).findFirst().orElseThrow();
                assertEquals(wire.group(1), clientSpan.path("tags").path("ai.operation.id").asText());
                assertEquals(wire.group(2), clientSpan.path("tags").path("ai.operation.parentId").asText());
                assertEquals(wire.group(4), serverSpan.path("tags").path("ai.operation.parentId").asText());
                assertEquals("RemoteDependencyData", clientSpan.path("data").path("baseType").asText());
                assertEquals("RequestData", serverSpan.path("data").path("baseType").asText());
                return java.util.Set.of(wire.group(2), wire.group(3), wire.group(4));
            }
            var match = Pattern.compile("ORACLE ([0-9a-f]{32}) ([0-9a-f]{16}) ([0-9a-f]{16}) ([0-9a-f]{32}) ([0-9a-f]{16})").matcher(output);
            assertTrue(match.find(), output);
            List<JsonNode> spans = received.stream().filter(node ->
                node.path("data").path("baseData").path("name").asText().startsWith("contoso.oracle.")).toList();
            assertEquals(3, spans.size(), "Service startup/debug logs do not substitute for received spans; output=" +
                output + "; received=" + received.stream().map(node -> node.path("data").path("baseType").asText() +
                    ":" + node.path("data").path("baseData").path("name").asText()).toList());
            var root = find(spans, "contoso.oracle.root");
            var client = find(spans, "contoso.oracle.client");
            var linked = find(spans, "contoso.oracle.linked");
            assertEquals(match.group(2), root.path("data").path("baseData").path("id").asText());
            assertEquals(match.group(3), client.path("data").path("baseData").path("id").asText());
            assertEquals(match.group(1), client.path("tags").path("ai.operation.id").asText());
            assertEquals(match.group(2), client.path("tags").path("ai.operation.parentId").asText());
            assertEquals("CLIENT", client.path("data").path("baseData").path("properties").path("contoso.span.kind").asText());
            String nativeLinks = linked.path("data").path("baseData").path("properties").path("_MS.links").asText();
            assertTrue(nativeLinks.contains(match.group(1)) && nativeLinks.contains(match.group(3)), nativeLinks);
            assertFalse(received.stream().anyMatch(node -> node.toString().contains("db.statement")));
            assertTrue(spans.stream().allMatch(node -> "contoso-oracle".equals(node.path("tags").path("ai.cloud.role").asText())));
            return spans.stream().map(node -> node.path("data").path("baseData").path("id").asText())
                .collect(java.util.stream.Collectors.toSet());
        } finally {
            if (child != null && child.isAlive()) child.destroyForcibly();
            server.stop(0);
        }
    }

    private static JsonNode find(List<JsonNode> spans, String name) {
        return spans.stream().filter(node -> name.equals(node.path("data").path("baseData").path("name").asText()))
            .findFirst().orElseThrow();
    }
}
