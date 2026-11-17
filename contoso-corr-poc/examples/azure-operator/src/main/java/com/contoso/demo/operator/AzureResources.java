package com.contoso.demo.operator;

import com.azure.core.credential.TokenCredential;
import com.azure.core.credential.TokenRequestContext;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class AzureResources {
    static final List<String> TABLES = List.of("AppRequests", "AppDependencies", "AppTraces", "AppExceptions", "AppEvents", "AppPageViews");
    record Response(int status, JsonNode body, String invocationId, String etag, double durationMs) {}
    private final OperatorConfig config;
    private final TokenCredential credential;
    private final OperatorRunStore store;
    private final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(3)).build();

    AzureResources(OperatorConfig config, TokenCredential credential, OperatorRunStore store) {
        this.config = config; this.credential = credential; this.store = store;
    }

    Response gateway(UUID runId, String method, String route, JsonNode body, Map<String, String> carrier) {
        store.active(runId);
        if (!List.of("GET", "POST").contains(method) ||
            !route.matches("/(?:me|orders(?:/[0-9a-f-]{36})?|demo-runs(?:/[0-9a-f-]{36}(?:/controls)?)?)")) {
            throw OperatorFailure.invalid();
        }
        if (route.matches("/(?:orders|demo-runs)/.*")) {
            store.requireOwned(runId, UUID.fromString(route.split("/")[2]));
        }
        if (body != null && !body.isNull() && (route.equals("/orders") || route.equals("/demo-runs"))) {
            store.requireOwned(runId, UUID.fromString(OperatorJson.text(body, route.equals("/orders") ? "orderId" : "runId")));
        }
        for (var entry : carrier.entrySet()) {
            if (!List.of("traceparent", "tracestate", "x-business-invocation-id").contains(entry.getKey()) ||
                entry.getValue() == null || entry.getValue().length() > 512 || entry.getValue().chars().anyMatch(c -> c < 32 || c == 127)) {
                throw OperatorFailure.invalid();
            }
        }
        UUID operation = store.beginGateway(runId);
        try {
        var response = send(config.gateway().toString() + route, method, config.ordersResource() + "/.default", body, carrier);
        String invocation = response.invocationId;
        if (invocation != null) {
            try { InvocationCheck.require(invocation); }
            catch (IllegalArgumentException failure) { throw new OperatorFailure(502, "GATEWAY_INVOCATION_INVALID"); }
        }
        if (response.status >= 200 && response.status < 300 && body != null &&
            (route.equals("/orders") || route.equals("/demo-runs"))) {
            store.attach(runId, UUID.fromString(OperatorJson.text(body, route.equals("/orders") ? "orderId" : "runId")));
        }
        var safe = OperatorJson.MAPPER.createObjectNode();
        if (response.body.isObject()) {
            for (String name : List.of("id", "businessInvocationId", "workflowBusinessInvocationId")) {
                if (response.body.has(name)) {
                    String value = response.body.path(name).asText(); InvocationCheck.require(value); safe.put(name, value);
                }
            }
            for (String name : List.of("state", "code", "errorCode")) {
                if (response.body.has(name)) {
                    String value = response.body.path(name).asText();
                    if (!value.matches("[A-Z][A-Z0-9_]{0,63}")) throw new OperatorFailure(502, "GATEWAY_RESPONSE_UNCLASSIFIED");
                    safe.put(name, value);
                }
            }
            if (response.body.has("actorType")) {
                String actor = response.body.path("actorType").asText();
                if (!List.of("user", "workload").contains(actor)) throw new OperatorFailure(502, "GATEWAY_RESPONSE_UNCLASSIFIED");
                safe.put("actorType", actor);
            }
        } else if (response.status >= 200 && response.status < 300) {
            throw new OperatorFailure(502, "GATEWAY_RESPONSE_INVALID");
        }
        return new Response(response.status, safe, response.invocationId, null, response.durationMs);
        } finally { store.finishGateway(runId, operation); }
    }

    JsonNode query(UUID id, JsonNode request) {
        var run = store.get(id);
        OperatorJson.fields(request, "table", "phase", "fromUtc", "toUtc", "watermarkUtc", "page", "pageSize", "invocationId");
        String table = OperatorJson.text(request, "table"), phase = OperatorJson.text(request, "phase");
        if (!TABLES.contains(table) || !List.of("schema", "count", "page", "business", "orphans", "billing").contains(phase)) {
            throw OperatorFailure.invalid();
        }
        Instant from = Instant.parse(OperatorJson.text(request, "fromUtc")), to = Instant.parse(OperatorJson.text(request, "toUtc"));
        Instant watermark = Instant.parse(OperatorJson.text(request, "watermarkUtc"));
        if (from.isBefore(Instant.parse(run.startsAt()).minusSeconds(10)) || !to.isAfter(from) ||
            to.isAfter(Instant.parse(run.expiresAt())) || watermark.isAfter(Instant.now()) || watermark.isBefore(to)) {
            throw OperatorFailure.invalid();
        }
        String window = table + " | where TimeGenerated >= datetime(" + from + ") and TimeGenerated < datetime(" + to + ")" +
            " | where _ResourceId =~ " + OperatorJson.write(config.appInsightsResourceId()) +
            " | extend ContosoObservedIngestedAt=ingestion_time()";
        String source = window + " | where isnotnull(ContosoObservedIngestedAt)" +
            " and ContosoObservedIngestedAt<=datetime(" + watermark + ")";
        String query = switch (phase) {
            case "schema" -> table + " | getschema | project ColumnName,ColumnType";
            case "count" -> window + " | summarize Copies=countif(isnotnull(ContosoObservedIngestedAt) and " +
                "ContosoObservedIngestedAt<=datetime(" + watermark + ")),Unknown=countif(isnull(ContosoObservedIngestedAt))," +
                "Beyond=countif(ContosoObservedIngestedAt>datetime(" + watermark + ")) by ObservedKey=tostring(column_ifexists('_ItemId',''))" +
                " | summarize Rows=sum(Copies),DistinctKeys=countif(Copies>0),EmptyKeys=countif(isempty(ObservedKey) and Copies>0)," +
                "DuplicateRows=sumif(Copies-1,Copies>0),UnwatermarkedRows=sum(Unknown),RowsBeyondWatermark=sum(Beyond)";
            case "billing" -> source + " | summarize BillableBytes=sumif(_BilledSize,_IsBillable =~ 'true')";
            case "business" -> {
                String invocation = OperatorJson.text(request, "invocationId"); InvocationCheck.require(invocation);
                boolean owned = store.rows(id, "workflows").stream().anyMatch(row -> invocation.equals(row.get("invocation_id")));
                if (!owned) throw OperatorFailure.conflict();
                yield source + " | where tostring(Properties['business.invocation_id']) == " +
                    OperatorJson.write(invocation) + " | summarize Rows=count() by OperationId";
            }
            case "orphans" -> {
                String both = "(union AppRequests,AppDependencies) | where TimeGenerated >= datetime(" + from +
                    ") and TimeGenerated < datetime(" + to + ") | where _ResourceId =~ " +
                    OperatorJson.write(config.appInsightsResourceId()) + " | where isnotnull(ingestion_time()) and " +
                    "ingestion_time()<=datetime(" + watermark + ") | project OperationId,Id,ParentId,AppRoleName";
                yield "let observed=(" + both + "); observed | where isnotempty(ParentId) | join kind=leftanti " +
                    "(observed | project OperationId,ParentId=Id) on OperationId,ParentId | take 2049";
            }
            case "page" -> {
                if (!request.path("page").isIntegralNumber() || !request.path("page").canConvertToInt() ||
                    !request.path("pageSize").isIntegralNumber() || !request.path("pageSize").canConvertToInt()) throw OperatorFailure.invalid();
                int page = request.path("page").asInt(-1), size = request.path("pageSize").asInt(-1);
                if (page < 0 || page >= 200 || size < 1 || size > 5000) throw OperatorFailure.invalid();
                yield source + " | extend ContosoObservedKey=tostring(column_ifexists('_ItemId',''))" +
                    " | order by ContosoObservedKey asc,TimeGenerated asc,ContosoObservedIngestedAt asc | serialize ContosoObservedOrdinal=row_number()" +
                    " | where ContosoObservedOrdinal>" + page * size + " and ContosoObservedOrdinal<=" + (page + 1) * size;
            }
            default -> throw OperatorFailure.invalid();
        };
        Response response = send("https://api.loganalytics.azure.com/v1/workspaces/" + config.workspaceId() + "/query",
            "POST", "https://api.loganalytics.io/.default", OperatorJson.MAPPER.valueToTree(Map.of("query", query)), Map.of());
        if (response.status != 200 || response.body.has("error") || response.body.has("warnings") &&
            !response.body.path("warnings").isEmpty()) throw new OperatorFailure(502, "AZURE_LOG_QUERY_INCOMPLETE");
        return response.body;
    }

    JsonNode metrics(UUID id, String from, String to) {
        var run = store.get(id);
        Instant first = Instant.parse(from), last = Instant.parse(to);
        if (first.isBefore(Instant.parse(run.startsAt())) || !last.isAfter(first) ||
            last.isAfter(Instant.now()) || last.isAfter(Instant.parse(run.expiresAt()))) throw OperatorFailure.invalid();
        String url = "https://management.azure.com" + config.computePlanResourceId() +
            "/providers/microsoft.insights/metrics?api-version=2023-10-01&metricnames=CpuPercentage,MemoryPercentage" +
            "&aggregation=Average,Maximum&interval=PT1M&timespan=" + URLEncoder.encode(from + "/" + to, StandardCharsets.UTF_8);
        Response response = send(url, "GET", "https://management.azure.com/.default", null, Map.of());
        if (response.status != 200) throw new OperatorFailure(502, "AZURE_METRICS_UNAVAILABLE");
        return response.body;
    }

    Map<String, Object> sampling(UUID id) {
        return activateSampling(id);
    }

    private Map<String, Object> activateSampling(UUID id) {
        if (store.rows(id, "events").stream().anyMatch(row -> "APIM_BASELINE".equals(row.get("kind")))) {
            throw OperatorFailure.conflict();
        }
        Response before = diagnostic();
        var properties = before.body.path("properties");
        if (!properties.path("sampling").isObject() || !properties.path("httpCorrelationProtocol").asText().equals("W3C")) {
            throw new OperatorFailure(409, "APIM_DIAGNOSTIC_NOT_QUALIFIED");
        }
        for (String side : List.of("frontend", "backend")) for (String direction : List.of("request", "response")) {
            var capture = properties.path(side).path(direction);
            if (!capture.path("body").path("bytes").isIntegralNumber() || capture.path("body").path("bytes").intValue() != 0 ||
                !capture.path("headers").isArray()) throw new OperatorFailure(409, "APIM_CAPTURE_POLICY_UNQUALIFIED");
            for (var header : capture.path("headers")) if (!header.asText().equalsIgnoreCase("x-business-invocation-id")) {
                throw new OperatorFailure(409, "APIM_CAPTURE_POLICY_UNQUALIFIED");
            }
        }
        JsonNode baseline = properties.path("sampling").deepCopy();
        OperatorJson.fields(baseline, "samplingType", "percentage");
        if (!baseline.path("samplingType").asText().equals("fixed") || !baseline.path("percentage").isNumber() ||
            baseline.path("percentage").doubleValue() < 0 || baseline.path("percentage").doubleValue() >= 100) {
            throw new OperatorFailure(409, "APIM_SAMPLING_BASELINE_UNCLASSIFIED");
        }
        store.claimSampling(id, baseline);
        var changed = properties.deepCopy();
        var sampling = OperatorJson.MAPPER.createObjectNode().put("samplingType", "fixed").put("percentage", 100);
        ((com.fasterxml.jackson.databind.node.ObjectNode) changed).set("sampling", sampling);
        var entered = new java.util.concurrent.atomic.AtomicBoolean();
        try {
            store.withActiveControlLease(id, () -> {
                entered.set(true);
                config.requireActive(Instant.now());
                updateDiagnostic(changed, before.etag);
                if (!diagnostic().body.path("properties").path("sampling").equals(sampling)) {
                    throw new OperatorFailure(409, "APIM_SAMPLING_READBACK_FAILED");
                }
                return null;
            });
        } catch (RuntimeException failure) {
            if (!entered.get()) store.event(id, "APIM_ACTIVATION_ABORTED", Map.of("requestNotIssued", true));
            throw failure;
        }
        store.event(id, "APIM_ACTIVATED", Map.of("samplingSha256", OperatorJson.hash(sampling)));
        return Map.of("configurationPercentage", 100, "nativeFidelityVerified", false, "certificationStatus", "NOT CERTIFIED");
    }

    void restoreSampling(UUID id) {
        var baselines = store.rows(id, "events").stream().filter(row -> "APIM_BASELINE".equals(row.get("kind"))).toList();
        if (baselines.isEmpty()) return;
        if (baselines.size() != 1) throw OperatorFailure.conflict();
        var baseline = ((JsonNode) baselines.getFirst().get("facts_json")).path("sampling");
        Response current = diagnostic();
        var actual = current.body.path("properties").path("sampling");
        if (actual.equals(baseline)) {
            var events = store.rows(id, "events");
            if (events.stream().anyMatch(row -> "APIM_ACTIVATION_INTENT".equals(row.get("kind"))) &&
                events.stream().noneMatch(row -> List.of("APIM_ACTIVATED", "APIM_ACTIVATION_ABORTED", "APIM_RESTORED").contains(row.get("kind")))) {
                throw new OperatorFailure(409, "APIM_ACTIVATION_OUTCOME_UNACKNOWLEDGED");
            }
            return;
        }
        if (!actual.path("samplingType").asText().equals("fixed") || actual.path("percentage").doubleValue() != 100) {
            throw new OperatorFailure(409, "APIM_SAMPLING_OWNERSHIP_CONFLICT");
        }
        var properties = (com.fasterxml.jackson.databind.node.ObjectNode) current.body.path("properties").deepCopy();
        properties.set("sampling", baseline);
        updateDiagnostic(properties, current.etag);
        if (!diagnostic().body.path("properties").path("sampling").equals(baseline)) {
            throw new OperatorFailure(409, "APIM_RESTORE_READBACK_FAILED");
        }
        store.event(id, "APIM_RESTORED", Map.of("samplingSha256", OperatorJson.hash(baseline)));
    }

    private Response diagnostic() {
        Response result = send("https://management.azure.com" + config.apimDiagnosticResourceId() + "?api-version=2024-05-01",
            "GET", "https://management.azure.com/.default", null, Map.of());
        if (result.status != 200 || result.etag == null || !result.body.path("properties").isObject()) {
            throw new OperatorFailure(502, "APIM_DIAGNOSTIC_ETAG_REQUIRED");
        }
        return result;
    }

    private void updateDiagnostic(JsonNode properties, String etag) {
        var body = OperatorJson.MAPPER.createObjectNode().set("properties", properties);
        Response result = send("https://management.azure.com" + config.apimDiagnosticResourceId() + "?api-version=2024-05-01",
            "PUT", "https://management.azure.com/.default", body, Map.of("If-Match", etag));
        if (result.status != 200 && result.status != 201) throw new OperatorFailure(409, "APIM_DIAGNOSTIC_CAS_FAILED");
    }

    private Response send(String target, String method, String scope, JsonNode body, Map<String, String> headers) {
        URI uri = URI.create(target); OperatorConfig.https(uriWithoutQuery(uri));
        if (!(uri.getHost().equals(config.gateway().getHost()) || List.of("management.azure.com", "api.loganalytics.azure.com").contains(uri.getHost()))) {
            throw OperatorFailure.invalid();
        }
        String token;
        try {
            var access = credential.getToken(new TokenRequestContext().addScopes(scope)).block(Duration.ofSeconds(5));
            if (access == null || !access.getExpiresAt().toInstant().isAfter(Instant.now().plusSeconds(30))) {
                throw new OperatorFailure(502, "AZURE_TOKEN_UNAVAILABLE");
            }
            token = access.getToken();
        } catch (RuntimeException failure) { throw new OperatorFailure(502, "AZURE_TOKEN_UNAVAILABLE"); }
        var builder = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer " + token)
            .header("Accept", "application/json");
        headers.forEach(builder::header);
        if (body == null || body.isNull()) builder.method(method, HttpRequest.BodyPublishers.noBody());
        else builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(OperatorJson.write(body)));
        long began = System.nanoTime();
        var future = client.sendAsync(builder.build(), ignored -> new LimitedBody());
        try {
            var response = future.get(20, TimeUnit.SECONDS);
            JsonNode json = response.body().length == 0 ? OperatorJson.MAPPER.nullNode() : OperatorJson.read(response.body(), 8388608);
            return new Response(response.statusCode(), json, response.headers().firstValue("x-business-invocation-id").orElse(null),
                response.headers().firstValue("etag").orElse(null), (System.nanoTime() - began) / 1_000_000.0);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt(); future.cancel(true);
            throw new OperatorFailure(503, "AZURE_REQUEST_INTERRUPTED");
        } catch (ExecutionException | TimeoutException failure) {
            future.cancel(true); throw new OperatorFailure(504, "AZURE_REQUEST_FAILED");
        }
    }

    private static URI uriWithoutQuery(URI value) {
        if (value.getUserInfo() != null || value.getFragment() != null) throw OperatorFailure.invalid();
        return URI.create(value.getScheme() + "://" + value.getRawAuthority() + value.getRawPath());
    }

    private static final class InvocationCheck {
        static void require(String value) { com.contoso.correlation.InvocationId.parse(value); }
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody() { return result; }
        public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        public void onNext(List<ByteBuffer> buffers) {
            for (var buffer : buffers) {
                if (buffer.remaining() > 8388608 - bytes.size()) {
                    subscription.cancel(); result.completeExceptionally(new OperatorFailure(413, "AZURE_RESPONSE_TOO_LARGE")); return;
                }
                byte[] part = new byte[buffer.remaining()]; buffer.get(part); bytes.writeBytes(part);
            }
            subscription.request(1);
        }
        public void onError(Throwable failure) { result.completeExceptionally(new OperatorFailure(502, "AZURE_RESPONSE_FAILED")); }
        public void onComplete() { result.complete(bytes.toByteArray()); }
    }
}
