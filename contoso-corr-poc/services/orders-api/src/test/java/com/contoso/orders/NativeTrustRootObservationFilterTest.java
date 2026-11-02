package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.InvocationId;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class NativeTrustRootObservationFilterTest {
    private static MockHttpServletRequest request() {
        var request = new MockHttpServletRequest("GET", "/api/me");
        request.addHeader("X-Contoso-Native-Case", InvocationId.generate().value());
        request.addHeader("X-Business-Invocation-Id", InvocationId.generate().value());
        return request;
    }

    @Test void noDiagnosticHeaderLeavesOrdinaryRequestAndAuthenticationChainUnchanged() throws Exception {
        var request = new MockHttpServletRequest("GET", "/health/ready");
        var invoked = new AtomicBoolean();
        new NativeTrustRootObservationFilter("contoso-orders-api").doFilter(request, new MockHttpServletResponse(),
            (input, response) -> invoked.set(true));
        assertTrue(invoked.get());
    }

    @Test void recordsActualSdkAndClassResourceFactsWithoutAddingAProviderOrCarrierDerivedIds() throws Exception {
        var request = request();
        request.addHeader("traceparent", "00-" + "0".repeat(32) + "-" + "1".repeat(16) + "-01");
        request.addHeader("tracestate", "bad key=value");
        var output = new ByteArrayOutputStream();
        PrintStream original = System.out;
        var invoked = new AtomicBoolean();
        try (var stream = new PrintStream(output, true, StandardCharsets.UTF_8)) {
            System.setOut(stream);
            new NativeTrustRootObservationFilter("contoso-orders-api").doFilter(request, new MockHttpServletResponse(),
                (input, response) -> invoked.set(true));
        } finally { System.setOut(original); }
        assertTrue(invoked.get());
        String line = output.toString(StandardCharsets.UTF_8).trim();
        assertTrue(line.startsWith("CONTOSO_NATIVE_ROOT_OBSERVATION "));
        var record = new ObjectMapper().readTree(line.substring("CONTOSO_NATIVE_ROOT_OBSERVATION ".length()));
        assertEquals(23, record.size());
        assertEquals(ProcessHandle.current().pid(), record.path("pid").asLong());
        assertEquals(request.getHeader("X-Contoso-Native-Case"), record.path("caseId").asText());
        assertEquals(request.getHeader("traceparent"), record.path("traceparentFields").get(0).asText());
        assertEquals(io.opentelemetry.api.trace.Span.current().getSpanContext().getTraceId(), record.path("sdkTraceId").asText());
        assertEquals(io.opentelemetry.api.trace.Span.current().getSpanContext().getSpanId(), record.path("sdkSpanId").asText());
        for (String prefix : new String[]{"fixture", "observer", "application", "runtimeGuard"}) {
            assertTrue(record.path(prefix + "CodeSource").asText().startsWith("file:"));
            assertTrue(record.path(prefix + "ClassSha256").asText().matches("[0-9a-f]{64}"));
        }
        assertFalse(record.has("Authorization"));
        assertFalse(record.has("nativeAuthority"));
    }

    @Test void privateOrUnsupportedDiagnosticInputsFailWithOnlyAStaticRejection() throws Exception {
        for (String field : new String[]{"traceparent", "tracestate", "X-Contoso-Native-Case"}) {
            var request = request();
            request.removeHeader(field);
            request.addHeader(field, "PRIVATE_OBSERVER_INPUT_CANARY");
            var response = new MockHttpServletResponse();
            var output = new ByteArrayOutputStream();
            PrintStream original = System.out;
            try (var stream = new PrintStream(output, true, StandardCharsets.UTF_8)) {
                System.setOut(stream);
                new NativeTrustRootObservationFilter("contoso-orders-api").doFilter(request, response,
                    (input, result) -> fail("Rejected diagnostic input must not run application handling"));
            } finally { System.setOut(original); }
            assertEquals(400, response.getStatus());
            assertEquals("CONTOSO_NATIVE_ROOT_REJECTED INPUT_REJECTED", output.toString(StandardCharsets.UTF_8).trim());
            assertFalse(output.toString(StandardCharsets.UTF_8).contains("CANARY"));
        }
    }

    @Test void duplicateCaseIdentifiersAndQueryValuesAreNeverSerialized() throws Exception {
        for (boolean duplicate : new boolean[]{true, false}) {
            var request = request();
            if (duplicate) request.addHeader("X-Contoso-Native-Case", InvocationId.generate().value());
            else request.setQueryString("private=OBSERVER_QUERY_CANARY");
            var response = new MockHttpServletResponse();
            var output = new ByteArrayOutputStream();
            PrintStream original = System.out;
            try (var stream = new PrintStream(output, true, StandardCharsets.UTF_8)) {
                System.setOut(stream);
                new NativeTrustRootObservationFilter("contoso-orders-api").doFilter(request, response,
                    (input, result) -> fail("Unexpected diagnostic input must not pass"));
            } finally { System.setOut(original); }
            assertEquals(400, response.getStatus());
            assertFalse(output.toString(StandardCharsets.UTF_8).contains("CANARY"));
        }
    }
}
