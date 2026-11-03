package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.OperationContext;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.SetArgs;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.resource.DefaultClientResources;
import io.opentelemetry.context.Context;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

final class LocalRedisLane {
    record Settings(UUID runId, String username, String password) {
        static Settings parse(Map<String, String> environment) {
            if (!"run-owned-only".equals(environment.get("CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS")) ||
                !"127.0.0.1".equals(environment.get("CONTOSO_LOCAL_REDIS_HOST"))) {
                throw new IllegalArgumentException("local_redis_explicit_loopback_approval_required");
            }
            UUID run;
            try {
                String supplied = environment.get("CONTOSO_LOCAL_REDIS_RUN_ID");
                run = UUID.fromString(supplied);
                if (!run.toString().equals(supplied) || run.equals(new UUID(0, 0)) ||
                    !"10000".equals(environment.get("CONTOSO_LOCAL_REDIS_PORT"))) {
                    throw new IllegalArgumentException();
                }
            } catch (RuntimeException invalid) {
                throw new IllegalArgumentException("local_redis_canonical_run_and_port_10000_required");
            }
            String username = environment.get("CONTOSO_LOCAL_REDIS_USERNAME");
            String password = environment.get("CONTOSO_LOCAL_REDIS_PASSWORD");
            if (username != null && !username.matches("[A-Za-z0-9_-]{1,63}") ||
                password != null && password.isEmpty() || username != null && password == null) {
                throw new IllegalArgumentException("local_redis_optional_credentials_invalid");
            }
            return new Settings(run, username, password);
        }

        String sku(String suffix) {
            if (!Set.of("LEASE", "ITEM", "WITNESS").contains(suffix)) {
                throw new IllegalArgumentException("local_redis_fixed_key_suffix_required");
            }
            return "LOCAL_" + runId.toString().replace("-", "").toUpperCase(Locale.ROOT) + "_" + suffix;
        }

        String key(String suffix) { return LettuceInventoryCache.key(sku(suffix)); }

        RedisURI uri() {
            var builder = RedisURI.builder().withHost("127.0.0.1").withPort(10000)
                .withDatabase(0).withSsl(false).withTimeout(Duration.ofSeconds(2));
            if (password != null) builder.withAuthentication(username == null ? "default" : username, password);
            return builder.build();
        }

        @Override public String toString() { return "LocalRedisSettings[redacted]"; }
    }

    @Test @Timeout(45)
    void realRedisCacheAdapterAndExactOwnedKeyCleanup() throws Exception {
        Settings settings = Settings.parse(System.getenv());
        var resources = DefaultClientResources.builder().ioThreadPoolSize(2).computationThreadPoolSize(2).build();
        RedisClient observerClient = RedisClient.create(resources, settings.uri());
        RedisClient cacheClient = RedisClient.create(resources, settings.uri());
        observerClient.setOptions(LettuceInventoryCache.options());
        cacheClient.setOptions(LettuceInventoryCache.options());
        boolean cacheHandedOff = false;
        try (var observer = observerClient.connect()) {
            String info = observer.sync().info("server");
            var version = Pattern.compile("(?m)^redis_version:(\\d+)\\.\\d+\\.\\d+\\r?$").matcher(info);
            assertTrue(version.find(), "The real endpoint must identify Redis, not a RESP test peer");
            assertTrue(Integer.parseInt(version.group(1)) >= 7);
            assertTrue(info.contains("redis_mode:standalone"), "This lane qualifies only a standalone local Redis");
            var cache = new LettuceInventoryCache("127.0.0.1", cacheClient, cacheClient.connect(), () -> {}, () -> {});
            cacheHandedOff = true;
            try (cache) {
                var claimed = new LinkedHashSet<String>();
                Throwable primary = null;
                try {
                    claim(observer, settings.key("LEASE"), settings.runId().toString(), claimed);
                    claim(observer, settings.key("ITEM"), "0:0", claimed);
                    claim(observer, settings.key("WITNESS"), "23:41", claimed);
                    exerciseAdapter(observer, cache, settings);
                } catch (Exception | Error failure) {
                    primary = failure;
                    throw failure;
                } finally {
                    try {
                        cleanup(observer, settings, claimed);
                    } catch (Exception | Error cleanup) {
                        var safe = new IllegalStateException("local_redis_owned_cleanup_incomplete");
                        if (primary != null) primary.addSuppressed(safe);
                        else throw safe;
                    }
                }
            }
        } finally {
            try {
                if (!cacheHandedOff) cacheClient.shutdown(Duration.ZERO, Duration.ofSeconds(2));
            } finally {
                try { observerClient.shutdown(Duration.ZERO, Duration.ofSeconds(2)); }
                finally { resources.shutdown(0, 2, TimeUnit.SECONDS).get(3, TimeUnit.SECONDS); }
            }
        }
    }

