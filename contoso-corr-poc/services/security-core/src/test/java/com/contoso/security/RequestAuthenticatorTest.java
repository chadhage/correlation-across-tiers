package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.*;
import java.net.URI;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class RequestAuthenticatorTest {
    @Test void realLoopbackKeysVerifyUserAndIndependentGatewayWithoutLeakingClaims() throws Exception {
        try (var f = new SecurityFixture()) {
            var caller = f.auth.authenticate(f.user(), f.gateway());
            assertEquals("user", caller.actorType());
            assertTrue(caller.trustedInvocationIssuer());
            assertFalse(caller.canControlRuns());
            assertTrue(caller.pseudonym().orElseThrow().matches("h1:[0-9a-f]{32}:[A-Za-z0-9_-]{43}"));
            assertEquals(caller.pseudonym(), f.auth.authenticate(f.user(), f.gateway()).pseudonym());
            assertEquals(1, f.requests.get());
            assertEquals(1, f.reads.get());
            assertFalse(caller.toString().contains(SecurityFixture.USER));
            assertFalse(caller.toString().contains(caller.pseudonym().orElseThrow()));
            assertEquals(Set.of("contoso.auth.outcome", "contoso.auth.actor_type", "contoso.auth.role_category"),
                SafeAuthenticationTelemetry.success(caller).keySet());
        }
    }

    @Test void forgedExpiredWrongAudienceIssuerTenantAndFutureTokensFailClosed() throws Exception {
        try (var f = new SecurityFixture()) {
            var user = new WorkloadIdentity(SecurityFixture.STOREFRONT, SecurityFixture.USER);
            List<String> rejected = List.of(
                f.token(SecurityFixture.FORGED, SecurityFixture.PUBLIC_AUDIENCE, user, false, Map.of()),
                f.token(SecurityFixture.FIRST, "api://wrong", user, false, Map.of()),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("exp", Date.from(f.clock.instant().minusSeconds(61)))),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("iss", "https://login.microsoftonline.com/other/v2.0")),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("tid", UUID.randomUUID().toString())),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("nbf", Date.from(f.clock.instant().plusSeconds(120)))),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("iat", Date.from(f.clock.instant().plusSeconds(120)))),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("exp", Date.from(f.clock.instant().plusSeconds(86400)))),
                f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE, user, false,
                    Map.of("ver", "3.0")));
            for (String token : rejected) {
                var failure = assertThrows(SecurityException.class, () -> f.auth.authenticate(token, f.gateway()));
                assertEquals("AUTHENTICATION_REJECTED", failure.getMessage());
                assertNull(failure.getCause());
            }
            assertEquals(0, f.reads.get());
        }
    }

    @Test void gatewayProofIsValidatedFirstAndCannotBeAUserOrForeignWorkload() throws Exception {
        try (var f = new SecurityFixture()) {
            for (String proof : Arrays.asList(null, f.user(), f.portal(),
                    f.token(SecurityFixture.FIRST, SecurityFixture.GATEWAY_AUDIENCE,
                        SecurityFixture.identity(), true, Map.of("roles", List.of("Gateway.Invoke"))),
                    f.token(SecurityFixture.FIRST, SecurityFixture.GATEWAY_AUDIENCE,
                        new WorkloadIdentity(SecurityFixture.GATEWAY.clientId(), UUID.randomUUID().toString()),
                        true, Map.of("roles", List.of("Gateway.Invoke"))))) {
                assertThrows(SecurityException.class, () -> f.auth.authenticate(f.user(), proof));
            }
            assertEquals(0, f.reads.get());
        }
    }

    @Test void roleClaimsCannotTurnDelegatedOrIdTokensIntoAppOnlyWorkloads() throws Exception {
        try (var f = new SecurityFixture()) {
            var mutations = new ArrayList<Map<String, Object>>();
            mutations.add(Map.of("scp", "Orders.Invoke"));
            var missingType = new HashMap<String, Object>();
            missingType.put("idtyp", null);
            mutations.add(missingType);
            mutations.add(Map.of("idtyp", "user"));
            mutations.add(Map.of("roles", List.of("Gateway.Invoke")));
            mutations.add(Map.of("roles", "Portal.Invoke"));
            mutations.add(Map.of("oid", UUID.randomUUID().toString()));
            for (var mutation : mutations) {
                var changes = new HashMap<String, Object>();
                changes.put("roles", List.of("Portal.Invoke"));
                changes.putAll(mutation);
                String token = f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE,
                    SecurityFixture.PORTAL, true, changes);
                assertThrows(SecurityException.class, () -> f.auth.authenticate(token, f.gateway()));
            }
            var portal = f.auth.authenticate(f.portal(), f.gateway());
            assertEquals("workload", portal.actorType());
            assertTrue(portal.pseudonym().isEmpty());
            assertTrue(portal.trustedInvocationIssuer());
            assertFalse(portal.canControlRuns());
        }
    }

    @Test void delegatedClientAndScopeAreIndependentlyAllowlisted() throws Exception {
        try (var f = new SecurityFixture()) {
            for (String token : List.of(
                    f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE,
                        SecurityFixture.identity(), false, Map.of()),
                    f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE,
                        new WorkloadIdentity(SecurityFixture.STOREFRONT, SecurityFixture.USER), false,
                        Map.of("scp", "Inventory.Invoke")))) {
                assertThrows(SecurityException.class, () -> f.auth.authenticate(token, f.gateway()));
            }
        }
    }

    @Test void inventoryRequiresOrdersWorkloadAndCannotAcceptGatewayOrDelegatedIdentity() throws Exception {
        var clock = new SecurityFixture.MutableClock();
        try (var verifier = new EntraJwtVerifier(SecurityFixture.TENANT,
                (id, issuer) -> SecurityFixture.FIRST.toPublicJWK(), clock);
             var auth = new RequestAuthenticator(verifier, SecurityFixture.inventoryPolicy(), null);
             var f = new SecurityFixture()) {
            String orders = f.token(SecurityFixture.FIRST, SecurityFixture.INVENTORY_AUDIENCE,
                SecurityFixture.ORDERS, true, Map.of("roles", List.of("Inventory.Invoke")));
            assertTrue(auth.authenticate(orders, null).trustedInvocationIssuer());
            assertThrows(SecurityException.class, () -> auth.authenticate(orders, f.gateway()));
            assertThrows(SecurityException.class, () -> auth.authenticate(f.user(), null));
            assertThrows(SecurityException.class, () -> auth.authenticate(
                f.token(SecurityFixture.FIRST, SecurityFixture.INVENTORY_AUDIENCE, SecurityFixture.GATEWAY,
                    true, Map.of("roles", List.of("Inventory.Invoke"))), null));
        }
    }

    @Test void runControlRequiresItsOwnPermissionNotInvocationIdOrGatewayRole() throws Exception {
        try (var f = new SecurityFixture()) {
            String controller = f.token(SecurityFixture.FIRST, SecurityFixture.PUBLIC_AUDIENCE,
                SecurityFixture.PORTAL, true, Map.of("roles", List.of("Portal.Invoke", "Demo.Control")));
            assertFalse(f.auth.authenticate(controller, f.gateway()).canControlRuns());
            try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) -> {
                    throw new AssertionError("workload_must_not_enrich_user");
                }, f.clock);
                 var auth = new RequestAuthenticator(f.verifier,
                    SecurityFixture.ordersPolicy(Set.of(SecurityFixture.PORTAL)), hmac)) {
                assertTrue(auth.authenticate(controller, f.gateway()).canControlRuns());
                assertFalse(auth.authenticate(f.portal(), f.gateway()).canControlRuns());
            }
        }
    }

    @Test void replayedExpiredProofIsRejectedButValidBearerReuseIsHonestlyNotAntiReplay() throws Exception {
        try (var f = new SecurityFixture()) {
            String caller = f.portal(), proof = f.gateway();
            assertEquals("workload", f.auth.authenticate(caller, proof).actorType());
            assertEquals("workload", f.auth.authenticate(caller, proof).actorType());
            f.clock.advance(Duration.ofSeconds(331));
            assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), proof));
            assertThrows(SecurityException.class, () -> f.auth.authenticate(caller, f.gateway()));
        }
    }

    @Test void noneHmacConfusionMalformedOversizedAndInjectedBearerHeadersFail() throws Exception {
        try (var f = new SecurityFixture()) {
            var claims = SignedJWT.parse(EntraJwtVerifier.bearer(f.user())).getJWTClaimsSet();
            byte[] secret = new byte[32];
            new SecureRandom().nextBytes(secret);
            var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).keyID("first").build(), claims);
            jwt.sign(new MACSigner(secret));
            Arrays.fill(secret, (byte) 0);
            for (String token : List.of("Bearer " + jwt.serialize(), "Bearer " + new PlainJWT(claims).serialize(),
                    f.user() + "," + f.user(), f.user() + "\r\nX-Trusted: true", "Bearer " + "x".repeat(8192))) {
                assertThrows(SecurityException.class, () -> f.auth.authenticate(token, f.gateway()));
            }
        }
    }

    @Test void configurationDoesNotAcceptUnpinnedEndpointsMissingWorkloadIdsOrUnknownRoles() {
        assertThrows(IllegalStateException.class, () -> RequestAuthenticator.policyFromEnvironment("contoso-orders-api", Map.of()));
        assertThrows(IllegalStateException.class, () -> RequestAuthenticator.policyFromEnvironment("test-issuer", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> new JwkKeySource(URI.create("http://identity.example/keys"),
            "https://issuer.example", Clock.systemUTC()));
        assertThrows(IllegalArgumentException.class, () -> new EntraJwtVerifier(SecurityFixture.TENANT,
            (id, issuer) -> SecurityFixture.FIRST.toPublicJWK(), Clock.systemUTC(), Duration.ofMinutes(5), Duration.ofHours(1)));
    }

    @Test void actualV2AudienceGuidIsAcceptedButTokenResourceUriCannotReplaceIt() throws Exception {
        try (var f = new SecurityFixture()) {
            assertEquals("workload", f.auth.authenticate(f.portal(), f.gateway()).actorType());
            String wrongCaller = f.token(SecurityFixture.FIRST, "api://" + SecurityFixture.PUBLIC_AUDIENCE,
                SecurityFixture.PORTAL, true, Map.of("roles", List.of("Portal.Invoke")));
            String wrongProof = f.token(SecurityFixture.FIRST, "api://" + SecurityFixture.GATEWAY_AUDIENCE,
                SecurityFixture.GATEWAY, true, Map.of("roles", List.of("Gateway.Invoke")));
            assertThrows(SecurityException.class, () -> f.auth.authenticate(wrongCaller, f.gateway()));
            assertThrows(SecurityException.class, () -> f.auth.authenticate(f.portal(), wrongProof));
            assertThrows(SecurityException.class, () -> f.verifier.verify(wrongProof,
                Set.of(SecurityFixture.GATEWAY_AUDIENCE, "api://" + SecurityFixture.GATEWAY_AUDIENCE)));
        }
    }

    @Test void authenticationAudienceConfigurationNeverFallsBackToOutboundResource() {
        Map<String, String> env = new HashMap<>();
        env.put("CONTOSO_ORDERS_CLIENT_ID", SecurityFixture.ORDERS.clientId());
        env.put("CONTOSO_ORDERS_OBJECT_ID", SecurityFixture.ORDERS.objectId());
        env.put("CONTOSO_INVENTORY_TOKEN_RESOURCE", "api://" + SecurityFixture.INVENTORY_AUDIENCE);
        assertThrows(IllegalStateException.class,
            () -> RequestAuthenticator.policyFromEnvironment("contoso-inventory-api", env));
        env.put("CONTOSO_INVENTORY_AUDIENCE", SecurityFixture.INVENTORY_AUDIENCE);
        assertEquals(Set.of(SecurityFixture.INVENTORY_AUDIENCE),
            RequestAuthenticator.policyFromEnvironment("contoso-inventory-api", env).callerAudiences());
    }

    @Test void v1IssuerAndApplicationIdAreExplicitlyValidatedRatherThanAssumedV2() throws Exception {
        try (var f = new SecurityFixture();
             var verifier = new EntraJwtVerifier(SecurityFixture.TENANT,
                (id, issuer) -> SecurityFixture.FIRST.toPublicJWK(), f.clock)) {
            Map<String, Object> changes = new HashMap<>();
            changes.put("ver", "1.0");
            changes.put("iss", EntraJwtVerifier.issuer(SecurityFixture.TENANT, "1.0"));
            changes.put("azp", null);
            changes.put("appid", SecurityFixture.ORDERS.clientId());
            String token = f.token(SecurityFixture.FIRST, "api://" + SecurityFixture.INVENTORY_AUDIENCE,
                SecurityFixture.ORDERS, true, changes);
            var claims = verifier.verify(token, Set.of("api://" + SecurityFixture.INVENTORY_AUDIENCE));
            assertTrue(claims.appOnly());
            assertEquals(SecurityFixture.ORDERS, claims.workload());
            assertThrows(SecurityException.class, () -> verifier.verify(token, Set.of(SecurityFixture.INVENTORY_AUDIENCE)));
        }
    }
}
