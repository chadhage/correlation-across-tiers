package com.contoso.orders;

import com.azure.core.credential.TokenRequestContext;
import com.azure.identity.ManagedIdentityCredentialBuilder;
import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationIds;
import com.contoso.correlation.data.InventoryItem;
import com.contoso.correlation.data.OperationContext;
import java.io.InputStream;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.function.Supplier;
import tools.jackson.databind.json.JsonMapper;

public final class InventoryHttpClient implements AutoCloseable {
    private final URI base;
    private final Function<Duration, String> token;
    private final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(3)).build();
    private final ExecutorService calls = new ThreadPoolExecutor(4, 4, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(16), daemon("contoso-inventory-call"), new ThreadPoolExecutor.AbortPolicy());
    private final ExecutorService cleanup = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(8), daemon("contoso-inventory-close"), new ThreadPoolExecutor.AbortPolicy());
    private final Set<CallState> active = ConcurrentHashMap.newKeySet();

    InventoryHttpClient(URI base, String audience) {
        this.base = base;
        var credential = new ManagedIdentityCredentialBuilder().build();
        this.token = remaining -> {
            var result = credential.getToken(new TokenRequestContext().addScopes(audience + "/.default"))
                .block(remaining);
            if (result == null) throw new IllegalStateException("inventory_token_unavailable");
            return result.getToken();
        };
    }
    InventoryHttpClient(URI base, Supplier<String> token) { this.base = base; this.token = remaining -> token.get(); }

    static InventoryHttpClient fromEnvironment() {
        String endpoint = System.getenv("CONTOSO_INVENTORY_BASE_URL");
        String audience = System.getenv("CONTOSO_INVENTORY_AUDIENCE");
        if (endpoint == null || audience == null) throw new IllegalStateException("inventory_configuration_missing");
        URI uri = URI.create(endpoint);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getHost().isBlank() ||
            uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
            !uri.getPath().endsWith("/api")) throw new IllegalStateException("invalid_inventory_endpoint");
        return new InventoryHttpClient(uri, audience);
    }

    public InventoryItem lookup(String sku, OperationContext context) {
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
            throw new IllegalStateException("inventory_capacity");
        }
        try {
            InventoryItem item = task.get(budget.remaining().toNanos(), TimeUnit.NANOSECONDS);
            budget.remaining();
            return item;
        } catch (InterruptedException failure) {
            task.cancel(true); state.cancel();
            Thread.currentThread().interrupt();
            throw new IllegalStateException("inventory_interrupted");
        } catch (TimeoutException failure) {
            task.cancel(true); state.cancel();
            throw new IllegalStateException("inventory_timeout");
        } catch (Exception failure) {
            task.cancel(true); state.cancel();
            throw new IllegalStateException("inventory_unavailable");
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
        var responseFuture = client.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
        state.request.set(responseFuture);
        if (state.cancelled.get()) { responseFuture.cancel(true); throw new TimeoutException(); }
        var response = responseFuture.get(budget.remaining().toNanos(), TimeUnit.NANOSECONDS);
        InputStream input = response.body();
        state.body.set(input);
        try (input) {
            if (state.cancelled.get()) throw new TimeoutException();
            budget.remaining();
            byte[] bytes = input.readNBytes(16385);
            budget.remaining();
            if (response.statusCode() != 200 || bytes.length > 16384) throw new IllegalStateException("inventory_unavailable");
            InventoryItem item = JsonMapper.builder().build().readValue(bytes, InventoryItem.class);
            budget.remaining();
            return item;
        } finally { state.body.compareAndSet(input, null); }
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
            if (remaining.isNegative() || remaining.isZero()) throw new IllegalStateException("inventory_timeout");
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
        final AtomicReference<CompletableFuture<HttpResponse<InputStream>>> request = new AtomicReference<>();
        final AtomicReference<InputStream> body = new AtomicReference<>();
        void cancel() {
            cancelled.set(true);
            var pending = request.get();
            if (pending != null) pending.cancel(true);
            InputStream input = body.getAndSet(null);
            if (input != null) {
                try { cleanup.execute(() -> { try { input.close(); } catch (Exception ignored) {} }); }
                catch (RejectedExecutionException ignored) { }
            }
        }
    }

    public void close() {
        active.forEach(CallState::cancel);
        client.shutdownNow();
        calls.shutdownNow();
        cleanup.shutdown();
    }
}
