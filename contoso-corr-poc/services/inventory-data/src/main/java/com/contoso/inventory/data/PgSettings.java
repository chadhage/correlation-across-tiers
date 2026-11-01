package com.contoso.inventory.data;

import java.time.Duration;
import java.util.Map;

public record PgSettings(String host, String database, String roleName, String serviceName,
                         int maximumPoolSize, Duration poolWait, Duration connectTimeout,
                         Duration socketTimeout, String resourceId, String clientId) {
    public PgSettings {
        if (host == null || !host.matches("[A-Za-z0-9.-]{1,253}") ||
            database == null || !database.matches("[a-z][a-z0-9_]{0,62}") ||
            roleName == null || !roleName.matches("[A-Za-z][A-Za-z0-9_-]{0,62}") ||
            serviceName == null || !serviceName.matches("contoso-[a-z0-9-]{1,60}") ||
            maximumPoolSize < 1 || maximumPoolSize > 4 ||
            poolWait == null || poolWait.toMillis() < 250 || poolWait.toMillis() > 1_000 ||
            connectTimeout == null || connectTimeout.toMillis() < 1 || connectTimeout.toMillis() > 3_000 ||
            socketTimeout == null || socketTimeout.toMillis() < 1 || socketTimeout.toMillis() > 5_000) {
            throw new IllegalArgumentException("invalid_postgres_configuration");
        }
        if (clientId != null && !clientId.matches("[0-9a-fA-F-]{36}")) {
            throw new IllegalArgumentException("invalid_identity_configuration");
        }
    }

    public static PgSettings fromEnvironment(String serviceName) {
        return fromEnvironment(System.getenv(), serviceName);
    }

    static PgSettings fromEnvironment(Map<String, String> environment, String serviceName) {
        PgSettings settings = new PgSettings(environment.get("CONTOSO_PG_HOST"),
            environment.getOrDefault("CONTOSO_PG_DATABASE", "contoso_orders"),
            environment.get("CONTOSO_PG_USERNAME"), serviceName,
            2, Duration.ofSeconds(1), Duration.ofSeconds(3), Duration.ofSeconds(5),
            environment.get("CONTOSO_PG_RESOURCE_ID"), environment.get("AZURE_CLIENT_ID"));
        var target = new InventorySchemaHooks.Permit(settings.resourceId(), "contoso_orders", false);
        String server = target.expectedResourceId().substring(target.expectedResourceId().lastIndexOf('/') + 1);
        if (!settings.host().equalsIgnoreCase(server + ".postgres.database.azure.com") ||
            !java.util.Set.of("contoso_orders", "postgres").contains(settings.database())) {
            throw new IllegalArgumentException("unapproved_postgres_target");
        }
        return settings;
    }

    public Map<String, String> telemetryAttributes() {
        return Map.of("db.system", "postgresql", "db.name", database,
            "server.address", host, "server.port", "5432");
    }

    @Override public String toString() { return "PgSettings[redacted]"; }
}
