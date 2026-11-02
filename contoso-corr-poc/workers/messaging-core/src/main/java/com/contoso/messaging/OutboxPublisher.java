package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.Map;

public final class OutboxPublisher {
    private final MessagingStore store;
    private final MessagingTransport transport;
    public OutboxPublisher(MessagingStore store, MessagingTransport transport) {
        this.store = store; this.transport = transport;
    }

    public int dispatch(int maximum) {
        try (var admitted = RuntimeGuard.admitWork()) { return dispatchAdmitted(maximum); }
    }

    private int dispatchAdmitted(int maximum) {
        int published = 0;
        var lookup = new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(30));
        for (var pending : store.claimOutbox(maximum, lookup)) {
            Envelope draft = pending.draft();
            var invocation = InvocationId.parse(draft.businessInvocationId());
            var source = TraceContexts.extract(draft);
            boolean linked = draft.replayOf() != null || draft.kind() == Envelope.Kind.BATCH || draft.kind() == Envelope.Kind.RESULT;
            String name = draft.replayOf() != null ? "contoso.replay.send" : switch (pending.destination()) {
                case SERVICE_BUS_ORDER, SERVICE_BUS_TOPIC, SERVICE_BUS_RESULT -> "contoso.servicebus.send";
                case EVENT_GRID -> "contoso.eventgrid.send";
                case EVENT_HUBS -> "contoso.eventhubs.send";
                case STORAGE_QUEUE -> "contoso.storagequeue.send";
            };
            var attributes = Map.of(
                "messaging.system", pending.destination().system(),
                "messaging.destination.name", pending.destination().entity(),
                "messaging.operation.name", "send",
                "messaging.message.id", draft.messageId(),
                "contoso.message.id", draft.messageId(),
                "contoso.workflow.id", draft.workflowId(),
                "contoso.publish.attempt", Integer.toString(pending.publishAttempt()),
                "contoso.transport", pending.destination().name());
            try (var span = linked
                    ? Correlation.startLinked(name, SpanKind.PRODUCER, invocation, TraceContexts.links(draft), attributes)
                    : Correlation.start(name, SpanKind.PRODUCER, source.context(), invocation, attributes);
                 var scope = span.makeCurrent()) {
                if (draft.replayOf() != null) span.attribute("contoso.original.message.id", draft.replayOf());
                if (draft.causationId() != null) span.attribute("contoso.causation.id", draft.causationId());
                var context = new OperationContext(invocation, span.context(), Instant.now().plusSeconds(30));
                Envelope envelope = draft.withContext(TraceContexts.capture(span.context()));
                var outbound = TraceContexts.extract(envelope).spanContext();
                if (!linked && source.spanContext().isValid() && !source.spanContext().isSampled() &&
                    outbound.isValid() && outbound.isSampled()) {
                    throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
                }
                try {
                    store.publicationRecorded(pending, envelope, context);
                    transport.publish(pending.destination(), envelope);
                    store.published(pending, envelope, context);
                    span.attribute("contoso.outcome", "SENT");
                    published++;
                } catch (RuntimeException failure) {
                    span.failure("PUBLISH_UNCERTAIN");
                    try { store.publicationFailed(pending, "PUBLISH_UNCERTAIN", context); }
                    catch (RuntimeException ignored) {}
                }
            }
        }
        return published;
    }
}
