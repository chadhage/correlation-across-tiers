package com.contoso.demo.operator;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import com.contoso.inventory.data.LettuceInventoryCache;
import com.contoso.inventory.data.RedisSettings;
import com.contoso.security.IdentityHttpClients;
import com.azure.core.credential.TokenRequestContext;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.ScriptOutputType;
import io.lettuce.core.SslVerifyMode;
import io.lettuce.core.resource.DefaultClientResources;
import io.opentelemetry.api.trace.SpanKind;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.TimeUnit;

final class AzureDataCanaries {
    private AzureDataCanaries() {}
    static void execute(PgConnectionFactory database, OperationContext context) {
        boolean sql = PgOperations.execute(database, PgOperation.SELECT, context, 1, connection -> {
            try (var query = connection.prepareStatement("SELECT 'SQL_LITERAL_CANARY',CAST(? AS VARCHAR(64))")) {
                query.setString(1, "SQL_PARAMETER_CANARY");
                try (var rows = query.executeQuery()) {
                    return rows.next() && "SQL_LITERAL_CANARY".equals(rows.getString(1)) &&
                        "SQL_PARAMETER_CANARY".equals(rows.getString(2));
                }
            }
        });
        if (!sql) throw new OperatorFailure(503, "DATA_CANARY_SQL_NOT_EXECUTED");
        var credential = IdentityHttpClients.managedIdentity(System.getenv("AZURE_CLIENT_ID"));
        try (var cache = LettuceInventoryCache.fromEnvironment(credential)) {
            cache.get("REDIS_KEY_CANARY", context);
        }
        var settings = RedisSettings.fromEnvironment(System.getenv());
        var token = credential.getToken(new TokenRequestContext().addScopes("https://redis.azure.com/.default"))
            .block(Duration.ofSeconds(3));
        if (token == null) throw new OperatorFailure(503, "DATA_CANARY_REDIS_TOKEN_UNAVAILABLE");
        char[] password = token.getToken().toCharArray();
        var resources = DefaultClientResources.builder().ioThreadPoolSize(2).computationThreadPoolSize(2).build();
        RedisClient redis = null;
        try {
            var uri = RedisURI.builder().withHost(settings.host()).withPort(10000).withSsl(true)
                .withVerifyPeer(SslVerifyMode.FULL).withAuthentication(settings.principalObjectId(), password)
                .withTimeout(Duration.ofSeconds(2)).build();
            redis = RedisClient.create(resources, uri);
            try (var connection = redis.connect()) {
                for (String operation : java.util.List.of("ECHO", "EVAL")) {
                    try (var span = Correlation.start("contoso.redis." + operation.toLowerCase(java.util.Locale.ROOT),
                            SpanKind.CLIENT, context.parentContext(), context.invocationId(),
                            Map.of("db.system", "redis", "db.name", "default", "db.operation.name", operation,
                                "server.address", settings.host(), "server.port", "10000"));
                         var scope = span.makeCurrent()) {
                        Object result = operation.equals("ECHO")
                            ? connection.async().echo("REDIS_VALUE_SCRIPT_ARGUMENT_CANARY").get(2, TimeUnit.SECONDS)
                            : connection.async().eval("return ARGV[1]", ScriptOutputType.VALUE, new String[0],
                                "REDIS_VALUE_SCRIPT_ARGUMENT_CANARY").get(2, TimeUnit.SECONDS);
                        if (!"REDIS_VALUE_SCRIPT_ARGUMENT_CANARY".equals(result)) throw new OperatorFailure(503, "DATA_CANARY_REDIS_NOT_EXECUTED");
                    }
                }
            }
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt(); throw new OperatorFailure(503, "DATA_CANARY_INTERRUPTED");
        } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException failure) {
            throw new OperatorFailure(503, "DATA_CANARY_REDIS_UNAVAILABLE");
        } finally {
            Arrays.fill(password, '\0');
            if (redis != null) redis.shutdown(Duration.ZERO, Duration.ofSeconds(2));
            resources.shutdown(0, 2, TimeUnit.SECONDS);
        }
    }
}
