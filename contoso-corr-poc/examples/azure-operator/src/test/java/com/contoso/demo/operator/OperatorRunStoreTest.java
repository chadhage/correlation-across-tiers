package com.contoso.demo.operator;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.inventory.data.InventorySchemaHooks;
import com.contoso.inventory.data.RestorableInventoryCache;
import com.contoso.security.WorkloadIdentity;
import java.net.URI;
import java.sql.Connection;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

class OperatorRunStoreTest {
    @Test void operatorAcceptsServiceDiagnosticButRejectsApiOverride() {
        String subscription = "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-unit/providers/";
        String apim = subscription + "Microsoft.ApiManagement/service/contoso-unit-apim";
        String guid = "11111111-1111-4111-8111-111111111111";
        var identity = new WorkloadIdentity(guid, "22222222-2222-4222-8222-222222222222");
        Instant start = Instant.now(), end = start.plusSeconds(300);
        java.util.function.Consumer<String> validate = diagnostic -> new OperatorConfig(guid, guid, identity,
            URI.create("https://gateway.example.test/contoso/v1"), "api://" + guid, guid,
            subscription + "Microsoft.Insights/components/contoso-unit-ai",
            subscription + "Microsoft.Web/serverfarms/contoso-unit-plan", diagnostic, start, end, "fixture");
        assertDoesNotThrow(() -> validate.accept(apim + "/diagnostics/applicationinsights"));
        assertThrows(OperatorFailure.class, () -> validate.accept(apim + "/apis/orders/diagnostics/applicationinsights"));
    }

    @Test void freshOperatorInstanceRestoresDurableInventoryAndOriginalCacheExpiry() throws Exception {
        try (var fixture = new Fixture()) {
            Instant expiry = Instant.now().plusSeconds(600);
            fixture.cache.values.put("CONTOSO-001", new RestorableInventoryCache.Baseline(Optional.of(
                new RestorableInventoryCache.Value(17, 7)), expiry));
            var run = fixture.store.prepare(1, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            assertEquals(20, fixture.available());
            assertTrue(fixture.cache.values.getOrDefault("CONTOSO-001", RestorableInventoryCache.Baseline.absent()).value().isEmpty());
            var restarted = new OperatorRunStore(fixture.database, fixture.cache, Fixture.RESOURCE);
            assertEquals("RESTORED", restarted.reset(run.runId()).get("result"));
            assertEquals(17, fixture.available());
            assertEquals(expiry, fixture.cache.values.get("CONTOSO-001").expiresAt());
            assertEquals("ALREADY_RESTORED", restarted.reset(run.runId()).get("result"));
            assertDoesNotThrow(() -> restarted.prepare(2, Instant.now().plusSeconds(300)));
        }
    }

    @Test void cacheFailureAfterSqlCommitKeepsCheckpointForIndependentRecovery() throws Exception {
        try (var fixture = new Fixture()) {
            fixture.cache.values.put("CONTOSO-001", new RestorableInventoryCache.Baseline(Optional.of(
                new RestorableInventoryCache.Value(17, 7)), null));
            var run = fixture.store.prepare(12, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            fixture.cache.failRestoreOnce = true;
            assertThrows(IllegalStateException.class, () -> fixture.store.reset(run.runId()));
            assertEquals(17, fixture.available());
            assertEquals("DRAINING", fixture.store.get(run.runId()).phase());
            var restarted = new OperatorRunStore(fixture.database, fixture.cache, Fixture.RESOURCE);
            assertEquals("RESTORED", restarted.reset(run.runId()).get("result"));
            assertEquals(new RestorableInventoryCache.Value(17, 7), fixture.cache.values.get("CONTOSO-001").value().orElseThrow());
        }
    }

    @Test void foreignReservationAndUnexpectedRevisionAreNeverOverwritten() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(1, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            try (var insert = fixture.anchor.prepareStatement(
                "INSERT INTO contoso.inventory_reservation(reservation_id,order_id,sku,quantity,state,invocation_id) VALUES (?,?,'CONTOSO-001',1,'RESERVED',?)")) {
                insert.setObject(1, UUID.randomUUID()); insert.setObject(2, UUID.randomUUID()); insert.setObject(3, UUID.randomUUID()); insert.executeUpdate();
            }
            assertThrows(OperatorFailure.class, () -> fixture.store.reset(run.runId()));
            assertEquals(20, fixture.available());
            try (var query = fixture.anchor.createStatement().executeQuery("SELECT COUNT(*) FROM contoso.inventory_reservation")) {
                query.next(); assertEquals(1, query.getInt(1));
            }
        }
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(1, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            fixture.anchor.createStatement().executeUpdate("UPDATE contoso.inventory_item SET revision=999 WHERE sku='CONTOSO-001'");
            assertThrows(OperatorFailure.class, () -> fixture.store.reset(run.runId()));
            assertEquals(20, fixture.available());
        }
    }

    @Test void unfinishedHttpWorkFencesResetAndAStoppedLeaseCannotAdmitMoreWork() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(5, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            UUID operation = fixture.store.beginGateway(run.runId());
            assertFalse(fixture.store.drained(run.runId()));
            assertThrows(OperatorFailure.class, () -> fixture.store.reset(run.runId()));
            assertEquals(20, fixture.available());
            assertThrows(OperatorFailure.class, () -> fixture.store.beginGateway(run.runId()));
            fixture.store.finishGateway(run.runId(), operation);
            assertEquals("RESTORED", fixture.store.reset(run.runId()).get("result"));
        }
    }

