package com.contoso.inventory.data;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.DataValidation;
import com.contoso.correlation.data.InventoryDataAdapter;
import com.contoso.correlation.data.InventoryItem;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import com.contoso.correlation.data.Reservation;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

public final class PgRedisInventoryDataAdapter implements InventoryDataAdapter {
    private final PgConnectionFactory connections;
    private final OwnedInventoryCache cache;
    private final String expectedResourceId;
    private final AtomicBoolean closed = new AtomicBoolean();

    public static InventoryDataAdapter fromEnvironment() {
        DataInstrumentationGuard.verify();
        DataLoggingGuard.verify();
        PgConnectionFactory connections = EntraPgConnectionFactory.fromEnvironment("contoso-inventory-api");
        try { return new PgRedisInventoryDataAdapter(connections, LettuceInventoryCache.fromEnvironment(),
            System.getenv("CONTOSO_PG_RESOURCE_ID")); }
        catch (RuntimeException failure) { connections.close(); throw failure; }
    }

    public PgRedisInventoryDataAdapter(PgConnectionFactory connections, OwnedInventoryCache cache) {
        this(connections, cache, null);
    }

    public PgRedisInventoryDataAdapter(PgConnectionFactory connections, OwnedInventoryCache cache, String expectedResourceId) {
        this.connections = java.util.Objects.requireNonNull(connections);
        this.cache = java.util.Objects.requireNonNull(cache);
        this.expectedResourceId = expectedResourceId;
    }

    @Override public InventoryItem lookupInventory(String sku, OperationContext context) {
        ensureOpen();
        DataValidation.sku(sku);
        String outcome = "MISS";
        try {
            var value = cache.get(sku, context);
            if (value.isPresent()) {
                return new InventoryItem(sku, value.get().available(), value.get().revision(), "HIT");
            }
        } catch (DataAccessException failure) { outcome = "ERROR"; }
        InventoryItem item = PgOperations.execute(connections, PgOperation.SELECT, context, 1,
            connection -> load(connection, sku, false));
        try { cache.put(sku, new OwnedInventoryCache.Value(item.available(), item.revision()), context); }
        catch (DataAccessException failure) { outcome = "ERROR"; }
        return new InventoryItem(item.sku(), item.available(), item.revision(), outcome);
    }

    @Override public Reservation reserveInventory(String orderId, String sku, int quantity, OperationContext context) {
        ensureOpen();
        DataValidation.id(orderId);
        DataValidation.sku(sku);
        if (quantity < 1 || quantity > 10_000) throw new DataAccessException(DataErrorKind.INVALID_REQUEST, false);
        Reservation result = PgOperations.execute(connections, PgOperation.TRANSACTION, context, 1, connection -> {
            connection.setAutoCommit(false);
            lockDataset(connection);
            InventoryItem item = load(connection, sku, true);
            Reservation existing = existingOrder(connection, orderId, sku);
            if (existing != null) {
                if (existing.quantity() != quantity || !existing.state().equals("RESERVED")) {
                    throw new DataAccessException(DataErrorKind.CONFLICT, false);
                }
                connection.commit();
                return existing;
            }
            if (item.available() < quantity) throw new DataAccessException(DataErrorKind.INSUFFICIENT_STOCK, false);
            Reservation reservation = new Reservation(UUID.randomUUID().toString(), orderId, sku, quantity, "RESERVED");
            try (var insert = connection.prepareStatement(
                    "INSERT INTO contoso.inventory_reservation(reservation_id,order_id,sku,quantity,state,invocation_id) VALUES(?,?,?,?,?,?)")) {
                insert.setObject(1, UUID.fromString(reservation.reservationId()));
                insert.setObject(2, UUID.fromString(orderId));
                insert.setString(3, sku);
                insert.setInt(4, quantity);
                insert.setString(5, "RESERVED");
                insert.setObject(6, context.invocationId().uuid());
                insert.executeUpdate();
            }
            try (var update = connection.prepareStatement(
                    "UPDATE contoso.inventory_item SET available=available-?,revision=revision+1 WHERE sku=? AND available>=?")) {
                update.setInt(1, quantity);
                update.setString(2, sku);
                update.setInt(3, quantity);
                if (update.executeUpdate() != 1) throw new DataAccessException(DataErrorKind.CONFLICT, false);
            }
            connection.commit();
            return reservation;
        });
        invalidateAfterCommit(sku, context);
        return result;
    }

