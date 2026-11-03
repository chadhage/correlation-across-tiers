package com.contoso.messaging;

public enum Destination {
    SERVICE_BUS_ORDER("servicebus", "contoso-orders"),
    SERVICE_BUS_TOPIC("servicebus", "contoso-order-events"),
    SERVICE_BUS_RESULT("servicebus", "contoso-order-results"),
    EVENT_GRID("eventgrid", "contoso-corr-poc-egt"),
    EVENT_HUBS("eventhubs", "contoso-telemetry-batch"),
    STORAGE_QUEUE("azure_storage_queue", "contoso-legacy-jobs");

    private final String system;
    private final String entity;
    Destination(String system, String entity) { this.system = system; this.entity = entity; }
    public String system() { return system; }
    public String entity() { return entity; }
}
