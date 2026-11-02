package com.contoso.messaging;

public enum Source {
    ORDERS(Destination.SERVICE_BUS_ORDER, "contoso-orders", null, false),
    FULFILLMENT(Destination.SERVICE_BUS_TOPIC, "contoso-order-events", "fulfillment", false),
    NOTIFY(Destination.SERVICE_BUS_TOPIC, "contoso-order-events", "notify", false),
    RESULTS(Destination.SERVICE_BUS_RESULT, "contoso-order-results", null, false),
    EVENT_GRID_RELAY(Destination.EVENT_GRID, "contoso-eventgrid-relay", null, false),
    LEGACY(Destination.STORAGE_QUEUE, "contoso-legacy-jobs", null, false),
    ORDERS_DLQ(Destination.SERVICE_BUS_ORDER, "contoso-orders", null, true),
    FULFILLMENT_DLQ(Destination.SERVICE_BUS_TOPIC, "contoso-order-events", "fulfillment", true),
    NOTIFY_DLQ(Destination.SERVICE_BUS_TOPIC, "contoso-order-events", "notify", true),
    LEGACY_POISON(Destination.STORAGE_QUEUE, "contoso-legacy-poison", null, true);

    private final Destination destination;
    private final String entity;
    private final String subscription;
    private final boolean deadLetter;
    Source(Destination destination, String entity, String subscription, boolean deadLetter) {
        this.destination = destination; this.entity = entity; this.subscription = subscription; this.deadLetter = deadLetter;
    }
    public Destination destination() { return destination; }
    public String entity() { return entity; }
    public String subscription() { return subscription; }
    public boolean deadLetter() { return deadLetter; }
    public java.util.Set<com.contoso.correlation.workflow.WorkTarget> replayTargets() {
        return switch (this) {
            case ORDERS_DLQ -> java.util.Set.of(com.contoso.correlation.workflow.WorkTarget.ORDER,
                com.contoso.correlation.workflow.WorkTarget.SERVICE_BUS);
            case FULFILLMENT_DLQ -> java.util.Set.of(com.contoso.correlation.workflow.WorkTarget.FULFILLMENT,
                com.contoso.correlation.workflow.WorkTarget.SERVICE_BUS);
            case NOTIFY_DLQ -> java.util.Set.of(com.contoso.correlation.workflow.WorkTarget.NOTIFY,
                com.contoso.correlation.workflow.WorkTarget.SERVICE_BUS);
            case LEGACY_POISON -> java.util.Set.of(com.contoso.correlation.workflow.WorkTarget.STORAGE_QUEUE);
            default -> java.util.Set.of();
        };
    }
    public Source replayDelivery() {
        return switch (this) {
            case ORDERS_DLQ -> ORDERS;
            case FULFILLMENT_DLQ -> FULFILLMENT;
            case NOTIFY_DLQ -> NOTIFY;
            case LEGACY_POISON -> LEGACY;
            default -> throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        };
    }
}
