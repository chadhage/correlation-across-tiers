package com.contoso.orders;

import com.contoso.correlation.*;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import com.contoso.correlation.workflow.*;
import com.contoso.inventory.data.EntraPgConnectionFactory;
import com.contoso.messaging.MessagingWorkflowPort;
import com.contoso.security.RequestAuthenticator;
import com.contoso.security.VerifiedCaller;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;

@SpringBootApplication
public class OrdersApplication {
    public static void main(String[] args) {
        RuntimeGuard.verify("contoso-orders-api", OrdersApplication.class.getClassLoader());
        SpringApplication.run(OrdersApplication.class, args);
    }

    @Bean(destroyMethod = "close") RequestAuthenticator authenticator() {
        return RequestAuthenticator.fromEnvironment("contoso-orders-api");
    }
    @Bean(destroyMethod = "close") com.contoso.correlation.data.PgConnectionFactory connections() {
        return EntraPgConnectionFactory.fromEnvironment("contoso-orders-api");
    }
    @Bean(destroyMethod = "close") WorkflowPort workflows(com.contoso.correlation.data.PgConnectionFactory connections) {
        return MessagingWorkflowPort.fromEnvironment(connections);
    }
    @Bean AuthFilter authFilter(RequestAuthenticator auth) { return new AuthFilter(auth); }
    @Bean(destroyMethod = "close") InventoryHttpClient inventoryHttpClient() { return InventoryHttpClient.fromEnvironment(); }

    static final String CALLER = "contoso.verified.caller";
    static final String INVOCATION = "contoso.invocation";
    static final String OPERATION = "contoso.operation";

    static OperationContext operation(HttpServletRequest request) {
        if (request.getAttribute(OPERATION) instanceof OperationContext context) return context;
        var context = new OperationContext((InvocationId) request.getAttribute(INVOCATION), Context.current(),
            Instant.now().plusSeconds(10));
        request.setAttribute(OPERATION, context);
        return context;
    }

    static void schema(int version) {
        if (version != 1) throw new IllegalArgumentException("invalid_schema_version");
    }

