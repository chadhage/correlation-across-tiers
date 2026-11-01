package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.*;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DataSafetyTest {
    @Test void dtoValidationRejectsUnsafeAndInvalidInputWithoutEcho() {
        assertThrows(IllegalArgumentException.class, () -> new InventoryItem("EVAL return('TOKEN')", 1, 1, "HIT"));
        assertThrows(IllegalArgumentException.class, () -> new InventoryItem("CONTOSO-001", -1, 1, "HIT"));
        assertThrows(IllegalArgumentException.class, () -> new InventoryItem("CONTOSO-001", 1, 1, null));
        assertThrows(IllegalArgumentException.class, () -> DataValidation.id("00000000-0000-0000-0000-000000000000"));
        assertThrows(IllegalArgumentException.class, () -> DataValidation.id("AUTH_TOKEN_CANARY"));
        assertFalse(DataFixture.context().toString().contains("Invocation"));
    }

    @Test void sqlErrorsAreFiniteAndNeverPreserveSensitiveCauses() {
        Map<String, DataErrorKind> cases = Map.of(
            "28P01", DataErrorKind.AUTHENTICATION, "42501", DataErrorKind.AUTHORIZATION,
            "53300", DataErrorKind.RESOURCE_EXHAUSTED, "40001", DataErrorKind.TRANSIENT_CONCURRENCY,
            "40P01", DataErrorKind.TRANSIENT_CONCURRENCY, "23505", DataErrorKind.CONFLICT,
            "57014", DataErrorKind.TIMEOUT, "08006", DataErrorKind.DNS_OR_CONNECTIVITY);
        cases.forEach((state, kind) -> {
            SQLException raw = new SQLException("SQL_LITERAL_PARAMETER_TOKEN_CANARY", state);
            SQLException sanitized = DataErrors.sanitized(raw);
            assertEquals(kind, DataErrors.classify(sanitized));
            assertNull(sanitized.getCause());
            assertFalse(sanitized.toString().contains("CANARY"));
        });
    }

    @Test void realConstraintErrorAndConnectionUnwrapAreSanitized() throws Exception {
        try (var fixture = new DataFixture()) {
            var failure = assertThrows(DataAccessException.class, () ->
                PgOperations.execute(fixture.connections, PgOperation.INSERT, DataFixture.context(), 1, connection -> {
                    try (var query = connection.prepareStatement(
                        "INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic) VALUES(?,?,?,?,TRUE)")) {
                        query.setString(1, "CONTOSO-001");
                        query.setString(2, "SQL_PARAMETER_CANARY");
                        query.setInt(3, 20);
                        query.setLong(4, 1);
                        query.executeUpdate();
                        return null;
                    }
                }));
            assertEquals(DataErrorKind.CONFLICT, failure.kind());
            assertFalse(failure.toString().contains("CANARY"));
            assertNull(failure.getCause());
            PgOperations.execute(fixture.connections, PgOperation.SELECT, DataFixture.context(), 1, connection -> {
                assertFalse(connection.toString().contains("jdbc"));
                assertThrows(SQLException.class, () -> connection.unwrap(org.h2.jdbc.JdbcConnection.class));
                return null;
            });
        }
    }

    @Test void deadlineAndScopeCleanupDoNotReturnSuccessAfterExpiry() throws Exception {
        try (var fixture = new DataFixture()) {
            PgOperations.execute(fixture.connections, PgOperation.SELECT, DataFixture.context(), 1,
                connection -> null);
            var entered = new java.util.concurrent.atomic.AtomicBoolean();
            var context = new OperationContext(DataFixture.context().invocationId(),
                io.opentelemetry.context.Context.current(), Instant.now().plusMillis(150));
            var failure = assertThrows(DataAccessException.class, () ->
                PgOperations.execute(fixture.connections, PgOperation.TRANSACTION, context, 1, connection -> {
                    entered.set(true);
                    try { Thread.sleep(250); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
                    return "unsafe_late_success";
                }));
            assertTrue(entered.get());
            assertEquals(DataErrorKind.TIMEOUT, failure.kind());
            assertTrue(failure.outcomeUnknown());
            assertNull(PgOperations.currentContext());
            assertEquals(20, fixture.adapter.lookupInventory("CONTOSO-001", DataFixture.context()).available());
        }
    }

    @Test void captureAndMetadataNegativeControlsFailClosed() {
        var safe = Map.of("APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED", "false",
            "APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED", "false");
        assertDoesNotThrow(() -> DataInstrumentationGuard.verify(safe));
        assertThrows(IllegalStateException.class, () -> DataInstrumentationGuard.verify(Map.of()));
        var unsafe = new java.util.HashMap<>(safe);
        unsafe.put("OTEL_INSTRUMENTATION_LETTUCE_ENABLED", "true");
        assertThrows(IllegalStateException.class, () -> DataInstrumentationGuard.verify(unsafe));
        PgConnectionFactory bad = new PgConnectionFactory() {
            public java.sql.Connection open() { fail("Must reject metadata before opening"); return null; }
            public Map<String, String> telemetryAttributes() { return Map.of("db.system", "postgresql", "db.statement", "SQL_LITERAL_CANARY"); }
        };
        assertThrows(DataAccessException.class, () -> PgOperations.execute(
            bad, PgOperation.SELECT, DataFixture.context(), 1, connection -> null));
    }

    @Test void targetsAndBootstrapPermissionsRejectBeforeMutation() throws Exception {
        Map<String, String> environment = Map.of(
            "CONTOSO_PG_HOST", "contoso-corr-poc-pg.postgres.database.azure.com",
            "CONTOSO_PG_USERNAME", "contoso_inventory", "CONTOSO_PG_RESOURCE_ID", DataFixture.RESOURCE);
        assertEquals("contoso_orders", PgSettings.fromEnvironment(environment, "contoso-inventory-api").database());
        var wrong = new java.util.HashMap<>(environment);
        wrong.put("CONTOSO_PG_HOST", "production.example.com");
        assertThrows(IllegalArgumentException.class, () -> PgSettings.fromEnvironment(wrong, "contoso-inventory-api"));
        assertThrows(IllegalArgumentException.class, () -> new InventorySchemaHooks.Principal(
            "evil_role\"; DROP SCHEMA contoso", "a0000000-0000-4000-8000-000000000001"));
        try (var fixture = new DataFixture()) {
            var permit = new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", true);
            InventorySchemaHooks.install(fixture.connections, permit, DataFixture.context());
            InventorySchemaHooks.install(fixture.connections, permit, DataFixture.context());
            assertEquals(20, fixture.stock("CONTOSO-001"));
            var unbound = new PgRedisInventoryDataAdapter(fixture.connections, fixture.cache, DataFixture.RESOURCE + "-wrong");
            assertFalse(unbound.isReady());
            assertThrows(DataAccessException.class, () -> unbound.reserveInventory(
                java.util.UUID.randomUUID().toString(), "CONTOSO-001", 1, DataFixture.context()));
            assertEquals(20, fixture.stock("CONTOSO-001"));
        }
    }
}
