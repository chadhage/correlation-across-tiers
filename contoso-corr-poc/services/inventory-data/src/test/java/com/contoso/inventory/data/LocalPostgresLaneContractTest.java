package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LocalPostgresLaneContractTest {
    static Map<String, String> environment() {
        return new HashMap<>(Map.of(
            "CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP", "run-owned-only",
            "CONTOSO_LOCAL_PG_HOST", "127.0.0.1",
            "CONTOSO_LOCAL_PG_RUN_ID", "25f663b8-0993-483b-b65e-dcbdfd77d522",
            "CONTOSO_LOCAL_PG_PORT", "15432",
            "CONTOSO_LOCAL_PG_USERNAME", "local_admin"));
    }

    @Test void explicitLocalRunProducesOnlyFixedRunOwnedNamesAndRedactsSecrets() {
        var env = environment();
        env.put("CONTOSO_LOCAL_PG_PASSWORD", "LOCAL_PASSWORD_CANARY");
        var settings = LocalPostgresLane.Settings.parse(env);
        assertEquals("contoso_local_25f663b80993483bb65edcbdfd77d522", settings.database());
        assertEquals(settings.database() + "_app", settings.role());
        assertEquals(15432, settings.port());
        assertEquals("local-postgresql:25f663b8-0993-483b-b65e-dcbdfd77d522", settings.marker());
        assertFalse(settings.toString().contains("CANARY"));
        assertEquals("127.0.0.1", settings.source(settings.database()).getServerNames()[0]);
        assertEquals("disable", settings.source(settings.database()).getSslMode());
    }

    @Test void optInAndEveryTargetFieldAreRequiredWithoutConnecting() {
        for (String key : environment().keySet()) {
            var env = environment();
            env.remove(key);
            assertThrows(IllegalArgumentException.class, () -> LocalPostgresLane.Settings.parse(env), key);
        }
        var env = environment();
        env.put("CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP", "true");
        assertThrows(IllegalArgumentException.class, () -> LocalPostgresLane.Settings.parse(env));
    }

    @Test void remoteDnsUrlAndAmbiguousLoopbackHostsAreRejectedWithoutConnecting() {
        for (String host : new String[] { "localhost", "::1", "127.0.0.1.evil.example", "contoso-pg.postgres.database.azure.com",
                "jdbc:postgresql://127.0.0.1:15432/postgres", "0.0.0.0", "127.0.0.2" }) {
            var env = environment();
            env.put("CONTOSO_LOCAL_PG_HOST", host);
            assertThrows(IllegalArgumentException.class, () -> LocalPostgresLane.Settings.parse(env));
        }
    }

    @Test void malformedZeroRunIdPortAndSqlIdentifierInputsAreRejected() {
        for (var entry : Map.of(
                "CONTOSO_LOCAL_PG_RUN_ID", new String[] { "00000000-0000-0000-0000-000000000000", "not-a-run", "1-1-1-1-1" },
                "CONTOSO_LOCAL_PG_PORT", new String[] { "0", "65536", "5432;DROP", "-1" },
                "CONTOSO_LOCAL_PG_USERNAME", new String[] { "user;DROP ROLE", "user name", "", "user\"name" }).entrySet()) {
            for (String invalid : entry.getValue()) {
                var env = environment();
                env.put(entry.getKey(), invalid);
                assertThrows(IllegalArgumentException.class, () -> LocalPostgresLane.Settings.parse(env));
            }
        }
    }

    @Test void sharedInventorySqlGrantsOnlyTheConstrainedMarkerLockColumn() {
        var sql = String.join(";", InventorySchemaHooks.inventoryGrantStatements("local_app"));
        assertTrue(sql.contains("GRANT SELECT,UPDATE(singleton) ON contoso.environment_marker TO \"local_app\""));
        assertFalse(sql.contains("GRANT UPDATE ON"));
        assertFalse(sql.contains("GRANT DELETE"));
        assertFalse(sql.contains("GRANT INSERT ON"));
        assertFalse(sql.contains("GRANT ALL"));
        assertFalse(sql.contains("UPDATE(expected_resource_id"));
        assertFalse(sql.contains("UPDATE(workload"));
        assertFalse(sql.contains("UPDATE(seed_version"));
        assertTrue(sql.contains("REVOKE ALL PRIVILEGES ON contoso.environment_marker FROM \"local_app\""));
    }

    @Test void sharedGrantConstructionRejectsUnquotedOrReservedRoleInjection() {
        for (String role : new String[] { "pg_monitor", "user\";DROP", "user name", "" }) {
            assertThrows(IllegalArgumentException.class, () -> InventorySchemaHooks.inventoryGrantStatements(role));
        }
        assertThrows(IllegalArgumentException.class, () -> InventorySchemaHooks.inventoryGrantStatements(null));
    }

    @Test void markerDdlRetainsTheSingleTrueNonNullPrimaryKey() throws Exception {
        try (var resource = InventorySchemaHooks.class.getClassLoader().getResourceAsStream(InventorySchemaHooks.MIGRATION)) {
            assertNotNull(resource);
            String sql = new String(resource.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertTrue(sql.contains("singleton BOOLEAN PRIMARY KEY CHECK (singleton = TRUE)"));
            assertTrue(sql.contains("environment VARCHAR(16) NOT NULL CHECK (environment = 'poc')"));
            assertTrue(sql.contains("seed_version INTEGER NOT NULL CHECK (seed_version = 1)"));
        }
    }
}
