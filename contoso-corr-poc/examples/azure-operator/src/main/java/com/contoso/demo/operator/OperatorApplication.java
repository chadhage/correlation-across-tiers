package com.contoso.demo.operator;

import com.contoso.inventory.data.EntraPgConnectionFactory;
import com.contoso.inventory.data.LettuceInventoryCache;
import com.contoso.inventory.data.RestorableInventoryCache;
import com.contoso.messaging.MessagingSettings;
import com.contoso.security.EntraJwtVerifier;
import com.contoso.security.IdentityHttpClients;
import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class OperatorApplication {
    private OperatorApplication() {}

    public static void main(String[] args) throws IOException {
        if (args.length > 1) throw OperatorFailure.invalid();
        String mode = args.length == 1 ? args[0] : System.getenv().getOrDefault("CONTOSO_OPERATOR_MODE", "operator");
        var credential = IdentityHttpClients.managedIdentity(System.getenv("AZURE_CLIENT_ID"));
        var database = EntraPgConnectionFactory.fromEnvironment(
            mode.equals("inventory-fixture") ? "contoso-inventory-api" : "contoso-demo-operator", credential);
        int port;
        try {
            port = Integer.parseInt(System.getenv().getOrDefault("SERVER_PORT", System.getenv().getOrDefault("PORT", "8080")));
            if (port < 1 || port > 65535) throw new NumberFormatException();
        } catch (NumberFormatException failure) { throw new IllegalStateException("OPERATOR_PORT_INVALID"); }
        if (mode.equals("inventory-fixture")) {
            InventoryFaultFixture.start(database, port); return;
        }
        if (mode.equals("--approved-migrate")) {
            try { new OperatorRunStore(database, null, OperatorConfig.required(System.getenv(), "CONTOSO_PG_RESOURCE_ID")).migrate(); }
            finally { database.close(); }
            return;
        }
        var cache = (RestorableInventoryCache) LettuceInventoryCache.fromEnvironment(credential);
        var store = new OperatorRunStore(database, cache, OperatorConfig.required(System.getenv(), "CONTOSO_PG_RESOURCE_ID"));
        if (!List.of("operator", "watchdog").contains(mode)) throw OperatorFailure.invalid();
        var config = OperatorConfig.fromEnvironment(System.getenv());
        var jwt = EntraJwtVerifier.forTenant(config.tenantId());
        var resources = new AzureResources(config, credential, store);
        var brokers = new AzureBrokerExamples(MessagingSettings.fromEnvironment(), credential, store);
        var executor = new ThreadPoolExecutor(4, 8, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32),
            new ThreadPoolExecutor.AbortPolicy());
        var server = HttpServer.create(new InetSocketAddress(port), 32);
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath();
                if (exchange.getRequestURI().getRawQuery() != null || exchange.getRequestURI().getRawFragment() != null) {
                    throw OperatorFailure.invalid();
                }
                if (path.equals("/health/live") && exchange.getRequestMethod().equals("GET")) {
                    reply(exchange, 200, Map.of("live", true, "certified", false)); return;
                }
                if (path.equals("/health/ready") && exchange.getRequestMethod().equals("GET")) {
                    store.checkReady();
                    reply(exchange, cache.isReady() ? 200 : 503, Map.of("ready", cache.isReady(), "certified", false)); return;
                }
                if (mode.equals("watchdog")) { reply(exchange, 404, Map.of("code", "NOT_FOUND")); return; }
                if (exchange.getRequestHeaders().getOrDefault("Authorization", List.of()).size() != 1) {
                    throw new SecurityException("CONTROLLER_REJECTED");
                }
                jwt.requireController(exchange.getRequestHeaders().getFirst("Authorization"), config.audience(), config.controller());
                if (!exchange.getRequestMethod().equals("POST") ||
                    !"application/json".equals(exchange.getRequestHeaders().getFirst("Content-Type"))) throw OperatorFailure.invalid();
                JsonNode request = OperatorJson.read(exchange.getRequestBody().readNBytes(65537));
                if (path.equals("/describe")) {
                    OperatorJson.fields(request);
                    reply(exchange, 200, Map.of("gatewayUrl", config.gateway().toString(), "workspaceId", config.workspaceId(),
                        "resourceId", config.appInsightsResourceId(), "startsAtUtc", config.startsAt().toString(),
                        "expiresAtUtc", config.expiresAt().toString(), "approvalReference", config.approvalReference(),
                        "certificationStatus", "NOT CERTIFIED")); return;
                }
                if (path.equals("/runs")) {
                    config.requireActive(Instant.now());
                    OperatorJson.fields(request, "demoId");
                    if (!request.path("demoId").isIntegralNumber() || !request.path("demoId").canConvertToInt()) throw OperatorFailure.invalid();
                    var run = store.prepare(request.path("demoId").intValue(), config.expiresAt());
                    try { store.seed(run.runId()); }
                    catch (RuntimeException failure) {
                        System.err.println("OPERATOR_PREPARATION_FAILED");
                        reply(exchange, 409, Map.of("code", "OPERATOR_PREPARATION_INCOMPLETE", "runId", run.runId().toString(),
                            "certificationStatus", "NOT CERTIFIED")); return;
                    }
                    reply(exchange, 201, Map.of("runId", run.runId().toString(), "startsAtUtc", run.startsAt(),
                        "expiresAtUtc", run.expiresAt(), "baselineSha256", OperatorJson.hash(run.baseline()),
                        "certificationStatus", "NOT CERTIFIED")); return;
                }
                if (!path.matches("/runs/[0-9a-f-]{36}/[a-z-]+")) throw OperatorFailure.invalid();
                String[] parts = path.split("/");
                UUID id = UUID.fromString(parts[2]);
                String action = parts[3];
                if (!List.of("reset", "stop", "observations", "query", "metrics", "rejections").contains(action)) {
                    config.requireActive(Instant.now()); store.active(id);
                }
                Object result = switch (action) {
                    case "allocate" -> {
                        OperatorJson.fields(request, "type");
                        yield Map.of("workflowId", store.allocate(id, OperatorJson.text(request, "type")).toString());
                    }
                    case "attach" -> {
                        OperatorJson.fields(request, "workflowId");
                        store.attach(id, UUID.fromString(OperatorJson.text(request, "workflowId")));
                        yield Map.of("attached", true);
                    }
                    case "gateway" -> {
                        OperatorJson.fields(request, "method", "route", "body", "headers");
                        var headers = new LinkedHashMap<String, String>();
                        JsonNode raw = request.path("headers");
                        if (!raw.isObject()) throw OperatorFailure.invalid();
                        raw.fields().forEachRemaining(entry -> {
                            if (!entry.getValue().isTextual()) throw OperatorFailure.invalid();
                            headers.put(entry.getKey(), entry.getValue().textValue());
                        });
                        yield resources.gateway(id, OperatorJson.text(request, "method"), OperatorJson.text(request, "route"),
                            request.get("body"), headers);
                    }
                    case "fault" -> {
                        OperatorJson.fields(request, "mode"); store.fault(id, OperatorJson.text(request, "mode"));
                        yield Map.of("configured", OperatorJson.text(request, "mode"), "effectObserved", false);
                    }
                    case "redeliver" -> {
                        OperatorJson.fields(request, "destination"); brokers.redeliver(id, OperatorJson.text(request, "destination"));
                        yield Map.of("sent", true, "consumerEffectObserved", false);
                    }
                    case "inject" -> {
                        OperatorJson.fields(request, "kind");
                        yield Map.of("messageId", brokers.inject(id, OperatorJson.text(request, "kind")).toString());
                    }
                    case "rejections" -> { OperatorJson.fields(request); yield brokers.rejected(id); }
                    case "observations" -> {
                        OperatorJson.fields(request);
                        yield Map.of("workflows", store.rows(id, "workflows"), "attempts", store.rows(id, "attempts"),
                            "publications", store.rows(id, "publications"), "contributors", store.rows(id, "contributors"),
                            "events", store.rows(id, "events"), "drained", store.drained(id),
                            "independentFullEmissionLedger", false, "certificationStatus", "NOT CERTIFIED");
                    }
                    case "query" -> resources.query(id, request);
                    case "metrics" -> {
                        OperatorJson.fields(request, "fromUtc", "toUtc");
                        yield resources.metrics(id, OperatorJson.text(request, "fromUtc"), OperatorJson.text(request, "toUtc"));
                    }
                    case "sampling-on" -> { OperatorJson.fields(request); yield resources.sampling(id); }
                    case "sampling-off" -> {
                        OperatorJson.fields(request); resources.restoreSampling(id);
                        yield Map.of("configurationRestored", true, "nativeFidelityVerified", false);
                    }
                    case "stop" -> { OperatorJson.fields(request); store.stop(id); yield Map.of("admissionStopped", true, "drained", store.drained(id)); }
                    case "reset" -> {
                        OperatorJson.fields(request);
                        if (!store.get(id).phase().equals("RESTORED")) {
                            store.stop(id); resources.restoreSampling(id); brokers.drainInjected(id);
                        }
                        yield store.reset(id);
                    }
                    default -> throw OperatorFailure.invalid();
                };
                reply(exchange, 200, result);
            } catch (SecurityException failure) {
                safeReply(exchange, 401, "CONTROLLER_REJECTED");
            } catch (OperatorFailure failure) {
                safeReply(exchange, failure.status, failure.getMessage());
            } catch (IllegalArgumentException failure) {
                safeReply(exchange, 400, "OPERATOR_INPUT_INVALID");
            } catch (RuntimeException failure) {
                System.err.println("OPERATOR_DEPENDENCY_FAILED");
                safeReply(exchange, 503, "OPERATOR_DEPENDENCY_FAILED");
            } finally { exchange.close(); }
        });
        var watchdog = new ScheduledThreadPoolExecutor(1);
        watchdog.setRemoveOnCancelPolicy(true);
        watchdog.scheduleWithFixedDelay(() -> {
            try {
                for (UUID id : store.expired()) {
                    store.stop(id); resources.restoreSampling(id); brokers.drainInjected(id); store.reset(id);
                }
            } catch (RuntimeException failure) { System.err.println("OPERATOR_RECOVERY_PENDING"); }
        }, 0, 5, TimeUnit.SECONDS);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(2); watchdog.shutdownNow(); executor.shutdownNow(); brokers.close();
            cache.close(); database.close(); jwt.close();
        }));
        server.start();
    }

    static void reply(HttpExchange exchange, int status, Object value) throws IOException {
        byte[] bytes = OperatorJson.write(value).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
    static void safeReply(HttpExchange exchange, int status, String code) {
        try { reply(exchange, status, Map.of("schemaVersion", 1, "code", code, "certificationStatus", "NOT CERTIFIED")); }
        catch (IOException failure) { System.err.println("OPERATOR_RESPONSE_NOT_DELIVERED"); }
    }
}
