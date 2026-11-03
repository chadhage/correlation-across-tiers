package com.contoso.security;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.*;

final class SecurityFixture implements AutoCloseable {
    static final String TENANT = UUID.randomUUID().toString();
    static final String PUBLIC_AUDIENCE = UUID.randomUUID().toString();
    static final String GATEWAY_AUDIENCE = PUBLIC_AUDIENCE;
    static final String INVENTORY_AUDIENCE = UUID.randomUUID().toString();
    static final String STOREFRONT = UUID.randomUUID().toString();
    static final WorkloadIdentity GATEWAY = identity(), PORTAL = identity(), ORDERS = identity();
    static final String USER = UUID.randomUUID().toString();
    static final RSAKey FIRST = key("first"), SECOND = key("second"), FORGED = key("first");
    final MutableClock clock = new MutableClock();
    final AtomicInteger requests = new AtomicInteger(), reads = new AtomicInteger();
    final AtomicReference<String> document = new AtomicReference<>(new JWKSet(FIRST.toPublicJWK()).toString());
    final AtomicInteger status = new AtomicInteger(200);
    final HttpServer server;
    final JwkKeySource source;
    final EntraJwtVerifier verifier;
    final HmacPseudonymizer hmac;
    final RequestAuthenticator auth;
    private final byte[] readerKey = new byte[32];

    SecurityFixture() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/keys", exchange -> {
            requests.incrementAndGet();
            byte[] bytes = document.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        source = new JwkKeySource(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/keys"),
            EntraJwtVerifier.issuer(TENANT, "2.0"), clock);
        verifier = new EntraJwtVerifier(TENANT, source, clock);
        new SecureRandom().nextBytes(readerKey);
        hmac = new HmacPseudonymizer(reference("1"), (reference, timeout) -> {
            reads.incrementAndGet();
            return new HmacPseudonymizer.SecretMaterial(readerKey, clock.instant().minusSeconds(1),
                clock.instant().plusSeconds(3600), true);
        }, clock);
        auth = new RequestAuthenticator(verifier, ordersPolicy(Set.of()), hmac);
    }

    static AuthorizationPolicy ordersPolicy(Set<WorkloadIdentity> controllers) {
        return new AuthorizationPolicy("contoso-orders-api", Set.of(PUBLIC_AUDIENCE), Set.of(GATEWAY_AUDIENCE),
            Set.of(STOREFRONT), "Orders.Invoke", Set.of(GATEWAY), Set.of(PORTAL), Set.of(PORTAL),
            controllers, "Portal.Invoke");
    }
    static AuthorizationPolicy inventoryPolicy() {
        return new AuthorizationPolicy("contoso-inventory-api", Set.of(INVENTORY_AUDIENCE), Set.of(),
            Set.of(), "Orders.Invoke", Set.of(), Set.of(ORDERS), Set.of(ORDERS), Set.of(), "Inventory.Invoke");
    }
    String gateway() { return token(FIRST, GATEWAY_AUDIENCE, GATEWAY, true, Map.of("roles", List.of("Gateway.Invoke"))); }
    String user() { return token(FIRST, PUBLIC_AUDIENCE, new WorkloadIdentity(STOREFRONT, USER), false, Map.of()); }
    String portal() { return token(FIRST, PUBLIC_AUDIENCE, PORTAL, true, Map.of("roles", List.of("Portal.Invoke"))); }
    String token(RSAKey key, String audience, WorkloadIdentity identity, boolean app, Map<String, Object> changes) {
        try {
            var builder = new JWTClaimsSet.Builder().issuer(EntraJwtVerifier.issuer(TENANT, "2.0"))
                .audience(audience).issueTime(Date.from(clock.instant().minusSeconds(60)))
                .notBeforeTime(Date.from(clock.instant().minusSeconds(60)))
                .expirationTime(Date.from(clock.instant().plusSeconds(300)))
                .claim("ver", "2.0").claim("tid", TENANT).claim("azp", identity.clientId()).claim("oid", identity.objectId());
            if (app) builder.claim("idtyp", "app");
            else builder.claim("idtyp", "user").claim("scp", "Orders.Invoke");
            changes.forEach(builder::claim);
            var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT)
                .keyID(key.getKeyID()).build(), builder.build());
            jwt.sign(new RSASSASigner(key));
            return "Bearer " + jwt.serialize();
        } catch (Exception ignored) { throw new AssertionError("fixture_token_failed"); }
    }
    static SecretVersionReference reference(String hex) {
        return SecretVersionReference.parse("https://contoso-corr-poc-kv.vault.azure.net/secrets/contoso-identity-hmac/" + hex.repeat(32));
    }
    static WorkloadIdentity identity() { return new WorkloadIdentity(UUID.randomUUID().toString(), UUID.randomUUID().toString()); }
    static RSAKey key(String id) {
        try { return new RSAKeyGenerator(2048).keyID(id).generate(); }
        catch (Exception ignored) { throw new AssertionError("fixture_key_failed"); }
    }
    public void close() { auth.close(); server.stop(0); Arrays.fill(readerKey, (byte) 0); }
    static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-01T04:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
        void advance(Duration value) { now = now.plus(value); }
    }
}
