package com.contoso.inventory;

import com.contoso.correlation.*;
import com.contoso.correlation.data.*;
import com.contoso.inventory.data.PgRedisInventoryDataAdapter;
import com.contoso.security.RequestAuthenticator;
import io.opentelemetry.context.Context;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;

@SpringBootApplication
public class InventoryApplication {
    public static void main(String[] args) {
        RuntimeGuard.verify("contoso-inventory-api", InventoryApplication.class.getClassLoader());
        SpringApplication.run(InventoryApplication.class, args);
    }
    @Bean(destroyMethod = "close") RequestAuthenticator authenticator() { return RequestAuthenticator.fromEnvironment("contoso-inventory-api"); }
    @Bean(destroyMethod = "close") InventoryDataAdapter adapter() { return PgRedisInventoryDataAdapter.fromEnvironment(); }
    @Bean AuthFilter authFilter(RequestAuthenticator authenticator) { return new AuthFilter(authenticator); }

    static final String INVOCATION = "contoso.invocation";
    static final String OPERATION = "contoso.operation";
    static OperationContext operation(HttpServletRequest request) {
        if (request.getAttribute(OPERATION) instanceof OperationContext context) return context;
        var context = new OperationContext((InvocationId) request.getAttribute(INVOCATION), Context.current(), Instant.now().plusSeconds(5));
        request.setAttribute(OPERATION, context);
        return context;
    }

    public static final class AuthFilter extends OncePerRequestFilter {
        private final RequestAuthenticator authenticator;
        AuthFilter(RequestAuthenticator authenticator) { this.authenticator = authenticator; }
        @Override protected boolean shouldNotFilterAsyncDispatch() { return false; }
        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                                   FilterChain chain) throws IOException, ServletException {
            var completed = BoundedRequestBody.dispatched(request);
            if (completed != null) {
                try (completed; var restored = completed.makeCurrent()) {
                    if (completed.withinDeadline(response)) chain.doFilter(new BufferedRequest(request, completed.bytes()), response);
                }
                return;
            }
            RuntimeGuard.WorkPermit work;
            try { work = RuntimeGuard.admitWork(); }
            catch (IllegalStateException draining) {
                response.setStatus(503);
                response.setContentType("application/json");
                response.getWriter().write("{\"schemaVersion\":1,\"code\":\"SAMPLING_DRAINING\"}");
                return;
            }
            boolean transferred = false;
            try {
                if (List.of("/health/live", "/health/ready").contains(request.getRequestURI())) chain.doFilter(request, response);
                else transferred = authenticateAndHandle(request, response, chain, work);
            } finally { if (!transferred) work.close(); }
        }

        private boolean authenticateAndHandle(HttpServletRequest request, HttpServletResponse response,
                                            FilterChain chain, RuntimeGuard.WorkPermit work) throws ServletException, IOException {
            if (Collections.list(request.getHeaders("Authorization")).size() != 1) {
                response.setStatus(401); return false;
            }
            Instant deadline = Instant.now().plusSeconds(5);
            com.contoso.security.VerifiedCaller caller;
            try {
                caller = authenticator.authenticate(request.getHeader("Authorization"), null);
            } catch (SecurityException failure) {
                com.contoso.security.SafeAuthenticationTelemetry.failure().forEach(io.opentelemetry.api.trace.Span.current()::setAttribute);
                response.setStatus(401);
                response.setContentType("application/json");
                response.getWriter().write("{\"schemaVersion\":1,\"code\":\"UNAUTHENTICATED\"}");
                return false;
            }
            var id = InvocationIds.resolve(Collections.list(request.getHeaders(InvocationIds.HEADER)),
                caller.trustedInvocationIssuer());
            request.setAttribute(INVOCATION, id);
            response.setHeader(InvocationIds.HEADER, id.value());
            try (var scope = Correlation.bind(id, caller.pseudonym().orElse(null))) {
                com.contoso.security.SafeAuthenticationTelemetry.success(caller).forEach(io.opentelemetry.api.trace.Span.current()::setAttribute);
                request.setAttribute(OPERATION, new OperationContext(id, Context.current(), deadline));
                var body = BoundedRequestBody.begin(request, response, deadline, work);
                if (body == null) return false;
                if (body.asynchronous()) return true;
                try (body) {
                    chain.doFilter(new BufferedRequest(request, body.bytes()), response);
                }
            }
            return false;
        }

