package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import io.opentelemetry.context.Context;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.postgresql.ds.PGSimpleDataSource;

final class LocalPostgresLane {
    record Settings(UUID runId, int port, String username, String password) {
        static Settings parse(Map<String, String> environment) {
            if (!"run-owned-only".equals(environment.get("CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP")) ||
                !"127.0.0.1".equals(environment.get("CONTOSO_LOCAL_PG_HOST"))) {
                throw new IllegalArgumentException("local_postgres_explicit_loopback_approval_required");
            }
            try {
                String supplied = environment.get("CONTOSO_LOCAL_PG_RUN_ID");
                UUID run = UUID.fromString(supplied);
                int port = Integer.parseInt(environment.get("CONTOSO_LOCAL_PG_PORT"));
                String user = environment.get("CONTOSO_LOCAL_PG_USERNAME");
                if (!run.toString().equals(supplied) || run.equals(new UUID(0, 0)) ||
                    port < 1 || port > 65535 || user == null || !user.matches("[A-Za-z_][A-Za-z0-9_]{0,62}")) {
                    throw new IllegalArgumentException();
                }
                return new Settings(run, port, user, environment.get("CONTOSO_LOCAL_PG_PASSWORD"));
            } catch (RuntimeException invalid) {
                throw new IllegalArgumentException("local_postgres_run_port_and_username_required");
            }
        }

        String database() { return "contoso_local_" + runId.toString().replace("-", ""); }
        String role() { return database() + "_app"; }
        String marker() { return "local-postgresql:" + runId; }

        PGSimpleDataSource source(String database) {
            var source = new PGSimpleDataSource();
            source.setServerNames(new String[] { "127.0.0.1" });
            source.setPortNumbers(new int[] { port });
            source.setDatabaseName(database);
            source.setUser(username);
            if (password != null) source.setPassword(password);
            source.setSslMode("disable");
            source.setConnectTimeout(3);
            source.setSocketTimeout(5);
            return source;
        }

        @Override public String toString() { return "LocalPostgresSettings[redacted]"; }
    }

