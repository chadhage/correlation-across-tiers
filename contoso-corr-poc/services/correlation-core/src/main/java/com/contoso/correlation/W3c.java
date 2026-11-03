package com.contoso.correlation;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import io.opentelemetry.context.propagation.TextMapSetter;
import java.util.List;
import java.util.Locale;

public final class W3c {
    private W3c() {}
    private static boolean allowed(String key) {
        return key != null && List.of("traceparent", "tracestate").contains(key.toLowerCase(Locale.ROOT));
    }

    public static <C> Context extract(C carrier, TextMapGetter<C> getter) {
        TextMapGetter<C> restricted = new TextMapGetter<>() {
            public Iterable<String> keys(C c) { return List.of("traceparent", "tracestate"); }
            public String get(C c, String key) { return allowed(key) ? getter.get(c, key) : null; }
        };
        return GlobalOpenTelemetry.getPropagators().getTextMapPropagator()
            .extract(Context.root(), carrier, restricted);
    }

    public static <C> void inject(Context context, C carrier, TextMapSetter<C> setter) {
        GlobalOpenTelemetry.getPropagators().getTextMapPropagator()
            .inject(context, carrier, (c, key, value) -> {
                if (allowed(key)) setter.set(c, key, value);
            });
    }
}
