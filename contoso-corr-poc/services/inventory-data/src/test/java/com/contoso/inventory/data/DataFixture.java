package com.contoso.inventory.data;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import io.opentelemetry.context.Context;
import java.sql.Connection;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.h2.jdbcx.JdbcDataSource;

final class DataFixture implements AutoCloseable {
    static final String RESOURCE = "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-poc/providers/Microsoft.DBforPostgreSQL/flexibleServers/contoso-corr-poc-pg";
    final JdbcDataSource source = new JdbcDataSource();
    final Connection anchor;
    final FakeCache cache = new FakeCache();
    final PgConnectionFactory connections;
    final PgRedisInventoryDataAdapter adapter;

    DataFixture() throws Exception {
        source.setURL("jdbc:h2:mem:contoso_orders;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=0");
        source.setUser("sa");
        anchor = source.getConnection();
        InventorySchemaHooks.applyV001(anchor);
        try (var statement = anchor.prepareStatement(
            "UPDATE contoso.environment_marker SET expected_resource_id=? WHERE singleton=TRUE")) {
            statement.setString(1, RESOURCE);
            statement.executeUpdate();
        }
        connections = new PgConnectionFactory() {
            public Connection open() throws java.sql.SQLException { return SanitizedJdbc.wrap(source.getConnection()); }
            public Map<String, String> telemetryAttributes() {
                return Map.of("db.system", "postgresql", "db.name", "contoso_orders",
                    "server.address", "contoso-corr-poc-pg.postgres.database.azure.com", "server.port", "5432");
            }
        };
        adapter = new PgRedisInventoryDataAdapter(connections, cache);
    }

    static OperationContext context() {
        return new OperationContext(InvocationId.generate(), Context.current(), Instant.now().plusSeconds(5));
    }

    int stock(String sku) throws Exception {
        try (var query = anchor.prepareStatement("SELECT available FROM contoso.inventory_item WHERE sku=?")) {
            query.setString(1, sku);
            try (var rows = query.executeQuery()) { rows.next(); return rows.getInt(1); }
        }
    }

    public void close() throws Exception { adapter.close(); anchor.close(); }

    static final class FakeCache implements OwnedInventoryCache {
        final Map<String, Value> values = new java.util.concurrent.ConcurrentHashMap<>();
        int gets, puts, invalidations;
        boolean fail;
        boolean closed;
        public Optional<Value> get(String sku, OperationContext context) { gets++; check(); return Optional.ofNullable(values.get(sku)); }
        public void put(String sku, Value value, OperationContext context) { puts++; check(); values.put(sku, value); }
        public void invalidate(String sku, OperationContext context) { invalidations++; check(); values.remove(sku); }
        public boolean isReady() { return !closed && !fail; }
        public void close() { closed = true; }
        private void check() {
            if (fail || closed) throw new com.contoso.correlation.data.DataAccessException(
                com.contoso.correlation.data.DataErrorKind.UNAVAILABLE, false);
        }
    }
}
