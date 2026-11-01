package com.contoso.correlation.data;

import java.util.Set;

public record InventoryItem(String sku, int available, long revision, String cacheOutcome) {
    private static final Set<String> OUTCOMES = Set.of("HIT", "MISS", "BYPASS", "ERROR");

    public InventoryItem {
        DataValidation.sku(sku);
        if (available < 0 || revision < 0 || cacheOutcome == null || !OUTCOMES.contains(cacheOutcome)) {
            throw new IllegalArgumentException("invalid_inventory_item");
        }
    }
}
