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
