package com.contoso.correlation;

import io.opentelemetry.api.trace.SpanKind;
import java.util.*;

public final class SpanOracle {
    private SpanOracle() {}

    public record Link(String traceId, String spanId) {}
    public record Evidence(String boundary, String role, SpanKind kind, String traceId,
                           String spanId, String parentId, List<Link> links, Map<String, String> properties) {
        public Evidence {
            links = List.copyOf(links);
            properties = Map.copyOf(properties);
        }
    }
    public record Expected(String boundary, String role, SpanKind kind, String parentBoundary,
                           Set<String> linkedBoundaries, boolean requireBusinessId) {
        public Expected { linkedBoundaries = Set.copyOf(linkedBoundaries); }
    }

    public static void verify(List<Expected> expected, List<Evidence> actual, String businessId) {
        InvocationId.parse(businessId);
        if (expected.isEmpty() || actual.size() != expected.size()) fail("SPAN_COUNT");
        Map<String, Evidence> byBoundary = new HashMap<>();
        Set<String> identifiers = new HashSet<>();
        for (Evidence span : actual) {
            if (!valid(span.traceId(), 32) || !valid(span.spanId(), 16) ||
                !identifiers.add(span.spanId()) || byBoundary.put(span.boundary(), span) != null) fail("SPAN_IDENTITY");
            if (span.links().size() > Correlation.MAX_LINKS ||
                span.links().stream().anyMatch(link -> !valid(link.traceId(), 32) || !valid(link.spanId(), 16))) fail("SPAN_LINKS");
            for (String key : span.properties().keySet()) {
                if (Set.of("db.statement", "db.query.text", "db.connection_string", "db.user",
                    "redis.key", "redis.value", "redis.script", "Authorization", "Cookie").contains(key)) fail("DATA_SAFETY");
            }
        }
        for (Expected boundary : expected) {
            Evidence span = byBoundary.get(boundary.boundary());
            if (span == null || !boundary.role().equals(span.role()) || boundary.kind() != span.kind()) fail("SPAN_BOUNDARY");
            if (boundary.requireBusinessId() && !businessId.equals(span.properties().get(Correlation.ATTRIBUTE))) fail("BUSINESS_ID");
            if (boundary.parentBoundary() == null) {
                if (span.parentId() != null && !span.parentId().isEmpty()) fail("UNEXPECTED_PARENT");
            } else {
                Evidence parent = byBoundary.get(boundary.parentBoundary());
                if (parent == null || !parent.spanId().equals(span.parentId()) || !parent.traceId().equals(span.traceId())) fail("SPAN_PARENT");
            }
            Set<Link> links = new HashSet<>();
            for (String linked : boundary.linkedBoundaries()) {
                Evidence contributor = byBoundary.get(linked);
                if (contributor == null) fail("MISSING_CONTRIBUTOR");
                links.add(new Link(contributor.traceId(), contributor.spanId()));
            }
            if (!links.equals(new HashSet<>(span.links()))) fail("NATIVE_LINK_MEMBERSHIP");
        }
    }

    private static boolean valid(String id, int length) {
        return id != null && id.matches("[0-9a-f]{" + length + "}") && !id.matches("0+");
    }
    private static void fail(String code) { throw new IllegalStateException("GATE_05_" + code); }
}
