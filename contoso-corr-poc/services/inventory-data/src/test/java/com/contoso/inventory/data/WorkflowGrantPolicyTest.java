package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.PgConnectionFactory;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkflowGrantPolicyTest {
    @Test void everyRoleHasExplicitColumnPrivilegesAndProtectedDefaultsCannotBeClaimed() {
        var principal = new InventorySchemaHooks.Principal("contoso_workflow", UUID.randomUUID().toString());
        for (var role : InventorySchemaHooks.WorkflowRole.values()) {
            var statements = InventorySchemaHooks.workflowGrantStatements(principal, role);
            assertTrue(statements.stream().anyMatch(sql -> sql.startsWith("REVOKE ALL PRIVILEGES ON ")));
            for (String sql : statements) {
                assertFalse(sql.contains("__ROLE__"));
                if (!sql.startsWith("GRANT ")) continue;
                assertFalse(sql.matches("(?s).*\\bUPDATE\\s+ON\\b.*"));
                assertFalse(sql.matches("(?s).*(?:INSERT|UPDATE)\\([^)]*\\b(?:owner|publisher|receiver|creator|created_at)\\b[^)]*\\).*"));
                assertTrue(sql.contains("\"contoso_workflow\""));
            }
        }
    }

    @Test void targetedReplayFlagAndCompositeSourceInsertRemainAuthorizedWithoutMutableReplayIdentity() {
        var principal = new InventorySchemaHooks.Principal("contoso_workflow", UUID.randomUUID().toString());
        var orders = InventorySchemaHooks.workflowGrantStatements(principal, InventorySchemaHooks.WorkflowRole.ORDERS);
        assertTrue(orders.stream().anyMatch(sql -> sql.startsWith("GRANT ") &&
            sql.contains("async_fault") && sql.contains("replay_requested")));
        for (var role : java.util.List.of(InventorySchemaHooks.WorkflowRole.FULFILLMENT, InventorySchemaHooks.WorkflowRole.NOTIFY)) {
            var worker = InventorySchemaHooks.workflowGrantStatements(principal, role);
            assertTrue(worker.stream().anyMatch(sql -> sql.startsWith("GRANT INSERT(original_message_id,source,workflow_id,new_message_id)")));
            assertFalse(worker.stream().anyMatch(sql -> sql.startsWith("GRANT ") && sql.contains("async_replay") && sql.contains("UPDATE")));
        }
        var aggregator = InventorySchemaHooks.workflowGrantStatements(principal, InventorySchemaHooks.WorkflowRole.AGGREGATOR);
        for (String table : java.util.List.of("async_replay", "async_publication", "async_contributor")) {
            assertTrue(aggregator.stream().anyMatch(sql -> sql.startsWith("GRANT SELECT ON ") && sql.contains("contoso." + table)));
            assertFalse(aggregator.stream().anyMatch(sql -> sql.startsWith("GRANT ") &&
                sql.contains("contoso." + table) && !sql.startsWith("GRANT SELECT ON ")));
        }
    }

    @Test void missingApprovalOrReservedPrincipalFailsBeforeAnyConnectionOrGrant() {
        PgConnectionFactory noConnection = () -> { throw new AssertionError("No unapproved SQL operation"); };
        var principal = new InventorySchemaHooks.Principal("contoso_workflow", UUID.randomUUID().toString());
        var permit = new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", false);
        assertThrows(DataAccessException.class, () -> InventorySchemaHooks.grantWorkflow(noConnection, permit,
            principal, InventorySchemaHooks.WorkflowRole.ORDERS, DataFixture.context()));
        assertThrows(IllegalArgumentException.class, () -> InventorySchemaHooks.workflowGrantStatements(
            new InventorySchemaHooks.Principal("pg_read_all_data", UUID.randomUUID().toString()),
            InventorySchemaHooks.WorkflowRole.ORDERS));
        assertThrows(IllegalArgumentException.class, () -> InventorySchemaHooks.workflowGrantStatements(principal, null));
    }
}
