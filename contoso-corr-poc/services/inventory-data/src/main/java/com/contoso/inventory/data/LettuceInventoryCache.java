package com.contoso.inventory.data;

import com.azure.core.credential.TokenCredential;
import com.contoso.correlation.Correlation;
import com.contoso.correlation.CorrelationSpan;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.DataValidation;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgOperations;
import com.contoso.security.IdentityHttpClients;
import io.lettuce.authx.TokenBasedRedisCredentialsProvider;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisCommandTimeoutException;
import io.lettuce.core.RedisConnectionException;
import io.lettuce.core.RedisFuture;
import io.lettuce.core.RedisURI;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.SslVerifyMode;
import io.lettuce.core.TimeoutOptions;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.resource.DefaultClientResources;
import io.opentelemetry.api.trace.SpanKind;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import redis.clients.authentication.entraid.EntraIDTokenAuthConfigBuilder;

public final class LettuceInventoryCache implements OwnedInventoryCache {
    static final String PREFIX = "contoso:corr:poc:inventory:v1:";
    private final RedisClient client;
    private final StatefulRedisConnection<String, String> connection;
    private final AutoCloseable credentials;
    private final AutoCloseable resources;
    private final String host;
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile boolean healthy;
    private volatile DataErrorKind lastFailure;

    public static OwnedInventoryCache fromEnvironment() {
        DataInstrumentationGuard.verify();
        DataLoggingGuard.verify();
        RedisSettings settings = RedisSettings.fromEnvironment(System.getenv());
        return open(settings, IdentityHttpClients.managedIdentity(settings.clientId()));
    }

    public static OwnedInventoryCache fromEnvironment(TokenCredential credential) {
        DataInstrumentationGuard.verify();
        DataLoggingGuard.verify();
        return open(RedisSettings.fromEnvironment(System.getenv()), credential);
    }

    static TokenBasedRedisCredentialsProvider credentialsProvider(TokenCredential credential) {
        EntraIDTokenAuthConfigBuilder builder = EntraIDTokenAuthConfigBuilder.builder();
        return credentialsLifecycle(builder, () -> {
            builder.customEntraIdAuthenticationSupplier(new RedisEntraIdAuthenticationSupplier(credential))
                .scopes(Set.of(RedisEntraIdAuthenticationSupplier.SCOPE))
                .expirationRefreshRatio(0.25f).lowerRefreshBoundMillis(1_000)
                .maxAttemptsToRetry(3).delayInMsToRetry(1_000).tokenRequestExecTimeoutInMs(3_000);
            return TokenBasedRedisCredentialsProvider.create(builder.build());
        });
    }

    static <T extends AutoCloseable> T credentialsLifecycle(AutoCloseable builder, Supplier<T> construction) {
        java.util.Objects.requireNonNull(builder);
        java.util.Objects.requireNonNull(construction);
        T provider = null;
        try (builder) {
            provider = java.util.Objects.requireNonNull(construction.get());
            return provider;
        } catch (Exception failure) {
            if (provider != null) {
                try {
                    provider.close();
                } catch (Exception cleanupFailure) {
                    throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
                }
            }
            if (failure instanceof DataAccessException safe) throw safe;
            DataErrorKind kind = com.contoso.correlation.data.DataErrors.classify(failure);
            throw new DataAccessException(kind == DataErrorKind.TIMEOUT || kind == DataErrorKind.CANCELLED
                ? kind : DataErrorKind.AUTHENTICATION, false);
        }
    }

    private static OwnedInventoryCache open(RedisSettings settings, TokenCredential credential) {
        TokenBasedRedisCredentialsProvider provider = null;
        DefaultClientResources resources = null;
        RedisClient client = null;
        try {
            provider = credentialsProvider(credential);
            var initial = provider.resolveCredentials().block(Duration.ofSeconds(3));
            if (initial == null || !settings.principalObjectId().equals(initial.getUsername())) {
                throw new DataAccessException(DataErrorKind.AUTHENTICATION, false);
            }
            resources = DefaultClientResources.builder().ioThreadPoolSize(2).computationThreadPoolSize(2).build();
            RedisURI uri = RedisURI.builder().withHost(settings.host()).withPort(10000)
                .withSsl(true).withVerifyPeer(SslVerifyMode.FULL).withAuthentication(provider)
                .withTimeout(Duration.ofSeconds(1)).build();
            client = RedisClient.create(resources, uri);
            client.setOptions(options());
            var connection = client.connect();
            DefaultClientResources ownedResources = resources;
            return new LettuceInventoryCache(settings.host(), client, connection, provider,
                () -> ownedResources.shutdown(0, 2, TimeUnit.SECONDS).get(3, TimeUnit.SECONDS));
        } catch (Exception failure) {
            if (client != null) try { client.shutdown(Duration.ZERO, Duration.ofSeconds(2)); } catch (RuntimeException ignored) {}
            if (provider != null) try { provider.close(); } catch (RuntimeException ignored) {}
            if (resources != null) resources.shutdown(0, 2, TimeUnit.SECONDS);
            throw new DataAccessException(DataErrorKind.AUTHENTICATION, false);
        }
    }

