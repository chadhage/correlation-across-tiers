package com.contoso.demo.operator;

import com.azure.core.credential.TokenCredential;
import com.azure.core.util.BinaryData;
import com.azure.core.amqp.AmqpRetryOptions;
import com.azure.messaging.servicebus.ServiceBusClientBuilder;
import com.azure.messaging.servicebus.ServiceBusMessage;
import com.azure.messaging.servicebus.ServiceBusReceiverClient;
import com.azure.messaging.servicebus.models.SubQueue;
import com.contoso.messaging.AzureMessagingTransport;
import com.contoso.messaging.Destination;
import com.contoso.messaging.EnvelopeCodec;
import com.contoso.messaging.MessagingSettings;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AzureBrokerExamples implements AutoCloseable {
    private final MessagingSettings settings;
    private final TokenCredential credential;
    private final OperatorRunStore store;
    private final EnvelopeCodec codec = new EnvelopeCodec();
    private final AzureMessagingTransport transport;

    AzureBrokerExamples(MessagingSettings settings, TokenCredential credential, OperatorRunStore store) {
        this.settings = settings; this.credential = credential; this.store = store;
        transport = new AzureMessagingTransport(settings, credential, codec);
    }

    void redeliver(UUID id, String destination) {
        if (store.active(id).demoId() != 10 || !List.of("EVENT_GRID", "STORAGE_QUEUE").contains(destination)) {
            throw OperatorFailure.invalid();
        }
        var matches = store.rows(id, "publications").stream().filter(row -> destination.equals(row.get("destination"))).toList();
        if (matches.size() != 1) throw OperatorFailure.conflict();
        var envelope = codec.decode(OperatorJson.write(matches.getFirst().get("envelope_json")));
        transport.publish(Destination.valueOf(destination), envelope);
        store.event(id, "REDELIVERED", Map.of("messageId", envelope.messageId(), "destination", destination,
            "samePersistedEnvelope", true, "scope", "operator-induced real transport redelivery"));
    }

    UUID inject(UUID id, String kind) {
        if (store.active(id).demoId() != 11 || !List.of("SPOOF", "INVALID_CONTEXT", "OVERSIZE").contains(kind)) {
            throw OperatorFailure.invalid();
        }
        UUID message = UUID.randomUUID();
        var payload = new LinkedHashMap<String, Object>();
        payload.put("schemaVersion", 1);
        byte[] random = new byte[16];
        new java.security.SecureRandom().nextBytes(random);
        String inputTrace = java.util.HexFormat.of().formatHex(random);
        if (inputTrace.equals("0".repeat(32))) throw new OperatorFailure(503, "SYNTHETIC_CONTEXT_GENERATION_FAILED");
        payload.put("traceparent", kind.equals("INVALID_CONTEXT")
            ? "00-" + "0".repeat(32) + "-" + "1".repeat(16) + "-01"
            : "00-" + inputTrace + "-" + "1".repeat(16) + "-01");
        payload.put("tracestate", null); payload.put("business.invocation_id", id.toString());
        payload.put("messageId", message.toString()); payload.put("causationId", null);
        payload.put("workflowId", id.toString()); payload.put("kind", "ORDER"); payload.put("replayOf", null);
        var work = new LinkedHashMap<String, Object>();
        work.put("orderId", id.toString()); work.put("sku", OperatorRunStore.SKU); work.put("quantity", 1);
        work.put("scenario", "PRIVACY"); work.put("contributor", null); payload.put("payload", work);
        if (kind.equals("OVERSIZE")) payload.put("padding", "x".repeat(32769));
        var unpadded = new LinkedHashMap<>(payload);
        unpadded.remove("padding");
        var envelope = codec.decode(OperatorJson.write(unpadded));
        var standard = new com.contoso.messaging.AzureCarriers(codec).serviceBus(envelope);
        var outgoing = standard;
        if (kind.equals("OVERSIZE")) {
            outgoing = new ServiceBusMessage(BinaryData.fromString(OperatorJson.write(payload)))
                .setMessageId(standard.getMessageId()).setContentType(standard.getContentType()).setSubject(standard.getSubject());
            outgoing.getApplicationProperties().putAll(standard.getApplicationProperties());
        }
        outgoing.setCorrelationId(id.toString());
        // An intent survives a lost broker ACK. It is not a receipt of publication or rejection.
        store.event(id, "INJECT_INTENT", Map.of("messageId", message.toString(), "caseId", kind));
        try (var sender = bus().sender().queueName("contoso-orders").buildClient()) {
            sender.sendMessage(outgoing);
        }
        store.event(id, "INJECTED", Map.of("messageId", message.toString(), "caseId", kind));
        return message;
    }

    List<Map<String, Object>> rejected(UUID id) {
        var owned = injected(id);
        var observed = new ArrayList<Map<String, Object>>();
        try (var receiver = deadLetters()) {
            long next = 0;
            for (int page = 0; page < 20; page++) {
                var messages = receiver.peekMessages(100, next).stream().toList();
                for (var message : messages) {
                    if (owned.contains(message.getMessageId())) {
                        String reason = message.getDeadLetterReason();
                        if (reason == null || !reason.matches("[A-Z][A-Z0-9_]{0,63}")) {
                            throw new OperatorFailure(502, "BROKER_REJECTION_REASON_UNCLASSIFIED");
                        }
                        observed.add(Map.of("messageId", message.getMessageId(), "reason", reason,
                            "sequenceNumber", message.getSequenceNumber()));
                    }
                    next = Math.max(next, message.getSequenceNumber() + 1);
                }
                if (messages.size() < 100) return List.copyOf(observed);
            }
        }
        throw new OperatorFailure(413, "BROKER_PEEK_LIMIT");
    }

    void drainInjected(UUID id) {
        var remaining = new java.util.HashSet<>(injected(id));
        if (remaining.isEmpty()) return;
        var already = store.rows(id, "events").stream().filter(row -> "INJECT_SETTLED".equals(row.get("kind")))
            .map(row -> ((JsonNode) row.get("facts_json")).path("messageId").asText()).toList();
        remaining.removeAll(already);
        try (var receiver = deadLetters()) {
            for (int i = 0; i < 16 && !remaining.isEmpty(); i++) {
                var head = receiver.peekMessage();
                if (head == null || !remaining.contains(head.getMessageId())) {
                    throw new OperatorFailure(409, "OWNED_DLQ_DRAIN_REQUIRES_OWNER_ACTION");
                }
                var message = receiver.receiveMessages(1, Duration.ofSeconds(2)).stream().findFirst()
                    .orElseThrow(() -> new OperatorFailure(409, "OWNED_DLQ_DRAIN_INCOMPLETE"));
                if (!remaining.contains(message.getMessageId())) {
                    receiver.abandon(message);
                    throw new OperatorFailure(409, "DLQ_CHANGED_DURING_OWNED_DRAIN");
                }
                receiver.complete(message);
                remaining.remove(message.getMessageId());
                store.event(id, "INJECT_SETTLED", Map.of("messageId", message.getMessageId()));
            }
        }
        if (!remaining.isEmpty()) throw new OperatorFailure(409, "OWNED_DLQ_DRAIN_INCOMPLETE");
    }

    private List<String> injected(UUID id) {
        return store.rows(id, "events").stream().filter(row -> "INJECT_INTENT".equals(row.get("kind")))
            .map(row -> ((JsonNode) row.get("facts_json")).path("messageId").asText()).distinct().toList();
    }

    private ServiceBusClientBuilder bus() {
        return new ServiceBusClientBuilder().credential(settings.serviceBusNamespace(), credential)
            .clientOptions(MessagingSettings.noTracing())
            .retryOptions(new AmqpRetryOptions().setMaxRetries(0).setTryTimeout(Duration.ofSeconds(5)));
    }
    private ServiceBusReceiverClient deadLetters() {
        return bus().receiver().queueName("contoso-orders").subQueue(SubQueue.DEAD_LETTER_QUEUE).prefetchCount(0).buildClient();
    }
    public void close() { transport.close(); }
}