    private static void exerciseAdapter(StatefulRedisConnection<String, String> observer,
                                        LettuceInventoryCache cache, Settings settings) {
        String sku = settings.sku("ITEM");
        String key = settings.key("ITEM");
        cache.invalidate(sku, context());
        assertTrue(cache.get(sku, context()).isEmpty());
        cache.put(sku, new OwnedInventoryCache.Value(20, 1), context());
        assertTrue(cache.get(sku, context()).orElseThrow().equals(new OwnedInventoryCache.Value(20, 1)));
        long populatedTtl = observer.sync().pttl(key);
        assertTrue(populatedTtl > 0 && populatedTtl <= 60_000, "Actual SETEX must retain the bounded adapter TTL");
        assertTrue(cache.isReady());

        observer.sync().set(key, "7:19", new SetArgs().px(20_000));
        var baseline = cache.capture(sku, context());
        assertTrue(baseline.value().orElseThrow().equals(new OwnedInventoryCache.Value(7, 19)));
        assertNotNull(baseline.expiresAt());
        cache.invalidate(sku, context());
        cache.restore(sku, baseline, context());
        long restoredTtl = observer.sync().pttl(key);
        assertTrue(restoredTtl > 0 && restoredTtl <= 20_000, "PXAT restoration must not renew a 60-second TTL");
        assertTrue(cache.get(sku, context()).orElseThrow().equals(new OwnedInventoryCache.Value(7, 19)));

        observer.sync().set(key, "LOCAL_CACHE_VALUE_CANARY", new SetArgs().px(20_000));
        var corrupt = assertThrows(DataAccessException.class, () -> cache.get(sku, context()));
        assertEquals(DataErrorKind.INTERNAL, corrupt.kind());
        assertNull(corrupt.getCause());
        assertFalse(corrupt.toString().contains("CANARY"));
        observer.sync().set(key, "003:8", new SetArgs().px(20_000));
        assertThrows(DataAccessException.class, () -> cache.capture(sku, context()));
        assertTrue("003:8".equals(observer.sync().get(key)), "A noncanonical baseline must not be normalized");
        cache.invalidate(sku, context());
        var absent = cache.capture(sku, context());
        assertTrue(absent.value().isEmpty());
        cache.restore(sku, absent, context());
        assertTrue(cache.get(sku, context()).isEmpty());
        assertTrue("23:41".equals(observer.sync().get(settings.key("WITNESS"))), "The declared witness changed");
        long witnessTtl = observer.sync().pttl(settings.key("WITNESS"));
        assertTrue(witnessTtl > 0 && witnessTtl <= 90_000);
    }

    private static void claim(StatefulRedisConnection<String, String> observer, String key,
                              String value, Set<String> claimed) {
        String result = observer.sync().set(key, value, new SetArgs().nx().px(90_000));
        assertTrue("OK".equals(result), "An existing key must never be adopted, overwritten or deleted");
        claimed.add(key);
    }

    private static void cleanup(StatefulRedisConnection<String, String> observer,
                                Settings settings, Set<String> claimed) {
        if (claimed.isEmpty()) return;
        var commands = observer.sync();
        String lease = settings.key("LEASE");
        if (!claimed.contains(lease) || !settings.runId().toString().equals(commands.get(lease))) {
            throw new IllegalStateException("local_redis_live_lease_changed");
        }
        String[] keys = claimed.toArray(String[]::new);
        commands.watch(keys);
        boolean transaction = false;
        try {
            for (String key : keys) {
                String value = commands.get(key);
                Set<String> allowed = key.equals(lease) ? Set.of(settings.runId().toString()) :
                    key.equals(settings.key("WITNESS")) ? Set.of("23:41") :
                    Set.of("0:0", "20:1", "7:19", "003:8", "LOCAL_CACHE_VALUE_CANARY");
                if (value != null && !allowed.contains(value) || key.equals(lease) && value == null) {
                    throw new IllegalStateException("local_redis_owned_value_changed");
                }
            }
            commands.multi();
            transaction = true;
            commands.del(keys);
            var result = commands.exec();
            transaction = false;
            if (result.wasDiscarded()) throw new IllegalStateException("local_redis_cleanup_conflict");
            for (String key : keys) assertEquals(0L, commands.exists(key).longValue(), "Exact owned key cleanup was not verified");
        } finally {
            if (transaction) commands.discard();
            else commands.unwatch();
        }
    }

    private static OperationContext context() {
        return new OperationContext(InvocationId.generate(), Context.current(), Instant.now().plusSeconds(5));
    }
}
