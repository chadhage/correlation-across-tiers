package com.contoso.inventory.data;

import com.contoso.correlation.data.OperationContext;
import java.util.Optional;

public interface OwnedInventoryCache extends AutoCloseable {
    record Value(int available, long revision) {
        public Value {
            if (available < 0 || revision < 0) throw new IllegalArgumentException("invalid_cache_value");
        }
    }
    Optional<Value> get(String sku, OperationContext context);
    void put(String sku, Value value, OperationContext context);
    void invalidate(String sku, OperationContext context);
    boolean isReady();
    @Override void close();
}
