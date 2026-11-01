package com.contoso.inventory.data;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.DataValidation;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;

public final class InventorySchemaHooks {
    public static final String MIGRATION = "db/migration/V001__inventory.sql";
    public static final List<String> SYNTHETIC_SKUS = List.of(
        "CONTOSO-001", "CONTOSO-002", "CONTOSO-003", "CONTOSO-004", "CONTOSO-005");
    private InventorySchemaHooks() {}

    public record Permit(String expectedResourceId, String expectedDatabase, boolean executionApproved) {
        public Permit {
            if (expectedResourceId == null || !expectedResourceId.toLowerCase(Locale.ROOT).matches(
                "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourcegroups/[a-z0-9_.-]*contoso[a-z0-9_.-]*/providers/microsoft.dbforpostgresql/flexibleservers/contoso-[a-z0-9-]+") ||
                !"contoso_orders".equals(expectedDatabase)) {
                throw new IllegalArgumentException("invalid_inventory_target");
            }
        }
        @Override public String toString() { return "InventoryBootstrapPermit[redacted]"; }
    }

    public record Principal(String roleName, String objectId) {
        public Principal {
            if (roleName == null || !roleName.matches("[A-Za-z][A-Za-z0-9_-]{0,62}")) {
                throw new IllegalArgumentException("invalid_database_role");
            }
            if (objectId == null) throw new IllegalArgumentException("invalid_database_principal");
            DataValidation.id(objectId.toLowerCase(Locale.ROOT));
        }
        @Override public String toString() { return "DatabasePrincipal[redacted]"; }
    }

    public static void install(PgConnectionFactory administrator, Permit permit, OperationContext context) {
        authorized(permit);
        verifyEndpoint(administrator, permit);
        PgOperations.execute(administrator, PgOperation.TRANSACTION, context, 1, connection -> {
            verifyDatabase(connection, permit.expectedDatabase());
            connection.setAutoCommit(false);
            applyV001(connection);
            try (var bind = connection.prepareStatement(
                "UPDATE contoso.environment_marker SET expected_resource_id=? WHERE singleton=TRUE AND (expected_resource_id IS NULL OR expected_resource_id=?)")) {
                bind.setString(1, permit.expectedResourceId());
                bind.setString(2, permit.expectedResourceId());
                if (bind.executeUpdate() != 1) throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
            }
            connection.commit();
            return null;
        });
    }

    public static void resetOwnedRows(PgConnectionFactory administrator, OwnedInventoryCache cache,
                                     Permit permit, OperationContext context) {
        authorized(permit);
        verifyEndpoint(administrator, permit);
        PgOperations.execute(administrator, PgOperation.TRANSACTION, context, 1, connection -> {
            verifyDatabase(connection, permit.expectedDatabase());
            connection.setAutoCommit(false);
            try (var guard = connection.prepareStatement(
                "SELECT expected_resource_id,workload,environment,seed_version FROM contoso.environment_marker WHERE singleton=TRUE FOR UPDATE");
                 var rows = guard.executeQuery()) {
                if (!rows.next() || !permit.expectedResourceId().equals(rows.getString(1)) ||
                    !"contoso-corr".equals(rows.getString(2)) || !"poc".equals(rows.getString(3)) || rows.getInt(4) != 1) {
                    throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
                }
            }
            for (String sku : SYNTHETIC_SKUS) {
                try (var ownership = connection.prepareStatement(
                    "SELECT synthetic FROM contoso.inventory_item WHERE sku=? FOR UPDATE")) {
                    ownership.setString(1, sku);
                    try (var rows = ownership.executeQuery()) {
                        if (!rows.next() || !rows.getBoolean(1)) {
                            throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
                        }
                    }
                }
                try (var unrelated = connection.prepareStatement(
                    "SELECT reservation_id FROM contoso.inventory_reservation WHERE sku=? AND synthetic=FALSE")) {
                    unrelated.setString(1, sku);
                    try (var rows = unrelated.executeQuery()) {
                        if (rows.next()) throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
                    }
                }
                try (var delete = connection.prepareStatement(
                    "DELETE FROM contoso.inventory_reservation WHERE sku=? AND synthetic=TRUE")) {
                    delete.setString(1, sku);
                    delete.executeUpdate();
                }
                try (var reset = connection.prepareStatement(
                    "UPDATE contoso.inventory_item SET available=20,revision=1 WHERE sku=? AND synthetic=TRUE")) {
                    reset.setString(1, sku);
                    reset.executeUpdate();
                }
            }
            connection.commit();
            return null;
        });
        for (String sku : SYNTHETIC_SKUS) cache.invalidate(sku, context);
    }

