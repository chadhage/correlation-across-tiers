package com.contoso.demo.operator;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationIds;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import com.contoso.inventory.data.PgRedisInventoryDataAdapter;
import com.contoso.security.RequestAuthenticator;
import com.sun.net.httpserver.HttpServer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Context;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class InventoryFaultFixture {
    private InventoryFaultFixture() {}

    static void start(PgConnectionFactory database, int port) throws java.io.IOException {
        if (!"true".equals(System.getenv("CONTOSO_ISOLATED_INVENTORY_FIXTURE"))) {
            throw new IllegalStateException("ISOLATED_INVENTORY_FIXTURE_REQUIRED");
        }
        RuntimeGuard.verify("contoso-inventory-api", InventoryFaultFixture.class.getClassLoader());
        var authenticator = RequestAuthenticator.fromEnvironment("contoso-inventory-api");
        var inventory = PgRedisInventoryDataAdapter.fromEnvironment();
        var executor = new ThreadPoolExecutor(4, 8, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32),
            new ThreadPoolExecutor.AbortPolicy());
        var server = HttpServer.create(new InetSocketAddress(port), 32);
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            UUID observedRun = null, observation = null;
            try {
                String path = exchange.getRequestURI().getPath();
                if (!"GET".equals(exchange.getRequestMethod()) || exchange.getRequestURI().getRawQuery() != null) {
                    OperatorApplication.reply(exchange, 400, Map.of("schemaVersion", 1, "code", "INVALID_REQUEST")); return;
                }
                if (path.equals("/health/live") || path.equals("/health/ready")) {
                    if (path.equals("/health/ready")) {
                        try (var connection = database.open(); var query = connection.prepareStatement(
                                "SELECT has_function_privilege(current_user,'contoso_operator.record_fixture_event(uuid,uuid,text,text)','EXECUTE')");
                             var row = query.executeQuery()) {
                            if (!row.next() || !row.getBoolean(1)) throw new OperatorFailure(503, "FIXTURE_OBSERVER_GRANT_REQUIRED");
                        }
                    }
                    OperatorApplication.reply(exchange, inventory.isReady() ? 200 : 503,
                        Map.of("fixture", true, "certified", false, "ready", inventory.isReady())); return;
                }
                if (!path.equals("/api/inventory/" + OperatorRunStore.SKU)) throw OperatorFailure.invalid();
                if (exchange.getRequestHeaders().getOrDefault("Authorization", java.util.List.of()).size() != 1) {
                    throw new SecurityException("AUTHENTICATION_REJECTED");
                }
                var caller = authenticator.authenticate(exchange.getRequestHeaders().getFirst("Authorization"), null);
                var invocation = InvocationIds.resolve(exchange.getRequestHeaders()
                    .getOrDefault(InvocationIds.HEADER, java.util.List.of()), caller.trustedInvocationIssuer());
                exchange.getResponseHeaders().set(InvocationIds.HEADER, invocation.value());
                try (var work = RuntimeGuard.admitWork(); var bound = Correlation.bind(invocation)) {
                    UUID runId = null; String fault = "NONE";
                    try (var connection = database.open();
                         var query = connection.prepareStatement("SELECT run_id,fault FROM contoso_operator.active_fault");
                         var row = query.executeQuery()) {
                        if (row.next()) { runId = UUID.fromString(row.getString(1)); fault = row.getString(2); }
                    }
                    if (runId == null) throw new OperatorFailure(409, "FIXTURE_RUN_REQUIRED");
                    observedRun = runId;
                    observation = UUID.randomUUID();
                    var facts = new LinkedHashMap<String, Object>();
                    var sdk = Span.current().getSpanContext();
                    facts.put("traceId", sdk.getTraceId()); facts.put("spanId", sdk.getSpanId());
                    facts.put("sdkSampled", sdk.isSampled()); facts.put("sdkRecording", Span.current().isRecording());
                    facts.put("businessInvocationId", invocation.value()); facts.put("fault", fault);
                    facts.put("requestObservationId", observation.toString());
                    var parents = exchange.getRequestHeaders().getOrDefault("traceparent", java.util.List.of());
                    if (parents.size() == 1 && parents.getFirst().matches("00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}")) {
                        facts.put("inboundTraceparent", parents.getFirst());
                    }
                    record(database, runId, observation, "INVENTORY_SDK", facts);
                    if (fault.equals("INVENTORY_TIMEOUT")) Thread.sleep(15000);
                    var context = new OperationContext(invocation, Context.current(), Instant.now().plusSeconds(5));
                    if (fault.equals("POSTGRES_ERROR")) {
                        PgOperations.execute(database, PgOperation.SELECT, context, 1, connection -> {
                            try (var query = connection.prepareStatement("SELECT 1 / 0"); var rows = query.executeQuery()) {
                                rows.next(); return rows.getInt(1);
                            }
                        });
                    }
                    if (fault.equals("DATA_CANARY")) {
                        AzureDataCanaries.execute(database, context);
                        record(database, runId, observation, "DATA_CANARIES", Map.of(
                            "sqlLiteralAndParameterExecuted", true, "redisKeyValueScriptAndArgumentExecuted", true,
                            "readOnlyEffects", true));
                    }
                    var item = inventory.lookupInventory(OperatorRunStore.SKU, context);
                    Correlation.log(org.slf4j.LoggerFactory.getLogger(InventoryFaultFixture.class), "inventory_lookup", "SUCCESS");
                    OperatorApplication.reply(exchange, 200, item);
                }
            } catch (SecurityException failure) {
                OperatorApplication.safeReply(exchange, 401, "UNAUTHENTICATED");
            } catch (InterruptedException failure) {
                Thread.currentThread().interrupt(); OperatorApplication.safeReply(exchange, 503, "INTERRUPTED");
            } catch (com.contoso.correlation.data.DataAccessException failure) {
                Span.current().recordException(failure);
                OperatorApplication.safeReply(exchange, 503, "DATA_UNAVAILABLE");
            } catch (OperatorFailure failure) {
                OperatorApplication.safeReply(exchange, failure.status, failure.getMessage());
            } catch (java.sql.SQLException failure) {
                OperatorApplication.safeReply(exchange, 503, "FIXTURE_STORE_UNAVAILABLE");
            } catch (RuntimeException failure) {
                System.err.println("INVENTORY_FIXTURE_FAILED");
                OperatorApplication.safeReply(exchange, 503, "FIXTURE_UNAVAILABLE");
            } finally {
                if (observedRun != null && observation != null) {
                    try { record(database, observedRun, observation, "INVENTORY_FINISHED", Map.of("completed", true)); }
                    catch (java.sql.SQLException | RuntimeException failure) { System.err.println("FIXTURE_FINISH_UNACKNOWLEDGED"); }
                }
                exchange.close();
            }
        });
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(2); executor.shutdownNow(); inventory.close(); authenticator.close(); database.close();
        }));
        server.start();
    }

    private static void record(PgConnectionFactory database, UUID id, UUID observation, String kind, Object facts) throws java.sql.SQLException {
        try (var connection = database.open(); var insert = connection.prepareStatement(
                "SELECT contoso_operator.record_fixture_event(?,?,?,?)")) {
            insert.setObject(1, id); insert.setObject(2, observation); insert.setString(3, kind);
            insert.setString(4, OperatorJson.write(facts)); insert.execute();
        }
    }
}
