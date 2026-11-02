package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import com.azure.core.http.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;

class IdentityHttpClientsTest {
    @Test void noNativeDisableSwitchIsNeededToRemoveContextAndPreserveCredentialHeaders() throws Exception {
        assertFalse("false".equalsIgnoreCase(System.getProperty("otel.instrumentation.okhttp.enabled")));
        assertFalse("false".equalsIgnoreCase(System.getenv("OTEL_INSTRUMENTATION_OKHTTP_ENABLED")));
        var observed = new AtomicReference<Map<String, Boolean>>();
        var context = List.of("traceparent", "tracestate", "baggage", "request-id",
            "correlation-context", "x-business-invocation-id", "x-business-correlation-id");
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            Map<String, Boolean> presence = new HashMap<>();
            for (String name : context) presence.put(name, exchange.getRequestHeaders().containsKey(name));
            presence.put("authorization", exchange.getRequestHeaders().containsKey("Authorization"));
            presence.put("x-identity-header", exchange.getRequestHeaders().containsKey("X-IDENTITY-HEADER"));
            observed.set(presence);
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            var request = new HttpRequest(HttpMethod.GET, "http://127.0.0.1:" + server.getAddress().getPort() + "/");
            for (String name : context) request.setHeader(name, UUID.randomUUID().toString());
            request.setHeader("Authorization", String.join("-", "fixture", "only", UUID.randomUUID().toString()));
            request.setHeader("X-IDENTITY-HEADER", UUID.randomUUID().toString());
            try (var response = IdentityHttpClients.httpClient().send(request).block(Duration.ofSeconds(5))) {
                assertNotNull(response);
                assertEquals(200, response.getStatusCode());
            }
            assertNotNull(observed.get());
            for (String name : context) assertFalse(observed.get().get(name), name);
            assertTrue(observed.get().get("authorization"));
            assertTrue(observed.get().get("x-identity-header"));
        } finally { server.stop(0); }
    }

    @Test void credentialTransportDoesNotFollowRedirectsAndInvalidClientIdsFailClosed() throws Exception {
        var followed = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().set("Location", "http://127.0.0.1:" + server.getAddress().getPort() + "/target");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/target", exchange -> {
            followed.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            try (var response = IdentityHttpClients.httpClient().send(new HttpRequest(HttpMethod.GET,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/redirect")).block(Duration.ofSeconds(5))) {
                assertNotNull(response);
                assertEquals(302, response.getStatusCode());
            }
            assertEquals(0, followed.get());
            assertThrows(IllegalArgumentException.class, () -> IdentityHttpClients.managedIdentity("not-a-guid"));
            assertSame(IdentityHttpClients.httpClient(), IdentityHttpClients.httpClient());
        } finally { server.stop(0); }
    }

    @Test void isolationRunsAtSubscriptionAndAgainForReusedRequestsWithoutChangingBody() throws Exception {
        var receipts = new AtomicInteger();
        var contextSeen = new AtomicBoolean();
        var bodyKept = new AtomicBoolean(true);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            contextSeen.set(contextSeen.get() || exchange.getRequestHeaders().containsKey("traceparent"));
            bodyKept.set(bodyKept.get() && Arrays.equals(new byte[] { 1, 2, 3 }, exchange.getRequestBody().readAllBytes()));
            receipts.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            var request = new HttpRequest(HttpMethod.POST, "http://127.0.0.1:" + server.getAddress().getPort() + "/")
                .setBody(new byte[] { 1, 2, 3 });
            for (int attempt = 0; attempt < 2; attempt++) {
                var pending = IdentityHttpClients.httpClient().send(request, com.azure.core.util.Context.NONE);
                request.setHeader("traceparent", UUID.randomUUID().toString());
                try (var response = pending.block(Duration.ofSeconds(5))) { assertEquals(200, response.getStatusCode()); }
            }
            assertEquals(2, receipts.get());
            assertFalse(contextSeen.get());
            assertTrue(bodyKept.get());
        } finally { server.stop(0); }
    }
}
