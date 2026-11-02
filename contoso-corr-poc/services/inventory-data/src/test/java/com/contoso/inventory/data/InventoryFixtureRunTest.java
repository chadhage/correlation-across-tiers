package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

class InventoryFixtureRunTest {
    static final String SKU = "CONTOSO-001";
    static final String WITNESS = "CONTOSO-002";

    @Test void actualLettuceColdPathSelectsAndPopulatesWhileHitSkipsSql() throws Exception {
        try (var fixture = new DataFixture(); var server = new RespFixture(); var cache = RedisDataTest.cache(server)) {
            var events = new CopyOnWriteArrayList<String>();
            server.record = operation -> { if (List.of("GET", "SETEX", "SET", "DEL").contains(operation)) events.add(operation); };
            var connections = recording(fixture.connections, events, new AtomicBoolean());
            var lease = lease();
            var run = InventoryFixtureRun.capture(connections, cache, permit(), lease, DataFixture.context());
            run.prepare(DataFixture.context());
            events.clear();
            var adapter = new PgRedisInventoryDataAdapter(connections, cache, DataFixture.RESOURCE);
            assertEquals("MISS", adapter.lookupInventory(SKU, DataFixture.context()).cacheOutcome());
            assertEquals(List.of("GET", "SELECT", "SETEX"), events);
            events.clear();
            assertEquals("HIT", adapter.lookupInventory(SKU, DataFixture.context()).cacheOutcome());
            assertEquals(List.of("GET"), events);
            var receipt = run.reset(DataFixture.context());
            assertEquals(receipt.expected(), receipt.observed());
            assertEquals(InventoryFixtureRun.State.RESTORED, run.state());
            assertFalse(server.commands.stream().anyMatch(command ->
                List.of("FLUSHALL", "FLUSHDB", "KEYS", "SCAN", "EVAL", "SCRIPT").contains(command.getFirst().toUpperCase())));
        }
    }

