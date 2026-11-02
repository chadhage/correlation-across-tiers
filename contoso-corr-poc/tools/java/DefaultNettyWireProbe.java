package com.contoso.tools;

import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenCredential;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.messaging.AzureMessagingTransport;
import com.contoso.messaging.Destination;
import com.contoso.messaging.Envelope;
import com.contoso.messaging.EnvelopeCodec;
import com.contoso.messaging.MessagingFailure;
import com.contoso.messaging.MessagingSettings;
import com.contoso.messaging.WorkPayload;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarFile;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

public final class DefaultNettyWireProbe {
    public static void main(String[] args) {
        try {
            run(args);
        } catch (Exception failure) {
            String code = failure.getMessage();
            System.err.println("DEFAULT_NETTY_PROBE_FAILED_" +
                (code != null && code.matches("[A-Z_]{1,80}") ? code : failure.getClass().getSimpleName()));
            System.exit(1);
        }
    }

    private static void run(String[] args) throws Exception {
        boolean expectedRejection = args.length == 1 && args[0].equals("reject-tls");
        if (args.length > 1 || args.length == 1 && !expectedRejection) throw new IllegalArgumentException();
        String gridHost = System.getenv("CONTOSO_NETTY_GRID_HOST");
        String queueHost = System.getenv("CONTOSO_NETTY_QUEUE_HOST");
        int proxyPort = Integer.parseInt(System.getenv("CONTOSO_NETTY_PROXY_PORT"));
        String token = System.getenv("CONTOSO_NETTY_FIXTURE_TOKEN");
        if (token == null || token.length() < 32) throw new IllegalArgumentException();
        var scopes = new ArrayList<String>();
        TokenCredential credential = request -> {
            scopes.addAll(request.getScopes());
            return Mono.just(new AccessToken(token, OffsetDateTime.now().plusMinutes(10)));
        };
        var settings = new MessagingSettings("contoso-netty.servicebus.windows.net",
            "https://" + gridHost + "/api/events", "contoso-netty.servicebus.windows.net",
            "https://" + queueHost, null, "orders", "fulfillment", "notify", "aggregator", 4, 2);
        var reports = new ArrayList<Map<String, Object>>();
        var tracer = GlobalOpenTelemetry.getTracer("contoso.default-netty-wire-probe");
        Span root = expectedRejection ? Span.getInvalid() :
            tracer.spanBuilder("contoso.default-netty-wire").setNoParent().startSpan();
        if (!expectedRejection && !root.getSpanContext().isValid()) throw new IllegalStateException("NO_NATIVE_PROVIDER");
        Map<String, Object> sampler = new LinkedHashMap<>();
        if (!expectedRejection) {
            var management = java.lang.management.ManagementFactory.getPlatformMBeanServer();
            var observer = new javax.management.ObjectName("com.contoso.correlation:type=SamplingObservation");
            for (String attribute : List.of("GuardSha256", "ProviderClass", "SdkAbi", "LoadedCount",
                "NativeStateAvailable", "EffectiveSamplingPercentage", "RequestsPerSecond")) {
                sampler.put(attribute, management.getAttribute(observer, attribute));
            }
            if (!Integer.valueOf(1).equals(sampler.get("LoadedCount")) ||
                !Boolean.TRUE.equals(sampler.get("NativeStateAvailable")) ||
                !System.getenv("CONTOSO_NETTY_EXPECTED_GUARD_SHA").equals(sampler.get("GuardSha256"))) {
                throw new IllegalStateException("NATIVE_SAMPLER_BINDING_MISMATCH");
            }
        }
        String invocation = InvocationId.generate().value();
        root.setAttribute("business.invocation_id", invocation);
        try (var current = root.makeCurrent();
             var transport = new AzureMessagingTransport(settings, credential, new EnvelopeCodec())) {
            Object businessClient = transport.businessHttpClient();
            if (!businessClient.getClass().getName().equals("com.azure.core.http.netty.NettyAsyncHttpClient")) {
                throw new IllegalStateException("NOT_DEFAULT_NETTY");
            }
            // Read-only, version-bound test inspection prevents any send if ambient routing was ignored.
            var field = businessClient.getClass().getDeclaredField("nettyClient");
            field.setAccessible(true);
            if (!(field.get(businessClient) instanceof HttpClient netty)) throw new IllegalStateException("NO_NETTY_CONFIG");
            ProxyProvider proxy = netty.configuration().proxyProvider();
            if (proxy == null && netty.configuration().proxyProviderSupplier() != null) {
                proxy = netty.configuration().proxyProviderSupplier().get();
            }
            if (proxy == null || !(proxy.getProxyAddress() instanceof InetSocketAddress address) ||
                !address.getHostString().equals("127.0.0.1") || address.getPort() != proxyPort ||
                !proxy.shouldProxy(InetSocketAddress.createUnresolved(gridHost, 443)) ||
                !proxy.shouldProxy(InetSocketAddress.createUnresolved(queueHost, 443))) {
                throw new IllegalStateException("ISOLATED_PROXY_NOT_ACTIVE");
            }
            for (Destination destination : List.of(Destination.EVENT_GRID, Destination.STORAGE_QUEUE)) {
                Span producer = expectedRejection ? Span.getInvalid() :
                    tracer.spanBuilder("contoso.default-netty.publish").setSpanKind(SpanKind.PRODUCER).startSpan();
                producer.setAttribute("business.invocation_id", invocation);
                producer.setAttribute("contoso.span.kind", "PRODUCER");
                boolean rejected = false;
                try (var producerScope = producer.makeCurrent()) {
                    var carrier = new HashMap<String, String>();
                    GlobalOpenTelemetry.getPropagators().getTextMapPropagator()
                        .inject(Context.current(), carrier, Map::put);
                    var envelope = new Envelope(1, carrier.get("traceparent"), carrier.get("tracestate"),
                        invocation, InvocationId.generate().value(), null, InvocationId.generate().value(),
                        Envelope.Kind.ORDER, null,
                        new WorkPayload(InvocationId.generate().value(), "CONTOSO-001", 1,
                            destination == Destination.EVENT_GRID ? RunScenario.EVENT_GRID : RunScenario.STORAGE_QUEUE, null));
                    try {
                        transport.publish(destination, envelope);
                    } catch (MessagingFailure failure) {
                        if (!expectedRejection || failure.code() != MessagingFailure.Code.BROKER_UNAVAILABLE) throw failure;
                        rejected = true;
                    }
                    if (expectedRejection != rejected) throw new IllegalStateException("TLS_CONTROL_MISMATCH");
                    reports.add(Map.of("destination", destination.name(), "messageId", envelope.messageId(),
                        "entity", destination.entity(),
                        "payloadTraceparent", envelope.traceparent() == null ? "" : envelope.traceparent(),
                        "producerSpanId", producer.getSpanContext().getSpanId(), "tlsRejected", rejected));
                } finally { producer.end(); }
            }
            var report = new LinkedHashMap<String, Object>();
            report.put("schema", "contoso.default-netty-local-wire.v1");
            report.put("actualPid", ProcessHandle.current().pid());
            report.put("mode", expectedRejection ? "EXPECTED_TLS_REJECTION" : "DEFAULT_NETTY_USED_LOCAL_TLS_BOUNDARY");
            report.put("credentialMode", "EXPLICIT_FIXTURE_NOT_PRODUCTION_MANAGED_IDENTITY");
            report.put("proxyVerifiedBeforeSend", true);
            report.put("traceId", root.getSpanContext().getTraceId());
            report.put("rootSpanId", root.getSpanContext().getSpanId());
            report.put("businessInvocationId", invocation);
            report.put("samplerObservation", sampler);
            try (var input = DefaultNettyWireProbe.class.getResourceAsStream("DefaultNettyWireProbe.class")) {
                if (input == null) throw new IllegalStateException("EXECUTED_PROBE_MEMBER_MISSING");
                report.put("executedProbeClassSha256", hash(input.readAllBytes()));
            }
            report.put("sends", reports);
            report.put("requestedScopes", scopes);
            report.put("transportOrigin", origin(transport));
            report.put("usedBusinessClientOrigin", origin(businessClient));
            if (!expectedRejection) {
                var gridField = AzureMessagingTransport.class.getDeclaredField("grid");
                gridField.setAccessible(true);
                var queueField = AzureMessagingTransport.class.getDeclaredField("queues");
                queueField.setAccessible(true);
                if (!(queueField.get(transport) instanceof Map<?, ?> queues) || queues.size() != 1 ||
                    !(queues.values().iterator().next() instanceof com.azure.storage.queue.QueueClient queue) ||
                    queue.getHttpPipeline().getHttpClient() != businessClient) {
                    throw new IllegalStateException("USED_QUEUE_PIPELINE_CLIENT_MISMATCH");
                }
                report.put("usedSdkOrigins", List.of(origin(gridField.get(transport)), origin(queue)));
                report.put("usedQueuePipelineClientIsDefaultNetty", true);
            }
            System.out.println("CONTOSO_DEFAULT_NETTY_RESULT " + new ObjectMapper().writeValueAsString(report));
        } finally {
            root.end();
            if (!expectedRejection) Thread.sleep(1500);
        }
    }

    private static Map<String, Object> origin(Object actualInstance) throws Exception {
        Class<?> type = actualInstance.getClass();
        Path archive = Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI());
        if (!Files.isRegularFile(archive) || !archive.getFileName().toString().endsWith(".jar")) {
            throw new IllegalStateException("USED_CLASS_NOT_FROM_ARCHIVE");
        }
        String member = type.getName().replace('.', '/') + ".class";
        byte[] archived;
        try (var jar = new JarFile(archive.toFile()); var input = jar.getInputStream(jar.getJarEntry(member))) {
            archived = input.readAllBytes();
        }
        try (var input = type.getResourceAsStream("/" + member)) {
            if (input == null || !java.util.Arrays.equals(archived, input.readAllBytes())) {
                throw new IllegalStateException("USED_MEMBER_ORIGIN_MISMATCH");
            }
        }
        return Map.of("className", type.getName(), "archivePath", archive.toString(),
            "archiveSha256", hash(Files.readAllBytes(archive)), "member", member, "memberSha256", hash(archived));
    }

    private static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
