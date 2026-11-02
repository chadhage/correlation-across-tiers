package com.contoso.inventory.data;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.DataValidation;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Explicit operator lifecycle, never an application-startup hook. The caller must
 * retain the handle through failures and hold a drained, exclusive external lease
 * until reset is verified. This object borrows both stores and installs no grants.
 */
public final class InventoryFixtureRun {
    public enum State { CAPTURED, PREPARED, PREPARE_FAILED, RESTORE_FAILED, RESTORED }

    public record Lease(String runId, String orderId, String sku, List<String> unownedCacheWitnessSkus) {
        public Lease {
            DataValidation.id(runId);
            DataValidation.id(orderId);
            if (!InventorySchemaHooks.SYNTHETIC_SKUS.contains(sku) || unownedCacheWitnessSkus == null ||
                unownedCacheWitnessSkus.size() > 16) throw new IllegalArgumentException("invalid_fixture_lease");
            unownedCacheWitnessSkus = List.copyOf(unownedCacheWitnessSkus);
            if (unownedCacheWitnessSkus.stream().distinct().count() != unownedCacheWitnessSkus.size() ||
                unownedCacheWitnessSkus.contains(sku)) throw new IllegalArgumentException("invalid_fixture_witnesses");
            unownedCacheWitnessSkus.forEach(DataValidation::sku);
        }
        @Override public String toString() { return "InventoryFixtureLease[redacted]"; }
    }

    public record Hashes(String ownedRowsSha256, String unownedRowsSha256,
                         String cacheContentSha256, String unownedCacheContentSha256) {}

    public record ResetReceipt(String runId, Hashes expected, Hashes observed) {}

    private record Item(String name, int available, long revision, boolean synthetic) {
        @Override public String toString() { return "InventoryFixtureItem[redacted]"; }
    }

    private record OwnedReservation(UUID id, UUID order, int quantity, String state, UUID invocation) {
        @Override public String toString() { return "InventoryFixtureReservation[redacted]"; }
    }

    private record SqlBaseline(Item item, String unownedHash) {}

    private record RestoreCheckpoint(Item item, List<OwnedReservation> reservations,
                                     RestorableInventoryCache.Baseline cache, UUID invocation) {
        private RestoreCheckpoint {
            reservations = List.copyOf(reservations);
        }
        @Override public String toString() { return "InventoryRestoreCheckpoint[redacted]"; }
    }

    private static final OwnedInventoryCache.Value SEED = new OwnedInventoryCache.Value(20, 1);
    private static final Duration TTL_CAPTURE_TOLERANCE = Duration.ofSeconds(1);
    private final PgConnectionFactory operator;
    private final RestorableInventoryCache cache;
    private final InventorySchemaHooks.Permit permit;
    private final Lease lease;
    private final SqlBaseline sql;
    private final RestorableInventoryCache.Baseline cacheBaseline;
    private final Map<String, RestorableInventoryCache.Baseline> witnesses;
    private final Clock clock;
    private final Hashes capturedHashes;
    private State state = State.CAPTURED;
    private RestoreCheckpoint restoreCheckpoint;

    private InventoryFixtureRun(PgConnectionFactory operator, RestorableInventoryCache cache,
                                InventorySchemaHooks.Permit permit, Lease lease, SqlBaseline sql,
                                RestorableInventoryCache.Baseline cacheBaseline,
                                Map<String, RestorableInventoryCache.Baseline> witnesses, Clock clock) {
        this.operator = operator;
        this.cache = cache;
        this.permit = permit;
        this.lease = lease;
        this.sql = sql;
        this.cacheBaseline = cacheBaseline;
        this.witnesses = witnesses;
        this.clock = clock;
        this.capturedHashes = expectedHashes(clock.instant());
    }

    public static InventoryFixtureRun capture(PgConnectionFactory operator, RestorableInventoryCache cache,
                                             InventorySchemaHooks.Permit permit, Lease lease,
                                             OperationContext context) {
        return capture(operator, cache, permit, lease, context, Clock.systemUTC());
    }

