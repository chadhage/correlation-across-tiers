package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.protocol.ProtocolVersion;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.Optional;

class RedisDataTest {
    static LettuceInventoryCache cache(RespFixture server) {
        RedisClient client = RedisClient.create(RedisURI.builder().withHost("127.0.0.1")
            .withPort(server.port()).withAuthentication("fake-principal", "REDIS_AUTH_TOKEN_CANARY").build());
        client.setOptions(LettuceInventoryCache.options().mutate()
            .protocolVersion(ProtocolVersion.RESP2).build());
        return new LettuceInventoryCache("localhost", client, client.connect(), () -> {}, () -> {});
    }

    @Test void realLettuceCallsOnlyGetSetDeleteOwnedKeysAndPreserveOthers() throws Exception {
        try (var server = new RespFixture(); var cache = cache(server)) {
            server.values.put("unrelated", "UNRELATED_VALUE");
            assertTrue(cache.get("REDIS_KEY_CANARY", DataFixture.context()).isEmpty());
            cache.put("REDIS_KEY_CANARY", new OwnedInventoryCache.Value(20, 1), DataFixture.context());
            assertEquals(new OwnedInventoryCache.Value(20, 1), cache.get("REDIS_KEY_CANARY", DataFixture.context()).orElseThrow());
            cache.invalidate("REDIS_KEY_CANARY", DataFixture.context());
            assertTrue(cache.get("REDIS_KEY_CANARY", DataFixture.context()).isEmpty());
            assertEquals("UNRELATED_VALUE", server.values.get("unrelated"));
            assertTrue(server.commands.stream().anyMatch(command ->
                command.get(0).equalsIgnoreCase("GET") && command.contains(LettuceInventoryCache.PREFIX + "REDIS_KEY_CANARY")));
            assertFalse(server.commands.stream().anyMatch(command ->
                java.util.Set.of("FLUSHALL", "FLUSHDB", "KEYS", "EVAL", "SCRIPT").contains(command.get(0).toUpperCase())));
        }
    }

    @Test void realRedisErrorsAndCorruptValuesAreSanitized() throws Exception {
        try (var server = new RespFixture(); var cache = cache(server)) {
            server.values.put(LettuceInventoryCache.key("REDIS_KEY_CANARY"), "REDIS_VALUE_SCRIPT_ARGUMENT_CANARY");
            var corrupt = assertThrows(DataAccessException.class, () -> cache.get("REDIS_KEY_CANARY", DataFixture.context()));
            assertFalse(corrupt.toString().contains("CANARY"));
            assertNull(corrupt.getCause());
            server.error = "NOPERM REDIS_KEY_TOKEN_SCRIPT_CANARY";
            var denied = assertThrows(DataAccessException.class, () -> cache.get("REDIS_KEY_CANARY", DataFixture.context()));
            assertEquals(DataErrorKind.AUTHORIZATION, denied.kind());
            assertFalse(denied.toString().contains("CANARY"));
            assertFalse(denied.outcomeUnknown());
            assertFalse(cache.isReady(), "A PING alone must not hide a failed authorization policy");
        }
    }

    @Test void renewalAndReplayPolicyIsExplicitAndDoesNotExposeRawCommandApi() {
        assertEquals(ClientOptions.ReauthenticateBehavior.ON_NEW_CREDENTIALS,
            LettuceInventoryCache.options().getReauthenticateBehaviour());
        assertEquals(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS,
            LettuceInventoryCache.options().getDisconnectedBehavior());
        assertEquals(64, LettuceInventoryCache.options().getRequestQueueSize());
        assertThrows(IllegalArgumentException.class, () -> LettuceInventoryCache.key("EVAL TOKEN_CANARY"));
        assertFalse(java.util.Arrays.stream(OwnedInventoryCache.class.getMethods())
            .anyMatch(method -> method.getName().matches("eval|script|flushall|flushdb|execute")));
    }

    @Test void baselineRestoresExactValueAndExpiryWithoutRefreshingSixtySecondTtl() throws Exception {
        var clock = new InventoryFixtureRunTest.MutableClock();
        try (var server = new RespFixture(clock)) {
            RedisClient client = RedisClient.create(RedisURI.builder().withHost("127.0.0.1").withPort(server.port()).build());
            client.setOptions(LettuceInventoryCache.options().mutate().protocolVersion(ProtocolVersion.RESP2).build());
            try (var cache = new LettuceInventoryCache("localhost", client, client.connect(), () -> {}, () -> {}, clock)) {
                String key = LettuceInventoryCache.key("CONTOSO-001");
                server.values.put(key, "7:19");
                server.expiresAt.put(key, clock.millis() + 42_000);
                server.values.put("unrelated", "UNRELATED_CANARY");
                var before = cache.capture("CONTOSO-001", DataFixture.context());
                cache.invalidate("CONTOSO-001", DataFixture.context());
                clock.advance(Duration.ofSeconds(12));
                cache.restore("CONTOSO-001", before, DataFixture.context());
                assertEquals("7:19", server.values.get(key));
                assertEquals(before.expiresAt().toEpochMilli(), server.expiresAt.get(key));
                assertTrue(server.commands.stream().anyMatch(command -> command.getFirst().equalsIgnoreCase("SET") &&
                    command.size() == 5 && command.get(3).equalsIgnoreCase("PXAT")));
                clock.advance(Duration.ofSeconds(31));
                cache.restore("CONTOSO-001", before, DataFixture.context());
                assertTrue(cache.get("CONTOSO-001", DataFixture.context()).isEmpty());
                assertEquals("UNRELATED_CANARY", server.values.get("unrelated"));
                assertFalse(before.toString().contains("7:19"));
            }
        }
    }

    @Test void baselineHandlesPersistentAbsentAndNoncanonicalValuesWithoutInventingDefaults() throws Exception {
        try (var server = new RespFixture(); var cache = cache(server)) {
            var absent = cache.capture("CONTOSO-001", DataFixture.context());
            assertTrue(absent.value().isEmpty());
            server.values.put(LettuceInventoryCache.key("CONTOSO-001"), "3:8");
            var persistent = cache.capture("CONTOSO-001", DataFixture.context());
            assertNull(persistent.expiresAt());
            cache.invalidate("CONTOSO-001", DataFixture.context());
            cache.restore("CONTOSO-001", persistent, DataFixture.context());
            assertEquals(Optional.of(new OwnedInventoryCache.Value(3, 8)),
                cache.capture("CONTOSO-001", DataFixture.context()).value());
            cache.restore("CONTOSO-001", absent, DataFixture.context());
            assertTrue(cache.get("CONTOSO-001", DataFixture.context()).isEmpty());
            server.values.put(LettuceInventoryCache.key("CONTOSO-001"), "003:8");
            assertThrows(DataAccessException.class, () -> cache.capture("CONTOSO-001", DataFixture.context()));
            assertEquals("003:8", server.values.get(LettuceInventoryCache.key("CONTOSO-001")));
        }
    }
}
