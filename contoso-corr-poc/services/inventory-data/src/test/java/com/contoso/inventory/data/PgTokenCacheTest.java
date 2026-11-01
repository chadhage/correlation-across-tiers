package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenCredential;
import com.contoso.correlation.data.DataAccessException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class PgTokenCacheTest {
    @Test void refreshUsesPostgresAudienceAndNewCredentialsAfterExpiry() {
        var clock = new MutableClock();
        var calls = new AtomicInteger();
        TokenCredential credential = request -> {
            assertEquals(java.util.List.of(PgTokenCache.SCOPE), request.getScopes());
            return Mono.just(new AccessToken("TOKEN_CANARY_" + calls.incrementAndGet(),
                clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC)));
        };
        var cache = new PgTokenCache(credential, clock);
        cache.prepare(Duration.ofSeconds(1));
        assertEquals("TOKEN_CANARY_1", cache.connectionPassword());
        clock.now = clock.now.plusSeconds(250);
        cache.prepare(Duration.ofSeconds(1));
        assertEquals("TOKEN_CANARY_2", cache.connectionPassword());
        assertFalse(cache.toString().contains("CANARY"));
    }

    @Test void concurrentBorrowersShareSingleFlightRefresh() throws Exception {
        var clock = new MutableClock();
        var calls = new AtomicInteger();
        var cache = new PgTokenCache(request -> Mono.fromSupplier(() -> {
            calls.incrementAndGet();
            return new AccessToken("TOKEN_CANARY", clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC));
        }), clock);
        try (var executor = Executors.newFixedThreadPool(8)) {
            var futures = new java.util.ArrayList<java.util.concurrent.Future<?>>();
            for (int i = 0; i < 8; i++) futures.add(executor.submit(() -> cache.prepare(Duration.ofSeconds(1))));
            for (var future : futures) future.get();
        }
        assertEquals(1, calls.get());
    }

    @Test void failedAndTooShortCredentialsFailClosedWithoutTokenOrRawError() {
        var clock = new MutableClock();
        var failed = new PgTokenCache(request -> Mono.error(
            new IllegalArgumentException("JWT_PASSWORD_TOKEN_CANARY")), clock);
        var error = assertThrows(DataAccessException.class, () -> failed.prepare(Duration.ofSeconds(1)));
        assertFalse(error.toString().contains("CANARY"));
        assertNull(error.getCause());
        var shortLived = new PgTokenCache(request -> Mono.just(
            new AccessToken("TOKEN_CANARY", clock.instant().plusSeconds(20).atOffset(ZoneOffset.UTC))), clock);
        assertThrows(DataAccessException.class, () -> shortLived.prepare(Duration.ofSeconds(1)));
    }

    @Test void refreshDeadlineIsBoundedWithoutPreservingIdentityError() {
        var cache = new PgTokenCache(request -> Mono.never(), new MutableClock());
        long start = System.nanoTime();
        var failure = assertThrows(DataAccessException.class, () -> cache.prepare(Duration.ofMillis(100)));
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 1_000);
        assertNull(failure.getCause());
    }

    private static final class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-10-31T22:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}
