package com.contoso.inventory.data;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class DataAgentProbe {
    private DataAgentProbe() {}

    public static void main(String[] args) throws Exception {
        long started = System.nanoTime();
        RuntimeGuard.verifyAgentArguments(java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments());
        boolean missing = args.length > 0 && args[0].equals("missing-client");
        try (var fixture = new DataFixture(); var resp = new RespFixture(); var cache = RedisDataTest.cache(resp);
             var root = Correlation.start("contoso.data.oracle", SpanKind.SERVER, Context.root(),
                 com.contoso.correlation.InvocationId.generate(), Map.of());
             var current = root.makeCurrent()) {
            var id = Correlation.invocation(root.context());
            var context = new OperationContext(id, root.context(), Instant.now().plusSeconds(20));
            final String[] sqlId = new String[1];
            if (missing) {
                try (var connection = fixture.connections.open(); var query = connection.prepareStatement("SELECT 1")) {
                    query.execute();
                }
            } else {
                PgOperations.execute(fixture.connections, PgOperation.SELECT, context, 1, connection -> {
                    sqlId[0] = Span.current().getSpanContext().getSpanId();
                    if (!Span.current().isRecording()) throw new IllegalStateException("API_NOT_RECORDING");
                    try (var query = connection.prepareStatement("SELECT 'SQL_LITERAL_CANARY', ?")) {
                        query.setString(1, "SQL_PARAMETER_CANARY");
                        try (var rows = query.executeQuery()) {
                            if (!rows.next() || !"SQL_PARAMETER_CANARY".equals(rows.getString(2))) {
                                throw new IllegalStateException("SQL_EXECUTION_NOT_VERIFIED");
                            }
                            try { Thread.sleep(80); }
                            catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
                        }
                    }
                    return null;
                });
            }
            resp.values.put(LettuceInventoryCache.key("REDIS_KEY_CANARY"), "REDIS_VALUE_SCRIPT_ARGUMENT_CANARY");
            try { cache.get("REDIS_KEY_CANARY", context); throw new IllegalStateException("CORRUPT_CACHE_NOT_REJECTED"); }
            catch (DataAccessException expected) {}
            cache.invalidate("REDIS_KEY_CANARY", context);
            cache.get("REDIS_KEY_CANARY", context);
            cache.put("REDIS_KEY_CANARY", new OwnedInventoryCache.Value(20, 1), context);
            if (!resp.commands.stream().anyMatch(command -> command.contains(LettuceInventoryCache.key("REDIS_KEY_CANARY")))) {
                throw new IllegalStateException("REDIS_EXECUTION_NOT_VERIFIED");
            }
            String linkedId;
            try (var linked = Correlation.startLinked("contoso.data.oracle.linked", SpanKind.CONSUMER,
                    id, List.of(root.spanContext()), Map.of());
                 var linkedScope = linked.makeCurrent()) {
                linkedId = linked.spanContext().getSpanId();
                if (!missing) PgOperations.execute(fixture.connections, PgOperation.SELECT,
                    new OperationContext(id, linked.context(), Instant.now().plusSeconds(5)), 1, connection -> {
                        try (var query = connection.prepareStatement("SELECT 1")) { query.execute(); }
                        return null;
                    });
            }
            SpanContext unsampled = SpanContext.create(root.spanContext().getTraceId(), "abcdef0123456789",
                TraceFlags.getDefault(), TraceState.getDefault());
            final String[] negativeId = new String[1];
            PgOperations.execute(fixture.connections, PgOperation.SELECT,
                new OperationContext(id, Context.root().with(Span.wrap(unsampled)), Instant.now().plusSeconds(5)), 1,
                connection -> {
                    negativeId[0] = Span.current().getSpanContext().getSpanId();
                    if (Span.current().isRecording() || Span.current().getSpanContext().isSampled()) {
                        throw new IllegalStateException("LOCAL_UNSAMPLED_PARENT_RESURRECTED");
                    }
                    try (var query = connection.prepareStatement("SELECT 1")) { query.execute(); }
                    return null;
                });
            System.out.printf("DATAORACLE %s %s %s %s %s %d%n", root.spanContext().getTraceId(),
                root.spanContext().getSpanId(), sqlId[0] == null ? "missing" : sqlId[0], linkedId,
                negativeId[0], Runtime.getRuntime().maxMemory());
            long cpu = ProcessHandle.current().info().totalCpuDuration().orElseThrow().toNanos();
            System.out.printf("DATARESOURCE %d %d %d%n", Runtime.getRuntime().availableProcessors(),
                cpu, System.nanoTime() - started);
        }
    }
}
