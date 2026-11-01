package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

class InventoryDataTest {
    @Test void coldThenWarmLookupUsesRealRowsAndOwnedCache() throws Exception {
        try (var fixture = new DataFixture()) {
            var first = fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context());
            var second = fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context());
            assertEquals(20, first.available());
            assertEquals("MISS", first.cacheOutcome());
            assertEquals("HIT", second.cacheOutcome());
            assertEquals(1, fixture.cache.puts);
            assertEquals(2, fixture.cache.gets);
            assertTrue(fixture.adapter.isReady());
        }
    }

    @Test void reservationAndReleaseAreIdempotentAndAtomic() throws Exception {
        try (var fixture = new DataFixture()) {
            String order = UUID.randomUUID().toString();
            var first = fixture.adapter.reserveInventory(order, "CONTOSO-001", 3, DataFixture.context());
            var duplicate = fixture.adapter.reserveInventory(order, "CONTOSO-001", 3, DataFixture.context());
            assertEquals(first, duplicate);
            assertEquals(17, fixture.stock("CONTOSO-001"));
            assertEquals(DataErrorKind.CONFLICT, assertThrows(DataAccessException.class, () ->
                fixture.adapter.reserveInventory(order, "CONTOSO-001", 4, DataFixture.context())).kind());
            assertEquals(17, fixture.stock("CONTOSO-001"));
            var released = fixture.adapter.releaseInventory(order, first.reservationId(), DataFixture.context());
            assertEquals("RELEASED", released.state());
            assertEquals(released, fixture.adapter.releaseInventory(order, first.reservationId(), DataFixture.context()));
            assertEquals(20, fixture.stock("CONTOSO-001"));
        }
    }

    @Test void concurrentSameOrderCannotDoubleApplyOrOversell() throws Exception {
        try (var fixture = new DataFixture(); var workers = Executors.newFixedThreadPool(4)) {
            String order = UUID.randomUUID().toString();
            var calls = new java.util.ArrayList<java.util.concurrent.Future<com.contoso.correlation.data.Reservation>>();
            for (int i = 0; i < 4; i++) calls.add(workers.submit(() ->
                fixture.adapter.reserveInventory(order, "CONTOSO-002", 15, DataFixture.context())));
            var first = calls.get(0).get();
            for (var call : calls) assertEquals(first.reservationId(), call.get().reservationId());
            assertEquals(5, fixture.stock("CONTOSO-002"));
            assertEquals(DataErrorKind.INSUFFICIENT_STOCK, assertThrows(DataAccessException.class, () ->
                fixture.adapter.reserveInventory(UUID.randomUUID().toString(), "CONTOSO-002", 6, DataFixture.context())).kind());
            assertEquals(5, fixture.stock("CONTOSO-002"));
        }
    }

    @Test void failuresNeverBecomeFakeCacheHitsOrRawErrors() throws Exception {
        try (var fixture = new DataFixture()) {
            fixture.cache.fail = true;
            assertEquals("ERROR", fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context()).cacheOutcome());
            assertFalse(fixture.adapter.isReady());
            var missing = assertThrows(DataAccessException.class, () ->
                fixture.adapter.lookupInventory("MISSING_SQL_PARAMETER_CANARY", DataFixture.context()));
            assertEquals(DataErrorKind.NOT_FOUND, missing.kind());
            assertFalse(missing.toString().contains("CANARY"));
            assertNull(missing.getCause());
            assertEquals(0, missing.getSuppressed().length);
        }
    }

    @Test void resetIsGuardedOwnedAndRepeatable() throws Exception {
        try (var fixture = new DataFixture()) {
            fixture.adapter.reserveInventory(UUID.randomUUID().toString(), "CONTOSO-001", 4, DataFixture.context());
            try (var insert = fixture.anchor.prepareStatement(
                    "INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic) VALUES(?,?,?,?,?)")) {
                insert.setString(1, "UNRELATED");
                insert.setString(2, "Unrelated synthetic test row");
                insert.setInt(3, 77);
                insert.setLong(4, 9);
                insert.setBoolean(5, false);
                insert.executeUpdate();
            }
            fixture.cache.values.put("UNRELATED", new OwnedInventoryCache.Value(77, 9));
            var permit = new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", true);
            InventorySchemaHooks.resetOwnedRows(fixture.connections, fixture.cache, permit, DataFixture.context());
            InventorySchemaHooks.resetOwnedRows(fixture.connections, fixture.cache, permit, DataFixture.context());
            assertEquals(20, fixture.stock("CONTOSO-001"));
            assertEquals(77, fixture.stock("UNRELATED"));
            assertTrue(fixture.cache.values.containsKey("UNRELATED"));
            assertEquals("MISS", fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context()).cacheOutcome());
            assertEquals("HIT", fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context()).cacheOutcome());
            assertThrows(DataAccessException.class, () -> InventorySchemaHooks.resetOwnedRows(
                fixture.connections, fixture.cache,
                new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", false), DataFixture.context()));
        }
    }
}
