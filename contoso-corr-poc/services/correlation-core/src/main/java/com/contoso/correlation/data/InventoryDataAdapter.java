package com.contoso.correlation.data;

public interface InventoryDataAdapter extends AutoCloseable {
    InventoryItem lookupInventory(String sku, OperationContext context);
    Reservation reserveInventory(String orderId, String sku, int quantity, OperationContext context);
    Reservation releaseInventory(String orderId, String reservationId, OperationContext context);
    boolean isReady();
    @Override void close();
}
