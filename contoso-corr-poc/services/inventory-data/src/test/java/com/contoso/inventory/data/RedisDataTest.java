package com.contoso.inventory.data;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.protocol.ProtocolVersion;
import org.junit.jupiter.api.Test;

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
}
