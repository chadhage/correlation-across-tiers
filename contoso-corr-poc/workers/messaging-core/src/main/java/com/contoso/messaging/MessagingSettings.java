package com.contoso.messaging;

import com.azure.core.credential.TokenCredential;
import com.azure.core.util.ClientOptions;
import com.azure.core.util.TracingOptions;
import com.contoso.security.IdentityHttpClients;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record MessagingSettings(String serviceBusNamespace, String eventGridEndpoint,
                                String eventHubsNamespace, String queueEndpoint, String managedIdentityClientId,
                                String ordersPublisher, String fulfillmentPublisher, String notifyPublisher,
                                String aggregatorPublisher, int maxLinks, int batchSize) {
    public MessagingSettings {
        namespace(serviceBusNamespace); namespace(eventHubsNamespace);
        endpoint(eventGridEndpoint, ".eventgrid.azure.net", "/api/events");
        endpoint(queueEndpoint, ".queue.core.windows.net", "");
        for (String role : new String[]{ordersPublisher, fulfillmentPublisher, notifyPublisher, aggregatorPublisher}) {
            if (role == null || !role.matches("[A-Za-z][A-Za-z0-9_-]{0,62}")) invalid();
        }
        if (managedIdentityClientId != null && !managedIdentityClientId.isBlank()) {
            try {
                if (!UUID.fromString(managedIdentityClientId).toString().equals(managedIdentityClientId)) invalid();
            } catch (IllegalArgumentException ignored) { invalid(); }
        }
        if (maxLinks < 2 || maxLinks > 32 || batchSize < 2 || batchSize > maxLinks) invalid();
    }

    public static MessagingSettings fromEnvironment() { return from(System.getenv()); }
    public static MessagingSettings from(Map<String, String> env) {
        try {
            return new MessagingSettings(env.get("CONTOSO_SERVICE_BUS_NAMESPACE"), env.get("CONTOSO_EVENT_GRID_ENDPOINT"),
                env.get("CONTOSO_EVENT_HUBS_NAMESPACE"), env.get("CONTOSO_STORAGE_QUEUE_ENDPOINT"), env.get("AZURE_CLIENT_ID"),
                env.get("CONTOSO_DB_ROLE_ORDERS"), env.get("CONTOSO_DB_ROLE_FULFILLMENT"), env.get("CONTOSO_DB_ROLE_NOTIFY"),
                env.get("CONTOSO_DB_ROLE_AGGREGATOR"), Integer.parseInt(env.getOrDefault("CONTOSO_MESSAGING_MAX_LINKS", "32")),
                Integer.parseInt(env.getOrDefault("CONTOSO_MESSAGING_BATCH_SIZE", "16")));
        } catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.INVALID_CONFIGURATION); }
    }

    public TokenCredential credential() {
        return IdentityHttpClients.managedIdentity(managedIdentityClientId);
    }

    public Set<String> publishers(Destination destination, boolean replay) {
        return switch (destination) {
            case SERVICE_BUS_RESULT -> Set.of(fulfillmentPublisher, notifyPublisher);
            case SERVICE_BUS_ORDER, SERVICE_BUS_TOPIC, STORAGE_QUEUE ->
                replay ? Set.copyOf(java.util.List.of(ordersPublisher, fulfillmentPublisher, notifyPublisher)) : Set.of(ordersPublisher);
            case EVENT_GRID, EVENT_HUBS -> Set.of(ordersPublisher);
        };
    }
    public Map<Branch, String> contributorPublishers() {
        return Map.of(Branch.FULFILLMENT, fulfillmentPublisher, Branch.NOTIFY, notifyPublisher);
    }
    public static ClientOptions noTracing() {
        return new ClientOptions().setTracingOptions(new TracingOptions().setEnabled(false));
    }

    private static void namespace(String value) {
        if (value == null || !value.matches("[a-z0-9][a-z0-9-]{4,48}\\.servicebus\\.windows\\.net")) invalid();
    }
    private static void endpoint(String value, String suffix, String path) {
        try {
            URI uri = URI.create(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !uri.getHost().endsWith(suffix) ||
                uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                uri.getPort() != -1 || !path.equals(uri.getPath())) invalid();
        } catch (RuntimeException ignored) { invalid(); }
    }
    private static void invalid() { throw new MessagingFailure(MessagingFailure.Code.INVALID_CONFIGURATION); }
    @Override public String toString() { return "MessagingSettings[redacted]"; }
}