    static InventoryFixtureRun capture(PgConnectionFactory operator, RestorableInventoryCache cache,
                                      InventorySchemaHooks.Permit permit, Lease lease,
                                      OperationContext context, Clock clock) {
        Objects.requireNonNull(operator);
        Objects.requireNonNull(cache);
        Objects.requireNonNull(lease);
        Objects.requireNonNull(clock);
        InventorySchemaHooks.authorized(permit);
        InventorySchemaHooks.verifyEndpoint(operator, permit);
        SqlBaseline sql = PgOperations.execute(operator, PgOperation.TRANSACTION, context, 1, connection -> {
            guard(connection, permit);
            Item item = item(connection, lease.sku());
            if (!item.synthetic()) throw failure(DataErrorKind.AUTHORIZATION);
            try (var query = connection.prepareStatement(
                    "SELECT reservation_id FROM contoso.inventory_reservation WHERE sku=? OR order_id=?")) {
                query.setString(1, lease.sku());
                query.setObject(2, UUID.fromString(lease.orderId()));
                try (var rows = query.executeQuery()) {
                    if (rows.next()) throw failure(DataErrorKind.CONFLICT);
                }
            }
            SqlBaseline baseline = new SqlBaseline(item, unownedHash(connection, lease));
            connection.commit();
            return baseline;
        });
        var owned = cache.capture(lease.sku(), context);
        var witnesses = new LinkedHashMap<String, RestorableInventoryCache.Baseline>();
        for (String sku : lease.unownedCacheWitnessSkus()) witnesses.put(sku, cache.capture(sku, context));
        return new InventoryFixtureRun(operator, cache, permit, lease, sql, owned, witnesses, clock);
    }

    public synchronized State state() { return state; }

    public synchronized Hashes capturedHashes() {
        return capturedHashes;
    }

    public synchronized void prepare(OperationContext context) {
        if (state != State.CAPTURED) throw failure(DataErrorKind.CONFLICT);
        try {
            verifyCache(cacheBaseline, cache.capture(lease.sku(), context), clock.instant());
            verifyWitnesses(context);
            InventorySchemaHooks.authorized(permit);
            InventorySchemaHooks.verifyEndpoint(operator, permit);
            PgOperations.execute(operator, PgOperation.TRANSACTION, context, 1, connection -> {
                guard(connection, permit);
                if (!sql.item().equals(item(connection, lease.sku())) ||
                    !reservations(connection, context, false).isEmpty() ||
                    !sql.unownedHash().equals(unownedHash(connection, lease))) throw failure(DataErrorKind.CONFLICT);
                update(connection, SEED.available(), SEED.revision());
                connection.commit();
                return null;
            });
            cache.invalidate(lease.sku(), context);
            if (cache.get(lease.sku(), context).isPresent()) throw failure(DataErrorKind.CONFLICT);
            state = State.PREPARED;
        } catch (RuntimeException failure) {
            state = State.PREPARE_FAILED;
            throw safe(failure);
        }
    }

    /**
     * The reset context must contain the independently observed measured request's
     * business invocation ID before it can delete that run's exact reservation.
     * No reservation is owned merely because it is marked synthetic.
     */
    public synchronized ResetReceipt reset(OperationContext context) {
        try {
            verifyWitnesses(context);
            var currentCache = cache.capture(lease.sku(), context);
            PgOperations.execute(operator, PgOperation.TRANSACTION, context, 1, connection -> {
                InventorySchemaHooks.authorized(permit);
                InventorySchemaHooks.verifyEndpoint(operator, permit);
                guard(connection, permit);
                Item current = item(connection, lease.sku());
                List<OwnedReservation> owned = reservations(connection, context, true);
                if (!sql.unownedHash().equals(unownedHash(connection, lease))) throw failure(DataErrorKind.CONFLICT);
                verifyRestorable(current, owned);
                retainRestoreCheckpoint(current, owned, currentCache, context);
                for (OwnedReservation row : owned) {
                    try (var delete = connection.prepareStatement(
                            "DELETE FROM contoso.inventory_reservation WHERE reservation_id=? AND order_id=? AND sku=? AND invocation_id=? AND synthetic=TRUE")) {
                        delete.setObject(1, row.id());
                        delete.setObject(2, row.order());
                        delete.setString(3, lease.sku());
                        delete.setObject(4, row.invocation());
                        if (delete.executeUpdate() != 1) throw failure(DataErrorKind.CONFLICT);
                    }
                }
                if (!current.equals(sql.item())) update(connection, sql.item().available(), sql.item().revision());
                connection.commit();
                return null;
            });
            if (!matches(cacheBaseline, currentCache, clock.instant())) cache.restore(lease.sku(), cacheBaseline, context);
            var restoredCache = cache.capture(lease.sku(), context);
            verifyCache(cacheBaseline, restoredCache, clock.instant());
            var restoredWitnesses = verifyWitnesses(context);
            String restoredRows = PgOperations.execute(operator, PgOperation.TRANSACTION, context, 1, connection -> {
                guard(connection, permit);
                Item restored = item(connection, lease.sku());
                if (!restored.equals(sql.item()) || !reservations(connection, context, true).isEmpty()) {
                    throw failure(DataErrorKind.CONFLICT);
                }
                String unowned = unownedHash(connection, lease);
                if (!sql.unownedHash().equals(unowned)) throw failure(DataErrorKind.CONFLICT);
                connection.commit();
                return unowned;
            });
            Instant now = clock.instant();
            Hashes expected = expectedHashes(now);
            Hashes observed = new Hashes(itemHash(sql.item()), restoredRows,
                cacheHash(List.of(restoredCache), now), cacheHash(restoredWitnesses, now));
            if (!expected.equals(observed)) throw failure(DataErrorKind.CONFLICT);
            state = State.RESTORED;
            restoreCheckpoint = null;
            return new ResetReceipt(lease.runId(), expected, observed);
        } catch (RuntimeException failure) {
            state = State.RESTORE_FAILED;
            throw safe(failure);
        }
    }

