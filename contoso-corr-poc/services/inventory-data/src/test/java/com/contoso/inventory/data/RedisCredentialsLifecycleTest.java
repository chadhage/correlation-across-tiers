package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import org.junit.jupiter.api.Test;

class RedisCredentialsLifecycleTest {
    @Test void successfulHandoffClosesOnlyBuilderAndPreservesProviderOwnership() throws Exception {
        var builder = new Owned(false);
        var provider = new Owned(false);
        assertSame(provider, LettuceInventoryCache.credentialsLifecycle(builder, () -> provider));
        assertEquals(1, builder.closes);
        assertEquals(0, provider.closes);
        provider.close();
        assertEquals(1, provider.closes);
    }

    @Test void checkedBuilderCloseFailureDisposesCreatedProviderAndSanitizesFailure() {
        var builder = new Owned(true);
        var provider = new Owned(false);
        var failure = assertThrows(DataAccessException.class,
            () -> LettuceInventoryCache.credentialsLifecycle(builder, () -> provider));
        assertEquals(1, builder.closes);
        assertEquals(1, provider.closes);
        assertEquals(DataErrorKind.AUTHENTICATION, failure.kind());
        assertNull(failure.getCause());
        assertFalse(failure.toString().contains("CANARY"));
    }

    @Test void providerCleanupFailureIsExplicitlyUnavailableNotSilentlyIgnoredOrLeaked() {
        var builder = new Owned(true);
        var provider = new Owned(true);
        var failure = assertThrows(DataAccessException.class,
            () -> LettuceInventoryCache.credentialsLifecycle(builder, () -> provider));
        assertEquals(1, builder.closes);
        assertEquals(1, provider.closes);
        assertEquals(DataErrorKind.UNAVAILABLE, failure.kind());
        assertNull(failure.getCause());
        assertEquals(0, failure.getSuppressed().length);
        assertFalse(failure.toString().contains("CANARY"));
    }

    @Test void constructionFailureStillClosesBuilderWithoutReturningAnInvalidProvider() {
        var builder = new Owned(false);
        assertThrows(DataAccessException.class, () -> LettuceInventoryCache.credentialsLifecycle(builder,
            () -> { throw new IllegalStateException("RAW_CONSTRUCTION_CANARY"); }));
        assertEquals(1, builder.closes);
    }

    private static final class Owned implements AutoCloseable {
        private final boolean fail;
        int closes;
        Owned(boolean fail) { this.fail = fail; }
        @Override public void close() throws Exception {
            closes++;
            if (fail) throw new java.io.IOException("RAW_CLOSE_CANARY");
        }
    }
}
