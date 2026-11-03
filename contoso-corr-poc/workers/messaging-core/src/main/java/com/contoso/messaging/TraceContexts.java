package com.contoso.messaging;

import com.contoso.correlation.W3c;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class TraceContexts {
    private TraceContexts() {}
    private static final TextMapGetter<Map<String, String>> GETTER = new TextMapGetter<>() {
        public Iterable<String> keys(Map<String, String> carrier) { return List.of("traceparent", "tracestate"); }
        public String get(Map<String, String> carrier, String key) { return carrier.get(key); }
    };
    public record Extracted(Context context, String rejection) {
        public SpanContext spanContext() { return Span.fromContext(context).getSpanContext(); }
    }

    public static Map<String, String> capture(Context context) {
        Map<String, String> carrier = new HashMap<>();
        W3c.inject(context, carrier, Map::put);
        return Map.copyOf(carrier);
    }

    public static Extracted extract(Envelope envelope) {
        return extract(envelope.traceparent(), envelope.tracestate());
    }

    public static Extracted extract(String traceparent, String tracestate) {
        if (traceparent == null) return new Extracted(Context.root(), "ABSENT");
        Map<String, String> carrier = new HashMap<>();
        carrier.put("traceparent", traceparent);
        if (tracestate != null) carrier.put("tracestate", tracestate);
        Context parsed = W3CTraceContextPropagator.getInstance().extract(Context.root(), carrier, GETTER);
        if (!Span.fromContext(parsed).getSpanContext().isValid()) {
            return new Extracted(Context.root(), "INVALID_CONTEXT");
        }
        return new Extracted(parsed, "NONE");
    }

    public static List<SpanContext> links(Envelope envelope) {
        var context = extract(envelope).spanContext();
        return context.isValid() ? List.of(context) : List.of();
    }
}