    private void retainRestoreCheckpoint(Item current, List<OwnedReservation> owned,
                                         RestorableInventoryCache.Baseline currentCache, OperationContext context) {
        Instant now = clock.instant();
        if (restoreCheckpoint != null) {
            if (!restoreCheckpoint.invocation().equals(context.invocationId().uuid())) throw failure(DataErrorKind.AUTHORIZATION);
            boolean beforeSqlRestore = restoreCheckpoint.item().equals(current) &&
                restoreCheckpoint.reservations().equals(owned);
            boolean afterSqlRestore = sql.item().equals(current) && owned.isEmpty();
            if ((!beforeSqlRestore && !afterSqlRestore) ||
                !matches(cacheBaseline, currentCache, now) && !matches(restoreCheckpoint.cache(), currentCache, now)) {
                throw failure(DataErrorKind.CONFLICT);
            }
            return;
        }
        var allowed = List.of(SEED, new OwnedInventoryCache.Value(current.available(), current.revision()));
        if (!matches(cacheBaseline, currentCache, now) && currentCache.valueAt(now).isPresent() &&
            !allowed.contains(currentCache.valueAt(now).orElseThrow())) {
            throw failure(DataErrorKind.CONFLICT);
        }
        // Retain validated state before mutation: commit/ACK may fail after applying.
        restoreCheckpoint = new RestoreCheckpoint(current, owned, currentCache, context.invocationId().uuid());
    }

    private Hashes expectedHashes(Instant now) {
        return new Hashes(itemHash(sql.item()), sql.unownedHash(), cacheHash(List.of(cacheBaseline), now),
            cacheHash(List.copyOf(witnesses.values()), now));
    }

    private List<RestorableInventoryCache.Baseline> verifyWitnesses(OperationContext context) {
        var result = new ArrayList<RestorableInventoryCache.Baseline>();
        for (var entry : witnesses.entrySet()) {
            var actual = cache.capture(entry.getKey(), context);
            verifyCache(entry.getValue(), actual, clock.instant());
            result.add(actual);
        }
        return result;
    }

    private void verifyRestorable(Item current, List<OwnedReservation> owned) {
        if (!current.synthetic() || !sql.item().name().equals(current.name())) throw failure(DataErrorKind.AUTHORIZATION);
        if (owned.isEmpty() && current.equals(sql.item())) return;
        int available = SEED.available();
        long revision = SEED.revision();
        for (OwnedReservation row : owned) {
            if (row.quantity() > available) throw failure(DataErrorKind.CONFLICT);
            if (row.state().equals("RESERVED")) { available -= row.quantity(); revision++; }
            else if (row.state().equals("RELEASED")) revision += 2;
            else throw failure(DataErrorKind.CONFLICT);
        }
        if (current.available() != available || current.revision() != revision) throw failure(DataErrorKind.CONFLICT);
    }

