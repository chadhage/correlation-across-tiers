package com.contoso.security;

import com.azure.core.credential.TokenCredential;
import com.azure.core.http.HttpClient;
import com.azure.core.http.HttpRequest;
import com.azure.core.http.HttpResponse;
import com.azure.core.http.okhttp.OkHttpAsyncHttpClientBuilder;
import com.azure.core.http.policy.HttpLogDetailLevel;
import com.azure.core.http.policy.HttpLogOptions;
import com.azure.core.util.ClientOptions;
import com.azure.core.util.TracingOptions;
import com.azure.identity.ManagedIdentityCredentialBuilder;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.security.keyvault.secrets.SecretAsyncClient;
import com.azure.security.keyvault.secrets.SecretClientBuilder;
import com.azure.core.http.policy.FixedDelayOptions;
import com.azure.core.http.policy.RetryOptions;
import java.net.URI;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.OkHttpClient;

public final class IdentityHttpClients {
    private static final List<String> CONTEXT_HEADERS = List.of(
        "traceparent", "tracestate", "baggage", "request-id", "correlation-context",
        "x-business-invocation-id", "x-business-correlation-id");
    private IdentityHttpClients() {}

    public static HttpClient httpClient() {
        SecurityLoggingGuard.verify();
        return Shared.CLIENT;
    }

    public static TokenCredential managedIdentity() { return managedIdentity(null); }

    public static TokenCredential managedIdentity(String clientId) {
        var builder = new ManagedIdentityCredentialBuilder().httpClient(httpClient())
            .httpLogOptions(new HttpLogOptions().setLogLevel(HttpLogDetailLevel.NONE))
            .clientOptions(new ClientOptions().setTracingOptions(new TracingOptions().setEnabled(false)));
        if (clientId != null && !clientId.isBlank()) builder.clientId(WorkloadIdentity.canonical(clientId));
        return builder.build();
    }

    public static TokenCredential defaultCredential() {
        return new DefaultAzureCredentialBuilder().httpClient(httpClient())
            .httpLogOptions(new HttpLogOptions().setLogLevel(HttpLogDetailLevel.NONE))
            .clientOptions(new ClientOptions().setTracingOptions(new TracingOptions().setEnabled(false))).build();
    }

    public static SecretAsyncClient keyVaultSecrets(URI vault, TokenCredential credential) {
        if (vault == null || !"https".equals(vault.getScheme()) || vault.getHost() == null ||
                !vault.getHost().matches("[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\\.vault\\.azure\\.net") ||
                vault.getUserInfo() != null || vault.getPort() != -1 || vault.getQuery() != null ||
                vault.getFragment() != null || !(vault.getPath().isEmpty() || vault.getPath().equals("/")) ||
                credential == null) throw new IllegalArgumentException("IDENTITY_VAULT_CONFIGURATION_INVALID");
        return new SecretClientBuilder().vaultUrl(vault.toString()).credential(credential).httpClient(httpClient())
            .httpLogOptions(new HttpLogOptions().setLogLevel(HttpLogDetailLevel.NONE))
            .retryOptions(new RetryOptions(new FixedDelayOptions(0, Duration.ofSeconds(1)))).buildAsyncClient();
    }

