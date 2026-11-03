package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.RuntimeGuard;
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

@EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
class DataAgentQualificationTest {
    @Test void actualAgentReceiptsProveCompletedClientsPrivacyLocalSamplingAndNativeLinks() throws Exception {
        Result result = run(false);
        var spans = result.rows.stream().filter(row ->
            row.path("data").path("baseData").path("name").asText().startsWith("contoso.")).toList();
        assertEquals(8, spans.size(), "Expected exact manual graph, no duplicate automatic data spans");
        var postgres = spans.stream().filter(row -> name(row).equals("contoso.pg.select")).toList();
        assertEquals(2, postgres.size());
        var primary = postgres.stream().filter(row -> id(row).equals(result.sqlId)).findFirst().orElseThrow();
        assertEquals(result.traceId, primary.path("tags").path("ai.operation.id").asText());
        assertEquals(result.rootId, primary.path("tags").path("ai.operation.parentId").asText());
        assertEquals("SELECT", primary.path("data").path("baseData").path("data").asText());
        assertEquals("postgresql", primary.path("data").path("baseData").path("type").asText());
        assertEquals("CLIENT", primary.path("data").path("baseData").path("properties").path("contoso.span.kind").asText());
        String[] duration = primary.path("data").path("baseData").path("duration").asText().split(":");
        assertEquals(3, duration.length);
        assertTrue(Double.parseDouble(duration[2]) >= 0.060, "SQL/result completion, not acquisition-only timing");
        var linked = spans.stream().filter(row -> name(row).equals("contoso.data.oracle.linked")).findFirst().orElseThrow();
        String links = linked.path("data").path("baseData").path("properties").path("_MS.links").asText();
        assertTrue(links.contains("\"operation_Id\":\"" + result.traceId + "\""));
        assertTrue(links.contains("\"id\":\"" + result.rootId + "\""));
        assertTrue(postgres.stream().anyMatch(row -> result.linkedId.equals(
            row.path("tags").path("ai.operation.parentId").asText())));
        assertTrue(postgres.stream().allMatch(row ->
            row.path("data").path("baseData").path("properties").path("_MS.links").isMissingNode()));
        assertFalse(spans.stream().anyMatch(row -> id(row).equals(result.negativeId)));
        assertTrue(result.maximumHeap <= 272L * 1024 * 1024);
        String raw = result.rows.toString() + result.output;
        for (String forbidden : List.of("SQL_LITERAL_CANARY", "SQL_PARAMETER_CANARY", "REDIS_KEY_CANARY",
            "REDIS_VALUE_SCRIPT_ARGUMENT_CANARY", "REDIS_AUTH_TOKEN_CANARY", "db.statement", "db.query.text", "db.query.parameter",
            "db.connection_string")) assertFalse(raw.contains(forbidden), forbidden);
    }

    @Test void missingManualEmissionControlRunsSqlButFailsExpectedCoverage() throws Exception {
        Result result = run(true);
        assertFalse(result.rows.stream().anyMatch(row -> name(row).equals("contoso.pg.select")),
            "The negative fixture must omit manual CLIENT emission, never ship as an app flag");
        assertEquals("missing", result.sqlId);
        assertThrows(AssertionError.class, () -> assertEquals(2,
            result.rows.stream().filter(row -> name(row).equals("contoso.pg.select")).count()));
    }

    private static Result run(boolean missing) throws Exception {
        Path agent = Path.of(System.getenv("CONTOSO_AGENT_JAR"));
        assertEquals(RuntimeGuard.AGENT_SHA256, java.util.HexFormat.of().formatHex(
            java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(agent))));
        var mapper = new ObjectMapper();
        List<JsonNode> received = new CopyOnWriteArrayList<>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
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
                byte[] response = ("{\"itemsReceived\":" + count + ",\"itemsAccepted\":" + count + ",\"errors\":[]}")
                    .getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } finally { exchange.close(); }
        });
        server.start();
        Process child = null;
        try {
            var builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Xmx256m", "-XX:ActiveProcessorCount=2", "-javaagent:" + agent, "-cp",
                System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                DataAgentProbe.class.getName(), missing ? "missing-client" : "normal").redirectErrorStream(true);
            var env = builder.environment();
            for (String key : List.of("AZURE_CLIENT_SECRET", "APPLICATIONINSIGHTS_AUTHENTICATION_STRING",
                "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "APPLICATIONINSIGHTS_CONFIGURATION_FILE",
                "APPLICATIONINSIGHTS_CONFIGURATION_CONTENT")) env.remove(key);
            env.put("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=" + UUID.randomUUID() +
                ";IngestionEndpoint=http://127.0.0.1:" + server.getAddress().getPort());
            env.put("APPLICATIONINSIGHTS_ROLE_NAME", "contoso-data-oracle");
            env.put("OTEL_SERVICE_NAME", "contoso-data-oracle");
            env.put("APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED", "false");
            env.put("APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED", "false");
            env.put("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT",
                "{\"sampling\":{\"percentage\":100},\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"}," +
                "\"instrumentation\":{\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false},\"redis\":{\"enabled\":false}," +
                "\"logging\":{\"level\":\"OFF\"}}}");
            child = builder.start();
            assertTrue(child.waitFor(Duration.ofSeconds(60)), "Data probe did not finish bounded shutdown");
            String output = child.inputReader(StandardCharsets.UTF_8).lines().reduce("", (a, b) -> a + b + "\n");
            assertEquals(0, child.exitValue(), output);
            var match = Pattern.compile("DATAORACLE ([0-9a-f]{32}) ([0-9a-f]{16}) (missing|[0-9a-f]{16}) ([0-9a-f]{16}) ([0-9a-f]{16}) ([0-9]+)").matcher(output);
            assertTrue(match.find(), output);
            var budget = Pattern.compile("DATARESOURCE ([0-9]+) ([0-9]+) ([0-9]+)").matcher(output);
            assertTrue(budget.find(), output);
            assertTrue(Integer.parseInt(budget.group(1)) <= 2, "Bounded JVM processor hint, not a per-app CPU quota");
            assertTrue(Long.parseLong(budget.group(2)) < Duration.ofSeconds(30).toNanos(), "Local probe CPU budget");
            assertTrue(Long.parseLong(budget.group(3)) < Duration.ofSeconds(60).toNanos(), "Bounded probe wall-clock budget");
            return new Result(received, output, match.group(1), match.group(2), match.group(3),
                match.group(4), match.group(5), Long.parseLong(match.group(6)));
        } finally {
            if (child != null && child.isAlive()) child.destroyForcibly();
            server.stop(0);
        }
    }

    private static String name(JsonNode row) { return row.path("data").path("baseData").path("name").asText(); }
    private static String id(JsonNode row) { return row.path("data").path("baseData").path("id").asText(); }
    private record Result(List<JsonNode> rows, String output, String traceId, String rootId,
                          String sqlId, String linkedId, String negativeId, long maximumHeap) {}
}
