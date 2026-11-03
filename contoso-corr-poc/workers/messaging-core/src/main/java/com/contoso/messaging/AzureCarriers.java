package com.contoso.messaging;

import com.azure.core.models.CloudEvent;
import com.azure.core.models.CloudEventDataFormat;
import com.azure.core.util.BinaryData;
import com.azure.messaging.eventhubs.EventData;
import com.azure.messaging.servicebus.ServiceBusMessage;
import com.azure.messaging.servicebus.ServiceBusReceivedMessage;
import java.util.Map;
import java.util.Objects;

public final class AzureCarriers {
    public static final String CLOUD_SOURCE = "/contoso/orders";
    public static final String CLOUD_TYPE = "com.contoso.order.work.v1";
    private final EnvelopeCodec codec;
    public AzureCarriers(EnvelopeCodec codec) { this.codec = Objects.requireNonNull(codec); }

    public ServiceBusMessage serviceBus(Envelope envelope) {
        var message = new ServiceBusMessage(BinaryData.fromBytes(codec.encode(envelope)))
            .setMessageId(envelope.messageId()).setContentType("application/json")
            .setSubject(envelope.kind().name());
        properties(message.getApplicationProperties(), envelope, "Diagnostic-Id");
        return message;
    }

    public Envelope serviceBus(ServiceBusReceivedMessage message) {
        return serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties());
    }

    public Envelope serviceBus(BinaryData body, String messageId, Map<String, Object> properties) {
        Envelope envelope = codec.decode(body.toBytes());
        if (!envelope.messageId().equals(messageId)) invalid();
        check(properties, envelope, "Diagnostic-Id");
        return envelope;
    }

    public EventData eventHub(Envelope envelope) {
        var data = new EventData(codec.encode(envelope));
        properties(data.getProperties(), envelope, "traceparent");
        return data;
    }

    public Envelope eventHub(EventData data) {
        Envelope envelope = codec.decode(data.getBodyAsBinaryData().toBytes());
        check(data.getProperties(), envelope, "traceparent");
        return envelope;
    }

    public CloudEvent cloudEvent(Envelope envelope) {
        var event = new CloudEvent(CLOUD_SOURCE, CLOUD_TYPE, BinaryData.fromBytes(codec.encode(envelope)),
            CloudEventDataFormat.JSON, "application/json").setId(envelope.messageId());
        if (envelope.traceparent() != null) event.addExtensionAttribute("traceparent", envelope.traceparent());
        if (envelope.tracestate() != null) event.addExtensionAttribute("tracestate", envelope.tracestate());
        event.addExtensionAttribute("businessinvocationid", envelope.businessInvocationId());
        event.addExtensionAttribute("messageid", envelope.messageId());
        if (envelope.causationId() != null) event.addExtensionAttribute("causationid", envelope.causationId());
        return event;
    }

    public Envelope cloudEvent(CloudEvent event) {
        if (!CLOUD_SOURCE.equals(event.getSource()) || !CLOUD_TYPE.equals(event.getType()) ||
            !"application/json".equals(event.getDataContentType()) || event.getData() == null) invalid();
        Envelope envelope = codec.decode(event.getData().toBytes());
        if (!envelope.messageId().equals(event.getId())) invalid();
        var extensions = event.getExtensionAttributes();
        equals(extensions.get("traceparent"), envelope.traceparent());
        equals(extensions.get("tracestate"), envelope.tracestate());
        equals(extensions.get("businessinvocationid"), envelope.businessInvocationId());
        equals(extensions.get("messageid"), envelope.messageId());
        equals(extensions.get("causationid"), envelope.causationId());
        return envelope;
    }

    public BinaryData queue(Envelope envelope) { return BinaryData.fromBytes(codec.encode(envelope)); }
    public Envelope queue(BinaryData body) { return codec.decode(body.toBytes()); }

    private static void properties(Map<String, Object> values, Envelope envelope, String traceKey) {
        if (envelope.traceparent() != null) values.put(traceKey, envelope.traceparent());
        if (envelope.tracestate() != null) values.put("tracestate", envelope.tracestate());
        values.put("business.invocation_id", envelope.businessInvocationId());
        values.put("message-id", envelope.messageId());
        if (envelope.causationId() != null) values.put("causation-id", envelope.causationId());
    }

    private static void check(Map<String, Object> values, Envelope envelope, String traceKey) {
        equals(values.get(traceKey), envelope.traceparent());
        equals(values.get("tracestate"), envelope.tracestate());
        equals(values.get("business.invocation_id"), envelope.businessInvocationId());
        equals(values.get("message-id"), envelope.messageId());
        equals(values.get("causation-id"), envelope.causationId());
    }

    private static void equals(Object actual, String expected) {
        if (!Objects.equals(actual, expected)) invalid();
    }
    private static void invalid() { throw new MessagingFailure(MessagingFailure.Code.INVALID_CARRIER); }
}
