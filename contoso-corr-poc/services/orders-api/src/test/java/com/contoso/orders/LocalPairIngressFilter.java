package com.contoso.orders;

import com.contoso.correlation.InvocationId;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;

public final class LocalPairIngressFilter extends OncePerRequestFilter implements Ordered {
    private static final ObjectMapper JSON = new ObjectMapper();
    static final String RECORDED = "contoso.local-pair.ingress-recorded";

    @Override public int getOrder() { return Ordered.HIGHEST_PRECEDENCE; }
    @Override protected boolean shouldNotFilterAsyncDispatch() { return false; }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                              FilterChain chain) throws ServletException, IOException {
        chain.doFilter(request, response);
        if ("POST".equals(request.getMethod()) && "/api/orders".equals(request.getRequestURI()) &&
                response.getStatus() == 202) {
            synchronized (request) {
                if (request.getAttribute(RECORDED) == null) {
                    try {
                        var record = observation(request, response, Span.current().getSpanContext());
                        System.out.println("CONTOSO_LOCAL_PAIR_INGRESS " + JSON.writeValueAsString(record));
                        request.setAttribute(RECORDED, true);
                    } catch (IllegalArgumentException invalid) {
                        throw new ServletException("LOCAL_PAIR_INGRESS_REJECTED");
                    }
                }
            }
        }
    }

    static Map<String, Object> observation(HttpServletRequest request, HttpServletResponse response, SpanContext sdk) {
        var parents = Collections.list(request.getHeaders("traceparent"));
        var states = Collections.list(request.getHeaders("tracestate"));
        if (request.getQueryString() != null || parents.size() != 1 ||
                !parents.getFirst().matches("00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-01") ||
                states.size() > 1 || (!states.isEmpty() && !"contoso=cert".equals(states.getFirst())) ||
                !sdk.isValid() || !sdk.isSampled()) {
            throw new IllegalArgumentException("LOCAL_PAIR_INGRESS_REJECTED");
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("schema", "contoso.local-pair-ingress.v1");
        result.put("profile", "LOCAL REHEARSAL");
        result.put("method", request.getMethod());
        result.put("path", request.getRequestURI());
        result.put("traceparent", parents.getFirst());
        if (!states.isEmpty()) result.put("tracestate", states.getFirst());
        result.put("sdkTraceId", sdk.getTraceId());
        result.put("sdkSpanId", sdk.getSpanId());
        result.put("observedAtUtc", Instant.now().toString());
        result.put("businessInvocationId", InvocationId.parse(response.getHeader("x-business-invocation-id")).value());
        return result;
    }
}