    private static final class Shared {
        private static final OkHttpClient CONFIGURED = new OkHttpClient.Builder()
            .followRedirects(false).followSslRedirects(false)
            .callTimeout(Duration.ofSeconds(5)).connectTimeout(Duration.ofSeconds(2))
            .readTimeout(Duration.ofSeconds(5)).writeTimeout(Duration.ofSeconds(5))
            .addNetworkInterceptor(chain -> {
                var request = chain.request().newBuilder();
                for (String name : CONTEXT_HEADERS) request.removeHeader(name);
                return chain.proceed(request.build());
            }).build();
        private static final HttpClient DELEGATE = new OkHttpAsyncHttpClientBuilder(CONFIGURED)
            .followRedirects(false).connectionTimeout(Duration.ofSeconds(2))
            .writeTimeout(Duration.ofSeconds(5)).responseTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(5)).callTimeout(Duration.ofSeconds(5)).build();
        private static final ContextFreeRestClient CLIENT = new ContextFreeRestClient(DELEGATE);
    }

    private static final class ContextFreeRestClient implements HttpClient {
        private final HttpClient delegate;
        private final AtomicLong sends = new AtomicLong();
        private ContextFreeRestClient(HttpClient delegate) { this.delegate = delegate; }

        private static HttpRequest isolate(HttpRequest request) {
            SecurityLoggingGuard.verify();
            for (String name : CONTEXT_HEADERS) request.getHeaders().remove(name);
            return request;
        }

        @Override public reactor.core.publisher.Mono<HttpResponse> send(HttpRequest request) {
            return reactor.core.publisher.Mono.defer(() -> {
                HttpRequest isolated = isolate(request);
                sends.incrementAndGet();
                return delegate.send(isolated);
            });
        }

        @Override public reactor.core.publisher.Mono<HttpResponse> send(
                HttpRequest request, com.azure.core.util.Context context) {
            return reactor.core.publisher.Mono.defer(() -> {
                HttpRequest isolated = isolate(request);
                sends.incrementAndGet();
                return delegate.send(isolated, context);
            });
        }

        @Override public HttpResponse sendSync(HttpRequest request, com.azure.core.util.Context context) {
            HttpRequest isolated = isolate(request);
            sends.incrementAndGet();
            return delegate.sendSync(isolated, context);
        }
    }

    public static List<Map<String, String>> observeConfiguredClients() {
        httpClient();
        List<Map<String, String>> facts = new ArrayList<>();
        facts.add(observeClient(Shared.CLIENT, "identity-wrapper"));
        facts.add(observeClient(Shared.DELEGATE, "identity-sdk-client"));
        facts.add(observeClient(Shared.CONFIGURED, "configured-okhttp-passed-to-sdk-builder"));
        return List.copyOf(facts);
    }

    public static Map<String, String> observeClient(Object client, String purpose) {
        if (client == null || !List.of("identity-wrapper", "identity-sdk-client",
                "configured-okhttp-passed-to-sdk-builder", "business-sdk-client").contains(purpose))
            throw new IllegalArgumentException("HTTP_OBSERVATION_INVALID");
        Class<?> type = client.getClass();
        String origin = "UNAVAILABLE", artifactHash = "UNAVAILABLE", memberHash = "UNAVAILABLE";
        try {
            var source = type.getProtectionDomain().getCodeSource();
            if (source != null && "file".equals(source.getLocation().getProtocol())) {
                Path path = Path.of(source.getLocation().toURI());
                origin = path.toUri().toString();
                if (Files.isRegularFile(path))
                    artifactHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
            }
            String member = "/" + type.getName().replace('.', '/') + ".class";
            try (InputStream bytes = type.getResourceAsStream(member)) {
                if (bytes != null) memberHash = HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes()));
            }
        } catch (Exception ignored) { }
        return Map.of("purpose", purpose, "concreteClass", type.getName(),
            "classLoader", type.getClassLoader() == null ? "bootstrap" : type.getClassLoader().getClass().getName(),
            "codeSource", origin, "artifactSha256", artifactHash, "classResourceSha256", memberHash,
            "sourceBuildLineage", "UNVERIFIED_BY_THIS_OBSERVATION",
            "usage", (purpose.equals("identity-wrapper") || purpose.equals("identity-sdk-client")) &&
                Shared.CLIENT.sends.get() > 0 ? "USED_VIA_PUBLIC_HTTP_CLIENT_SEND" : "CREATED_ONLY");
    }

    public static List<String> configuredNetworkInterceptorClasses() {
        httpClient();
        return Shared.CONFIGURED.networkInterceptors().stream().map(value -> value.getClass().getName()).toList();
    }

    public static long observedIdentitySendCalls() {
        httpClient();
        return Shared.CLIENT.sends.get();
    }
}
