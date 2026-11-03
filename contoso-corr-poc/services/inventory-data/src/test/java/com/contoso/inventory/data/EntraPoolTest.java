package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.azure.core.credential.AccessToken;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class EntraPoolTest {
    @Test void actualHikariUsesOnlyCurrentTokenOnPhysicalConnectionAndClosesCleanly() throws Exception {
        try (var fixture = new DataFixture()) {
            var physical = new AtomicInteger();
            var tokenRequests = new AtomicInteger();
            DataSource source = new DataSource() {
                public Connection getConnection(String user, String password) throws SQLException {
                    assertEquals("contoso_inventory", user);
                    assertEquals("TOKEN_POOL_CANARY", password);
                    physical.incrementAndGet();
                    return fixture.source.getConnection();
                }
                public Connection getConnection() { throw new AssertionError("Physical credentials must be explicit"); }
                public java.io.PrintWriter getLogWriter() { return null; }
                public void setLogWriter(java.io.PrintWriter out) {}
                public void setLoginTimeout(int seconds) {}
                public int getLoginTimeout() { return 1; }
                public java.util.logging.Logger getParentLogger() { return java.util.logging.Logger.getAnonymousLogger(); }
                public <T> T unwrap(Class<T> type) throws SQLException { throw new SQLException("unwrap_forbidden"); }
                public boolean isWrapperFor(Class<?> type) { return false; }
            };
            var settings = new PgSettings("localhost", "contoso_orders", "contoso_inventory", "contoso-inventory-api",
                2, Duration.ofSeconds(1), Duration.ofSeconds(3), Duration.ofSeconds(5), DataFixture.RESOURCE, null);
            var factory = new EntraPgConnectionFactory(settings, request -> {
                tokenRequests.incrementAndGet();
                return Mono.just(new AccessToken("TOKEN_POOL_CANARY", OffsetDateTime.now().plusMinutes(5)));
            }, source);
            try (factory) {
                for (int i = 0; i < 4; i++) {
                    int stock = PgOperations.execute(factory, PgOperation.SELECT, DataFixture.context(), 1, connection -> {
                        try (var query = connection.prepareStatement("SELECT available FROM contoso.inventory_item WHERE sku=?")) {
                            query.setString(1, "CONTOSO-001");
                            try (var rows = query.executeQuery()) { rows.next(); return rows.getInt(1); }
                        }
                    });
                    assertEquals(20, stock);
                }
                assertEquals(1, tokenRequests.get());
                assertTrue(physical.get() <= 2);
                assertFalse(factory.telemetryAttributes().toString().contains("TOKEN"));
                assertFalse(factory.toString().contains("TOKEN"));
            }
            assertThrows(SQLException.class, factory::open);
        }
    }
}
