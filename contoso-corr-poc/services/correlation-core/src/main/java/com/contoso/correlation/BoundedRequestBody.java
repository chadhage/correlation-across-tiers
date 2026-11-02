package com.contoso.correlation;

import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import jakarta.servlet.AsyncContext;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BoundedRequestBody implements AutoCloseable {
    public static final int LIMIT = 16384;
    private static final String ATTRIBUTE = "contoso.bounded.request.body";
    private static final ScheduledExecutorService DEADLINES = Executors.newScheduledThreadPool(2, action -> {
        var thread = new Thread(action, "contoso-request-body-deadline"); thread.setDaemon(true); return thread;
    });
    private final AsyncContext async;
    private final RuntimeGuard.WorkPermit work;
    private final Context context;
    private final Instant deadline;
    private final long expires;
    private final AtomicBoolean finished = new AtomicBoolean();
    private volatile byte[] bytes;
    private ScheduledFuture<?> timeout;

    private BoundedRequestBody(byte[] bytes, AsyncContext async, RuntimeGuard.WorkPermit work, Instant deadline) {
        this.bytes = bytes; this.async = async; this.work = work; this.context = Context.current(); this.deadline = deadline;
        expires = System.nanoTime() + Math.max(0, Duration.between(Instant.now(), deadline).toNanos());
    }

    public byte[] bytes() { return bytes; }
    public boolean asynchronous() { return async != null; }
    public Scope makeCurrent() { return Correlation.bind(context); }
    public static BoundedRequestBody dispatched(HttpServletRequest request) {
        return request.getAttribute(ATTRIBUTE) instanceof BoundedRequestBody body && body.bytes != null ? body : null;
    }

    public boolean withinDeadline(HttpServletResponse response) throws IOException {
        if (remaining() > 0) return true;
        reject(response, 408, "REQUEST_TIMEOUT");
        return false;
    }

    public static BoundedRequestBody begin(HttpServletRequest request, HttpServletResponse response,
                                            Instant deadline, RuntimeGuard.WorkPermit work) throws IOException {
        if (request.getContentLengthLong() > LIMIT) { reject(response, 413, "PAYLOAD_TOO_LARGE"); return null; }
        if (!Instant.now().isBefore(deadline)) { reject(response, 408, "REQUEST_TIMEOUT"); return null; }
        ServletInputStream input = request.getInputStream();
        if (request.getContentLengthLong() == 0 || input.isFinished() ||
            request.getContentLengthLong() < 0 && request.getHeader("Transfer-Encoding") == null &&
                ("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))) {
            return new BoundedRequestBody(new byte[0], null, null, deadline);
        }
        if (!request.isAsyncSupported()) { reject(response, 503, "BODY_READER_UNAVAILABLE"); return null; }
        AsyncContext async = request.startAsync();
        var body = new BoundedRequestBody(null, async, work, deadline);
        request.setAttribute(ATTRIBUTE, body);
        body.timeout = DEADLINES.schedule(() -> body.fail(response, 408, "REQUEST_TIMEOUT"),
            Math.max(0, body.remaining()), TimeUnit.NANOSECONDS);
        async.setTimeout(Math.max(1, TimeUnit.NANOSECONDS.toMillis(Math.max(0, body.remaining()))));
        try {
            input.setReadListener(new ReadListener() {
                private final ByteArrayOutputStream received = new ByteArrayOutputStream();
                public void onDataAvailable() {
                    try {
                        byte[] buffer = new byte[1024];
                        while (!body.finished.get() && input.isReady() && !input.isFinished()) {
                            if (body.remaining() <= 0) { body.fail(response, 408, "REQUEST_TIMEOUT"); return; }
                            int count = input.read(buffer);
                            if (count < 0) { onAllDataRead(); return; }
                            if (count > LIMIT - received.size()) { body.fail(response, 413, "PAYLOAD_TOO_LARGE"); return; }
                            received.write(buffer, 0, count);
                        }
                        if (input.isFinished()) onAllDataRead();
                    } catch (IOException failure) { body.fail(response, 400, "INVALID_REQUEST"); }
                }
                public void onAllDataRead() {
                    if (body.remaining() <= 0) { body.fail(response, 408, "REQUEST_TIMEOUT"); return; }
                    if (!body.finished.compareAndSet(false, true)) return;
                    body.bytes = received.toByteArray();
                    body.timeout.cancel(false);
                    try { async.dispatch(); }
                    catch (IllegalStateException closed) { body.close(); }
                }
                public void onError(Throwable failure) { body.fail(response, 400, "INVALID_REQUEST"); }
            });
        } catch (RuntimeException failure) { body.fail(response, 400, "INVALID_REQUEST"); }
        return body;
    }

    private long remaining() {
        return Math.min(expires - System.nanoTime(), Duration.between(Instant.now(), deadline).toNanos());
    }
    private void fail(HttpServletResponse response, int status, String code) {
        if (!finished.compareAndSet(false, true)) return;
        try (var restored = makeCurrent()) { reject(response, status, code); }
        catch (IOException ignored) {}
        finally { close(); }
    }
    private static void reject(HttpServletResponse response, int status, String code) throws IOException {
        Correlation.failure(code);
        response.setStatus(status); response.setHeader("Connection", "close"); response.setContentType("application/json");
        response.getWriter().write("{\"schemaVersion\":1,\"code\":\"" + code + "\"}");
    }
    public void close() {
        if (timeout != null) timeout.cancel(false);
        if (work != null) work.close();
        if (async != null) try { async.complete(); } catch (IllegalStateException alreadyCompleted) {}
    }
}
