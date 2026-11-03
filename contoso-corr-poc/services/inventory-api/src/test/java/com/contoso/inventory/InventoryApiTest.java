package com.contoso.inventory;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.contoso.correlation.*;
import com.contoso.correlation.data.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class InventoryApiTest {
    @Test void oneHttpOperationKeepsItsOriginalAbsoluteDeadline() {
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.setAttribute(InventoryApplication.INVOCATION, InvocationId.generate());
        var first = InventoryApplication.operation(request);
        assertSame(first, InventoryApplication.operation(request));
    }

    @Test void actualRoutesCallTypedAdapterAndRejectBadInputs() throws Exception {
        var adapter = new StubData();
        var mvc = MockMvcBuilders.standaloneSetup(new InventoryApplication.Api(adapter))
            .setControllerAdvice(new InventoryApplication.Errors()).build();
        var id = InvocationId.generate();
        var result = mvc.perform(get("/api/inventory/CONTOSO-WIDGET")
            .requestAttr(InventoryApplication.INVOCATION, id)).andReturn();
        assertEquals(200, result.getResponse().getStatus());
        assertTrue(result.getResponse().getContentAsString().contains("\"available\":20"));
        assertEquals(id, adapter.invocation);
        var bad = mvc.perform(post("/api/inventory/reservations")
            .requestAttr(InventoryApplication.INVOCATION, id).contentType(MediaType.APPLICATION_JSON)
            .content("{\"schemaVersion\":1,\"orderId\":\"" + id.value() + "\",\"sku\":\"CONTOSO-WIDGET\",\"quantity\":101}")).andReturn();
        assertEquals(400, bad.getResponse().getStatus());
        assertEquals(0, adapter.reservations);
    }

    @Test void unreadyIsNotServiceStartupCertification() {
        var response = new InventoryApplication.Api(new StubData()).ready();
        assertEquals(503, response.getStatusCode().value());
    }

    static final class StubData implements InventoryDataAdapter {
        InvocationId invocation;
        int reservations;
        public InventoryItem lookupInventory(String sku, OperationContext context) {
            invocation = context.invocationId();
            return new InventoryItem(sku, 20, 1, "MISS");
        }
        public Reservation reserveInventory(String orderId, String sku, int quantity, OperationContext context) {
            reservations++;
            return new Reservation(InvocationId.generate().value(), orderId, sku, quantity, "RESERVED");
        }
        public Reservation releaseInventory(String orderId, String reservationId, OperationContext context) {
            return new Reservation(reservationId, orderId, "CONTOSO-WIDGET", 1, "RELEASED");
        }
        public boolean isReady() { return false; }
        public void close() {}
    }
}
