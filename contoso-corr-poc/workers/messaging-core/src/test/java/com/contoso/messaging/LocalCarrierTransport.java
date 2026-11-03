package com.contoso.messaging;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

final class LocalCarrierTransport implements MessagingTransport {
    final Map<Source, List<Delivery>> deliveries = new EnumMap<>(Source.class);
    final List<HubRecord> hub = new ArrayList<>();
    final List<Envelope> published = new ArrayList<>();
    private final AzureCarriers carriers;
    LocalCarrierTransport(EnvelopeCodec codec) { carriers = new AzureCarriers(codec); }
    public void publish(Destination destination, Envelope envelope) {
        published.add(envelope);
        if (destination == Destination.EVENT_HUBS) {
            hub.add(new HubRecord(carriers.eventHub(carriers.eventHub(envelope)), "0", hub.size(), hub.size()));
            return;
        }
        var message = carriers.serviceBus(envelope);
        Envelope wire = carriers.serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties());
        switch (destination) {
            case SERVICE_BUS_ORDER -> enqueue(Source.ORDERS, wire, 1);
            case SERVICE_BUS_TOPIC -> { enqueue(Source.FULFILLMENT, wire, 1); enqueue(Source.NOTIFY, wire, 1); }
            case SERVICE_BUS_RESULT -> enqueue(Source.RESULTS, wire, 1);
            case EVENT_GRID -> enqueue(Source.EVENT_GRID_RELAY, carriers.cloudEvent(carriers.cloudEvent(envelope)), 1);
            case STORAGE_QUEUE -> enqueue(Source.LEGACY, carriers.queue(carriers.queue(envelope)), 1);
            default -> throw new IllegalStateException("invalid_fixture_destination");
        }
    }
    private void enqueue(Source source, Envelope envelope, int count) {
        deliveries.computeIfAbsent(source, ignored -> new ArrayList<>()).add(new Delivery() {
            public Source source() { return source; }
            public Envelope envelope() { return envelope; }
            public int deliveryCount() { return count; }
            public Instant lockedUntil() { return Instant.now().plusSeconds(120); }
            public Instant renew() { return lockedUntil(); }
            public void complete() {}
            public void abandon() { enqueue(source, envelope, count + 1); }
            public void deadLetter(String reason) {
                enqueue(switch (source) {
                    case ORDERS -> Source.ORDERS_DLQ;
                    case FULFILLMENT -> Source.FULFILLMENT_DLQ;
                    case NOTIFY -> Source.NOTIFY_DLQ;
                    case LEGACY -> Source.LEGACY_POISON;
                    default -> throw new IllegalStateException("invalid_fixture_dlq");
                }, envelope, count);
            }
        });
    }
    public List<Delivery> receive(Source source, int maximum, Duration wait) {
        var queue = deliveries.computeIfAbsent(source, ignored -> new ArrayList<>());
        if (queue.isEmpty()) return List.of();
        var result = new ArrayList<Delivery>();
        while (!queue.isEmpty() && result.size() < maximum) result.add(queue.removeFirst());
        return List.copyOf(result);
    }
    public List<String> partitions() { return List.of("0"); }
    public List<HubRecord> receiveBatch(String partitionId, long offset, int maximum, Duration wait) {
        return hub.stream().filter(record -> record.offset() > offset).limit(maximum).toList();
    }
    public void close() {}
}
