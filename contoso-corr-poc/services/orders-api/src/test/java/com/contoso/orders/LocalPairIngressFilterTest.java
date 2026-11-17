package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.InvocationId;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class LocalPairIngressFilterTest {
    private static final String TRACE = "1234567890abcdef1234567890abcdef";
    private static final String PARENT = "1234567890abcdef";
    private static final String SERVER = "abcdef1234567890";

    private static MockHttpServletRequest request() {
        var request = new MockHttpServletRequest("POST", "/api/orders");
        request.addHeader("traceparent", "00-" + TRACE + "-" + PARENT + "-01");
        return request;
    }
    private static MockHttpServletResponse response() {
        var response = new MockHttpServletResponse();
        response.setHeader("x-business-invocation-id", InvocationId.generate().value());
        return response;
    }
    private static SpanContext sdk() {
        return SpanContext.create(TRACE, SERVER, TraceFlags.getSampled(), TraceState.getDefault());
    }

    @Test void recordsReceivedCarrierAndActualSdkIdentityWithoutInventingState() {
        var response = response();
        var record = LocalPairIngressFilter.observation(request(), response, sdk());
        assertEquals("00-" + TRACE + "-" + PARENT + "-01", record.get("traceparent"));
        assertEquals(SERVER, record.get("sdkSpanId"));
        assertNotEquals(PARENT, record.get("sdkSpanId"));
        assertFalse(record.containsKey("tracestate"));
        assertEquals(response.getHeader("x-business-invocation-id"), record.get("businessInvocationId"));
    }

    @Test void rejectsUnscopedHeaderContentDuplicateCarriersAndMissingSdkContext() {
        var state = request();
        state.addHeader("tracestate", "unapproved=value");
        assertThrows(IllegalArgumentException.class, () -> LocalPairIngressFilter.observation(state, response(), sdk()));
        var duplicate = request();
        duplicate.addHeader("traceparent", duplicate.getHeader("traceparent"));
        assertThrows(IllegalArgumentException.class, () -> LocalPairIngressFilter.observation(duplicate, response(), sdk()));
        assertThrows(IllegalArgumentException.class,
            () -> LocalPairIngressFilter.observation(request(), response(), SpanContext.getInvalid()));
        var response = new MockHttpServletResponse();
        assertThrows(IllegalArgumentException.class,
            () -> LocalPairIngressFilter.observation(request(), response, sdk()));
    }

    @Test void observesCompletedAsyncBodyDispatchExactlyOnce() throws Exception {
        var request = request();
        request.setDispatcherType(jakarta.servlet.DispatcherType.ASYNC);
        var response = response();
        var filter = new LocalPairIngressFilter();
        try (var scope = Span.wrap(sdk()).makeCurrent()) {
            filter.doFilter(request, response, (incoming, outgoing) ->
                ((jakarta.servlet.http.HttpServletResponse) outgoing).setStatus(202));
            assertEquals(true, request.getAttribute(LocalPairIngressFilter.RECORDED));
            request.removeHeader("traceparent");
            assertDoesNotThrow(() -> filter.doFilter(request, response, (incoming, outgoing) -> {}));
        }
    }
}
