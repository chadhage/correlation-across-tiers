package com.contoso.security;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

final class BoundedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
    private final int limit;
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> result = new CompletableFuture<>();
    private Flow.Subscription subscription;

    BoundedBodySubscriber(int limit) { this.limit = limit; }
    public CompletionStage<byte[]> getBody() { return result; }
    public void onSubscribe(Flow.Subscription subscription) {
        this.subscription = subscription;
        subscription.request(1);
    }
    public void onNext(List<ByteBuffer> buffers) {
        for (ByteBuffer buffer : buffers) {
            if (buffer.remaining() > limit - bytes.size()) {
                subscription.cancel();
                result.completeExceptionally(new SecurityException("JWKS_UNAVAILABLE"));
                return;
            }
            byte[] part = new byte[buffer.remaining()];
            buffer.get(part);
            bytes.writeBytes(part);
        }
        subscription.request(1);
    }
    public void onError(Throwable ignored) { result.completeExceptionally(new SecurityException("JWKS_UNAVAILABLE")); }
    public void onComplete() { result.complete(bytes.toByteArray()); }
}