    @Test void restoresNonDefaultOwnedBaselineAndOnlyExactRunReservation() throws Exception {
        try (var fixture = new DataFixture()) {
            change(fixture, SKU, 13, 9);
            change(fixture, WITNESS, 77, 12);
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, new RestorableInventoryCache.Baseline(Optional.of(new OwnedInventoryCache.Value(17, 8)),
                clock.instant().plusSeconds(45)));
            cache.values.put(WITNESS, persistent(77, 12));
            insertReservation(fixture, UUID.randomUUID().toString(), WITNESS, DataFixture.context(), false);
            var unownedReservation = reservations(fixture);
            var lease = lease();
            var run = capture(fixture, cache, lease, clock);
            var before = run.capturedHashes();
            var actual = DataFixture.context();
            run.prepare(actual);
            assertEquals(20, fixture.stock(SKU));
            var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache, DataFixture.RESOURCE);
            assertEquals("MISS", adapter.lookupInventory(SKU, actual).cacheOutcome());
            adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
            var receipt = run.reset(actual);
            assertEquals(before, receipt.observed());
            assertEquals(receipt.expected(), receipt.observed());
            assertEquals(13, fixture.stock(SKU));
            assertEquals(9, revision(fixture, SKU));
            assertEquals(77, fixture.stock(WITNESS));
            assertEquals(unownedReservation, reservations(fixture));
            assertEquals(new OwnedInventoryCache.Value(17, 8), cache.capture(SKU, actual).value().orElseThrow());
            assertEquals(clock.instant().plusSeconds(45), cache.capture(SKU, actual).expiresAt());
            assertEquals(persistent(77, 12), cache.capture(WITNESS, actual));
            assertEquals(receipt.expected(), run.reset(actual).observed());
        }
    }

    @Test void releasedRunReservationRestoresOriginalRevisionRatherThanInventedSeedDefaults() throws Exception {
        try (var fixture = new DataFixture()) {
            change(fixture, SKU, 11, 42);
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var lease = lease();
            var run = capture(fixture, cache, lease, clock);
            var actual = DataFixture.context();
            run.prepare(actual);
            var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache);
            var reserved = adapter.reserveInventory(lease.orderId(), SKU, 2, actual);
            adapter.releaseInventory(lease.orderId(), reserved.reservationId(), actual);
            run.reset(actual);
            assertEquals(11, fixture.stock(SKU));
            assertEquals(42, revision(fixture, SKU));
            assertEquals(0, reservations(fixture).size());
        }
    }

    @Test void expiredBaselineAndWitnessStayAbsentAndResetIsIdempotent() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, new RestorableInventoryCache.Baseline(Optional.of(new OwnedInventoryCache.Value(8, 3)),
                clock.instant().plusSeconds(2)));
            cache.values.put(WITNESS, new RestorableInventoryCache.Baseline(Optional.of(new OwnedInventoryCache.Value(7, 4)),
                clock.instant().plusSeconds(2)));
            var run = capture(fixture, cache, lease(), clock);
            run.prepare(DataFixture.context());
            new PgRedisInventoryDataAdapter(fixture.connections, cache).lookupInventory(SKU, DataFixture.context());
            clock.advance(Duration.ofSeconds(3));
            var receipt = run.reset(DataFixture.context());
            assertEquals(receipt.expected(), receipt.observed());
            assertTrue(cache.get(SKU, DataFixture.context()).isEmpty());
            assertTrue(cache.get(WITNESS, DataFixture.context()).isEmpty());
            int writes = cache.restores;
            run.reset(DataFixture.context());
            assertEquals(writes, cache.restores);
            assertThrows(DataAccessException.class, () -> run.prepare(DataFixture.context()));
        }
    }

    @Test void persistentCacheBaselineIsRestoredWithoutAddingAnExpiry() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, persistent(6, 8));
            var run = capture(fixture, cache, lease(), clock);
            run.prepare(DataFixture.context());
            run.reset(DataFixture.context());
            assertEquals(persistent(6, 8), cache.capture(SKU, DataFixture.context()));
        }
    }

    @Test void captureRequiresApprovalExactMarkerAndSyntheticFixtureBeforeAnyMutation() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            assertEquals(DataErrorKind.AUTHORIZATION, assertThrows(DataAccessException.class, () ->
                InventoryFixtureRun.capture(fixture.connections, cache,
                    new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", false), lease(),
                    DataFixture.context(), clock)).kind());
            assertEquals(0, cache.captures);
            try (var update = fixture.anchor.prepareStatement(
                    "UPDATE contoso.environment_marker SET expected_resource_id=? WHERE singleton=TRUE")) {
                update.setString(1, DataFixture.RESOURCE + "-foreign");
                update.executeUpdate();
            }
            assertThrows(DataAccessException.class, () -> capture(fixture, cache, lease(), clock));
            assertEquals(0, cache.captures);
            assertEquals(20, fixture.stock(SKU));
        }
        try (var fixture = new DataFixture()) {
            fixture.anchor.createStatement().executeUpdate("UPDATE contoso.inventory_item SET synthetic=FALSE WHERE sku='CONTOSO-001'");
            assertThrows(DataAccessException.class, () -> capture(fixture, new Cache(new MutableClock()), lease(), new MutableClock()));
            assertEquals(20, fixture.stock(SKU));
        }
        assertThrows(IllegalArgumentException.class, () -> new InventoryFixtureRun.Lease(UUID.randomUUID().toString(),
            UUID.randomUUID().toString(), "UNAPPROVED", List.of()));
        assertThrows(IllegalArgumentException.class, () -> new InventoryFixtureRun.Lease(UUID.randomUUID().toString(),
            UUID.randomUUID().toString(), SKU, List.of(SKU)));
    }

    @Test void existingReservationsAreNotOwnedJustBecauseTheyAreSynthetic() throws Exception {
        try (var fixture = new DataFixture()) {
            insertReservation(fixture, UUID.randomUUID().toString(), SKU, DataFixture.context(), true);
            var before = reservations(fixture);
            assertThrows(DataAccessException.class, () -> capture(fixture, new Cache(new MutableClock()), lease(), new MutableClock()));
            assertEquals(before, reservations(fixture));
        }
        try (var fixture = new DataFixture()) {
            var lease = lease();
            insertReservation(fixture, lease.orderId(), WITNESS, DataFixture.context(), true);
            assertThrows(DataAccessException.class, () -> capture(fixture, new Cache(new MutableClock()), lease, new MutableClock()));
            assertEquals(1, reservations(fixture).size());
        }
    }

    @Test void prepareRejectsBaselineDriftWithoutEvictingOrOverwritingIt() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, persistent(7, 3));
            var run = capture(fixture, cache, lease(), clock);
            change(fixture, SKU, 55, 7);
            assertThrows(DataAccessException.class, () -> run.prepare(DataFixture.context()));
            assertEquals(InventoryFixtureRun.State.PREPARE_FAILED, run.state());
            assertEquals(55, fixture.stock(SKU));
            assertEquals(0, cache.invalidations);
            assertThrows(DataAccessException.class, () -> run.reset(DataFixture.context()));
            assertEquals(55, fixture.stock(SKU));
            assertEquals(persistent(7, 3), cache.capture(SKU, DataFixture.context()));
        }
    }

    @Test void resetRejectsForeignOrderInvocationAndNonSyntheticReservationsWithoutDeleting() throws Exception {
        for (int kind = 0; kind < 3; kind++) {
            try (var fixture = new DataFixture()) {
                var clock = new MutableClock();
                var cache = new Cache(clock);
                var lease = lease();
                var run = capture(fixture, cache, lease, clock);
                var actual = DataFixture.context();
                run.prepare(actual);
                insertReservation(fixture, kind == 0 ? UUID.randomUUID().toString() : lease.orderId(), SKU,
                    kind == 1 ? DataFixture.context() : actual, kind != 2);
                var before = reservations(fixture);
                assertEquals(DataErrorKind.AUTHORIZATION,
                    assertThrows(DataAccessException.class, () -> run.reset(actual)).kind());
                assertEquals(before, reservations(fixture));
                assertEquals(20, fixture.stock(SKU));
                assertEquals(InventoryFixtureRun.State.RESTORE_FAILED, run.state());
            }
        }
    }

    @Test void unownedSqlOrCacheDriftIsReportedAndNeverRepairedByReset() throws Exception {
        for (boolean sqlDrift : List.of(true, false)) {
            try (var fixture = new DataFixture()) {
                var clock = new MutableClock();
                var cache = new Cache(clock);
                var run = capture(fixture, cache, lease(), clock);
                run.prepare(DataFixture.context());
                if (sqlDrift) change(fixture, WITNESS, 99, 99);
                else cache.values.put(WITNESS, persistent(99, 99));
                assertThrows(DataAccessException.class, () -> run.reset(DataFixture.context()));
                if (sqlDrift) assertEquals(99, fixture.stock(WITNESS));
                else assertEquals(persistent(99, 99), cache.capture(WITNESS, DataFixture.context()));
                assertEquals(0, cache.restores);
            }
        }
    }

    @Test void unexpectedOwnedCacheValueIsNotSilentlyClobbered() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var run = capture(fixture, cache, lease(), clock);
            run.prepare(DataFixture.context());
            cache.values.put(SKU, persistent(999, 999));
            assertThrows(DataAccessException.class, () -> run.reset(DataFixture.context()));
            assertEquals(persistent(999, 999), cache.capture(SKU, DataFixture.context()));
            assertEquals(0, cache.restores);
        }
    }

    @Test void changedCacheBaselineRejectsPreparationBeforeChangingSqlOrEvicting() throws Exception {
        try (var fixture = new DataFixture()) {
            change(fixture, SKU, 8, 4);
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, persistent(8, 4));
            var run = capture(fixture, cache, lease(), clock);
            cache.values.put(SKU, persistent(99, 99));
            assertThrows(DataAccessException.class, () -> run.prepare(DataFixture.context()));
            assertEquals(8, fixture.stock(SKU));
            assertEquals(0, cache.invalidations);
            assertEquals(persistent(99, 99), cache.capture(SKU, DataFixture.context()));
        }
    }

    @Test void failedOrUnknownEvictionRetainsBaselineForExplicitResetNotFakePreparation() throws Exception {
        for (boolean acknowledged : List.of(true, false)) {
            try (var fixture = new DataFixture()) {
                change(fixture, SKU, 8, 4);
                var clock = new MutableClock();
                var cache = new Cache(clock);
                cache.values.put(SKU, persistent(8, 4));
                var run = capture(fixture, cache, lease(), clock);
                cache.failInvalidate = true;
                cache.mutateBeforeFailure = acknowledged;
                var failure = assertThrows(DataAccessException.class, () -> run.prepare(DataFixture.context()));
                assertEquals(acknowledged, failure.outcomeUnknown());
                assertEquals(InventoryFixtureRun.State.PREPARE_FAILED, run.state());
                assertEquals(20, fixture.stock(SKU));
                cache.failInvalidate = false;
                run.reset(DataFixture.context());
                assertEquals(8, fixture.stock(SKU));
                assertEquals(persistent(8, 4), cache.capture(SKU, DataFixture.context()));
            }
        }
    }

    @Test void sqlResetFailureRollsBackAndExplicitRetakeRechecksActualState() throws Exception {
        try (var fixture = new DataFixture()) {
            change(fixture, SKU, 8, 4);
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var failUpdate = new AtomicBoolean();
            var connections = recording(fixture.connections, new ArrayList<>(), failUpdate);
            var lease = lease();
            var actual = DataFixture.context();
            var run = InventoryFixtureRun.capture(connections, cache, permit(), lease, actual, clock);
            run.prepare(actual);
            new PgRedisInventoryDataAdapter(connections, cache).reserveInventory(lease.orderId(), SKU, 2, actual);
            failUpdate.set(true);
            assertThrows(DataAccessException.class, () -> run.reset(actual));
            assertEquals(18, fixture.stock(SKU));
            assertEquals(1, reservations(fixture).size(), "The preceding exact-row DELETE must roll back with the failed update");
            assertEquals(InventoryFixtureRun.State.RESTORE_FAILED, run.state());
            failUpdate.set(false);
            run.reset(actual);
            assertEquals(8, fixture.stock(SKU));
            assertEquals(0, reservations(fixture).size());
        }
    }

    @Test void cacheRestoreFailureBeforeMutationRetainsReservationDerivedStateForRetry() throws Exception {
        for (boolean unknown : List.of(false, true)) {
            try (var fixture = new DataFixture()) {
                var clock = new MutableClock();
                var cache = new Cache(clock);
                var lease = lease();
                var actual = DataFixture.context();
                var run = capture(fixture, cache, lease, clock);
                var before = run.capturedHashes();
                run.prepare(actual);
                var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache);
                adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
                assertEquals(17, adapter.lookupInventory(SKU, actual).available());
                assertEquals(Optional.of(new OwnedInventoryCache.Value(17, 2)), cache.get(SKU, actual));
                cache.failRestoreBeforeWrite = true;
                cache.restoreFailureUnknown = unknown;
                var failure = assertThrows(DataAccessException.class, () -> run.reset(actual));
                assertEquals(unknown, failure.outcomeUnknown());
                assertEquals(InventoryFixtureRun.State.RESTORE_FAILED, run.state());
                assertEquals(20, fixture.stock(SKU));
                assertEquals(1, revision(fixture, SKU));
                assertEquals(0, reservations(fixture).size());
                assertEquals(Optional.of(new OwnedInventoryCache.Value(17, 2)), cache.get(SKU, actual));
                assertEquals(1, cache.restores, "A failed/unknown outcome must not trigger an automatic retry");
                cache.failRestoreBeforeWrite = false;
                var receipt = run.reset(actual);
                assertEquals(before, receipt.observed());
                assertEquals(receipt.expected(), receipt.observed());
                assertEquals(InventoryFixtureRun.State.RESTORED, run.state());
                assertTrue(cache.get(SKU, actual).isEmpty());
                assertEquals(2, cache.restores);
            }
        }
    }

    @Test void unknownCacheRestoreNeverReturnsReceiptAndRetakeReadsBeforeWriting() throws Exception {
        try (var fixture = new DataFixture()) {
            change(fixture, SKU, 8, 4);
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.values.put(SKU, persistent(8, 4));
            var run = capture(fixture, cache, lease(), clock);
            var actual = DataFixture.context();
            run.prepare(actual);
            cache.failRestoreAfterWrite = true;
            assertTrue(assertThrows(DataAccessException.class, () -> run.reset(actual)).outcomeUnknown());
            assertEquals(8, fixture.stock(SKU));
            assertEquals(InventoryFixtureRun.State.RESTORE_FAILED, run.state());
            cache.failRestoreAfterWrite = false;
            int writes = cache.restores;
            var receipt = run.reset(actual);
            assertEquals(writes, cache.restores);
            assertEquals(receipt.expected(), receipt.observed());
        }
    }

    @Test void retryAfterSqlRestoreRevalidatesCacheExpiryAndUnownedStateBeforeWriting() throws Exception {
        for (int drift = 0; drift < 4; drift++) {
            try (var fixture = new DataFixture()) {
                var clock = new MutableClock();
                var cache = new Cache(clock);
                var lease = lease();
                var actual = DataFixture.context();
                var run = capture(fixture, cache, lease, clock);
                run.prepare(actual);
                var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache);
                adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
                adapter.lookupInventory(SKU, actual);
                cache.failRestoreBeforeWrite = true;
                assertThrows(DataAccessException.class, () -> run.reset(actual));
                cache.failRestoreBeforeWrite = false;
                if (drift == 0) cache.values.put(SKU, persistent(16, 2));
                if (drift == 1) {
                    var observed = cache.capture(SKU, actual);
                    cache.values.put(SKU, new RestorableInventoryCache.Baseline(observed.value(), observed.expiresAt().plusSeconds(5)));
                }
                if (drift == 2) change(fixture, WITNESS, 99, 99);
                if (drift == 3) cache.values.put(WITNESS, persistent(99, 99));
                var cacheBefore = Map.copyOf(cache.values);
                assertEquals(DataErrorKind.CONFLICT, assertThrows(DataAccessException.class, () -> run.reset(actual)).kind());
                assertEquals(cacheBefore, cache.values);
                assertEquals(1, cache.restores, "Rejected drift must not replay the failed cache restore");
                assertEquals(20, fixture.stock(SKU));
                assertEquals(1, revision(fixture, SKU));
                assertEquals(0, reservations(fixture).size());
                if (drift == 2) assertEquals(99, fixture.stock(WITNESS));
            }
        }
    }

    @Test void retryRejectsRecreatedReservationEvenWithIdenticalRunOwnerStockAndRevision() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var lease = lease();
            var actual = DataFixture.context();
            var run = capture(fixture, cache, lease, clock);
            run.prepare(actual);
            var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache);
            var original = adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
            adapter.lookupInventory(SKU, actual);
            cache.failRestoreBeforeWrite = true;
            assertThrows(DataAccessException.class, () -> run.reset(actual));
            cache.failRestoreBeforeWrite = false;
            var recreated = adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
            assertNotEquals(original.reservationId(), recreated.reservationId());
            assertEquals(DataErrorKind.CONFLICT, assertThrows(DataAccessException.class, () -> run.reset(actual)).kind());
            assertEquals(List.of(recreated.reservationId()), reservations(fixture));
            assertEquals(17, fixture.stock(SKU));
            assertEquals(2, revision(fixture, SKU));
            assertEquals(1, cache.restores);
        }
    }

    @Test void retryRequiresOriginalObservedInvocationEvenAfterReservationDeletionCommitted() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var lease = lease();
            var actual = DataFixture.context();
            var run = capture(fixture, cache, lease, clock);
            run.prepare(actual);
            var adapter = new PgRedisInventoryDataAdapter(fixture.connections, cache);
            adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
            adapter.lookupInventory(SKU, actual);
            cache.failRestoreBeforeWrite = true;
            assertThrows(DataAccessException.class, () -> run.reset(actual));
            cache.failRestoreBeforeWrite = false;
            assertEquals(DataErrorKind.AUTHORIZATION,
                assertThrows(DataAccessException.class, () -> run.reset(DataFixture.context())).kind());
            assertEquals(Optional.of(new OwnedInventoryCache.Value(17, 2)), cache.get(SKU, actual));
            assertEquals(1, cache.restores);
            assertEquals(0, reservations(fixture).size());
            var receipt = run.reset(actual);
            assertEquals(receipt.expected(), receipt.observed());
            assertTrue(cache.get(SKU, actual).isEmpty());
        }
    }

    @Test void uncertainSqlCommitRetainsValidatedStateWithoutAssumingCommitSucceeded() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            var failCommitAfterWrite = new AtomicBoolean();
            var connections = recording(fixture.connections, new ArrayList<>(), new AtomicBoolean(), failCommitAfterWrite);
            var lease = lease();
            var actual = DataFixture.context();
            var run = InventoryFixtureRun.capture(connections, cache, permit(), lease, actual, clock);
            run.prepare(actual);
            var adapter = new PgRedisInventoryDataAdapter(connections, cache);
            adapter.reserveInventory(lease.orderId(), SKU, 3, actual);
            adapter.lookupInventory(SKU, actual);
            failCommitAfterWrite.set(true);
            var failure = assertThrows(DataAccessException.class, () -> run.reset(actual));
            assertTrue(failure.outcomeUnknown());
            assertNull(failure.getCause());
            assertEquals(InventoryFixtureRun.State.RESTORE_FAILED, run.state());
            assertEquals(20, fixture.stock(SKU));
            assertEquals(0, reservations(fixture).size());
            assertEquals(Optional.of(new OwnedInventoryCache.Value(17, 2)), cache.get(SKU, actual));
            assertEquals(0, cache.restores, "Uncertain SQL outcome must return before cache restoration");
            var receipt = run.reset(actual);
            assertEquals(receipt.expected(), receipt.observed());
            assertTrue(cache.get(SKU, actual).isEmpty());
        }
    }

    @Test void unavailableCacheCannotBeCapturedOrPassedOffAsSuccessfulColdLookup() throws Exception {
        try (var fixture = new DataFixture()) {
            var clock = new MutableClock();
            var cache = new Cache(clock);
            cache.fail = true;
            assertThrows(DataAccessException.class, () -> capture(fixture, cache, lease(), clock));
            assertEquals(20, fixture.stock(SKU));
            cache.fail = false;
            var run = capture(fixture, cache, lease(), clock);
            run.prepare(DataFixture.context());
            cache.fail = true;
            var item = new PgRedisInventoryDataAdapter(fixture.connections, cache).lookupInventory(SKU, DataFixture.context());
            assertEquals("ERROR", item.cacheOutcome());
            assertThrows(DataAccessException.class, () -> run.reset(DataFixture.context()));
            cache.fail = false;
            run.reset(DataFixture.context());
        }
    }

    static InventorySchemaHooks.Permit permit() {
        return new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", true);
    }

    static InventoryFixtureRun.Lease lease() {
        return new InventoryFixtureRun.Lease(UUID.randomUUID().toString(), UUID.randomUUID().toString(), SKU, List.of(WITNESS));
    }

    static InventoryFixtureRun capture(DataFixture fixture, Cache cache, InventoryFixtureRun.Lease lease, Clock clock) {
        return InventoryFixtureRun.capture(fixture.connections, cache, permit(), lease, DataFixture.context(), clock);
    }

    static RestorableInventoryCache.Baseline persistent(int available, long revision) {
        return new RestorableInventoryCache.Baseline(Optional.of(new OwnedInventoryCache.Value(available, revision)), null);
    }

    static void change(DataFixture fixture, String sku, int available, long revision) throws Exception {
        try (var update = fixture.anchor.prepareStatement("UPDATE contoso.inventory_item SET available=?,revision=? WHERE sku=?")) {
            update.setInt(1, available);
            update.setLong(2, revision);
            update.setString(3, sku);
            update.executeUpdate();
        }
    }

    static long revision(DataFixture fixture, String sku) throws Exception {
        try (var query = fixture.anchor.prepareStatement("SELECT revision FROM contoso.inventory_item WHERE sku=?")) {
            query.setString(1, sku);
            try (var rows = query.executeQuery()) { rows.next(); return rows.getLong(1); }
        }
    }

    static void insertReservation(DataFixture fixture, String order, String sku, OperationContext context, boolean synthetic)
            throws Exception {
        try (var insert = fixture.anchor.prepareStatement(
                "INSERT INTO contoso.inventory_reservation(reservation_id,order_id,sku,quantity,state,invocation_id,synthetic) VALUES(?,?,?,?,?,?,?)")) {
            insert.setObject(1, UUID.randomUUID());
            insert.setObject(2, UUID.fromString(order));
            insert.setString(3, sku);
            insert.setInt(4, 1);
            insert.setString(5, "RESERVED");
            insert.setObject(6, context.invocationId().uuid());
            insert.setBoolean(7, synthetic);
            insert.executeUpdate();
        }
    }

    static List<String> reservations(DataFixture fixture) throws Exception {
        var result = new ArrayList<String>();
        try (var query = fixture.anchor.prepareStatement("SELECT reservation_id FROM contoso.inventory_reservation ORDER BY reservation_id");
             var rows = query.executeQuery()) {
            while (rows.next()) result.add(rows.getString(1));
        }
        return result;
    }

    private static PgConnectionFactory recording(PgConnectionFactory delegate, List<String> events, AtomicBoolean failUpdate) {
        return recording(delegate, events, failUpdate, new AtomicBoolean());
    }

    private static PgConnectionFactory recording(PgConnectionFactory delegate, List<String> events, AtomicBoolean failUpdate,
                                                  AtomicBoolean failCommitAfterWrite) {
        return new PgConnectionFactory() {
            @Override public Map<String, String> telemetryAttributes() { return delegate.telemetryAttributes(); }
            @Override public Connection open() throws SQLException {
                Connection connection = delegate.open();
                return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] { Connection.class },
                    (proxy, method, args) -> {
                        if (method.getName().equals("prepareStatement")) {
                            String sql = (String) args[0];
                            if (sql.equals("SELECT available,revision FROM contoso.inventory_item WHERE sku=?")) events.add("SELECT");
                            if (failUpdate.get() && sql.startsWith("UPDATE contoso.inventory_item SET available=?")) {
                                throw new SQLException("SQL_PARAMETER_CANARY", "08006");
                            }
                        }
                        try {
                            Object result = method.invoke(connection, args);
                            if (method.getName().equals("commit") && failCommitAfterWrite.getAndSet(false)) {
                                throw new SQLException("SQL_COMMIT_CANARY", "08006");
                            }
                            return result;
                        }
                        catch (InvocationTargetException failure) { throw failure.getCause(); }
                    });
            }
        };
    }

    static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-02T07:30:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    static final class Cache implements RestorableInventoryCache {
        final Map<String, Baseline> values = new LinkedHashMap<>();
        final Clock clock;
        int captures, invalidations, restores;
        boolean fail, failInvalidate, mutateBeforeFailure, failRestoreAfterWrite, failRestoreBeforeWrite, restoreFailureUnknown;
        Cache(Clock clock) { this.clock = clock; }
        @Override public Optional<Value> get(String sku, OperationContext context) { check(); return current(sku).valueAt(clock.instant()); }
        @Override public void put(String sku, Value value, OperationContext context) {
            check();
            values.put(sku, new Baseline(Optional.of(value), clock.instant().plusSeconds(60)));
        }
        @Override public void invalidate(String sku, OperationContext context) {
            check();
            invalidations++;
            if (failInvalidate && !mutateBeforeFailure) throw new DataAccessException(DataErrorKind.AUTHORIZATION, false);
            values.remove(sku);
            if (failInvalidate) throw new DataAccessException(DataErrorKind.TIMEOUT, true);
        }
        @Override public Baseline capture(String sku, OperationContext context) { check(); captures++; return current(sku); }
        @Override public void restore(String sku, Baseline baseline, OperationContext context) {
            check();
            restores++;
            if (failRestoreBeforeWrite) throw new DataAccessException(
                restoreFailureUnknown ? DataErrorKind.TIMEOUT : DataErrorKind.UNAVAILABLE, restoreFailureUnknown);
            if (baseline.valueAt(clock.instant()).isEmpty()) values.remove(sku);
            else values.put(sku, baseline);
            if (failRestoreAfterWrite) throw new DataAccessException(DataErrorKind.TIMEOUT, true);
        }
        private Baseline current(String sku) {
            var value = values.getOrDefault(sku, Baseline.absent());
            if (value.valueAt(clock.instant()).isEmpty()) { values.remove(sku); return Baseline.absent(); }
            return value;
        }
        private void check() { if (fail) throw new DataAccessException(DataErrorKind.UNAVAILABLE, false); }
        @Override public boolean isReady() { return !fail; }
        @Override public void close() {}
    }
}
