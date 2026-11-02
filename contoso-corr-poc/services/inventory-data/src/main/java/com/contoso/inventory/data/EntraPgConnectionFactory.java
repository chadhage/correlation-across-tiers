package com.contoso.inventory.data;

import com.azure.core.credential.TokenCredential;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperations;
import com.contoso.security.IdentityHttpClients;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.postgresql.ds.PGSimpleDataSource;

public final class EntraPgConnectionFactory implements PgConnectionFactory {
    private final PgSettings settings;
    private final PgTokenCache tokens;
    private final HikariDataSource pool;
    private final ThreadPoolExecutor opening;
    private final AtomicBoolean closed = new AtomicBoolean();

    public static PgConnectionFactory fromEnvironment() {
        return fromEnvironment(System.getenv().getOrDefault("APPLICATIONINSIGHTS_ROLE_NAME", "contoso-inventory-api"));
    }

    public static PgConnectionFactory fromEnvironment(String serviceName) {
        DataInstrumentationGuard.verify();
        DataLoggingGuard.verify();
        PgSettings settings = PgSettings.fromEnvironment(serviceName);
        return new EntraPgConnectionFactory(settings, IdentityHttpClients.managedIdentity(settings.clientId()));
    }

    public static PgConnectionFactory fromEnvironment(String serviceName, TokenCredential credential) {
        DataInstrumentationGuard.verify();
        DataLoggingGuard.verify();
        return new EntraPgConnectionFactory(PgSettings.fromEnvironment(serviceName), credential);
    }

    public EntraPgConnectionFactory(PgSettings settings, TokenCredential credential) {
        this(settings, credential, physical(settings));
    }

    EntraPgConnectionFactory(PgSettings settings, TokenCredential credential, DataSource physical) {
        this.settings = settings;
        tokens = new PgTokenCache(credential, Clock.systemUTC());
        HikariConfig config = new HikariConfig();
        config.setPoolName("contoso-pg");
        config.setDataSource(new TokenDataSource(physical));
        config.setMaximumPoolSize(settings.maximumPoolSize());
        config.setMinimumIdle(0);
        config.setConnectionTimeout(settings.poolWait().toMillis());
        config.setValidationTimeout(1_000);
        config.setInitializationFailTimeout(-1);
        config.setMaxLifetime(Duration.ofMinutes(4).toMillis());
        pool = new HikariDataSource(config);
        opening = new ThreadPoolExecutor(1, settings.maximumPoolSize(), 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(settings.maximumPoolSize()), action -> {
                Thread thread = new Thread(action, "contoso-pg-open");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    }

    private static PGSimpleDataSource physical(PgSettings settings) {
        PGSimpleDataSource physical = new PGSimpleDataSource();
        physical.setServerNames(new String[]{settings.host()});
        physical.setPortNumbers(new int[]{5432});
        physical.setDatabaseName(settings.database());
        physical.setSslMode("verify-full");
        physical.setSslfactory("org.postgresql.ssl.DefaultJavaSSLFactory");
        physical.setConnectTimeout((int) Math.max(1, settings.connectTimeout().toSeconds()));
        physical.setSocketTimeout((int) Math.max(1, settings.socketTimeout().toSeconds()));
        physical.setCancelSignalTimeout(1);
        physical.setApplicationName(settings.serviceName());
        return physical;
    }

    @Override public Connection open() throws SQLException {
        if (closed.get()) throw new SQLException("data_unavailable", "08003");
        OperationContext context = PgOperations.currentContext();
        long budget = context == null ? 3_000 : PgOperations.remainingMillis(context);
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budget);
        try { tokens.prepare(Duration.ofMillis(Math.min(3_000, budget))); }
        catch (DataAccessException failure) {
            if (failure.kind() == DataErrorKind.TIMEOUT) {
                throw new java.sql.SQLTimeoutException("data_timeout", "57014");
            }
            if (failure.kind() == DataErrorKind.CANCELLED) throw new SQLException("data_cancelled", "57014");
            throw new SQLException("data_authentication", "28000");
        }
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new java.sql.SQLTimeoutException("data_timeout", "57014");
        AtomicBoolean abandoned = new AtomicBoolean();
        AtomicReference<Connection> opened = new AtomicReference<>();
        Future<Connection> pending;
        try {
            pending = opening.submit(() -> {
                Connection connection = pool.getConnection();
                opened.set(connection);
                if (abandoned.get() || System.nanoTime() > deadline) {
                    if (opened.compareAndSet(connection, null)) connection.close();
                    throw new java.sql.SQLTimeoutException("data_timeout", "57014");
                }
                return connection;
            });
        } catch (RuntimeException failure) { throw new SQLException("data_capacity", "53300"); }
        try {
            Connection connection = pending.get(remaining, TimeUnit.NANOSECONDS);
            opened.compareAndSet(connection, null);
            return connection;
        }
        catch (TimeoutException failure) {
            abandoned.set(true);
            pending.cancel(true);
            closeAbandoned(opened);
            throw new java.sql.SQLTimeoutException("data_timeout", "57014");
        } catch (InterruptedException failure) {
            abandoned.set(true);
            pending.cancel(true);
            closeAbandoned(opened);
            Thread.currentThread().interrupt();
            throw new SQLException("data_cancelled", "57014");
        } catch (ExecutionException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof SQLException sql) throw com.contoso.correlation.data.DataErrors.sanitized(sql);
            throw new SQLException("data_unavailable", "08006");
        }
    }

    @Override public Map<String, String> telemetryAttributes() { return settings.telemetryAttributes(); }

    @Override public void close() {
        if (closed.compareAndSet(false, true)) {
            opening.shutdownNow();
            pool.close();
        }
    }

    @Override public String toString() { return "EntraPgConnectionFactory[redacted]"; }

    private static void closeAbandoned(AtomicReference<Connection> opened) {
        Connection connection = opened.getAndSet(null);
        if (connection != null) try { connection.close(); } catch (SQLException ignored) {}
    }

    private final class TokenDataSource implements DataSource {
        private final DataSource physical;
        TokenDataSource(DataSource physical) { this.physical = physical; }
        @Override public Connection getConnection() throws SQLException {
            try { return SanitizedJdbc.wrap(physical.getConnection(settings.roleName(), tokens.connectionPassword())); }
            catch (SQLException failure) { throw com.contoso.correlation.data.DataErrors.sanitized(failure); }
            catch (DataAccessException failure) { throw new SQLException("data_authentication", "28000"); }
        }
        @Override public Connection getConnection(String user, String password) throws SQLException {
            throw new SQLException("data_credentials_override_forbidden");
        }
        @Override public PrintWriter getLogWriter() { return null; }
        @Override public void setLogWriter(PrintWriter writer) throws SQLException {
            if (writer != null) throw new SQLException("data_logging_forbidden");
        }
        @Override public void setLoginTimeout(int seconds) {}
        @Override public int getLoginTimeout() { return 3; }
        @Override public Logger getParentLogger() { return Logger.getLogger("com.contoso.inventory.data"); }
        @Override public <T> T unwrap(Class<T> type) throws SQLException { throw new SQLException("data_unwrap_forbidden"); }
        @Override public boolean isWrapperFor(Class<?> type) { return false; }
    }
}
