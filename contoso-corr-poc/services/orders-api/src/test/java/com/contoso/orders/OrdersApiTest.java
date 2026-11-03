package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.workflow.*;
import java.net.URI;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrdersApiTest {
    @Test void oneHttpOperationKeepsItsOriginalAbsoluteDeadline() {
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.setAttribute(OrdersApplication.INVOCATION, InvocationId.generate());
        var first = OrdersApplication.operation(request);
        assertSame(first, OrdersApplication.operation(request));
    }

    @Test void schemaAndBoundsFailBeforeAnyDependencyCall() throws Exception {
        var port = new StubWorkflow();
        var api = new OrdersApplication.Api(port, new InventoryHttpClient(URI.create("http://127.0.0.1:1/api"), () -> "synthetic"),
            () -> { throw new java.sql.SQLException("synthetic"); });
        var mvc = MockMvcBuilders.standaloneSetup(api).setControllerAdvice(new OrdersApplication.Errors()).build();
        for (String json : List.of("{\"schemaVersion\":2,\"sku\":\"CONTOSO-WIDGET\",\"quantity\":1}",
                "{\"schemaVersion\":1,\"sku\":\"CONTOSO-WIDGET\",\"quantity\":101}",
                "{\"schemaVersion\":1,\"sku\":\"CONTOSO-WIDGET\",\"quantity\":0}")) {
            var result = mvc.perform(post("/api/orders").requestAttr(OrdersApplication.INVOCATION, InvocationId.generate())
                .contentType(MediaType.APPLICATION_JSON).content(json)).andReturn();
            assertEquals(400, result.getResponse().getStatus(), result.getResponse().getContentAsString());
            assertFalse(result.getResponse().getContentAsString().contains("synthetic"));
        }
        assertEquals(0, port.submits);
    }

    @Test void workflowViewIsVersionedAndNeverClaimsDelivery() {
        var id = InvocationId.generate().value();
        var view = OrdersApplication.view(new WorkflowView(id, id, "DURABLE_STAGED", Map.of()));
        assertEquals(1, view.get("schemaVersion"));
        assertEquals("DURABLE_STAGED", view.get("state"));
        assertFalse(view.containsKey("certified"));
    }

    @Test void mutationIdentityUsesCurrentActionWithoutChangingTheStoredWorkflowOrReadView() {
        var storedId = InvocationId.generate().value();
        var originalInvocation = InvocationId.generate().value();
        var stored = new WorkflowView(storedId, originalInvocation, "QUEUED", Map.of("paused", "false"));
        for (int attempt = 0; attempt < 3; attempt++) {
            var action = InvocationId.generate();
            var context = new OperationContext(action, io.opentelemetry.context.Context.root(),
                java.time.Instant.now().plusSeconds(5));
            var response = OrdersApplication.mutationView(stored, context);
            assertEquals(action.value(), response.get("businessInvocationId"));
            assertEquals(originalInvocation, response.get("workflowBusinessInvocationId"));
            assertEquals(storedId, response.get("id"));
            assertEquals(stored.details(), response.get("details"));
            assertEquals(originalInvocation, stored.businessInvocationId());
            assertEquals(originalInvocation, OrdersApplication.view(stored).get("businessInvocationId"));
            assertFalse(OrdersApplication.view(stored).containsKey("workflowBusinessInvocationId"));
        }
    }

    static final class StubWorkflow implements WorkflowPort {
        int submits;
        public WorkflowView submitOrder(OrderCommand command, OperationContext context) {
            submits++;
            return new WorkflowView(command.orderId(), context.invocationId().value(), "DURABLE_STAGED", Map.of());
        }
        public Optional<WorkflowView> order(String id, OperationContext context) { return Optional.empty(); }
        public WorkflowView startRun(DemoRunCommand command, OperationContext context) {
            return new WorkflowView(command.runId(), context.invocationId().value(), "DURABLE_STAGED", Map.of());
        }
        public Optional<WorkflowView> run(String id, OperationContext context) { return Optional.empty(); }
        public WorkflowView controlRun(String id, RunControl command, OperationContext context) {
            return new WorkflowView(id, context.invocationId().value(), "DURABLE_STAGED", Map.of());
        }
    }
}
