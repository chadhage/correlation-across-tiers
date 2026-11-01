package com.contoso.correlation.data;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.CorrelationSpan;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.ContextKey;
import io.opentelemetry.context.Scope;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.stream.BaseStream;

public final class PgOperations {
    private static final ContextKey<OperationContext> CALL = ContextKey.named("contoso.pg.call");
    private static final Set<String> METADATA = Set.of("db.system", "db.name", "server.address", "server.port");
    private static final ScheduledExecutorService DEADLINES = Executors.newScheduledThreadPool(2, action -> {
        Thread thread = new Thread(action, "contoso-pg-deadline");
        thread.setDaemon(true);
        return thread;
    });

    private PgOperations() {}

    public static OperationContext currentContext() { return Context.current().get(CALL); }

    public static long remainingMillis(OperationContext context) {
        long remaining = Duration.between(Instant.now(), context.deadline()).toMillis();
        if (remaining <= 0) throw new DataAccessException(DataErrorKind.TIMEOUT, false);
        return Math.min(remaining, 30_000);
    }

    public static <T> T execute(PgConnectionFactory connections, PgOperation operation,
                               OperationContext context, int dataAttempt, SqlWork<T> work) {
        if (connections == null || operation == null || context == null || work == null ||
            dataAttempt < 1 || dataAttempt > 100) {
            throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
        }
        remainingMillis(context);
        var bound = Correlation.invocation(context.parentContext());
        if (bound != null && !bound.equals(context.invocationId())) {
            throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
        }
        Map<String, String> attributes = metadata(connections);
        attributes.put("contoso.data.operation", operation.name());
        attributes.put("db.operation.name", operation.name());
        attributes.put("contoso.process.attempt", Integer.toString(dataAttempt));
        try (Scope parent = context.parentContext().with(CALL, context).makeCurrent()) {
            Connection connection;
            // Identity/pool preparation is not a SQL child operation.
            try { connection = connections.open(); }
            catch (SQLException failure) { throw safe(failure, false); }
            catch (RuntimeException failure) { throw safe(failure, false); }
            if (connection == null) throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
            CorrelationSpan span = null;
            try {
                remainingMillis(context);
                span = Correlation.start(operation.spanName(), SpanKind.CLIENT,
                    Context.current(), context.invocationId(), attributes);
                try (Scope current = span.makeCurrent()) {
                    DeadlineLease lease = new DeadlineLease(connection, context);
                    try {
                        Connection guarded = DeadlineJdbc.wrap(connection, context);
                        T value = work.run(guarded);
                        if (lease.expired || Instant.now().isAfter(context.deadline())) {
                            throw new SQLTimeoutException("data_timeout", "57014");
                        }
                        if (value instanceof Connection || value instanceof java.sql.Statement ||
                            value instanceof java.sql.ResultSet || value instanceof BaseStream<?, ?>) {
                            throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
                        }
                        return value;
                    } catch (SQLException | RuntimeException failure) {
                        DataAccessException safe = lease.expired
                            ? new DataAccessException(DataErrorKind.TIMEOUT, operation.mutating())
                            : safe(failure, operation.mutating());
                        span.failure(safe.kind().name());
                        throw safe;
                    } finally {
                        try { lease.close(); }
                        catch (SQLException failure) {
                            DataAccessException safe = safe(failure, operation.mutating());
                            span.failure(safe.kind().name());
                            throw safe;
                        }
                    }
                }
            } finally {
                try { connection.close(); } catch (SQLException ignored) {}
                if (span != null) span.close();
            }
        }
    }

    private static Map<String, String> metadata(PgConnectionFactory connections) {
        Map<String, String> supplied = connections.telemetryAttributes();
        if (supplied == null || !METADATA.containsAll(supplied.keySet())) {
            throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
        }
        Map<String, String> result = new HashMap<>(supplied);
        if (!"postgresql".equals(result.get("db.system"))) {
            throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
        }
        for (var entry : result.entrySet()) {
            String value = entry.getValue();
            if (value == null || value.length() > 253 || value.chars().anyMatch(c -> c < 32 || c == 127)) {
                throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
            }
            if (entry.getKey().equals("server.address") && !value.matches("[A-Za-z0-9.-]{1,253}") ||
                entry.getKey().equals("db.name") && !value.matches("[A-Za-z0-9_]{1,63}") ||
                entry.getKey().equals("server.port") && !value.equals("5432")) {
                throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
            }
        }
        return result;
    }

    private static DataAccessException safe(Throwable failure, boolean mutating) {
        if (failure instanceof DataAccessException alreadySafe) {
            boolean uncertain = mutating && (alreadySafe.kind() == DataErrorKind.TIMEOUT ||
                alreadySafe.kind() == DataErrorKind.CANCELLED ||
                alreadySafe.kind() == DataErrorKind.DNS_OR_CONNECTIVITY);
            return new DataAccessException(alreadySafe.kind(), alreadySafe.outcomeUnknown() || uncertain);
        }
        DataErrorKind kind = DataErrors.classify(failure);
        boolean unknown = mutating && (kind == DataErrorKind.TIMEOUT ||
            kind == DataErrorKind.DNS_OR_CONNECTIVITY || kind == DataErrorKind.UNAVAILABLE ||
            kind == DataErrorKind.CANCELLED);
        return new DataAccessException(kind, unknown);
    }

    private static final class DeadlineLease {
        private final Connection connection;
        private final ReentrantLock lock = new ReentrantLock();
        private final ScheduledFuture<?> deadline;
        private boolean closed;
        private volatile boolean expired;

        DeadlineLease(Connection connection, OperationContext context) {
            this.connection = connection;
            deadline = DEADLINES.schedule(this::expire, remainingMillis(context), TimeUnit.MILLISECONDS);
        }

        private void expire() {
            lock.lock();
            try {
                if (closed) return;
                expired = true;
                try { connection.abort(Runnable::run); } catch (SQLException | RuntimeException ignored) {}
            } finally { lock.unlock(); }
        }

        void close() throws SQLException {
            lock.lock();
            try {
                closed = true;
                deadline.cancel(false);
                try {
                    if (!connection.isClosed() && !connection.getAutoCommit()) {
                        connection.rollback();
                        connection.setAutoCommit(true);
                    }
                } finally { connection.close(); }
            } finally { lock.unlock(); }
        }
    }
}
