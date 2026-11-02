package com.contoso.inventory.data;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.security.IdentityHttpClients;
import io.opentelemetry.context.Context;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.function.Supplier;

/** Fixed operator process bridge. A live process handle, not saved JSON, owns the private baseline. */
public final class InventoryFixtureStdio {
    private static final String SCHEMA = "contoso.inventory-fixture-stdio.v1";
    private InventoryFixtureStdio() {}

    record Stores(PgConnectionFactory operator, RestorableInventoryCache cache, InventorySchemaHooks.Permit permit)
            implements AutoCloseable {
        @Override public void close() {
            try { cache.close(); } finally { operator.close(); }
        }
    }

    public static void main(String[] args) {
        if (!Arrays.equals(args, new String[] { "--approved-operator-stdio" })) {
            error(System.out, new DataAccessException(DataErrorKind.AUTHORIZATION, false));
            System.exit(2);
            return;
        }
        System.exit(serve(System.in, System.out, InventoryFixtureStdio::openStores));
    }

    private static Stores openStores() {
        var permit = new InventorySchemaHooks.Permit(System.getenv("CONTOSO_PG_RESOURCE_ID"),
            System.getenv().getOrDefault("CONTOSO_PG_DATABASE", "contoso_orders"), true);
        var credential = IdentityHttpClients.defaultCredential();
        PgConnectionFactory pg = EntraPgConnectionFactory.fromEnvironment("contoso-inventory-api", credential);
        try {
            var cache = LettuceInventoryCache.fromEnvironment(credential);
            return new Stores(pg, (RestorableInventoryCache) cache, permit);
        } catch (RuntimeException failure) {
            pg.close();
            throw failure;
        }
    }

    static int serve(InputStream input, PrintStream output, Supplier<Stores> factory) {
        var opened = new java.util.ArrayList<Stores>(1);
        int result = serveCommands(input, output, () -> {
            Stores stores = factory.get();
            opened.add(stores);
            return stores;
        });
        for (Stores stores : opened) {
            try { stores.close(); }
            catch (RuntimeException failure) {
                error(output, new DataAccessException(DataErrorKind.UNAVAILABLE, false));
                result = 4;
            }
        }
        return output.checkError() ? 4 : result;
    }

    private static int serveCommands(InputStream input, PrintStream output, Supplier<Stores> factory) {
        Stores stores = null;
        InventoryFixtureRun run = null;
        String runId = null;
        try {
            for (int commandCount = 0; commandCount < 64; commandCount++) {
                String line = readLine(input);
                if (line == null) {
                    if (run == null) return 2;
                    if (run.state() == InventoryFixtureRun.State.RESTORED) return 0;
                    incomplete(output);
                    return 3;
                }
                try {
                    String[] fields = line.split("\t", -1);
                    switch (fields[0]) {
                        case "CAPTURE" -> {
                            if (fields.length != 7 || run != null) throw invalid();
                            var lease = new InventoryFixtureRun.Lease(fields[1], fields[2], fields[3],
                                fields[6].equals("-") ? List.of() : List.of(fields[6].split(",", -1)));
                            var context = context(fields[4], fields[5]);
                            if (stores == null) stores = factory.get();
                            run = InventoryFixtureRun.capture(stores.operator(), stores.cache(), stores.permit(), lease, context);
                            runId = lease.runId();
                            output.println(header("CAPTURE", runId, run) + ",\"hashes\":" + hashes(run.capturedHashes()) + "}");
                        }
                        case "PREPARE", "RESET" -> {
                            if (fields.length != 4 || run == null || !fields[1].equals(runId)) throw invalid();
                            var context = context(fields[2], fields[3]);
                            if (fields[0].equals("PREPARE")) {
                                run.prepare(context);
                                output.println(header("PREPARE", runId, run) + "}");
                            } else {
                                var receipt = run.reset(context);
                                output.println(header("RESET", runId, run) + ",\"expected\":" + hashes(receipt.expected()) +
                                    ",\"observed\":" + hashes(receipt.observed()) + "}");
                            }
                        }
                        case "QUIT" -> {
                            if (fields.length != 2 || run == null || !fields[1].equals(runId) ||
                                run.state() != InventoryFixtureRun.State.RESTORED) throw invalid();
                            output.println(header("QUIT", runId, run) + "}");
                            return 0;
                        }
                        default -> throw invalid();
                    }
                } catch (RuntimeException failure) {
                    error(output, failure);
                }
                output.flush();
            }
            incomplete(output);
            return 3;
        } catch (IOException failure) {
            error(output, invalid());
            if (run != null && run.state() != InventoryFixtureRun.State.RESTORED) incomplete(output);
            return 2;
        }
    }

    private static OperationContext context(String invocationId, String budget) {
        long millis;
        try { millis = Long.parseLong(budget); }
        catch (NumberFormatException failure) { throw invalid(); }
        if (millis < 1 || millis > 30_000) throw invalid();
        return new OperationContext(InvocationId.parse(invocationId), Context.root(), Instant.now().plusMillis(millis));
    }

    private static String readLine(InputStream input) throws IOException {
        var bytes = new java.io.ByteArrayOutputStream();
        for (int next; (next = input.read()) != -1;) {
            if (next == '\n') return bytes.toString(StandardCharsets.US_ASCII).replaceFirst("\\r$", "");
            if (bytes.size() >= 1_024 || next > 126 || next < 32 && next != '\t' && next != '\r') {
                throw new IOException("invalid_fixture_command");
            }
            bytes.write(next);
        }
        return bytes.size() == 0 ? null : bytes.toString(StandardCharsets.US_ASCII);
    }

    private static String header(String command, String runId, InventoryFixtureRun run) {
        return "{\"schema\":\"" + SCHEMA + "\",\"command\":\"" + command + "\",\"runId\":\"" + runId +
            "\",\"state\":\"" + run.state().name() + "\"";
    }

    private static String hashes(InventoryFixtureRun.Hashes value) {
        return "{\"ownedRowsSha256\":\"" + value.ownedRowsSha256() + "\",\"unownedRowsSha256\":\"" +
            value.unownedRowsSha256() + "\",\"cacheContentSha256\":\"" + value.cacheContentSha256() +
            "\",\"unownedCacheContentSha256\":\"" + value.unownedCacheContentSha256() + "\"}";
    }

    private static void error(PrintStream output, RuntimeException failure) {
        var safe = failure instanceof DataAccessException data ? data : invalid();
        output.println("{\"schema\":\"" + SCHEMA + "\",\"error\":\"" + safe.kind().name() +
            "\",\"outcomeUnknown\":" + safe.outcomeUnknown() + "}");
        output.flush();
    }

    private static void incomplete(PrintStream output) {
        output.println("{\"schema\":\"" + SCHEMA + "\",\"error\":\"INCOMPLETE_RESET\"}");
        output.flush();
    }

    private static DataAccessException invalid() { return new DataAccessException(DataErrorKind.INVALID_REQUEST, false); }
}
