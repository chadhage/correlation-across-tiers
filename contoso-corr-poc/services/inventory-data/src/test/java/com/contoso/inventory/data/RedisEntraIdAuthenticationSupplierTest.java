package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;
import com.azure.core.credential.AccessToken;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class RedisEntraIdAuthenticationSupplierTest {
    @Test void actualPublicAuthXProviderConsumesInjectedCredentialAndFixedAudience() {
        String principal = UUID.randomUUID().toString();
        String token = jwt(principal);
        var requests = new AtomicInteger();
        try (var provider = LettuceInventoryCache.credentialsProvider(request -> {
            assertEquals(java.util.List.of(RedisEntraIdAuthenticationSupplier.SCOPE), request.getScopes());
            requests.incrementAndGet();
            return Mono.just(new AccessToken(token, OffsetDateTime.now().plusMinutes(5)));
        })) {
            var resolved = provider.resolveCredentials().block(Duration.ofSeconds(3));
            assertNotNull(resolved);
            assertTrue(principal.equals(resolved.getUsername()), "AuthX principal binding changed");
            assertTrue(token.equals(new String(resolved.getPassword())), "AuthX credential changed");
            assertTrue(provider.supportsStreaming(), "real AuthX renewal must remain enabled");
            assertTrue(requests.get() >= 1);
        }
    }

    @Test void repeatedSupplierCallsUseCurrentCredentialAndNeverExposeItInDiagnostics() {
        var calls = new AtomicInteger();
        var supplier = new RedisEntraIdAuthenticationSupplier(request ->
            Mono.just(new AccessToken("TOKEN_SOURCE_CANARY_" + calls.incrementAndGet(), OffsetDateTime.now().plusMinutes(5))));
        var first = supplier.get();
        var second = supplier.get();
        assertTrue(first.accessToken().endsWith("_1"));
        assertTrue(second.accessToken().endsWith("_2"));
        assertEquals(RedisEntraIdAuthenticationSupplier.SCOPE, second.scopes());
        assertTrue(second.expiresOnDate().after(new java.util.Date()));
        assertFalse(supplier.toString().contains("CANARY"));
        assertFalse(second.toString().contains("CANARY"));
        assertNull(second.account());
        assertNull(second.tenantProfile());
    }

    @Test void expiredUnavailableAndTimedOutCredentialsFailWithOnlySafeCategories() {
        var expired = new RedisEntraIdAuthenticationSupplier(request ->
            Mono.just(new AccessToken("TOKEN_EXPIRY_CANARY", OffsetDateTime.now().plusSeconds(30))));
        assertEquals(DataErrorKind.AUTHENTICATION, assertThrows(DataAccessException.class, expired::get).kind());
        var failed = new RedisEntraIdAuthenticationSupplier(request ->
            Mono.error(new IllegalStateException("RAW_CREDENTIAL_RESPONSE_CANARY")));
        var failure = assertThrows(DataAccessException.class, failed::get);
        assertEquals(DataErrorKind.AUTHENTICATION, failure.kind());
        assertNull(failure.getCause());
        assertFalse(failure.toString().contains("CANARY"));
        var timeout = new RedisEntraIdAuthenticationSupplier(request -> Mono.never(),
            Clock.systemUTC(), Duration.ofMillis(20));
        assertEquals(DataErrorKind.TIMEOUT, assertThrows(DataAccessException.class, timeout::get).kind());
    }

    private static String jwt(String principal) {
        var encode = Base64.getUrlEncoder().withoutPadding();
        String header = encode.encodeToString("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = encode.encodeToString(("{\"oid\":\"" + principal + "\",\"exp\":" +
            (java.time.Instant.now().getEpochSecond() + 300) + "}").getBytes(StandardCharsets.UTF_8));
        return header + "." + payload + ".fixture-signature";
    }
}
