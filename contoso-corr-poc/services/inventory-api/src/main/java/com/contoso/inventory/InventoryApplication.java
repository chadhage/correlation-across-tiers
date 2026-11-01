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
    @Bean RequestAuthenticator authenticator() { return RequestAuthenticator.fromEnvironment("contoso-inventory-api"); }
    @Bean(destroyMethod = "close") InventoryDataAdapter adapter() { return PgRedisInventoryDataAdapter.fromEnvironment(); }
    @Bean AuthFilter authFilter(RequestAuthenticator authenticator) { return new AuthFilter(authenticator); }

    static final String INVOCATION = "contoso.invocation";
    static OperationContext operation(HttpServletRequest request) {
        return new OperationContext((InvocationId) request.getAttribute(INVOCATION), Context.current(), Instant.now().plusSeconds(5));
    }

    public static final class AuthFilter extends OncePerRequestFilter {
        private final RequestAuthenticator authenticator;
        AuthFilter(RequestAuthenticator authenticator) { this.authenticator = authenticator; }
        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                                   FilterChain chain) throws IOException, ServletException {
            if (List.of("/health/live", "/health/ready").contains(request.getRequestURI())) { chain.doFilter(request, response); return; }
            if (Collections.list(request.getHeaders("Authorization")).size() != 1) {
                response.setStatus(401); return;
            }
            try {
                var caller = authenticator.authenticate(request.getHeader("Authorization"), null);
                var id = InvocationIds.resolve(Collections.list(request.getHeaders(InvocationIds.HEADER)),
                    caller.trustedInvocationIssuer());
                request.setAttribute(INVOCATION, id);
                response.setHeader(InvocationIds.HEADER, id.value());
                if (request.getContentLengthLong() > 16384) { response.sendError(413); return; }
                byte[] body = request.getInputStream().readNBytes(16385);
                if (body.length > 16384) { response.sendError(413); return; }
                try (var scope = Correlation.bind(id)) { chain.doFilter(new BufferedRequest(request, body), response); }
            } catch (SecurityException failure) {
                response.setStatus(401);
                response.setContentType("application/json");
                response.getWriter().write("{\"schemaVersion\":1,\"code\":\"UNAUTHENTICATED\"}");
            }
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
        ResponseEntity<?> missing() { return ResponseEntity.status(404).body(Map.of("schemaVersion", 1, "code", "NOT_FOUND")); }
        @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class})
        ResponseEntity<?> invalid() { return ResponseEntity.badRequest().body(Map.of("schemaVersion", 1, "code", "INVALID_REQUEST")); }
        @ExceptionHandler(Exception.class) ResponseEntity<?> unavailable() {
            return ResponseEntity.status(503).body(Map.of("schemaVersion", 1, "code", "DEPENDENCY_UNAVAILABLE"));
        }
    }
}