        static final class BufferedRequest extends HttpServletRequestWrapper {
            private final byte[] bytes;
            BufferedRequest(HttpServletRequest request, byte[] bytes) { super(request); this.bytes = bytes; }
            @Override public ServletInputStream getInputStream() {
                var input = new ByteArrayInputStream(bytes);
                return new ServletInputStream() {
                    public int read() { return input.read(); }
                    public boolean isFinished() { return input.available() == 0; }
                    public boolean isReady() { return true; }
                    public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException("synchronous_input"); }
                };
            }
            @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(), java.nio.charset.StandardCharsets.UTF_8)); }
        }
    }

    @RestController
    static class Api {
        private final InventoryDataAdapter data;
        Api(InventoryDataAdapter data) { this.data = data; }
        @GetMapping("/health/live") Map<String, Object> live() { return Map.of("status", "UP", "certified", false); }
        @GetMapping("/health/ready") ResponseEntity<?> ready() {
            boolean ready = data.isReady();
            return ResponseEntity.status(ready ? 200 : 503).body(Map.of("status", ready ? "READY" : "NOT_READY", "certified", false));
        }
        @GetMapping("/api/inventory/{sku}") InventoryItem lookup(@PathVariable String sku, HttpServletRequest request) {
            if (!sku.matches("[A-Za-z0-9_-]{1,64}")) throw new IllegalArgumentException("invalid_sku");
            return data.lookupInventory(sku, operation(request));
        }
        @PostMapping("/api/inventory/reservations") Reservation reserve(@RequestBody ReserveBody body, HttpServletRequest request) {
            if (body.schemaVersion() != 1 || body.quantity() < 1 || body.quantity() > 100 ||
                body.sku() == null || !body.sku().matches("[A-Za-z0-9_-]{1,64}")) throw new IllegalArgumentException("invalid_reservation");
            InvocationId.parse(body.orderId());
            return data.reserveInventory(body.orderId(), body.sku(), body.quantity(), operation(request));
        }
        @PostMapping("/api/inventory/reservations/{id}/release") Reservation release(@PathVariable String id,
                @RequestBody ReleaseBody body, HttpServletRequest request) {
            if (body.schemaVersion() != 1) throw new IllegalArgumentException("invalid_schema");
            InvocationId.parse(id); InvocationId.parse(body.orderId());
            return data.releaseInventory(body.orderId(), id, operation(request));
        }
    }
    record ReserveBody(int schemaVersion, String orderId, String sku, int quantity) {}
    record ReleaseBody(int schemaVersion, String orderId) {}
    @RestControllerAdvice
    static class Errors {
        @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
        ResponseEntity<?> missing() { return error(404, "NOT_FOUND"); }
        @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class})
        ResponseEntity<?> invalid() { return error(400, "INVALID_REQUEST"); }
        @ExceptionHandler(Exception.class) ResponseEntity<?> unavailable(Exception failure) {
            String category = failure instanceof DataAccessException data ? "DATA_" + data.kind().name() : "INTERNAL";
            return error(503, "DEPENDENCY_UNAVAILABLE", category);
        }
        private static ResponseEntity<?> error(int status, String code) {
            return error(status, code, code);
        }
        private static ResponseEntity<?> error(int status, String code, String category) {
            Correlation.failure(category);
            Correlation.log(org.slf4j.LoggerFactory.getLogger(Errors.class), "inventory.request", category);
            return ResponseEntity.status(status).body(Map.of("schemaVersion", 1, "code", code));
        }
    }
}