    public static void registerPrincipal(PgConnectionFactory postgresAdministrator,
                                         Permit permit, Principal principal, OperationContext context) {
        authorized(permit);
        verifyEndpoint(postgresAdministrator, permit);
        PgOperations.execute(postgresAdministrator, PgOperation.TRANSACTION, context, 1, connection -> {
            verifyDatabase(connection, "postgres");
            connection.setAutoCommit(false);
            try (var query = connection.prepareStatement(
                    "SELECT objectid FROM pg_catalog.pgaadauth_list_principals(FALSE) WHERE rolename=?")) {
                query.setString(1, principal.roleName());
                try (var rows = query.executeQuery()) {
                    if (rows.next()) {
                        if (!principal.objectId().equalsIgnoreCase(rows.getString(1))) {
                            throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
                        }
                        connection.commit();
                        return null;
                    }
                }
            }
            try (var create = connection.prepareStatement(
                    "SELECT * FROM pg_catalog.pgaadauth_create_principal_with_oid(?,?,?,FALSE,FALSE)")) {
                create.setString(1, principal.roleName());
                create.setString(2, principal.objectId());
                create.setString(3, "service");
                create.execute();
            }
            connection.commit();
            return null;
        });
    }

    public static void grantInventory(PgConnectionFactory administrator, Permit permit,
                                      Principal principal, OperationContext context) {
        authorized(permit);
        verifyEndpoint(administrator, permit);
        PgOperations.execute(administrator, PgOperation.TRANSACTION, context, 1, connection -> {
            verifyDatabase(connection, permit.expectedDatabase());
            connection.setAutoCommit(false);
            String role = "\"" + principal.roleName() + "\"";
            try (var statement = connection.createStatement()) {
                statement.execute("GRANT CONNECT ON DATABASE contoso_orders TO " + role);
                statement.execute("GRANT USAGE ON SCHEMA contoso TO " + role);
                statement.execute("GRANT SELECT,UPDATE ON contoso.inventory_item TO " + role);
                statement.execute("GRANT SELECT,INSERT,UPDATE ON contoso.inventory_reservation TO " + role);
                statement.execute("GRANT SELECT ON contoso.environment_marker TO " + role);
            }
            connection.commit();
            return null;
        });
    }

    static void applyV001(Connection connection) throws SQLException {
        try (var source = InventorySchemaHooks.class.getClassLoader().getResourceAsStream(MIGRATION)) {
            if (source == null) throw new SQLException("inventory_migration_missing");
            String sql = new String(source.readAllBytes(), StandardCharsets.UTF_8);
            for (String command : sql.split(";")) {
                if (!command.isBlank()) {
                    try (var statement = connection.createStatement()) { statement.execute(command); }
                }
            }
        } catch (IOException failure) { throw new SQLException("inventory_migration_unreadable"); }
    }

    private static void verifyDatabase(Connection connection, String expected) throws SQLException {
        try (var query = connection.prepareStatement("SELECT current_database()");
             var rows = query.executeQuery()) {
            if (!rows.next() || !expected.equals(rows.getString(1))) {
                throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
            }
        }
    }

    private static void authorized(Permit permit) {
        if (permit == null || !permit.executionApproved()) {
            throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
        }
    }

    private static void verifyEndpoint(PgConnectionFactory factory, Permit permit) {
        String name = permit.expectedResourceId().substring(permit.expectedResourceId().lastIndexOf('/') + 1);
        String host = factory.telemetryAttributes().get("server.address");
        if (host == null || !host.equalsIgnoreCase(name + ".postgres.database.azure.com")) {
            throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
        }
    }
}
