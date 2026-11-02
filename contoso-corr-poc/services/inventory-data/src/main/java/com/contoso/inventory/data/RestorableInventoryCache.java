package com.contoso.inventory.data;

import com.contoso.correlation.data.OperationContext;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/** Operator-only baseline operations; ordinary inventory traffic uses OwnedInventoryCache. */
public interface RestorableInventoryCache extends OwnedInventoryCache {
    record Baseline(Optional<Value> value, Instant expiresAt) {
        public Baseline {
            Objects.requireNonNull(value);
            if (value.isEmpty() && expiresAt != null) throw new IllegalArgumentException("invalid_cache_baseline");
        }

        public static Baseline absent() { return new Baseline(Optional.empty(), null); }

        public Optional<Value> valueAt(Instant instant) {
            return expiresAt != null && !expiresAt.isAfter(instant) ? Optional.empty() : value;
        }

        @Override public String toString() { return "InventoryCacheBaseline[redacted]"; }
    }

    Baseline capture(String sku, OperationContext context);
    void restore(String sku, Baseline baseline, OperationContext context);
}