    private List<OwnedReservation> reservations(Connection connection, OperationContext context, boolean restoring)
            throws SQLException {
        var result = new ArrayList<OwnedReservation>();
        try (var query = connection.prepareStatement(
                "SELECT reservation_id,order_id,quantity,state,invocation_id,synthetic FROM contoso.inventory_reservation WHERE sku=? FOR UPDATE")) {
            query.setString(1, lease.sku());
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    if (!restoring || !rows.getBoolean(6) ||
                        !UUID.fromString(lease.orderId()).equals(rows.getObject(2, UUID.class)) ||
                        !context.invocationId().uuid().equals(rows.getObject(5, UUID.class))) {
                        throw failure(DataErrorKind.AUTHORIZATION);
                    }
                    result.add(new OwnedReservation(rows.getObject(1, UUID.class), rows.getObject(2, UUID.class),
                        rows.getInt(3), rows.getString(4), rows.getObject(5, UUID.class)));
                }
            }
        }
        return result;
    }

    private void update(Connection connection, int available, long revision) throws SQLException {
        try (var update = connection.prepareStatement(
                "UPDATE contoso.inventory_item SET available=?,revision=? WHERE sku=? AND synthetic=TRUE")) {
            update.setInt(1, available);
            update.setLong(2, revision);
            update.setString(3, lease.sku());
            if (update.executeUpdate() != 1) throw failure(DataErrorKind.CONFLICT);
        }
    }

    private static void guard(Connection connection, InventorySchemaHooks.Permit permit) throws SQLException {
        InventorySchemaHooks.verifyDatabase(connection, permit.expectedDatabase());
        connection.setAutoCommit(false);
        InventorySchemaHooks.verifyBoundDataset(connection, permit);
    }

    private static Item item(Connection connection, String sku) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT display_name,available,revision,synthetic FROM contoso.inventory_item WHERE sku=? FOR UPDATE")) {
            query.setString(1, sku);
            try (var rows = query.executeQuery()) {
                if (!rows.next()) throw failure(DataErrorKind.NOT_FOUND);
                return new Item(rows.getString(1), rows.getInt(2), rows.getLong(3), rows.getBoolean(4));
            }
        }
    }

    private static String unownedHash(Connection connection, Lease lease) throws SQLException {
        var fields = new ArrayList<String>();
        try (var query = connection.prepareStatement(
                "SELECT sku,display_name,available,revision,synthetic FROM contoso.inventory_item WHERE sku<>? ORDER BY sku")) {
            query.setString(1, lease.sku());
            query.setMaxRows(4_097);
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    if (fields.size() >= 4_096 * 6) throw failure(DataErrorKind.RESOURCE_EXHAUSTED);
                    fields.add("item");
                    for (int i = 1; i <= 5; i++) fields.add(rows.getString(i));
                }
            }
        }
        try (var query = connection.prepareStatement(
                "SELECT reservation_id,order_id,sku,quantity,state,invocation_id,synthetic,created_at FROM contoso.inventory_reservation WHERE NOT(sku=? AND order_id=?) ORDER BY reservation_id")) {
            query.setString(1, lease.sku());
            query.setObject(2, UUID.fromString(lease.orderId()));
            query.setMaxRows(4_097);
            try (var rows = query.executeQuery()) {
                int count = 0;
                while (rows.next()) {
                    if (++count > 4_096) throw failure(DataErrorKind.RESOURCE_EXHAUSTED);
                    fields.add("reservation");
                    for (int i = 1; i <= 8; i++) fields.add(rows.getString(i));
                }
            }
        }
        return hash(fields);
    }

    private static void verifyCache(RestorableInventoryCache.Baseline expected,
                                    RestorableInventoryCache.Baseline actual, Instant now) {
        if (!matches(expected, actual, now)) throw failure(DataErrorKind.CONFLICT);
    }

    private static boolean matches(RestorableInventoryCache.Baseline expected,
                                   RestorableInventoryCache.Baseline actual, Instant now) {
        if (!expected.valueAt(now).equals(actual.valueAt(now))) return false;
        if (expected.valueAt(now).isEmpty()) return true;
        if (expected.expiresAt() == null || actual.expiresAt() == null) {
            return expected.expiresAt() == actual.expiresAt();
        }
        return Duration.between(expected.expiresAt(), actual.expiresAt()).abs().compareTo(TTL_CAPTURE_TOLERANCE) <= 0;
    }

    private static String cacheHash(List<RestorableInventoryCache.Baseline> baselines, Instant now) {
        var fields = new ArrayList<String>();
        for (var baseline : baselines) {
            var value = baseline.valueAt(now);
            fields.add(value.isEmpty() ? "absent" : baseline.expiresAt() == null ? "persistent" : "expiring");
            value.ifPresent(item -> {
                fields.add(Integer.toString(item.available()));
                fields.add(Long.toString(item.revision()));
            });
        }
        return hash(fields);
    }

    private static String itemHash(Item item) {
        return hash(List.of(item.name(), Integer.toString(item.available()), Long.toString(item.revision()),
            Boolean.toString(item.synthetic())));
    }

    private static String hash(List<String> fields) {
        try {
            var bytes = new ByteArrayOutputStream();
            try (var output = new DataOutputStream(bytes)) {
                for (String field : fields) {
                    byte[] encoded = field.getBytes(StandardCharsets.UTF_8);
                    output.writeInt(encoded.length);
                    output.write(encoded);
                }
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException impossible) {
            throw failure(DataErrorKind.INTERNAL);
        }
    }

    private static DataAccessException safe(RuntimeException failure) {
        return failure instanceof DataAccessException safe ? safe : failure(DataErrorKind.INTERNAL);
    }

    private static DataAccessException failure(DataErrorKind kind) { return new DataAccessException(kind, false); }

    @Override public String toString() { return "InventoryFixtureRun[redacted]"; }
}