    @Override public Reservation releaseInventory(String orderId, String reservationId, OperationContext context) {
        ensureOpen();
        DataValidation.id(orderId);
        DataValidation.id(reservationId);
        Reservation result = PgOperations.execute(connections, PgOperation.TRANSACTION, context, 1, connection -> {
            connection.setAutoCommit(false);
            lockDataset(connection);
            Reservation candidate = existingId(connection, orderId, reservationId, false);
            if (candidate == null) throw new DataAccessException(DataErrorKind.NOT_FOUND, false);
            load(connection, candidate.sku(), true);
            Reservation locked = existingId(connection, orderId, reservationId, true);
            if (locked.state().equals("RELEASED")) { connection.commit(); return locked; }
            try (var update = connection.prepareStatement(
                    "UPDATE contoso.inventory_item SET available=available+?,revision=revision+1 WHERE sku=?")) {
                update.setInt(1, locked.quantity());
                update.setString(2, locked.sku());
                update.executeUpdate();
            }
            try (var update = connection.prepareStatement(
                    "UPDATE contoso.inventory_reservation SET state=? WHERE reservation_id=? AND order_id=?")) {
                update.setString(1, "RELEASED");
                update.setObject(2, UUID.fromString(reservationId));
                update.setObject(3, UUID.fromString(orderId));
                update.executeUpdate();
            }
            connection.commit();
            return new Reservation(locked.reservationId(), orderId, locked.sku(), locked.quantity(), "RELEASED");
        });
        invalidateAfterCommit(result.sku(), context);
        return result;
    }

    private void invalidateAfterCommit(String sku, OperationContext context) {
        try { cache.invalidate(sku, context); } catch (DataAccessException ignored) {}
    }

    private static InventoryItem load(Connection connection, String sku, boolean lock) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT available,revision FROM contoso.inventory_item WHERE sku=?" + (lock ? " FOR UPDATE" : ""))) {
            query.setString(1, sku);
            try (var rows = query.executeQuery()) {
                if (!rows.next()) throw new DataAccessException(DataErrorKind.NOT_FOUND, false);
                return new InventoryItem(sku, rows.getInt(1), rows.getLong(2), "BYPASS");
            }
        }
    }

    private static Reservation existingOrder(Connection connection, String orderId, String sku) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT reservation_id,order_id,sku,quantity,state FROM contoso.inventory_reservation WHERE order_id=? AND sku=? FOR UPDATE")) {
            query.setObject(1, UUID.fromString(orderId));
            query.setString(2, sku);
            try (var rows = query.executeQuery()) { return rows.next() ? reservation(rows) : null; }
        }
    }

    private static Reservation existingId(Connection connection, String orderId, String id, boolean lock) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT reservation_id,order_id,sku,quantity,state FROM contoso.inventory_reservation WHERE reservation_id=? AND order_id=?" +
                (lock ? " FOR UPDATE" : ""))) {
            query.setObject(1, UUID.fromString(id));
            query.setObject(2, UUID.fromString(orderId));
            try (var rows = query.executeQuery()) { return rows.next() ? reservation(rows) : null; }
        }
    }

    private static Reservation reservation(java.sql.ResultSet rows) throws SQLException {
        return new Reservation(rows.getObject(1, UUID.class).toString(), rows.getObject(2, UUID.class).toString(),
            rows.getString(3), rows.getInt(4), rows.getString(5));
    }

    private void lockDataset(Connection connection) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT seed_version,expected_resource_id FROM contoso.environment_marker WHERE singleton=TRUE FOR UPDATE");
             var rows = query.executeQuery()) {
            if (!rows.next() || rows.getInt(1) != 1 || rows.getString(2) == null ||
                expectedResourceId != null && !expectedResourceId.equals(rows.getString(2))) {
                throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
            }
        }
    }

    @Override public boolean isReady() {
        if (closed.get()) return false;
        try (var connection = connections.open();
             var query = connection.prepareStatement(
                "SELECT seed_version,expected_resource_id FROM contoso.environment_marker WHERE singleton=TRUE");
             var rows = query.executeQuery()) {
            return rows.next() && rows.getInt(1) == 1 && rows.getString(2) != null &&
                (expectedResourceId == null || expectedResourceId.equals(rows.getString(2))) && cache.isReady();
        } catch (SQLException | RuntimeException failure) { return false; }
    }

    @Override public void close() {
        if (closed.compareAndSet(false, true)) {
            try { cache.close(); } finally { connections.close(); }
        }
    }

    private void ensureOpen() {
        if (closed.get()) throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
    }
}
