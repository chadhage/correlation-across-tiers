package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.OperationContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class InventoryFixtureStdioTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test void suppliedBridgeRetainsActualBaselineAndEmitsOnlyScopedHashes() throws Exception {
        try (var fixture = new DataFixture()) {
            InventoryFixtureRunTest.change(fixture, InventoryFixtureRunTest.SKU, 8, 41);
            var clock = new InventoryFixtureRunTest.MutableClock();
            var cache = new InventoryFixtureRunTest.Cache(clock);
            cache.values.put(InventoryFixtureRunTest.SKU, InventoryFixtureRunTest.persistent(8, 41));
            var lease = InventoryFixtureRunTest.lease();
            var context = DataFixture.context();
            var output = new ByteArrayOutputStream();
            String commands = capture(lease, context) + command("PREPARE", lease.runId(), context) +
                command("RESET", lease.runId(), context) + "QUIT\t" + lease.runId() + "\n";
            int exit = InventoryFixtureStdio.serve(bytes(commands), new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(fixture.connections, cache, InventoryFixtureRunTest.permit()));
            assertEquals(0, exit);
            var rows = rows(output);
            assertEquals(List.of("CAPTURE", "PREPARE", "RESET", "QUIT"),
                rows.stream().map(row -> row.path("command").asText()).toList());
            assertEquals("PREPARED", rows.get(1).path("state").asText());
            assertEquals(rows.get(2).path("expected"), rows.get(2).path("observed"));
            assertEquals(8, fixture.stock(InventoryFixtureRunTest.SKU));
            assertEquals(41, InventoryFixtureRunTest.revision(fixture, InventoryFixtureRunTest.SKU));
            assertFalse(output.toString(StandardCharsets.UTF_8).contains(InventoryFixtureRunTest.SKU));
            assertFalse(output.toString(StandardCharsets.UTF_8).contains(lease.orderId()));
            assertFalse(output.toString(StandardCharsets.UTF_8).contains("8:41"));
            assertEquals("InventoryFixtureRun[redacted]",
                InventoryFixtureRunTest.capture(fixture, cache, InventoryFixtureRunTest.lease(), clock).toString());
            assertEquals("InventoryCacheBaseline[redacted]", cache.capture(InventoryFixtureRunTest.SKU, context).toString());
        }
    }

    @Test void failureDoesNotLoseLiveBaselineOrFalselyReportPrepared() throws Exception {
        try (var fixture = new DataFixture()) {
            InventoryFixtureRunTest.change(fixture, InventoryFixtureRunTest.SKU, 9, 7);
            var cache = new InventoryFixtureRunTest.Cache(new InventoryFixtureRunTest.MutableClock());
            cache.values.put(InventoryFixtureRunTest.SKU, InventoryFixtureRunTest.persistent(9, 7));
            cache.failInvalidate = true;
            cache.mutateBeforeFailure = true;
            var lease = InventoryFixtureRunTest.lease();
            var context = DataFixture.context();
            var input = new ScriptInput(List.of(capture(lease, context), command("PREPARE", lease.runId(), context),
                command("RESET", lease.runId(), context), "QUIT\t" + lease.runId() + "\n"),
                Map.of(2, () -> cache.failInvalidate = false));
            var output = new ByteArrayOutputStream();
            assertEquals(0, InventoryFixtureStdio.serve(input, new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(fixture.connections, cache, InventoryFixtureRunTest.permit())));
            var rows = rows(output);
            assertEquals("TIMEOUT", rows.get(1).path("error").asText());
            assertTrue(rows.get(1).path("outcomeUnknown").asBoolean());
            assertEquals("RESET", rows.get(2).path("command").asText());
            assertEquals(9, fixture.stock(InventoryFixtureRunTest.SKU));
        }
    }

    @Test void eofWithRetainedBaselineIsIncompleteNotAnInventedReset() throws Exception {
        try (var fixture = new DataFixture()) {
            InventoryFixtureRunTest.change(fixture, InventoryFixtureRunTest.SKU, 8, 41);
            var cache = new InventoryFixtureRunTest.Cache(new InventoryFixtureRunTest.MutableClock());
            var lease = InventoryFixtureRunTest.lease();
            var context = DataFixture.context();
            var output = new ByteArrayOutputStream();
            assertEquals(3, InventoryFixtureStdio.serve(bytes(capture(lease, context) +
                command("PREPARE", lease.runId(), context)), new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(fixture.connections, cache, InventoryFixtureRunTest.permit())));
            assertEquals("INCOMPLETE_RESET", rows(output).getLast().path("error").asText());
            assertEquals(20, fixture.stock(InventoryFixtureRunTest.SKU));
        }
    }

    @Test void wrongObservedInvocationCannotDeleteReservationThenCorrectRetakeCanRestore() throws Exception {
        try (var fixture = new DataFixture()) {
            var cache = new InventoryFixtureRunTest.Cache(new InventoryFixtureRunTest.MutableClock());
            var lease = InventoryFixtureRunTest.lease();
            var actual = DataFixture.context();
            var input = new ScriptInput(List.of(capture(lease, actual), command("PREPARE", lease.runId(), actual),
                command("RESET", lease.runId(), DataFixture.context()), command("RESET", lease.runId(), actual),
                "QUIT\t" + lease.runId() + "\n"), Map.of(2, () -> {
                    new PgRedisInventoryDataAdapter(fixture.connections, cache).reserveInventory(lease.orderId(),
                        InventoryFixtureRunTest.SKU, 2, actual);
                }));
            var output = new ByteArrayOutputStream();
            assertEquals(0, InventoryFixtureStdio.serve(input, new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(fixture.connections, cache, InventoryFixtureRunTest.permit())));
            var rows = rows(output);
            assertEquals("AUTHORIZATION", rows.get(2).path("error").asText());
            assertEquals("RESTORED", rows.get(3).path("state").asText());
            assertEquals(0, InventoryFixtureRunTest.reservations(fixture).size());
        }
    }

    @Test void malformedSavedJsonArbitraryCommandsOrBudgetsCannotOpenStores() throws Exception {
        var opens = new AtomicInteger();
        for (String command : List.of("{\"state\":\"RESTORED\"}\n", "sh\tTOKEN_CANARY\n",
                "RESET\t" + UUID.randomUUID() + "\t" + UUID.randomUUID() + "\t5000\n",
                "CAPTURE\t" + UUID.randomUUID() + "\t" + UUID.randomUUID() + "\tCONTOSO-001\t" +
                    UUID.randomUUID() + "\t30001\t-\n")) {
            var output = new ByteArrayOutputStream();
            assertEquals(2, InventoryFixtureStdio.serve(bytes(command), new PrintStream(output), () -> {
                opens.incrementAndGet();
                throw new AssertionError("Must not open a real factory");
            }));
            assertEquals("INVALID_REQUEST", rows(output).getFirst().path("error").asText());
            assertFalse(output.toString(StandardCharsets.UTF_8).contains("CANARY"));
        }
        assertEquals(0, opens.get());
    }

    @Test void cleanupFailureHasFiniteErrorAndNonzeroExitAfterVerifiedReset() throws Exception {
        try (var fixture = new DataFixture()) {
            var cache = new InventoryFixtureRunTest.Cache(new InventoryFixtureRunTest.MutableClock());
            var lease = InventoryFixtureRunTest.lease();
            var context = DataFixture.context();
            var operator = new com.contoso.correlation.data.PgConnectionFactory() {
                @Override public java.sql.Connection open() throws java.sql.SQLException { return fixture.connections.open(); }
                @Override public Map<String, String> telemetryAttributes() { return fixture.connections.telemetryAttributes(); }
                @Override public void close() { throw new IllegalStateException("TOKEN_SQL_CANARY"); }
            };
            var output = new ByteArrayOutputStream();
            String commands = capture(lease, context) + command("PREPARE", lease.runId(), context) +
                command("RESET", lease.runId(), context) + "QUIT\t" + lease.runId() + "\n";
            assertEquals(4, InventoryFixtureStdio.serve(bytes(commands), new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(operator, cache, InventoryFixtureRunTest.permit())));
            assertEquals("UNAVAILABLE", rows(output).getLast().path("error").asText());
            assertFalse(output.toString(StandardCharsets.UTF_8).contains("CANARY"));
        }
    }

    @Test void overlongAndNonAsciiInputTerminatesBeforeOpeningAFactory() throws Exception {
        for (String command : List.of("A".repeat(1_025) + "\n", "CAPTURE\t\u2603\n")) {
            var output = new ByteArrayOutputStream();
            assertEquals(2, InventoryFixtureStdio.serve(bytes(command), new PrintStream(output), () -> {
                throw new AssertionError("Must not open a real factory");
            }));
            assertEquals("INVALID_REQUEST", rows(output).getFirst().path("error").asText());
        }
    }

    @Test void crossRunPrepareQuitAndRepeatedPrepareAreRejectedWithoutLosingHandle() throws Exception {
        try (var fixture = new DataFixture()) {
            var cache = new InventoryFixtureRunTest.Cache(new InventoryFixtureRunTest.MutableClock());
            var lease = InventoryFixtureRunTest.lease();
            var context = DataFixture.context();
            var output = new ByteArrayOutputStream();
            String commands = capture(lease, context) + command("PREPARE", UUID.randomUUID().toString(), context) +
                "QUIT\t" + lease.runId() + "\n" + command("PREPARE", lease.runId(), context) +
                command("PREPARE", lease.runId(), context) + command("RESET", lease.runId(), context) +
                "QUIT\t" + lease.runId() + "\n";
            assertEquals(0, InventoryFixtureStdio.serve(bytes(commands), new PrintStream(output), () ->
                new InventoryFixtureStdio.Stores(fixture.connections, cache, InventoryFixtureRunTest.permit())));
            var rows = rows(output);
            assertEquals("INVALID_REQUEST", rows.get(1).path("error").asText());
            assertEquals("INVALID_REQUEST", rows.get(2).path("error").asText());
            assertEquals("CONFLICT", rows.get(4).path("error").asText());
            assertEquals("RESET", rows.get(5).path("command").asText());
        }
    }

    private static String capture(InventoryFixtureRun.Lease lease, OperationContext context) {
        return "CAPTURE\t" + lease.runId() + "\t" + lease.orderId() + "\t" + lease.sku() + "\t" +
            context.invocationId().value() + "\t5000\t" + String.join(",", lease.unownedCacheWitnessSkus()) + "\n";
    }

    private static String command(String command, String runId, OperationContext context) {
        return command + "\t" + runId + "\t" + context.invocationId().value() + "\t5000\n";
    }

    private static ByteArrayInputStream bytes(String value) {
        return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
    }

    private static List<JsonNode> rows(ByteArrayOutputStream output) throws Exception {
        var result = new ArrayList<JsonNode>();
        for (String line : output.toString(StandardCharsets.UTF_8).lines().toList()) result.add(JSON.readTree(line));
        return result;
    }

    private static final class ScriptInput extends InputStream {
        private final List<String> lines;
        private final Map<Integer, Runnable> hooks;
        private int line, offset;
        ScriptInput(List<String> lines, Map<Integer, Runnable> hooks) { this.lines = lines; this.hooks = hooks; }
        @Override public int read() {
            if (line == lines.size()) return -1;
            if (offset == 0 && hooks.containsKey(line)) hooks.get(line).run();
            char value = lines.get(line).charAt(offset++);
            if (offset == lines.get(line).length()) { offset = 0; line++; }
            return value;
        }
    }
}