    @Test void stagedOrderWithPendingOutboxStillFencesReset() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(1, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            UUID order = fixture.store.allocate(run.runId(), "ORDER");
            try (var insert = fixture.anchor.prepareStatement(
                "INSERT INTO contoso.async_workflow(workflow_id,invocation_id,workflow_type,scenario,demo_id,failure_budget,state,order_id,sku,quantity) " +
                "VALUES (?,?,'ORDER','SYNC',0,0,'QUEUED',?,'CONTOSO-001',1)")) {
                insert.setObject(1, order); insert.setObject(2, UUID.randomUUID()); insert.setObject(3, order); insert.executeUpdate();
            }
            try (var insert = fixture.anchor.prepareStatement(
                "INSERT INTO contoso.async_outbox(message_id,workflow_id,destination,draft_json) VALUES (?,?,'SERVICE_BUS_ORDER','{}')")) {
                insert.setObject(1, UUID.randomUUID()); insert.setObject(2, order); insert.executeUpdate();
            }
            fixture.store.attach(run.runId(), order);
            assertFalse(fixture.store.drained(run.runId()));
            assertThrows(OperatorFailure.class, () -> fixture.store.reset(run.runId()));
            assertEquals("DRAINING", fixture.store.get(run.runId()).phase());
            assertEquals(20, fixture.available());
            try (var rows = fixture.anchor.createStatement().executeQuery("SELECT state FROM contoso.async_outbox")) {
                assertTrue(rows.next()); assertEquals("PENDING", rows.getString(1));
            }
        }
    }

    @Test void unownedCacheDriftFailsBeforeAnyInventoryRestoreAndLeaseCannotBeStolen() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(1, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            assertThrows(OperatorFailure.class, () -> fixture.store.prepare(2, Instant.now().plusSeconds(300)));
            fixture.cache.values.put("CONTOSO-002", new RestorableInventoryCache.Baseline(Optional.of(
                new RestorableInventoryCache.Value(99, 99)), null));
            assertThrows(OperatorFailure.class, () -> fixture.store.reset(run.runId()));
            assertEquals(20, fixture.available());
        }
    }

    @Test void faultTypesAreBoundToTheirOwnScenarioAndUnknownWorkCannotBeAdopted() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(12, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            fixture.store.fault(run.runId(), "DATA_CANARY");
            assertThrows(OperatorFailure.class, () -> fixture.store.fault(run.runId(), "INVENTORY_TIMEOUT"));
            assertThrows(OperatorFailure.class, () -> fixture.store.requireOwned(run.runId(), UUID.randomUUID()));
        }
    }

    @Test void approvedLoadFitsTheJournalAndTheHardRequestBudgetStillFencesFurtherTraffic() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(15, Instant.now().plusSeconds(300));
            fixture.store.seed(run.runId());
            try (var insert = fixture.anchor.prepareStatement(
                    "INSERT INTO contoso_operator.event(event_id,run_id,kind,observed_at,facts_json,operation_id) VALUES (?,?,?,?,?,?)")) {
                for (int i = 0; i < 1200; i++) {
                    UUID operation = UUID.randomUUID();
                    for (String kind : java.util.List.of("GATEWAY_BEGIN", "GATEWAY_FINISHED")) {
                        insert.setObject(1, UUID.randomUUID()); insert.setObject(2, run.runId()); insert.setString(3, kind);
                        insert.setObject(4, java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC));
                        insert.setString(5, "{}"); insert.setObject(6, operation); insert.addBatch();
                    }

                }
                insert.executeBatch();
            }
            assertEquals(2401, fixture.store.rows(run.runId(), "events").size());
            for (int i = 1200; i < 1500; i++) {
                UUID operation = fixture.store.beginGateway(run.runId());
                fixture.store.finishGateway(run.runId(), operation);
            }
            var failure = assertThrows(OperatorFailure.class, () -> fixture.store.beginGateway(run.runId()));
            assertEquals(429, failure.status);
            assertTrue(fixture.store.drained(run.runId()));
        }
    }

    @Test void samplingIntentIsDurableUniqueAndCannotExecuteAfterAdmissionStops() throws Exception {
        try (var fixture = new Fixture()) {
            var run = fixture.store.prepare(15, Instant.now().plusSeconds(300));
            var baseline = OperatorJson.MAPPER.readTree("{\"samplingType\":\"fixed\",\"percentage\":10}");
            fixture.store.claimSampling(run.runId(), baseline);
            var restarted = new OperatorRunStore(fixture.database, fixture.cache, Fixture.RESOURCE);
            assertEquals(2, restarted.rows(run.runId(), "events").size());
            assertThrows(OperatorFailure.class, () -> restarted.claimSampling(run.runId(), baseline));
            restarted.stop(run.runId());
            var called = new java.util.concurrent.atomic.AtomicBoolean();
            assertThrows(OperatorFailure.class, () -> restarted.withActiveControlLease(run.runId(), () -> {
                called.set(true); return null;
            }));
            assertFalse(called.get());
        }
    }

    static final class Fixture implements AutoCloseable {
        static final String RESOURCE = "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-unit/providers/Microsoft.DBforPostgreSQL/flexibleServers/contoso-unit-pg";
        final JdbcDataSource source = new JdbcDataSource();
        final Connection anchor;
        final MemoryCache cache = new MemoryCache();
        final PgConnectionFactory database;
        final OperatorRunStore store;
        Fixture() throws Exception {
            source.setURL("jdbc:h2:mem:operator_" + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=0");
            source.setUser("sa"); anchor = source.getConnection();
            // H2 retains the creating session in optimized IN-list constraints.
            for (String resource : new String[]{InventorySchemaHooks.MIGRATION, "db/messaging/V002__messaging.sql", "db/operator.sql"}) {
                try (var input = getClass().getClassLoader().getResourceAsStream(resource); var statement = anchor.createStatement()) {
                    String sql = new String(java.util.Objects.requireNonNull(input).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                    for (String command : sql.split(";")) if (!command.isBlank()) statement.execute(command);
                }
            }
            try (var update = anchor.prepareStatement("UPDATE contoso.environment_marker SET expected_resource_id=?")) {
                update.setString(1, RESOURCE); update.executeUpdate();
            }
            anchor.createStatement().executeUpdate("UPDATE contoso.inventory_item SET available=17,revision=7 WHERE sku='CONTOSO-001'");
            database = new PgConnectionFactory() {
                public Connection open() throws java.sql.SQLException { return source.getConnection(); }
                public Map<String, String> telemetryAttributes() { return Map.of("db.system", "postgresql"); }
            };
            store = new OperatorRunStore(database, cache, RESOURCE);
            store.migrate();
        }
        int available() throws Exception {
            try (var query = anchor.createStatement().executeQuery("SELECT available FROM contoso.inventory_item WHERE sku='CONTOSO-001'")) {
                query.next(); return query.getInt(1);
            }
        }
        public void close() throws Exception { anchor.close(); }
    }

    static final class MemoryCache implements RestorableInventoryCache {
        final Map<String, Baseline> values = new HashMap<>();
        boolean failRestoreOnce;
        public Optional<Value> get(String sku, OperationContext context) { return capture(sku, context).valueAt(Instant.now()); }
        public void put(String sku, Value value, OperationContext context) { values.put(sku, new Baseline(Optional.of(value), null)); }
        public void invalidate(String sku, OperationContext context) { values.remove(sku); }
        public boolean isReady() { return true; }
        public Baseline capture(String sku, OperationContext context) { return values.getOrDefault(sku, Baseline.absent()); }
        public void restore(String sku, Baseline value, OperationContext context) {
            if (failRestoreOnce) { failRestoreOnce = false; throw new IllegalStateException("fixture-cache-unavailable"); }
            values.put(sku, value);
        }
        public void close() {}
    }
}