    static ClientOptions options() {
        return ClientOptions.builder()
            .reauthenticateBehavior(ClientOptions.ReauthenticateBehavior.ON_NEW_CREDENTIALS)
            .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
            .requestQueueSize(64).replayFilter(command -> false)
            .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofSeconds(3)).keepAlive(true).build())
            .timeoutOptions(TimeoutOptions.enabled(Duration.ofSeconds(1))).build();
    }

    LettuceInventoryCache(String host, RedisClient client, StatefulRedisConnection<String, String> connection,
                          AutoCloseable credentials, AutoCloseable resources) {
        this.host = host;
        this.client = client;
        this.connection = connection;
        this.credentials = credentials;
        this.resources = resources;
        healthy = true;
        lastFailure = null;
    }

    @Override public Optional<Value> get(String sku, OperationContext context) {
        DataValidation.sku(sku);
        return call("GET", context, span -> {
            String value = await(connection.async().get(key(sku)), context);
            if (value == null) {
                span.attribute("contoso.cache.outcome", "MISS");
                return Optional.empty();
            }
            if (!value.matches("[0-9]{1,9}:[0-9]{1,18}")) {
                throw new DataAccessException(DataErrorKind.INTERNAL, false);
            }
            String[] fields = value.split(":");
            Value parsed = new Value(Integer.parseInt(fields[0]), Long.parseLong(fields[1]));
            span.attribute("contoso.cache.outcome", "HIT");
            return Optional.of(parsed);
        });
    }

    @Override public void put(String sku, Value value, OperationContext context) {
        DataValidation.sku(sku);
        call("SET", context, span -> {
            await(connection.async().setex(key(sku), 60, value.available() + ":" + value.revision()), context);
            return null;
        });
    }

    @Override public void invalidate(String sku, OperationContext context) {
        DataValidation.sku(sku);
        call("DEL", context, span -> {
            await(connection.async().del(key(sku)), context);
            return null;
        });
    }

    private <T> T call(String operation, OperationContext context, CacheWork<T> work) {
        if (closed.get() || context == null) throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
        PgOperations.remainingMillis(context);
        try (CorrelationSpan span = Correlation.start("contoso.redis." + operation.toLowerCase(java.util.Locale.ROOT),
                SpanKind.CLIENT, context.parentContext(), context.invocationId(),
                Map.of("db.system", "redis", "db.name", "default", "db.operation.name", operation,
                    "server.address", host, "server.port", "10000", "contoso.data.operation", operation));
             var current = span.makeCurrent()) {
            try {
                T result = work.run(span);
                healthy = true;
                return result;
            } catch (RuntimeException failure) {
                healthy = false;
                DataErrorKind kind = redisKind(failure);
                lastFailure = kind;
                span.failure(kind.name());
                throw new DataAccessException(kind, !operation.equals("GET"));
            }
        }
    }

    private static <T> T await(RedisFuture<T> future, OperationContext context) {
        try { return future.get(Math.min(1_000, PgOperations.remainingMillis(context)), TimeUnit.MILLISECONDS); }
        catch (TimeoutException failure) {
            future.cancel(true);
            throw new DataAccessException(DataErrorKind.TIMEOUT, true);
        } catch (InterruptedException failure) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new DataAccessException(DataErrorKind.CANCELLED, true);
        } catch (ExecutionException failure) {
            throw new DataAccessException(redisKind(failure.getCause()), true);
        }
    }

    static DataErrorKind redisKind(Throwable failure) {
        if (failure instanceof DataAccessException safe) return safe.kind();
        if (failure instanceof RedisCommandTimeoutException || failure instanceof TimeoutException) return DataErrorKind.TIMEOUT;
        if (failure instanceof RedisConnectionException) return DataErrorKind.DNS_OR_CONNECTIVITY;
        String message = failure == null ? null : failure.getMessage();
        if (message != null) {
            if (message.startsWith("NOAUTH") || message.startsWith("WRONGPASS")) return DataErrorKind.AUTHENTICATION;
            if (message.startsWith("NOPERM")) return DataErrorKind.AUTHORIZATION;
            if (message.startsWith("OOM")) return DataErrorKind.RESOURCE_EXHAUSTED;
            if (message.startsWith("LOADING") || message.startsWith("TRYAGAIN") || message.startsWith("CLUSTERDOWN")) {
                return DataErrorKind.UNAVAILABLE;
            }
        }
        return DataErrorKind.INTERNAL;
    }

    static String key(String sku) { return PREFIX + DataValidation.sku(sku); }

    @Override public boolean isReady() {
        if (closed.get() || !connection.isOpen()) return false;
        if (lastFailure == DataErrorKind.AUTHENTICATION || lastFailure == DataErrorKind.AUTHORIZATION ||
            lastFailure == DataErrorKind.TLS) return false;
        try { return healthy = "PONG".equals(connection.async().ping().get(1, TimeUnit.SECONDS)); }
        catch (Exception failure) { healthy = false; return false; }
    }

    @Override public void close() {
        if (closed.compareAndSet(false, true)) {
            boolean failed = false;
            try { connection.close(); }
            catch (RuntimeException failure) { failed = true; }
            finally {
                try { client.shutdown(Duration.ZERO, Duration.ofSeconds(2)); }
                catch (RuntimeException failure) { failed = true; }
                finally {
                    try { credentials.close(); } catch (Exception ignored) {}
                    try { resources.close(); } catch (Exception ignored) {}
                }
            }
            if (failed) throw new DataAccessException(DataErrorKind.UNAVAILABLE, false);
        }
    }

    @Override public String toString() { return "LettuceInventoryCache[redacted]"; }
    @FunctionalInterface private interface CacheWork<T> { T run(CorrelationSpan span); }
}
