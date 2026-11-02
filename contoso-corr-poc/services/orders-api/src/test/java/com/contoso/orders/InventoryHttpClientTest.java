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
    @Test void tokenResourceIsRequiredAndVerifierAudiencesCannotBecomeScopes() {
        var resource = "api://" + InvocationId.generate().value();
        var settings = new java.util.HashMap<>(java.util.Map.of(
            "CONTOSO_INVENTORY_BASE_URL", "https://contoso-inventory.azurewebsites.net/api",
            "CONTOSO_INVENTORY_TOKEN_RESOURCE", resource,
            "CONTOSO_INVENTORY_AUDIENCE", InvocationId.generate().value() + ",api://" + InvocationId.generate().value()));
        assertEquals(resource, InventoryHttpClient.configuration(settings).tokenResource());
        settings.remove("CONTOSO_INVENTORY_TOKEN_RESOURCE");
        assertThrows(IllegalStateException.class, () -> InventoryHttpClient.configuration(settings));
        for (String invalid : java.util.List.of("guid1,guid2", "api://id/.default", "audience-only", "api://id?secret=x")) {
            settings.put("CONTOSO_INVENTORY_TOKEN_RESOURCE", invalid);
            assertThrows(IllegalStateException.class, () -> InventoryHttpClient.configuration(settings));
        }
    }

    @Test void actualCredentialRequestReceivesOnlyResourceDotDefault() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var scopes = new AtomicReference<java.util.List<String>>();
        var resource = "api://" + InvocationId.generate().value();
        server.createContext("/api/inventory/CONTOSO-WIDGET", exchange -> {
            exchange.getResponseHeaders().set(InvocationIds.HEADER, exchange.getRequestHeaders().getFirst(InvocationIds.HEADER));
            byte[] body = "{\"sku\":\"CONTOSO-WIDGET\",\"available\":20,\"revision\":1,\"cacheOutcome\":\"MISS\"}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try { exchange.getResponseBody().write(body); } finally { exchange.close(); }
        });
        server.start();
        com.azure.core.credential.TokenCredential credential = request -> {
            scopes.set(java.util.List.copyOf(request.getScopes()));
            return reactor.core.publisher.Mono.just(new com.azure.core.credential.AccessToken("synthetic", java.time.OffsetDateTime.now().plusMinutes(5)));
        };
        try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api"),
                resource, credential)) {
            assertEquals(20, client.lookup("CONTOSO-WIDGET",
                new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(3))).available());
            assertEquals(java.util.List.of(resource + "/.default"), scopes.get());
        } finally { server.stop(0); }
    }

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
            exchange.getResponseHeaders().set(InvocationIds.HEADER, business.get());
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

    @Test void malformedSkuFailsBeforeTokenAndCannotBecomeAQueryOrForeignPath() {
        var tokens = new java.util.concurrent.atomic.AtomicInteger();
        try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:1/api"), () -> {
            tokens.incrementAndGet(); return "synthetic";
        })) {
            for (String sku : java.util.List.of("../secret", "CONTOSO?token=x", "CONTOSO#fragment", "X".repeat(65))) {
                assertThrows(IllegalArgumentException.class, () -> client.lookup(sku,
                    new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(1))));
            }
            assertEquals(0, tokens.get());
        }
    }

    @Test void downstreamCannotSilentlyReplaceBusinessIdentityOrReturnUnboundedJson() throws Exception {
        for (boolean oversized : new boolean[]{false, true}) {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/api/inventory/CONTOSO-WIDGET", exchange -> {
                exchange.getResponseHeaders().set(InvocationIds.HEADER, oversized ?
                    exchange.getRequestHeaders().getFirst(InvocationIds.HEADER) : InvocationId.generate().value());
                byte[] body = (oversized ? " ".repeat(16385) :
                    "{\"sku\":\"CONTOSO-WIDGET\",\"available\":20,\"revision\":1,\"cacheOutcome\":\"MISS\"}")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, body.length);
                try { exchange.getResponseBody().write(body); } finally { exchange.close(); }
            });
            server.start();
            try (var client = new InventoryHttpClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api"),
                    () -> "synthetic")) {
                assertThrows(IllegalStateException.class, () -> client.lookup("CONTOSO-WIDGET",
                    new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(2))));
            } finally { server.stop(0); }
        }
    }
}
