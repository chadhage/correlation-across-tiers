package com.contoso.correlation;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.ContextKey;
import io.opentelemetry.context.Scope;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.MDC;

public final class Correlation {
    public static final String ATTRIBUTE = "business.invocation_id";
    public static final int MAX_LINKS = 32;
    private static final ContextKey<InvocationId> INVOCATION = ContextKey.named(ATTRIBUTE);
    private static final ContextKey<String> PSEUDONYM = ContextKey.named("user.pseudonym");
    private static final Pattern CODE = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]{0,63}");
    private static final Set<String> ALLOWED = Set.of(
        "db.system", "db.system.name", "db.name", "db.namespace", "db.operation.name",
        "server.address", "server.port", "contoso.data.operation", "contoso.cache.outcome",
        "messaging.system", "messaging.destination.name", "messaging.operation.name",
        "messaging.destination.partition.id", "messaging.eventhubs.message.offset",
        "messaging.message.id", "messaging.batch.message_count", "contoso.process.attempt",
        "contoso.publish.attempt", "contoso.message.id", "contoso.run.id", "contoso.workflow.id",
        "contoso.original.message.id", "contoso.causation.id",
        "contoso.branch", "contoso.outcome", "contoso.span.kind", "contoso.transport",
        "contoso.link.count", "contoso.context.rejection", "error.type");
    private Correlation() {}

    public static String safeCode(String code) {
        return code != null && CODE.matcher(code).matches() ? code : "INTERNAL";
    }

    public static CorrelationSpan start(String name, SpanKind kind, Context parent,
                                        InvocationId id, Map<String, String> attributes) {
        if (name == null || !name.matches("[a-z][a-z0-9_.-]{0,95}") || kind == null) {
            throw new IllegalArgumentException("invalid_span_boundary");
        }
        validateAttributes(attributes);
        Context base = parent == null ? Context.current() : parent;
        if (id != null) base = base.with(INVOCATION, id);
        Span span = GlobalOpenTelemetry.getTracer("com.contoso.correlation", "1.0.0")
            .spanBuilder(name).setParent(base).setSpanKind(kind)
            .setAllAttributes(attributes(kind, id, base, attributes)).startSpan();
        return new CorrelationSpan(span, base);
    }

    public static CorrelationSpan startLinked(String name, SpanKind kind, InvocationId id,
                                              List<SpanContext> links, Map<String, String> attributes) {
        if (links == null || links.size() > MAX_LINKS ||
            links.stream().anyMatch(link -> link == null || !link.isValid())) {
            throw new IllegalArgumentException("invalid_link_set");
        }
        if (name == null || !name.matches("[a-z][a-z0-9_.-]{0,95}") || kind == null) {
            throw new IllegalArgumentException("invalid_span_boundary");
        }
        validateAttributes(attributes);
        Context base = id == null ? Context.root() : Context.root().with(INVOCATION, id);
        var builder = GlobalOpenTelemetry.getTracer("com.contoso.correlation", "1.0.0")
            .spanBuilder(name).setNoParent().setSpanKind(kind)
            .setAllAttributes(attributes(kind, id, base, attributes));
        links.stream().distinct().forEach(builder::addLink);
        Span span = builder.startSpan();
        span.setAttribute("contoso.link.count", links.stream().distinct().count());
        return new CorrelationSpan(span, base);
    }

    private static Attributes attributes(SpanKind kind, InvocationId id, Context context, Map<String, String> values) {
        var builder = Attributes.builder().put("contoso.span.kind", kind.name());
        if (id != null) builder.put(ATTRIBUTE, id.value());
        String pseudonym = context.get(PSEUDONYM);
        if (pseudonym != null) builder.put("user.pseudonym", pseudonym);
        if (values != null) values.forEach((key, value) -> {
            if (numeric(key)) builder.put(key, Long.parseLong(value));
            else builder.put(key, value);
        });
        return builder.build();
    }

    private static boolean numeric(String key) {
        return key.equals("server.port") || key.endsWith(".attempt") ||
            key.equals("messaging.batch.message_count") || key.equals("contoso.link.count");
    }

    static void setSafeAttribute(Span span, String key, String value) {
        validateAttribute(key, value);
        if (numeric(key)) {
            try {
                long number = Long.parseLong(value);
                if (number < 0 || number > 1_000_000_000) throw new NumberFormatException();
                span.setAttribute(key, number);
            } catch (NumberFormatException failure) { throw new IllegalArgumentException("invalid_numeric_attribute"); }
        } else {
            span.setAttribute(key, value);
        }
    }

    private static void validateAttributes(Map<String, String> attributes) {
        if (attributes != null) attributes.forEach(Correlation::validateAttribute);
    }

    private static void validateAttribute(String key, String value) {
        if (!ALLOWED.contains(key) || value == null || value.length() > 256 ||
            value.chars().anyMatch(c -> c < 32 || c == 127)) {
            throw new IllegalArgumentException("unsafe_telemetry_attribute");
        }
        if (numeric(key) &&
            (!value.matches("[0-9]{1,10}") || Long.parseLong(value) > 1_000_000_000L)) {
            throw new IllegalArgumentException("invalid_numeric_attribute");
        }
        if ((key.equals("messaging.destination.partition.id") || key.equals("messaging.eventhubs.message.offset")) &&
            !value.matches("[0-9]{1,20}")) {
            throw new IllegalArgumentException("invalid_message_position");
        }
        if ((key.equals("contoso.context.rejection") || key.equals("error.type")) &&
            !CODE.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid_error_category");
        }
        if (key.equals("contoso.original.message.id") || key.equals("contoso.causation.id")) InvocationId.parse(value);
    }

    public static InvocationId invocation(Context context) { return context.get(INVOCATION); }

    public static void failure(String code) { CorrelationSpan.failure(Span.current(), code); }

    public static Scope bind(InvocationId id) {
        return bind(id, null);
    }

    public static Scope bind(InvocationId id, String pseudonym) {
        Span.current().setAttribute(ATTRIBUTE, id.value());
        Context context = Context.current().with(INVOCATION, id);
        if (pseudonym != null) {
            if (!pseudonym.matches("[A-Za-z0-9_:.~-]{1,160}")) throw new IllegalArgumentException("invalid_pseudonym");
            Span.current().setAttribute("user.pseudonym", pseudonym);
            context = context.with(PSEUDONYM, pseudonym);
        }
        return bind(context);
    }

    static Scope bind(Context context) {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        Scope scope = context.makeCurrent();
        MDC.clear();
        InvocationId id = context.get(INVOCATION);
        if (id != null) MDC.put(ATTRIBUTE, id.value());
        String pseudonym = context.get(PSEUDONYM);
        if (pseudonym != null) MDC.put("user.pseudonym", pseudonym);
        return () -> {
            try { scope.close(); }
            finally {
                if (previous == null) MDC.clear(); else MDC.setContextMap(previous);
            }
        };
    }

    public static Runnable wrap(Runnable action) {
        Context captured = Context.current();
        return () -> { try (Scope ignored = bind(captured)) { action.run(); } };
    }

    public static <T> Callable<T> wrap(Callable<T> action) {
        Context captured = Context.current();
        return () -> { try (Scope ignored = bind(captured)) { return action.call(); } };
    }

    public static void log(Logger logger, String event, String outcome) {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.clear();
            InvocationId id = Context.current().get(INVOCATION);
            if (id != null) MDC.put(ATTRIBUTE, id.value());
            String pseudonym = Context.current().get(PSEUDONYM);
            if (pseudonym != null) MDC.put("user.pseudonym", pseudonym);
            logger.info("{} {}", safeCode(event), safeCode(outcome));
        } finally {
            if (previous == null) MDC.clear(); else MDC.setContextMap(previous);
        }
    }
}