    @Test @Timeout(60)
    void realPostgres18MigrationGrantsOperationsAndOwnedCleanup() throws Exception {
        Settings settings = Settings.parse(System.getenv());
        try (Connection control = settings.source("postgres").getConnection()) {
            assertEquals("PostgreSQL", control.getMetaData().getDatabaseProductName());
            assertEquals(18, control.getMetaData().getDatabaseMajorVersion());
            assertEquals("127.0.0.1", text(control, "SELECT inet_server_addr()::text"));
            assertFalse(exists(control, "SELECT 1 FROM pg_database WHERE datname=?", settings.database()),
                "Existing databases are never adopted or dropped");
            assertFalse(exists(control, "SELECT 1 FROM pg_roles WHERE rolname=?", settings.role()),
                "Existing roles are never adopted or dropped");
            boolean roleCreated = false;
            boolean databaseCreated = false;
            Throwable primary = null;
            try {
                execute(control, "CREATE ROLE \"" + settings.role() +
                    "\" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
                roleCreated = true;
                execute(control, "CREATE DATABASE \"" + settings.database() + "\" TEMPLATE template0");
                databaseCreated = true;
                verifyOwnedDatabase(settings);
            } catch (Exception | Error failure) {
                primary = failure;
                throw failure;
            } finally {
                try {
                    if (databaseCreated) {
                        execute(control, "DROP DATABASE \"" + settings.database() + "\"");
                        assertFalse(exists(control, "SELECT 1 FROM pg_database WHERE datname=?", settings.database()));
                    }
                    if (roleCreated) {
                        execute(control, "DROP ROLE \"" + settings.role() + "\"");
                        assertFalse(exists(control, "SELECT 1 FROM pg_roles WHERE rolname=?", settings.role()));
                    }
                } catch (Exception | Error cleanup) {
                    var safe = new IllegalStateException("local_postgres_owned_cleanup_incomplete");
                    if (primary != null) primary.addSuppressed(safe);
                    else throw safe;
                }
            }
        }
    }

    private static void verifyOwnedDatabase(Settings settings) throws Exception {
        try (Connection administrator = settings.source(settings.database()).getConnection()) {
            assertFalse(exists(administrator, "SELECT 1 FROM pg_namespace WHERE nspname=?", "contoso"));
            InventorySchemaHooks.applyV001(administrator);
            InventorySchemaHooks.applyV001(administrator);
            try (var bind = administrator.prepareStatement(
                "UPDATE contoso.environment_marker SET expected_resource_id=? WHERE singleton=TRUE")) {
                bind.setString(1, settings.marker());
                assertEquals(1, bind.executeUpdate());
            }
            execute(administrator, "INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic) " +
                "VALUES('LOCAL-WITNESS','Local untouched witness',17,41,FALSE)");
            execute(administrator, "GRANT CONNECT ON DATABASE \"" + settings.database() + "\" TO \"" + settings.role() + "\"");
            for (String grant : InventorySchemaHooks.inventoryGrantStatements(settings.role())) execute(administrator, grant);
            execute(administrator, "GRANT ALL PRIVILEGES ON contoso.environment_marker TO \"" + settings.role() + "\"");
            execute(administrator, "GRANT INSERT(singleton,workload,environment,seed_version,expected_resource_id)," +
                "UPDATE(expected_resource_id,workload,environment,seed_version) ON contoso.environment_marker TO \"" + settings.role() + "\"");
            for (String grant : InventorySchemaHooks.inventoryGrantStatements(settings.role())) execute(administrator, grant);

            var connections = new PgConnectionFactory() {
                @Override public Connection open() throws SQLException { return roleConnection(settings); }
                @Override public Map<String, String> telemetryAttributes() {
                    return Map.of("db.system", "postgresql", "db.name", settings.database(), "server.address", "127.0.0.1");
                }
            };
            try (var adapter = new PgRedisInventoryDataAdapter(connections, new PostgresOnlyCache(), settings.marker())) {
                assertTrue(adapter.isReady());
                assertEquals(20, adapter.lookupInventory("CONTOSO-001", context()).available());
                String order = UUID.randomUUID().toString();
                var reserved = adapter.reserveInventory(order, "CONTOSO-001", 3, context());
                assertEquals(reserved, adapter.reserveInventory(order, "CONTOSO-001", 3, context()));
                assertEquals(17, adapter.lookupInventory("CONTOSO-001", context()).available());
                assertEquals(DataErrorKind.CONFLICT, assertThrows(DataAccessException.class,
                    () -> adapter.reserveInventory(order, "CONTOSO-001", 2, context())).kind());
                assertEquals(DataErrorKind.INSUFFICIENT_STOCK, assertThrows(DataAccessException.class,
                    () -> adapter.reserveInventory(UUID.randomUUID().toString(), "CONTOSO-001", 21, context())).kind());
                var released = adapter.releaseInventory(order, reserved.reservationId(), context());
                assertEquals("RELEASED", released.state());
                assertEquals(released, adapter.releaseInventory(order, reserved.reservationId(), context()));
                assertEquals(20, adapter.lookupInventory("CONTOSO-001", context()).available());
            }

            try (Connection runtime = roleConnection(settings)) {
                runtime.setAutoCommit(false);
                try (var query = runtime.createStatement();
                     var rows = query.executeQuery("SELECT singleton FROM contoso.environment_marker WHERE singleton=TRUE FOR UPDATE")) {
                    assertTrue(rows.next(), "The real nonadmin role must acquire the marker row lock");
                }
                runtime.rollback();
            }
            for (String column : new String[] { "expected_resource_id", "workload", "environment", "seed_version" }) {
                assertDenied(settings, "UPDATE contoso.environment_marker SET " + column + "=" + column + " WHERE FALSE");
            }
            assertDenied(settings, "INSERT INTO contoso.environment_marker(singleton,workload,environment,seed_version) " +
                "SELECT TRUE,'contoso-corr','poc',1 WHERE FALSE");
            assertDenied(settings, "DELETE FROM contoso.environment_marker WHERE FALSE");
            assertDenied(settings, "DELETE FROM contoso.inventory_reservation WHERE FALSE");
            assertDenied(settings, "UPDATE contoso.inventory_item SET sku=sku WHERE FALSE");
            assertDenied(settings, "INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic) " +
                "SELECT 'NEVER-INSERTED','Never inserted',1,1,TRUE WHERE FALSE");
            try (Connection runtime = roleConnection(settings)) {
                assertEquals("false", text(runtime, "SELECT has_table_privilege(current_user,'contoso.inventory_item','TRUNCATE')::text"));
                for (String privilege : new String[] { "INSERT", "UPDATE", "DELETE", "TRUNCATE" }) {
                    assertEquals("false", text(runtime, "SELECT has_table_privilege(current_user,'contoso.environment_marker','" +
                        privilege + "')::text"), privilege);
                }
                for (String column : new String[] { "expected_resource_id", "workload", "environment", "seed_version" }) {
                    assertEquals("false", text(runtime, "SELECT has_column_privilege(current_user,'contoso.environment_marker','" +
                        column + "','UPDATE')::text"), column);
                }
                for (String column : new String[] { "singleton", "expected_resource_id", "workload", "environment", "seed_version" }) {
                    assertEquals("false", text(runtime, "SELECT has_column_privilege(current_user,'contoso.environment_marker','" +
                        column + "','INSERT')::text"), column);
                }
                assertEquals("false", text(runtime, "SELECT has_schema_privilege(current_user,'contoso','CREATE')::text"));
                assertEquals("false", text(runtime, "SELECT has_column_privilege(current_user,'contoso.inventory_reservation','synthetic','INSERT')::text"));
                assertEquals("true", text(runtime, "SELECT has_column_privilege(current_user,'contoso.environment_marker','singleton','UPDATE')::text"));
                runtime.setAutoCommit(false);
                var immutable = assertThrows(SQLException.class,
                    () -> execute(runtime, "UPDATE contoso.environment_marker SET singleton=FALSE WHERE singleton=TRUE"));
                assertEquals("23514", immutable.getSQLState(), "The granted lock-only column is constrained to TRUE");
                runtime.rollback();
                var nonnull = assertThrows(SQLException.class,
                    () -> execute(runtime, "UPDATE contoso.environment_marker SET singleton=NULL WHERE singleton=TRUE"));
                assertEquals("23502", nonnull.getSQLState(), "The singleton primary key cannot become NULL");
                runtime.rollback();
            }
            assertEquals("17:41:false", text(administrator,
                "SELECT available::text||':'||revision::text||':'||synthetic::text FROM contoso.inventory_item WHERE sku='LOCAL-WITNESS'"));
            assertEquals("5", text(administrator, "SELECT count(*)::text FROM contoso.inventory_item WHERE synthetic=TRUE"));
            assertEquals(settings.marker(), text(administrator,
                "SELECT expected_resource_id FROM contoso.environment_marker WHERE singleton=TRUE"));
        }
    }

    private static Connection roleConnection(Settings settings) throws SQLException {
        Connection connection = settings.source(settings.database()).getConnection();
        try {
            execute(connection, "SET statement_timeout='2s'");
            execute(connection, "SET lock_timeout='1s'");
            execute(connection, "SET ROLE \"" + settings.role() + "\"");
            if (!settings.role().equals(text(connection, "SELECT current_user"))) {
                throw new SQLException("local_postgres_effective_role_mismatch");
            }
            return connection;
        } catch (SQLException failure) {
            connection.close();
            throw failure;
        }
    }

    private static void assertDenied(Settings settings, String sql) throws SQLException {
        try (Connection connection = roleConnection(settings)) {
            assertEquals("42501", assertThrows(SQLException.class, () -> execute(connection, sql)).getSQLState());
        }
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.setQueryTimeout(5);
            statement.execute(sql);
        }
    }

    private static String text(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next());
            return rows.getString(1);
        }
    }

    private static boolean exists(Connection connection, String sql, String name) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            statement.setString(1, name);
            try (var rows = statement.executeQuery()) { return rows.next(); }
        }
    }

    private static OperationContext context() {
        return new OperationContext(InvocationId.generate(), Context.current(), Instant.now().plusSeconds(5));
    }

    private static final class PostgresOnlyCache implements OwnedInventoryCache {
        @Override public Optional<Value> get(String sku, OperationContext context) { return Optional.empty(); }
        @Override public void put(String sku, Value value, OperationContext context) {}
        @Override public void invalidate(String sku, OperationContext context) {}
        @Override public boolean isReady() { return true; }
        @Override public void close() {}
    }
}
