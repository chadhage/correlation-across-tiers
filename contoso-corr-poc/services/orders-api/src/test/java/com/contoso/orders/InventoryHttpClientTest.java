package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.*;
import com.contoso.correlation.data.OperationContext;
import com.sun.net.httpserver.HttpServer;
import io.opentelemetry.context.Context;
import java.net.*;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class InventoryHttpClientTest {
    @Test void expiryIsCheckedBeforeTokenAcquisition() {
        var tokens = new java.util.concurrent.atomic.AtomicInteger();
        try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:1/api"), () -> {
            tokens.incrementAndGet(); return "synthetic";
        })) {
            assertThrows(IllegalStateException.class, () -> client.lookup("CONTOSO-001",
                new OperationContext(InvocationId.generate(), Context.root(), Instant.now().minusSeconds(1))));
            assertEquals(0, tokens.get());
        }
    }

    @Test void slowTokenCannotExceedTheWholeCallDeadline() {
        try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:1/api"), () -> {
            try { Thread.sleep(3000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            return "synthetic";
        })) {
            long started = System.nanoTime();
            assertThrows(IllegalStateException.class, () -> client.lookup("CONTOSO-001",
                new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusMillis(150))));
            assertTrue(java.time.Duration.ofNanos(System.nanoTime() - started).toMillis() < 1000);
        }
    }

    @Test void headersAndByteCapDoNotPermitAStalledResponseBody() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var release = new java.util.concurrent.CountDownLatch(1);
        server.createContext("/api/inventory/CONTOSO-001", exchange -> {
            try {
                exchange.sendResponseHeaders(200, 100);
                exchange.getResponseBody().write('{');
                exchange.getResponseBody().flush();
                try { release.await(3, java.util.concurrent.TimeUnit.SECONDS); }
                catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            } finally { exchange.close(); }
        });
        server.start();
        try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api"),
                () -> "synthetic")) {
            long started = System.nanoTime();
            assertThrows(IllegalStateException.class, () -> client.lookup("CONTOSO-001",
                new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusMillis(200))));
            assertTrue(java.time.Duration.ofNanos(System.nanoTime() - started).toMillis() < 1000);
        } finally { release.countDown(); server.stop(0); }
    }
    @Test void realHttpCarriesOnlyValidatedBusinessIdAndServiceToken() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var business = new AtomicReference<String>();
        var authorization = new AtomicReference<String>();
        server.createContext("/api/inventory/CONTOSO-WIDGET", exchange -> {
            business.set(exchange.getRequestHeaders().getFirst(InvocationIds.HEADER));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = "{\"sku\":\"CONTOSO-WIDGET\",\"available\":20,\"revision\":1,\"cacheOutcome\":\"MISS\"}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            var id = InvocationId.generate();
            var client = new InventoryHttpClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api"),
                () -> "synthetic-service-token");
            var item = client.lookup("CONTOSO-WIDGET", new OperationContext(id, Context.root(), Instant.now().plusSeconds(5)));
            assertEquals(20, item.available());
            assertEquals(id.value(), business.get());
            assertEquals("Bearer synthetic-service-token", authorization.get());
        } finally { server.stop(0); }
    }

    @Test void expiredDeadlineDoesNotCallNetwork() {
        var client = new InventoryHttpClient(URI.create("http://127.0.0.1:1/api"), () -> "synthetic");
        assertThrows(IllegalStateException.class, () -> client.lookup("CONTOSO-WIDGET",
            new OperationContext(InvocationId.generate(), Context.root(), Instant.now().minusSeconds(1))));
    }
}
