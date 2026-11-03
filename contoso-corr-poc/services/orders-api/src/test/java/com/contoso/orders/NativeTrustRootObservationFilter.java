package com.contoso.orders;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;

public final class NativeTrustRootObservationFilter extends OncePerRequestFilter implements Ordered {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String CASE_HEADER = "X-Contoso-Native-Case";
    private final String roleName;

    public NativeTrustRootObservationFilter(String roleName) {
        if (!"contoso-orders-api".equals(roleName)) throw new IllegalArgumentException("NATIVE_OBSERVER_ROLE");
        this.roleName = roleName;
    }

    @Override public int getOrder() { return Ordered.HIGHEST_PRECEDENCE; }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                              FilterChain chain) throws ServletException, IOException {
        if (request.getHeader(CASE_HEADER) == null) {
            chain.doFilter(request, response);
            return;
        }
        try {
            Map<String, Object> observation = observation(request);
            String record = JSON.writeValueAsString(observation);
            if (record.getBytes(StandardCharsets.UTF_8).length > 8192) {
                throw new IllegalStateException("NATIVE_OBSERVER_RECORD_BOUND");
            }
            System.out.println("CONTOSO_NATIVE_ROOT_OBSERVATION " + record);
        } catch (IllegalArgumentException invalid) {
            System.out.println("CONTOSO_NATIVE_ROOT_REJECTED INPUT_REJECTED");
            response.sendError(400, "NATIVE_OBSERVER_INPUT_REJECTED");
            return;
        } catch (IOException | NoSuchAlgorithmException | URISyntaxException | IllegalStateException | SecurityException unavailable) {
            System.out.println("CONTOSO_NATIVE_ROOT_REJECTED OBSERVATION_UNAVAILABLE");
            throw new ServletException("NATIVE_OBSERVER_UNAVAILABLE");
        }
        chain.doFilter(request, response);
    }

    private Map<String, Object> observation(HttpServletRequest request)
            throws IOException, NoSuchAlgorithmException, URISyntaxException {
        if (!"GET".equals(request.getMethod()) || !"/api/me".equals(request.getRequestURI()) ||
            request.getQueryString() != null) throw new IllegalArgumentException("NATIVE_OBSERVER_REQUEST");
        String caseId = singleUuid(request, CASE_HEADER);
        String business = singleUuid(request, "X-Business-Invocation-Id");
        List<String> traceparent = fields(request, "traceparent", 256);
        List<String> tracestate = fields(request, "tracestate", 512);
        // Only the fixed runner's technical control shapes may reach this test-only stdout port.
        for (String value : traceparent) {
            if (!value.matches("[0-9a-fA-F]{2}-[0-9a-fA-F]{32}-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}")) {
                throw new IllegalArgumentException("NATIVE_OBSERVER_CARRIER");
            }
        }
        if (!tracestate.isEmpty() && !tracestate.equals(List.of("bad key=value"))) {
            throw new IllegalArgumentException("NATIVE_OBSERVER_STATE_CONTROL");
        }
        Span actual = Span.current();
        var context = actual.getSpanContext();
        var process = ProcessHandle.current();
        var result = new LinkedHashMap<String, Object>();
        result.put("schema", "contoso.actual-api-root-observation.v1");
        result.put("caseId", caseId);
        result.put("pid", process.pid());
        result.put("processStartUtc", process.info().startInstant()
            .orElseThrow(() -> new IllegalStateException("NATIVE_OBSERVER_PROCESS_START")).toString());
        result.put("observedAtUtc", Instant.now().toString());
        result.put("roleName", roleName);
        result.put("requestMethod", request.getMethod());
        result.put("requestPath", request.getRequestURI());
        result.put("businessInvocationId", business);
        result.put("traceparentFields", traceparent);
        result.put("tracestateFields", tracestate);
        result.put("sdkTraceId", context.getTraceId());
        result.put("sdkSpanId", context.getSpanId());
        result.put("sdkSampled", context.isSampled());
        result.put("sdkRecording", actual.isRecording());
        origin(result, "fixture", NativeApiFixture.class);
        origin(result, "observer", NativeTrustRootObservationFilter.class);
        origin(result, "application", OrdersApplication.class);
        origin(result, "runtimeGuard", RuntimeGuard.class);
        return result;
    }

    private static String singleUuid(HttpServletRequest request, String name) {
        List<String> values = fields(request, name, 36);
        if (values.size() != 1) throw new IllegalArgumentException("NATIVE_OBSERVER_CASE");
        return InvocationId.parse(values.getFirst()).value();
    }

    private static List<String> fields(HttpServletRequest request, String name, int maximumBytes) {
        var values = new ArrayList<String>();
        var fields = request.getHeaders(name);
        while (fields.hasMoreElements()) {
            String value = fields.nextElement();
            if (values.size() >= 8 || value == null ||
                value.getBytes(StandardCharsets.UTF_8).length > maximumBytes) {
                throw new IllegalArgumentException("NATIVE_OBSERVER_FIELD_BOUND");
            }
            values.add(value);
        }
        return List.copyOf(values);
    }

    private static void origin(Map<String, Object> record, String prefix, Class<?> actualType)
            throws IOException, NoSuchAlgorithmException, URISyntaxException {
        var domain = actualType.getProtectionDomain();
        if (domain == null || domain.getCodeSource() == null) {
            throw new IllegalStateException("NATIVE_OBSERVER_CLASS_ORIGIN");
        }
        var source = domain.getCodeSource().getLocation().toURI();
        if (!"file".equals(source.getScheme()) || source.getRawUserInfo() != null || source.getRawQuery() != null ||
            source.getRawFragment() != null || (source.getHost() != null && !source.getHost().isEmpty() &&
                !"localhost".equals(source.getHost()))) {
            throw new IllegalStateException("NATIVE_OBSERVER_CLASS_ORIGIN");
        }
        String member = "/" + actualType.getName().replace('.', '/') + ".class";
        try (var input = actualType.getResourceAsStream(member)) {
            if (input == null) throw new IllegalStateException("NATIVE_OBSERVER_CLASS_RESOURCE");
            byte[] bytes = input.readNBytes(1_048_577);
            if (bytes.length > 1_048_576) throw new IllegalStateException("NATIVE_OBSERVER_CLASS_BOUND");
            record.put(prefix + "CodeSource", source.toString());
            record.put(prefix + "ClassSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(bytes)));
        }
    }
}
