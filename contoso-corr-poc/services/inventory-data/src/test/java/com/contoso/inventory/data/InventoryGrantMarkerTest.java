package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

class InventoryGrantMarkerTest {
    @Test void missingUnboundForeignOrWrongDatasetMarkerRejectsBeforeAnyPrivilegeDdl() {
        var permit = new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", true);
        var cases = new Object[][] {
            null,
            { null, "contoso-corr", "poc", 1 },
            { DataFixture.RESOURCE + "-foreign", "contoso-corr", "poc", 1 },
            { DataFixture.RESOURCE, "foreign", "poc", 1 },
            { DataFixture.RESOURCE, "contoso-corr", "production", 1 },
            { DataFixture.RESOURCE, "contoso-corr", "poc", 2 }
        };
        for (Object[] marker : cases) {
            var queries = new ArrayList<String>();
            var failure = assertThrows(DataAccessException.class,
                () -> InventorySchemaHooks.verifyBoundDataset(metadata(marker, queries), permit));
            assertEquals(DataErrorKind.AUTHORIZATION, failure.kind());
            assertEquals(1, queries.size());
        }
    }

    @Test void exactMarkerIsVerifiedUnderRowLockWithoutExecutingSqlOrGrants() throws Exception {
        var permit = new InventorySchemaHooks.Permit(DataFixture.RESOURCE, "contoso_orders", true);
        var queries = new ArrayList<String>();
        InventorySchemaHooks.verifyBoundDataset(
            metadata(new Object[] { DataFixture.RESOURCE, "contoso-corr", "poc", 1 }, queries), permit);
        assertEquals(1, queries.size());
        assertTrue(queries.getFirst().endsWith("FOR UPDATE"));
    }

    private static Connection metadata(Object[] marker, List<String> queries) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] { Connection.class },
            (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement")) {
                    queries.add((String) args[0]);
                    assertTrue(((String) args[0]).startsWith("SELECT expected_resource_id,workload,environment,seed_version"));
                    return (PreparedStatement) Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(),
                        new Class<?>[] { PreparedStatement.class }, (statement, call, values) -> {
                            if (call.getName().equals("close")) return null;
                            if (!call.getName().equals("executeQuery")) throw new AssertionError("No SQL/grant execution");
                            var read = new AtomicBoolean();
                            return (ResultSet) Proxy.newProxyInstance(ResultSet.class.getClassLoader(),
                                new Class<?>[] { ResultSet.class }, (rows, fetch, columns) -> switch (fetch.getName()) {
                                    case "next" -> marker != null && !read.getAndSet(true);
                                    case "getString" -> marker[(Integer) columns[0] - 1];
                                    case "getInt" -> marker[3];
                                    case "close" -> null;
                                    default -> throw new AssertionError("Unexpected metadata read");
                                });
                        });
                }
                throw new AssertionError("No SQL/grant execution");
            });
    }
}
