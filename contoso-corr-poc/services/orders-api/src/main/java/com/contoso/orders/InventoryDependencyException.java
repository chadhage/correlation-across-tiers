package com.contoso.orders;

public final class InventoryDependencyException extends IllegalStateException {
    public enum Category { TIMEOUT, UNAVAILABLE, CAPACITY, INTERRUPTED }
    private final Category category;

    InventoryDependencyException(Category category) {
        super("inventory_" + category.name().toLowerCase(java.util.Locale.ROOT));
        this.category = category;
    }

    public Category category() { return category; }
}
