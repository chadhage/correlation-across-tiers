package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.workflow.RunScenario;

public record WorkPayload(String orderId, String sku, int quantity, RunScenario scenario, Branch contributor) {
    public WorkPayload {
        InvocationId.parse(orderId);
        if (sku == null || !sku.matches("CONTOSO-00[1-5]") || quantity < 1 || quantity > 100 ||
            scenario == null || contributor != null &&
            contributor != Branch.FULFILLMENT && contributor != Branch.NOTIFY) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE);
        }
    }
    @Override public String toString() { return "WorkPayload[redacted]"; }
}
