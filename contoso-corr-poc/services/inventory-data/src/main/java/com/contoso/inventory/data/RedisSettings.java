package com.contoso.inventory.data;

import com.contoso.correlation.data.DataValidation;
import java.util.Map;

public record RedisSettings(String host, String principalObjectId, String clientId) {
    public RedisSettings {
        if (host == null || !host.matches("[A-Za-z0-9.-]{1,253}")) {
            throw new IllegalArgumentException("invalid_redis_configuration");
        }
        DataValidation.id(principalObjectId);
        if (clientId != null) DataValidation.id(clientId.toLowerCase(java.util.Locale.ROOT));
    }

    static RedisSettings fromEnvironment(Map<String, String> environment) {
        RedisSettings settings = new RedisSettings(environment.get("CONTOSO_REDIS_HOST"),
            environment.get("CONTOSO_REDIS_PRINCIPAL_ID"), environment.get("AZURE_CLIENT_ID"));
        if (!settings.host().startsWith("contoso-") || !settings.host().endsWith(".redis.azure.net")) {
            throw new IllegalArgumentException("unapproved_managed_redis_target");
        }
        return settings;
    }

    @Override public String toString() { return "RedisSettings[redacted]"; }
}
