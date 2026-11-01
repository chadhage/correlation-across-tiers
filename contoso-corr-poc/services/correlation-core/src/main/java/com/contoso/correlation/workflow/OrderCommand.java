package com.contoso.correlation.workflow;

import com.contoso.correlation.InvocationId;

public record OrderCommand(String orderId, String sku, int quantity) {
    public OrderCommand {
        InvocationId.parse(orderId);
        if (sku == null || !sku.matches("[A-Za-z0-9_-]{1,64}") || quantity < 1 || quantity > 100) {
            throw new IllegalArgumentException("invalid_order");
        }
    }
}
