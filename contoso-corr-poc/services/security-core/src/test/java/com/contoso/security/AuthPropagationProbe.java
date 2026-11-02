package com.contoso.security;

import com.azure.identity.ManagedIdentityCredentialBuilder;
import com.azure.core.util.ClientOptions;
import com.azure.core.util.TracingOptions;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.lang.management.ManagementFactory;
import javax.management.ObjectName;
import com.nimbusds.jose.util.JSONObjectUtils;
import okhttp3.OkHttpClient;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import org.slf4j.LoggerFactory;

public final class AuthPropagationProbe {
    public static void main(String[] args) throws Exception {
        URI base = URI.create(args[0]);
        if (!"http".equals(base.getScheme()) || !"127.0.0.1".equals(base.getHost()))
            throw new IllegalArgumentException("FIXTURE_ENDPOINT_INVALID");
        Object logging = LoggerFactory.getILoggerFactory();
        for (String name : List.of("com.azure", "com.microsoft.aad.msal4j", "reactor.netty", "io.netty")) {
            Object logger = logging.getClass().getMethod("getLogger", String.class).invoke(logging, name);
            Class<?> level = Class.forName("ch.qos.logback.classic.Level");
            logger.getClass().getMethod("setLevel", level).invoke(logger, level.getField("OFF").get(null));
        }
        SecurityLoggingGuard.verify();
        var root = GlobalOpenTelemetry.getTracer("contoso-av23-probe").spanBuilder("contoso.av23.root")
            .setSpanKind(SpanKind.INTERNAL).startSpan();
        boolean active = root.isRecording() && root.getSpanContext().isValid();
        if (!active) throw new IllegalStateException("NATIVE_PROVIDER_NOT_ACTIVE");
        var beans = ManagementFactory.getPlatformMBeanServer();
        var observation = new ObjectName("com.contoso.correlation:type=SamplingObservation");
        String guardVersion = (String) beans.getAttribute(observation, "ArtifactVersion");
        String guardPolicy = (String) beans.getAttribute(observation, "GuardPolicy");
        String abi = (String) beans.getAttribute(observation, "SdkAbi");
        boolean guardLoaded = args.length > 3 && args[3].equals(beans.getAttribute(observation, "GuardSha256")) &&
            "1.1.0".equals(guardVersion) && "1.65.0".equals(abi) &&
            "DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS".equals(guardPolicy) &&
            Integer.valueOf(1).equals(beans.getAttribute(observation, "LoadedCount")) &&
            Boolean.TRUE.equals(beans.getAttribute(observation, "NativeStateAvailable"));
        if (!guardLoaded) throw new IllegalStateException("CURRENT_GUARD_NOT_LOADED");
        String issuer = "https://login.microsoftonline.com/" + UUID.randomUUID() + "/v2.0";
        boolean sdkTracingDisabled = args.length > 1 && "sdk-tracing-disabled".equals(args[1]);
        var credentialBuilder = new ManagedIdentityCredentialBuilder();
        if (sdkTracingDisabled) credentialBuilder.clientOptions(new ClientOptions().setTracingOptions(new TracingOptions().setEnabled(false)));
        boolean isolatedTransport = args.length > 2 && "isolated-transport".equals(args[2]);
        boolean jwks = false, identity = false, trusted = false, parentAdvanced = false, rawTransport = false;
        boolean rawNativeInterceptorPresent;
        List<Map<String, String>> clients;
        List<String> configuredInterceptors;
        long identitySends;
        try (var scope = root.makeCurrent()) {
            var raw = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
                .callTimeout(Duration.ofSeconds(5)).connectTimeout(Duration.ofSeconds(2)).build();
            rawNativeInterceptorPresent = raw.networkInterceptors().stream()
                .anyMatch(value -> value.getClass().getName().startsWith("io.opentelemetry."));
            try (var response = raw.newCall(new okhttp3.Request.Builder()
                    .url(base.resolve("/identity/transport-control").toString()).get().build()).execute()) {
                rawTransport = response.code() == 200;
            }
        }
        try (var scope = root.makeCurrent();
             var keys = new JwkKeySource(base.resolve("/identity/jwks"), issuer, Clock.systemUTC());
             var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
                 .followRedirects(HttpClient.Redirect.NEVER).build();
             var tokens = new BoundedTokenProvider(isolatedTransport ? IdentityHttpClients.managedIdentity() : credentialBuilder.build(),
                 "api://" + UUID.randomUUID() + "/.default", Clock.systemUTC())) {
            jwks = keys.key("av23", issuer) != null;
            identity = !tokens.token(Duration.ofSeconds(5)).isEmpty();
            var response = client.sendAsync(HttpRequest.newBuilder(base.resolve("/trusted/api"))
                .timeout(Duration.ofSeconds(5)).setHeader("x-business-invocation-id", UUID.randomUUID().toString())
                .GET().build(), HttpResponse.BodyHandlers.ofString()).get(5, java.util.concurrent.TimeUnit.SECONDS);
            trusted = response.statusCode() == 200;
            String carrier = response.headers().firstValue("x-contoso-fixture-observed-parent").orElse("");
            Context remote = GlobalOpenTelemetry.getPropagators().getTextMapPropagator().extract(Context.root(),
                Map.of("traceparent", carrier), new TextMapGetter<Map<String, String>>() {
                    public Iterable<String> keys(Map<String, String> values) { return values.keySet(); }
                    public String get(Map<String, String> values, String key) { return values.get(key); }
                });
            var carried = Span.fromContext(remote).getSpanContext();
            parentAdvanced = carried.isValid() && carried.getTraceId().equals(root.getSpanContext().getTraceId()) &&
                !carried.getSpanId().equals(root.getSpanContext().getSpanId());
            clients = IdentityHttpClients.observeConfiguredClients();
            configuredInterceptors = IdentityHttpClients.configuredNetworkInterceptorClasses();
            identitySends = IdentityHttpClients.observedIdentitySendCalls();
        } finally { root.end(); }
        Map<String, Object> observed = new LinkedHashMap<>();
        observed.put("mode", "header_isolation_only");
        observed.put("headerPolicyVersion", 1);
        observed.put("actualRootContext", Map.of(
            "traceId", root.getSpanContext().getTraceId(), "spanId", root.getSpanContext().getSpanId()));
        observed.put("probeCodeSource", AuthPropagationProbe.class.getProtectionDomain()
            .getCodeSource().getLocation().toURI().toString());
        try (var bytes = AuthPropagationProbe.class.getResourceAsStream("/com/contoso/security/AuthPropagationProbe.class")) {
            observed.put("probeClassResourceSha256", HexFormat.of().formatHex(
                java.security.MessageDigest.getInstance("SHA-256").digest(Objects.requireNonNull(bytes).readAllBytes())));
        }
        observed.put("providerActive", active);
        observed.put("jwksCompleted", jwks);
        observed.put("identityCompleted", identity);
        observed.put("trustedCompleted", trusted);
        observed.put("trustedParentAdvanced", parentAdvanced);
        observed.put("sdkTracingOptionsDisabled", sdkTracingDisabled);
        observed.put("isolatedCredentialTransport", isolatedTransport);
        observed.put("guardLoadedFromFrozenBytes", guardLoaded);
        observed.put("guardArtifactVersion", guardVersion);
        observed.put("guardPolicy", guardPolicy);
        observed.put("sdkAbi", abi);
        observed.put("rawTransportControlCompleted", rawTransport);
        observed.put("rawNativeInterceptorPresent", rawNativeInterceptorPresent);
        observed.put("identitySendCalls", identitySends);
        observed.put("configuredNetworkInterceptorClasses", configuredInterceptors);
        observed.put("clientObservations", clients);
        observed.put("pid", ProcessHandle.current().pid());
        observed.put("processStartUtc", ProcessHandle.current().info().startInstant().orElseThrow().toString());
        observed.put("observedAtUtc", Instant.now().toString());
        System.out.println("AV23_JAVA_READY " + JSONObjectUtils.toJSONString(observed));
        System.out.flush();
        // Standalone test process: public JVM shutdown runs the installed agent's drain hook.
        System.exit(0);
    }
}