    public static final class AuthFilter extends OncePerRequestFilter {
        private final RequestAuthenticator authenticator;
        AuthFilter(RequestAuthenticator authenticator) { this.authenticator = authenticator; }
        @Override protected boolean shouldNotFilterAsyncDispatch() { return false; }

        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                                  FilterChain chain) throws ServletException, IOException {
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
            Instant deadline = Instant.now().plusSeconds(10);
            if (Collections.list(request.getHeaders("Authorization")).size() != 1 ||
                Collections.list(request.getHeaders("X-Contoso-Gateway-Authorization")).size() != 1) {
                response.setStatus(401);
                return false;
            }
            VerifiedCaller caller;
            try {
                caller = authenticator.authenticate(request.getHeader("Authorization"),
                    request.getHeader("X-Contoso-Gateway-Authorization"));
            } catch (SecurityException failure) {
                com.contoso.security.SafeAuthenticationTelemetry.failure().forEach(io.opentelemetry.api.trace.Span.current()::setAttribute);
                response.setStatus(401);
                response.setContentType("application/json");
                response.getWriter().write("{\"schemaVersion\":1,\"code\":\"UNAUTHENTICATED\"}");
                return false;
            }
            InvocationId id = InvocationIds.resolve(Collections.list(request.getHeaders(InvocationIds.HEADER)),
                caller.trustedInvocationIssuer());
            request.setAttribute(CALLER, caller);
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

    @RestController
    static class Api {
        private final WorkflowPort workflows;
        private final InventoryHttpClient inventory;
        private final com.contoso.correlation.data.PgConnectionFactory connections;
        Api(WorkflowPort workflows, InventoryHttpClient inventory, com.contoso.correlation.data.PgConnectionFactory connections) {
            this.workflows = workflows; this.inventory = inventory; this.connections = connections;
        }

        @GetMapping("/health/live") Map<String, Object> live() { return Map.of("status", "UP", "certified", false); }
        @GetMapping("/health/ready") ResponseEntity<?> ready() {
            boolean ready = false;
            try {
                var context = new OperationContext(InvocationId.generate(), Context.current(), Instant.now().plusSeconds(2));
                ready = PgOperations.execute(connections, PgOperation.SELECT, context, 1,
                    connection -> connection.isValid(1));
            }
            catch (Exception ignored) { }
            return ResponseEntity.status(ready ? 200 : 503).body(Map.of("status", ready ? "READY" : "NOT_READY", "certified", false));
        }
        @GetMapping("/api/me") Map<String, Object> me(HttpServletRequest request) {
            var caller = (VerifiedCaller) request.getAttribute(CALLER);
            var result = new LinkedHashMap<String, Object>();
            result.put("schemaVersion", 1);
            result.put("actorType", caller.actorType());
            result.put("businessInvocationId", operation(request).invocationId().value());
            caller.pseudonym().ifPresent(value -> result.put("pseudonym", value));
            return result;
        }
        @PostMapping("/api/orders") ResponseEntity<Map<String, Object>> submit(@RequestBody OrderBody body, HttpServletRequest request) {
            schema(body.schemaVersion());
            var context = operation(request);
            OrderCommand command;
            try (var span = Correlation.start("orders.validate", SpanKind.INTERNAL, context.parentContext(),
                    context.invocationId(), Map.of()); var scope = span.makeCurrent()) {
                try {
                    command = new OrderCommand(body.orderId() == null ? InvocationId.generate().value() : body.orderId(), body.sku(), body.quantity());
                } catch (IllegalArgumentException failure) { span.failure("VALIDATION"); throw failure; }
            }
            inventory.lookup(command.sku(), context);
            return ResponseEntity.accepted().body(mutationView(workflows.submitOrder(command, context), context));
        }
        @GetMapping("/api/orders/{id}") Map<String, Object> order(@PathVariable String id, HttpServletRequest request) {
            InvocationId.parse(id);
            return view(workflows.order(id, operation(request)).orElseThrow(Missing::new));
        }
        @GetMapping("/api/inventory/{sku}") Object inventory(@PathVariable String sku, HttpServletRequest request) {
            if (!sku.matches("[A-Za-z0-9_-]{1,64}")) throw new IllegalArgumentException("invalid_sku");
            return inventory.lookup(sku, operation(request));
        }
        @PostMapping("/api/demo-runs") ResponseEntity<Map<String, Object>> start(@RequestBody RunBody body, HttpServletRequest request) {
            schema(body.schemaVersion());
            requireRunPermission(request);
            var command = new DemoRunCommand(body.demoId(), body.scenario() == null ? RunScenario.SYNC : body.scenario(),
                body.failureBudget() == null ? 0 : body.failureBudget(),
                body.runId() == null ? InvocationId.generate().value() : body.runId());
            var context = operation(request);
            return ResponseEntity.accepted().body(mutationView(workflows.startRun(command, context), context));
        }
        @GetMapping("/api/demo-runs/{id}") Map<String, Object> run(@PathVariable String id, HttpServletRequest request) {
            InvocationId.parse(id);
            return view(workflows.run(id, operation(request)).orElseThrow(Missing::new));
        }
        @PostMapping("/api/demo-runs/{id}/controls") ResponseEntity<Map<String, Object>> control(
                @PathVariable String id, @RequestBody ControlBody body, HttpServletRequest request) {
            schema(body.schemaVersion()); InvocationId.parse(id); requireRunPermission(request);
            var context = operation(request);
            return ResponseEntity.accepted().body(mutationView(workflows.controlRun(id,
                new RunControl(body.action(), body.target(), body.failureBudget()), context), context));
        }

        private static void requireRunPermission(HttpServletRequest request) {
            var caller = (VerifiedCaller) request.getAttribute(CALLER);
            if (!caller.canControlRuns()) throw new SecurityException("run_permission_required");
            RuntimeGuard.requireRunWindow(System.getenv(), Instant.now());
        }
    }

    static Map<String, Object> view(WorkflowView value) {
        return Map.of("schemaVersion", 1, "id", value.id(), "businessInvocationId", value.businessInvocationId(),
            "state", value.state(), "details", value.details());
    }

    static Map<String, Object> mutationView(WorkflowView value, OperationContext context) {
        return Map.of("schemaVersion", 1, "id", value.id(),
            "businessInvocationId", context.invocationId().value(),
            "workflowBusinessInvocationId", value.businessInvocationId(),
            "state", value.state(), "details", value.details());
    }

    record OrderBody(int schemaVersion, String orderId, String sku, int quantity) {}
    record RunBody(int schemaVersion, String runId, int demoId, RunScenario scenario, Integer failureBudget) {}
    record ControlBody(int schemaVersion, RunAction action, WorkTarget target, int failureBudget) {}
    static final class Missing extends RuntimeException {}

    @RestControllerAdvice
    static class Errors {
        @ExceptionHandler(SecurityException.class) ResponseEntity<?> forbidden() { return error(403, "FORBIDDEN"); }
        @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class})
        ResponseEntity<?> invalid() { return error(400, "INVALID_REQUEST"); }
        @ExceptionHandler(Missing.class) ResponseEntity<?> missing() { return error(404, "NOT_FOUND"); }
        @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class}) ResponseEntity<?> unknown() { return error(404, "NOT_FOUND"); }
        @ExceptionHandler(Exception.class) ResponseEntity<?> unavailable(Exception failure) {
            String category = failure instanceof InventoryDependencyException dependency ? "INVENTORY_" + dependency.category().name() :
                failure instanceof com.contoso.correlation.data.DataAccessException data ? "DATA_" + data.kind().name() : "INTERNAL";
            return error(503, "DEPENDENCY_UNAVAILABLE", category);
        }
        private static ResponseEntity<?> error(int status, String code) {
            return error(status, code, code);
        }
        private static ResponseEntity<?> error(int status, String code, String category) {
            Correlation.failure(category);
            Correlation.log(org.slf4j.LoggerFactory.getLogger(Errors.class), "orders.request", category);
            return ResponseEntity.status(status).body(Map.of("schemaVersion", 1, "code", code));
        }
    }
}
