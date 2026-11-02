package com.contoso.correlation.sampling;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

public final class ParentSafeProbeApplication {
    private static final TextMapGetter<HttpExchange> GETTER = new TextMapGetter<>() {
        @Override public Iterable<String> keys(HttpExchange exchange) {
            return exchange.getRequestHeaders().keySet();
        }
        @Override public String get(HttpExchange exchange, String key) {
            return exchange.getRequestHeaders().getFirst(key);
        }
    };

    public static void main(String[] arguments) throws Exception {
        URI echo = URI.create(arguments[0]);
        boolean baseline = arguments.length == 2 && "baseline".equals(arguments[1]);
        if (!"http".equals(echo.getScheme()) || !"127.0.0.1".equals(echo.getHost())) {
            throw new IllegalArgumentException("Fixture echo must be loopback");
        }
        var telemetry = GlobalOpenTelemetry.get();
        var provider = telemetry.getTracerProvider();
        var tracer = provider.get("contoso.parent-safe.local-probe", "1.0.0");
        var client = HttpClient.newHttpClient();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/sampling-observation", exchange -> {
            try {
                var beans = java.lang.management.ManagementFactory.getPlatformMBeanServer();
                var name = new javax.management.ObjectName(SamplingObservation.OBJECT_NAME);
                String owned = (String) beans.getAttribute(name, "OwnedConfigurationJson");
                String body = "{\"nativeStateAvailable\":" + beans.getAttribute(name, "NativeStateAvailable") +
                    ",\"ownedConfiguration\":" + (owned == null ? "null" : owned) +
                    ",\"effectiveSamplingPercentage\":" + beans.getAttribute(name, "EffectiveSamplingPercentage") +
                    ",\"requestsPerSecond\":" + beans.getAttribute(name, "RequestsPerSecond") +
                    ",\"loadedCount\":" + beans.getAttribute(name, "LoadedCount") +
                    ",\"guardSha256\":" + quoted(beans.getAttribute(name, "GuardSha256")) +
                    ",\"providerClass\":" + quoted(beans.getAttribute(name, "ProviderClass")) +
                    ",\"sdkAbi\":" + quoted(beans.getAttribute(name, "SdkAbi")) +
                    ",\"guardPolicy\":" + quoted(beans.getAttribute(name, "GuardPolicy")) +
                    ",\"artifactVersion\":" + quoted(beans.getAttribute(name, "ArtifactVersion")) +
                    ",\"delegateClass\":" + quoted(beans.getAttribute(name, "DelegateClass")) +
                    ",\"delegateLoader\":" + quoted(beans.getAttribute(name, "DelegateLoader")) +
                    ",\"extensionLoader\":" + quoted(beans.getAttribute(name, "ExtensionLoader")) +
                    ",\"unsampledDropCount\":" + beans.getAttribute(name, "UnsampledDropCount") +
                    ",\"delegateDecisionCount\":" + beans.getAttribute(name, "DelegateDecisionCount") +
                    ",\"runtimeInstanceId\":\"" + ProcessHandle.current().pid() + "\"" +
                    ",\"providerCount\":null,\"exporterCount\":null}";
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
            } catch (Exception failure) { exchange.sendResponseHeaders(503, -1); }
            finally { exchange.close(); }
        });
        server.createContext("/probe", exchange -> {
            try {
            String caseId = exchange.getRequestHeaders().getFirst("x-contoso-probe-case");
            if (caseId == null || !caseId.matches("[a-z0-9-]{1,40}")) {
                exchange.sendResponseHeaders(400, -1);
                exchange.close();
                return;
            }
            if (baseline) {
                client.send(HttpRequest.newBuilder(echo).GET().build(), HttpResponse.BodyHandlers.discarding());
                byte[] bytes = "{\"baseline\":true}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
                return;
            }
            Context extracted = telemetry.getPropagators().getTextMapPropagator()
                    .extract(Context.root(), exchange, GETTER);
            var inbound = Span.fromContext(extracted).getSpanContext();
            Span request = tracer.spanBuilder("contoso.parent-safe.probe.server")
                    .setSpanKind(SpanKind.SERVER).setParent(extracted).startSpan();
            try (var requestScope = request.makeCurrent()) {
                request.setAttribute("contoso.probe.case", caseId);
                request.setAttribute("contoso.span.kind", "SERVER");
                    var outbound = HttpRequest.newBuilder(echo).header("x-contoso-probe-case", caseId);
                    var downstream = client.send(outbound.GET().build(), HttpResponse.BodyHandlers.discarding());
                    String wire = downstream.headers().firstValue("x-contoso-observed-traceparent").orElseThrow();
                    if (!wire.matches("00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]")) {
                        throw new IllegalStateException("Expected actual agent-injected loopback context");
                    }
                    String[] parts = wire.split("-");
                    var root = request.getSpanContext();
                    String body = "{\"caseId\":\"" + caseId + "\",\"traceId\":\"" + root.getTraceId()
                            + "\",\"parentId\":\"" + inbound.getSpanId() + "\",\"serverSpanId\":\"" + root.getSpanId()
                            + "\",\"clientSpanId\":\"" + parts[2] + "\",\"serverSampled\":" + root.isSampled()
                            + ",\"clientSampled\":" + "01".equals(parts[3]) + ",\"serverRecording\":" + request.isRecording()
                            + ",\"clientRecording\":null,\"clientObservation\":\"actual-downstream-carrier\""
                            + ",\"providerIdentity\":" + System.identityHashCode(provider)
                            + ",\"providerType\":\"" + provider.getClass().getName() + "\"}";
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
            } catch (Exception failure) {
                exchange.sendResponseHeaders(500, -1);
                throw new RuntimeException("Loopback fixture failed", failure);
            } finally {
                request.end();
                exchange.close();
            }
            } catch (Throwable failure) {
                failure.printStackTrace(System.err);
                try { exchange.sendResponseHeaders(500, -1); } catch (Exception ignored) { }
                exchange.close();
            }
        });
        server.start();
        System.out.println("PARENT_SAFE_PROBE_READY " + server.getAddress().getPort());
        try (var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            input.readLine();
        }
        server.stop(0);
        System.out.println("PARENT_SAFE_PROBE_STOPPED");
    }

    private static String quoted(Object value) {
        return "\"" + value.toString().replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }
}
