package com.contoso.correlation.data;

import java.util.Set;

public record Reservation(String reservationId, String orderId, String sku, int quantity, String state) {
    private static final Set<String> STATES = Set.of("RESERVED", "RELEASED");

    public Reservation {
        DataValidation.id(reservationId);
        DataValidation.id(orderId);
        DataValidation.sku(sku);
        if (quantity < 1 || quantity > 10_000 || state == null || !STATES.contains(state)) {
            throw new IllegalArgumentException("invalid_reservation");
        }
    }
}
