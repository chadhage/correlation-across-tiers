package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LocalRedisLaneContractTest {
    static Map<String, String> environment() {
        return new HashMap<>(Map.of(
            "CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS", "run-owned-only",
            "CONTOSO_LOCAL_REDIS_HOST", "127.0.0.1",
            "CONTOSO_LOCAL_REDIS_PORT", "10000",
            "CONTOSO_LOCAL_REDIS_RUN_ID", "d4787bb0-c876-4c62-9edf-fc17d79c68c8"));
    }

    @Test void explicitLocalTargetRetainsActualAdapterPortAndNoTlsOutsideThisTest() {
        var settings = LocalRedisLane.Settings.parse(environment());
        var uri = settings.uri();
        assertEquals("127.0.0.1", uri.getHost());
        assertEquals(10000, uri.getPort());
        assertEquals(0, uri.getDatabase());
        assertFalse(uri.isSsl());
        assertEquals("LOCAL_D4787BB0C8764C629EDFFC17D79C68C8_ITEM", settings.sku("ITEM"));
    }

    @Test void everyExplicitOptInTargetFieldIsRequiredWithoutConnecting() {
        for (String key : environment().keySet()) {
            var env = environment();
            env.remove(key);
            assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env), key);
        }
    }

    @Test void remoteDnsUrlAndAmbiguousLoopbackNamesNeverBecomeConnections() {
        for (String host : new String[] { "localhost", "::1", "0.0.0.0", "127.0.0.2",
                "127.0.0.1.example", "contoso-cache.redis.azure.net", "redis://127.0.0.1:10000" }) {
            var env = environment();
            env.put("CONTOSO_LOCAL_REDIS_HOST", host);
            assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
        }
    }

    @Test void invalidRunIdentifiersAndMismatchedMetadataPortsAreRejected() {
        for (String run : new String[] { "00000000-0000-0000-0000-000000000000", "1-1-1-1-1", "not-a-run",
                environment().get("CONTOSO_LOCAL_REDIS_RUN_ID").toUpperCase(java.util.Locale.ROOT) }) {
            var env = environment();
            env.put("CONTOSO_LOCAL_REDIS_RUN_ID", run);
            assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
        }
        for (String port : new String[] { "6379", "0", "65536", "10000;FLUSHALL", " 10000" }) {
            var env = environment();
            env.put("CONTOSO_LOCAL_REDIS_PORT", port);
            assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
        }
    }

    @Test void credentialsAreOptionalValidatedAndRedacted() {
        var env = environment();
        env.put("CONTOSO_LOCAL_REDIS_USERNAME", "local_user");
        assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
        env.put("CONTOSO_LOCAL_REDIS_PASSWORD", "LOCAL_AUTH_CANARY");
        var settings = LocalRedisLane.Settings.parse(env);
        assertFalse(settings.toString().contains("CANARY"));
        assertFalse(settings.toString().contains("local_user"));
        env.put("CONTOSO_LOCAL_REDIS_USERNAME", "bad user");
        assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
        env.remove("CONTOSO_LOCAL_REDIS_USERNAME");
        env.put("CONTOSO_LOCAL_REDIS_PASSWORD", "");
        assertThrows(IllegalArgumentException.class, () -> LocalRedisLane.Settings.parse(env));
    }

    @Test void onlyThreeDistinctBoundedRunOwnedKeySuffixesAreConstructible() {
        var settings = LocalRedisLane.Settings.parse(environment());
        var keys = java.util.Set.of(settings.key("LEASE"), settings.key("ITEM"), settings.key("WITNESS"));
        assertEquals(3, keys.size());
        for (String key : keys) {
            assertTrue(key.startsWith(LettuceInventoryCache.PREFIX + "LOCAL_"));
            assertTrue(key.length() - LettuceInventoryCache.PREFIX.length() <= 64);
        }
        assertThrows(IllegalArgumentException.class, () -> settings.key("OTHER"));
        assertThrows(IllegalArgumentException.class, () -> settings.key("ITEM EVAL"));
    }
}
