package com.contoso.inventory;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.InvocationIds;
import com.contoso.security.*;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class InventoryAuthenticationTest {
    @Test void realVerifierAcceptsActualV2AudienceAndRejectsTheTokenResourceAsAudience() throws Exception {
        String tenant = InvocationId.generate().value();
        String audience = InvocationId.generate().value();
        var orders = new WorkloadIdentity(InvocationId.generate().value(), InvocationId.generate().value());
        var key = new RSAKeyGenerator(2048).keyID("contoso-local-api").generate();
        var verifier = new EntraJwtVerifier(tenant, (kid, issuer) -> {
            if (!key.getKeyID().equals(kid) || !issuer.equals("https://login.microsoftonline.com/" + tenant + "/v2.0")) {
                throw new SecurityException("AUTHENTICATION_REJECTED");
            }
            return key.toPublicJWK();
        }, Clock.systemUTC());
        var policy = new AuthorizationPolicy("contoso-inventory-api", Set.of(audience), Set.of(), Set.of(),
            "Orders.Invoke", Set.of(), Set.of(orders), Set.of(orders), Set.of(), "Inventory.Invoke");
        try (var authenticator = new RequestAuthenticator(verifier, policy, null)) {
            var filter = new InventoryApplication.AuthFilter(authenticator);
            var business = InvocationId.generate();
            for (String actualAudience : List.of(audience, "api://" + audience, InvocationId.generate().value())) {
                var now = Instant.now();
                var claims = new JWTClaimsSet.Builder().issuer("https://login.microsoftonline.com/" + tenant + "/v2.0")
                    .audience(actualAudience).issueTime(Date.from(now)).notBeforeTime(Date.from(now.minusSeconds(5)))
                    .expirationTime(Date.from(now.plusSeconds(120))).claim("ver", "2.0").claim("tid", tenant)
                    .claim("azp", orders.clientId()).claim("oid", orders.objectId()).claim("idtyp", "app")
                    .claim("roles", List.of("Inventory.Invoke")).build();
                var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID(key.getKeyID()).build(), claims);
                jwt.sign(new RSASSASigner(key));
                var request = new MockHttpServletRequest("GET", "/api/inventory/CONTOSO-WIDGET");
                request.addHeader("Authorization", "Bearer " + jwt.serialize());
                request.addHeader(InvocationIds.HEADER, business.value());
                var response = new MockHttpServletResponse();
                var handled = new AtomicBoolean();
                filter.doFilter(request, response, (incoming, outgoing) -> {
                    handled.set(true);
                    assertEquals(business, incoming.getAttribute(InventoryApplication.INVOCATION));
                });
                boolean expected = audience.equals(actualAudience);
                assertEquals(expected, handled.get());
                assertEquals(expected ? 200 : 401, response.getStatus());
                if (expected) assertEquals(business.value(), response.getHeader(InvocationIds.HEADER));
                else assertFalse(response.getContentAsString().contains(jwt.serialize()));
            }
        }
    }
}
