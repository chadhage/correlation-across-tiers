package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import com.azure.core.credential.AccessToken;
import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class BoundedTokenProviderTest {
    private static final String SCOPE = "api://" + java.util.UUID.randomUUID() + "/.default";

    @Test void cacheRefreshIsSingleFlightAndNeverReturnsNearExpiry() throws Exception {
        var clock = new SecurityFixture.MutableClock();
        var calls = new AtomicInteger();
        try (var provider = new BoundedTokenProvider(context -> {
                assertEquals(java.util.List.of(SCOPE), context.getScopes());
                return Mono.fromSupplier(() -> new AccessToken("memory-only-" + calls.incrementAndGet(),
                    clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC)));
            }, SCOPE, clock);
             var pool = Executors.newFixedThreadPool(8)) {
            var tasks = new java.util.ArrayList<Future<String>>();
            for (int index = 0; index < 24; index++) tasks.add(pool.submit(() -> provider.token(Duration.ofSeconds(1))));
            for (var task : tasks) assertEquals("memory-only-1", task.get());
            assertEquals(1, calls.get());
            clock.advance(Duration.ofSeconds(250));
            assertEquals("memory-only-2", provider.token(Duration.ofSeconds(1)));
            assertFalse(provider.toString().contains("memory-only"));
        }
    }

    @Test void callerBudgetInterruptAndCredentialErrorsAreBoundedAndRedacted() {
        var clock = new SecurityFixture.MutableClock();
        try (var provider = new BoundedTokenProvider(context -> Mono.never(), SCOPE, clock)) {
            long start = System.nanoTime();
            var failure = assertThrows(SecurityException.class, () -> provider.token(Duration.ofMillis(100)));
            assertTrue(Duration.ofNanos(System.nanoTime() - start).compareTo(Duration.ofSeconds(1)) < 0);
            assertEquals("TOKEN_UNAVAILABLE", failure.getMessage());
            assertNull(failure.getCause());
            assertThrows(SecurityException.class, () -> provider.token(Duration.ZERO));
        }
        try (var provider = new BoundedTokenProvider(context -> Mono.error(new IllegalStateException("sensitive_sdk_message")),
                SCOPE, clock)) {
            var failure = assertThrows(SecurityException.class, () -> provider.token(Duration.ofSeconds(1)));
            assertEquals("TOKEN_UNAVAILABLE", failure.getMessage());
            assertNull(failure.getCause());
        }
    }

    @Test void tooShortCredentialsAndClosedProvidersFailClosed() {
        var clock = new SecurityFixture.MutableClock();
        try (var provider = new BoundedTokenProvider(context -> Mono.just(new AccessToken("memory-only",
                clock.instant().plusSeconds(30).atOffset(ZoneOffset.UTC))), SCOPE, clock)) {
            assertThrows(SecurityException.class, () -> provider.token(Duration.ofSeconds(1)));
            provider.close();
            assertThrows(SecurityException.class, () -> provider.token(Duration.ofSeconds(1)));
        }
    }

    @Test void tokenAcquisitionUsesOnlyExplicitResourceScopeAndRejectsCsvAudiences() {
        var clock = new SecurityFixture.MutableClock();
        String audience = SecurityFixture.INVENTORY_AUDIENCE;
        String resourceScope = "api://" + audience + "/.default";
        try (var provider = new BoundedTokenProvider(context -> {
                assertEquals(java.util.List.of(resourceScope), context.getScopes());
                assertFalse(context.getScopes().getFirst().contains(","));
                return Mono.just(new AccessToken("memory-only", clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC)));
            }, resourceScope, clock)) {
            assertEquals("memory-only", provider.token(Duration.ofSeconds(1)));
        }
        assertThrows(IllegalArgumentException.class, () -> new BoundedTokenProvider(context -> Mono.never(),
            audience + ",api://" + audience + "/.default", clock));
    }
}
