package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;
import io.opentelemetry.api.trace.SpanKind;
import java.util.*;
import org.junit.jupiter.api.Test;

class SpanOracleTest {
    private final String invocation = InvocationId.generate().value();
    private final String trace = "12345678901234567890123456789012";
    private final List<SpanOracle.Expected> expected = List.of(
        new SpanOracle.Expected("orders", "contoso-orders-api", SpanKind.SERVER, null, Set.of(), true),
        new SpanOracle.Expected("inventory-call", "contoso-orders-api", SpanKind.CLIENT, "orders", Set.of(), false),
        new SpanOracle.Expected("inventory", "contoso-inventory-api", SpanKind.SERVER, "inventory-call", Set.of(), true));
    private List<SpanOracle.Evidence> actual() {
        return List.of(span("orders", "contoso-orders-api", SpanKind.SERVER, "1111111111111111", ""),
            span("inventory-call", "contoso-orders-api", SpanKind.CLIENT, "2222222222222222", "1111111111111111"),
            span("inventory", "contoso-inventory-api", SpanKind.SERVER, "3333333333333333", "2222222222222222"));
    }
    private SpanOracle.Evidence span(String name, String role, SpanKind kind, String id, String parent) {
        return new SpanOracle.Evidence(name, role, kind, trace, id, parent, List.of(), Map.of(Correlation.ATTRIBUTE, invocation));
    }
    @Test void acceptsExactEmittedGraphNotServiceStartup() {
        assertDoesNotThrow(() -> SpanOracle.verify(expected, actual(), invocation));
        assertThrows(IllegalStateException.class, () -> SpanOracle.verify(expected, List.of(), invocation));
    }
    @Test void disabledModuleDuplicateAndFalseParentFail() {
        assertThrows(IllegalStateException.class, () -> SpanOracle.verify(expected, actual().subList(0, 2), invocation));
        var wrong = new ArrayList<>(actual());
        wrong.set(2, span("inventory", "contoso-inventory-api", SpanKind.SERVER, "3333333333333333", "1111111111111111"));
        assertThrows(IllegalStateException.class, () -> SpanOracle.verify(expected, wrong, invocation));
        wrong.set(2, span("inventory", "contoso-inventory-api", SpanKind.SERVER, "2222222222222222", "1111111111111111"));
        assertThrows(IllegalStateException.class, () -> SpanOracle.verify(expected, wrong, invocation));
    }
    @Test void rawDatabaseCaptureCannotHideBehindAValidGraph() {
        var wrong = new ArrayList<>(actual());
        var span = wrong.get(2);
        wrong.set(2, new SpanOracle.Evidence(span.boundary(), span.role(), span.kind(), span.traceId(), span.spanId(),
            span.parentId(), span.links(), Map.of(Correlation.ATTRIBUTE, invocation, "db.statement", "SELECT synthetic")));
        assertThrows(IllegalStateException.class, () -> SpanOracle.verify(expected, wrong, invocation));
    }
}
