package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import com.nimbusds.jose.jwk.JWKSet;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;

class KeyRotationTest {
    @Test void unknownSigningKeyTriggersBoundedRefreshAndOldKeysAreRemoved() throws Exception {
        try (var f = new SecurityFixture()) {
            assertEquals("workload", f.auth.authenticate(f.portal(), f.gateway()).actorType());
            f.clock.advance(Duration.ofMinutes(6));
            f.document.set(new JWKSet(SecurityFixture.SECOND.toPublicJWK()).toString());
            String caller = f.token(SecurityFixture.SECOND, SecurityFixture.PUBLIC_AUDIENCE,
                SecurityFixture.PORTAL, true, Map.of("roles", List.of("Portal.Invoke")));
            String proof = f.token(SecurityFixture.SECOND, SecurityFixture.GATEWAY_AUDIENCE,
                SecurityFixture.GATEWAY, true, Map.of("roles", List.of("Gateway.Invoke")));
            assertEquals("workload", f.auth.authenticate(caller, proof).actorType());
            assertEquals(2, f.requests.get());
            assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), f.gateway()));
            assertEquals(2, f.requests.get());
        }
    }

    @Test void unknownKeyFloodDoesNotCauseUnboundedRetrieval() throws Exception {
        try (var f = new SecurityFixture()) {
            f.auth.authenticate(f.portal(), f.gateway());
            for (int index = 0; index < 30; index++) {
                String token = f.token(SecurityFixture.SECOND, SecurityFixture.GATEWAY_AUDIENCE,
                    SecurityFixture.GATEWAY, true, Map.of("roles", List.of("Gateway.Invoke")));
                assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), token));
            }
            assertEquals(1, f.requests.get());
        }
    }

    @Test void lastKnownKeysAreBoundedDuringOutageAndNeverAcceptForeignIssuer() throws Exception {
        try (var f = new SecurityFixture()) {
            f.auth.authenticate(f.portal(), f.gateway());
            f.clock.advance(Duration.ofHours(2));
            f.status.set(503);
            assertEquals("workload", f.auth.authenticate(f.portal(), f.gateway()).actorType());
            f.clock.advance(Duration.ofHours(23));
            assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), f.gateway()));
        }
    }

    @Test void duplicateKidsPrivateKeyMaterialWrongKeyIssuerAndHugeDocumentsFailClosed() throws Exception {
        for (int kind = 0; kind < 4; kind++) {
            try (var f = new SecurityFixture()) {
                switch (kind) {
                    case 0 -> f.document.set(new JWKSet(List.of(SecurityFixture.FIRST.toPublicJWK(),
                        SecurityFixture.FIRST.toPublicJWK())).toString());
                    case 1 -> f.document.set("{\"keys\":[" + SecurityFixture.FIRST.toJSONString() + "]}");
                    case 2 -> {
                        var key = new HashMap<>(SecurityFixture.FIRST.toPublicJWK().toJSONObject());
                        key.put("issuer", "https://login.microsoftonline.com/foreign/v2.0");
                        f.document.set(com.nimbusds.jose.util.JSONObjectUtils.toJSONString(Map.of("keys", List.of(key))));
                    }
                    default -> f.document.set("{\"padding\":\"" + "x".repeat(262144) + "\",\"keys\":[]}");
                }
                assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), f.gateway()));
            }
        }
    }

    @Test void duplicateJsonMembersAreNotSilentlyLastWins() {
        assertThrows(SecurityException.class,
            () -> EntraJwtVerifier.strictJson("{\"roles\":[],\"roles\":[\"Gateway.Invoke\"]}".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
}
