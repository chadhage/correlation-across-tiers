package com.contoso.correlation;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.util.concurrent.atomic.AtomicBoolean;

public final class CorrelationSpan implements AutoCloseable {
    private final Span span;
    private final Context context;
    private final AtomicBoolean ended = new AtomicBoolean();

    CorrelationSpan(Span span, Context context) {
        this.span = span;
        this.context = context.with(span);
    }

    public Context context() { return context; }
    public SpanContext spanContext() { return span.getSpanContext(); }
    public Scope makeCurrent() { return Correlation.bind(context); }
    public void failure(String code) {
        String safe = Correlation.safeCode(code);
        span.setAttribute("error.type", safe);
        span.setStatus(StatusCode.ERROR, safe);
        span.recordException(new SafeTelemetryFailure(safe));
    }
    public void attribute(String key, String value) { Correlation.setSafeAttribute(span, key, value); }
    public void close() { if (ended.compareAndSet(false, true)) span.end(); }

    private static final class SafeTelemetryFailure extends RuntimeException {
        SafeTelemetryFailure(String code) { super(code, null, false, false); }
    }
}
