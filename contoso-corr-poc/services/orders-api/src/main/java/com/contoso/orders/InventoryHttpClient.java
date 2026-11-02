package com.contoso.orders;

import com.azure.core.credential.TokenRequestContext;
import com.azure.core.credential.TokenCredential;
import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationIds;
import com.contoso.correlation.data.InventoryItem;
import com.contoso.correlation.data.OperationContext;
import com.contoso.security.IdentityHttpClients;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.function.Supplier;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.json.JsonMapper;

public final class InventoryHttpClient implements AutoCloseable {
    private final URI base;
    private final Function<Duration, String> token;
    private final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(3)).build();
    private final ExecutorService calls = new ThreadPoolExecutor(4, 4, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(16), daemon("contoso-inventory-call"), new ThreadPoolExecutor.AbortPolicy());
    private final Set<CallState> active = ConcurrentHashMap.newKeySet();

    InventoryHttpClient(URI base, String tokenResource) {
        this(base, tokenResource, IdentityHttpClients.managedIdentity());
    }

    InventoryHttpClient(URI base, String tokenResource, TokenCredential credential) {
        this.base = base;
        this.token = remaining -> {
            var result = credential.getToken(new TokenRequestContext().addScopes(tokenResource + "/.default"))
                .block(remaining);
            if (result == null) throw new IllegalStateException("inventory_token_unavailable");
            return result.getToken();
        };
    }
    InventoryHttpClient(URI base, Supplier<String> token) { this.base = base; this.token = remaining -> token.get(); }

    static InventoryHttpClient fromEnvironment() {
        var configuration = configuration(System.getenv());
        return new InventoryHttpClient(configuration.base(), configuration.tokenResource());
    }

    static Configuration configuration(Map<String, String> environment) {
        String endpoint = environment.get("CONTOSO_INVENTORY_BASE_URL");
        String tokenResource = environment.get("CONTOSO_INVENTORY_TOKEN_RESOURCE");
        if (endpoint == null || tokenResource == null) throw new IllegalStateException("inventory_configuration_missing");
        if (tokenResource.length() > 256 || !tokenResource.matches("[A-Za-z0-9:/._-]+") ||
            tokenResource.endsWith("/.default")) {
            throw new IllegalStateException("invalid_inventory_token_resource");
        }
        URI resource;
        URI uri;
        try { resource = URI.create(tokenResource); uri = URI.create(endpoint); }
        catch (IllegalArgumentException invalid) { throw new IllegalStateException("invalid_inventory_configuration"); }
        if ((! "api".equals(resource.getScheme()) && !"https".equals(resource.getScheme())) || resource.getHost() == null ||
            resource.getUserInfo() != null || resource.getQuery() != null || resource.getFragment() != null) {
            throw new IllegalStateException("invalid_inventory_token_resource");
        }
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getHost().isBlank() ||
            uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
            !uri.getPath().endsWith("/api")) throw new IllegalStateException("invalid_inventory_endpoint");
        return new Configuration(uri, tokenResource);
    }

    record Configuration(URI base, String tokenResource) {}

    public InventoryItem lookup(String sku, OperationContext context) {
        if (sku == null || !sku.matches("[A-Za-z0-9_-]{1,64}")) throw new IllegalArgumentException("invalid_sku");
        Budget budget = new Budget(context.deadline());
        CallState state = new CallState();
        active.add(state);
        Future<InventoryItem> task;
        try {
            task = calls.submit(() -> {
                try (var parent = context.parentContext().makeCurrent();
                     var scope = Correlation.bind(context.invocationId())) {
                    return execute(sku, context, budget, state);
                } finally { active.remove(state); }
            });
        } catch (RejectedExecutionException failure) {
            active.remove(state);
            throw new InventoryDependencyException(InventoryDependencyException.Category.CAPACITY);
        }
        try {
            InventoryItem item = task.get(budget.remaining().toNanos(), TimeUnit.NANOSECONDS);
            budget.remaining();
            return item;
        } catch (InterruptedException failure) {
            task.cancel(true); state.cancel();
            Thread.currentThread().interrupt();
            throw new InventoryDependencyException(InventoryDependencyException.Category.INTERRUPTED);
        } catch (TimeoutException failure) {
            task.cancel(true); state.cancel();
            throw new InventoryDependencyException(InventoryDependencyException.Category.TIMEOUT);
        } catch (ExecutionException failure) {
            task.cancel(true); state.cancel();
            if (failure.getCause() instanceof InventoryDependencyException dependency) throw dependency;
            throw new InventoryDependencyException(failure.getCause() instanceof TimeoutException ?
                InventoryDependencyException.Category.TIMEOUT : InventoryDependencyException.Category.UNAVAILABLE);
        } catch (Exception failure) {
            task.cancel(true); state.cancel();
            throw new InventoryDependencyException(InventoryDependencyException.Category.UNAVAILABLE);
        } finally { active.remove(state); }
    }

    private InventoryItem execute(String sku, OperationContext context, Budget budget, CallState state) throws Exception {
        if (state.cancelled.get()) throw new TimeoutException();
        String tokenValue = token.apply(budget.remaining());
        Duration remaining = budget.remaining();
        if (state.cancelled.get()) throw new TimeoutException();
        var request = HttpRequest.newBuilder(URI.create(base + "/inventory/" + sku)).timeout(remaining)
            .setHeader("Authorization", "Bearer " + tokenValue)
            .setHeader(InvocationIds.HEADER, context.invocationId().value()).GET().build();
        var responseFuture = client.sendAsync(request, ignored -> new BoundedBody());
        state.request.set(responseFuture);
        if (state.cancelled.get()) { responseFuture.cancel(true); throw new TimeoutException(); }
        var response = responseFuture.get(budget.remaining().toNanos(), TimeUnit.NANOSECONDS);
        if (state.cancelled.get()) throw new TimeoutException();
        budget.remaining();
        var invocationHeaders = response.headers().allValues(InvocationIds.HEADER);
        if (response.statusCode() != 200 || invocationHeaders.size() != 1 ||
            !context.invocationId().value().equals(invocationHeaders.getFirst())) {
            throw new InventoryDependencyException(InventoryDependencyException.Category.UNAVAILABLE);
        }
        InventoryItem item = JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES, DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT).disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .build().readValue(response.body(), InventoryItem.class);
        if (item == null || !sku.equals(item.sku()) || item.available() < 0 || item.revision() < 0) {
            throw new InventoryDependencyException(InventoryDependencyException.Category.UNAVAILABLE);
        }
        budget.remaining();
        return item;
    }

    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody() { return body; }
        public void onSubscribe(Flow.Subscription value) {
            if (subscription != null) { value.cancel(); return; }
            subscription = value;
            value.request(1);
        }
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > 16384 - bytes.size()) {
                    subscription.cancel();
                    body.completeExceptionally(new InventoryDependencyException(InventoryDependencyException.Category.UNAVAILABLE));
                    return;
                }
                byte[] chunk = new byte[buffer.remaining()];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        public void onError(Throwable failure) { body.completeExceptionally(new InventoryDependencyException(InventoryDependencyException.Category.UNAVAILABLE)); }
        public void onComplete() { body.complete(bytes.toByteArray()); }
    }

    private static ThreadFactory daemon(String name) {
        return action -> {
            Thread thread = new Thread(action, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    private static final class Budget {
        private final Instant deadline;
        private final long expires;
        Budget(Instant deadline) {
            this.deadline = deadline;
            Duration remaining = Duration.between(Instant.now(), deadline);
            if (remaining.isNegative() || remaining.isZero()) throw new InventoryDependencyException(InventoryDependencyException.Category.TIMEOUT);
            expires = System.nanoTime() + cappedNanos(remaining);
        }
        Duration remaining() throws TimeoutException {
            long nanos = Math.min(expires - System.nanoTime(), cappedNanos(Duration.between(Instant.now(), deadline)));
            if (nanos <= 0) throw new TimeoutException();
            return Duration.ofNanos(nanos);
        }
        private static long cappedNanos(Duration duration) {
            return duration.compareTo(Duration.ofSeconds(30)) > 0 ? Duration.ofSeconds(30).toNanos() : duration.toNanos();
        }
    }

    private final class CallState {
        final AtomicBoolean cancelled = new AtomicBoolean();
        final AtomicReference<CompletableFuture<HttpResponse<byte[]>>> request = new AtomicReference<>();
        void cancel() {
            cancelled.set(true);
            var pending = request.get();
            if (pending != null) pending.cancel(true);
        }
    }

    public void close() {
        active.forEach(CallState::cancel);
        client.shutdownNow();
        calls.shutdownNow();
    }
}
