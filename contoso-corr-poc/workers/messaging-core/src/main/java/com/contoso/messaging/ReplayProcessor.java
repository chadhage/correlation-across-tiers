package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.Map;

public final class ReplayProcessor {
    private final MessagingStore store;
    private final MessagingSettings settings;
    public ReplayProcessor(MessagingStore store, MessagingSettings settings) { this.store = store; this.settings = settings; }

    public boolean replay(Delivery deadLetter, boolean requireRequest) {
        if (!deadLetter.source().deadLetter()) throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        try (var admitted = RuntimeGuard.admitWork(); var lease = new ProcessingLease(deadLetter)) {
            Envelope original = deadLetter.envelope();
            var invocation = InvocationId.parse(original.businessInvocationId());
            var operation = new OperationContext(invocation, Context.root(), Instant.now().plusSeconds(30));
            if (!store.trusted(original, deadLetter.source().destination(),
                settings.publishers(deadLetter.source().destination(), original.replayOf() != null), operation)) {
                throw new MessagingFailure(MessagingFailure.Code.UNTRUSTED_PUBLICATION);
            }
            try (var span = Correlation.startLinked("contoso.replay.process", SpanKind.CONSUMER, invocation,
                    TraceContexts.links(original), Map.of("messaging.system", deadLetter.source().destination().system(),
                        "messaging.message.id", original.messageId(), "contoso.workflow.id", original.workflowId(),
                        "messaging.operation.name", "process", "contoso.process.attempt", Integer.toString(deadLetter.deliveryCount())));
                 var scope = span.makeCurrent()) {
                if (!requireRequest || !store.replayRequested(original.workflowId(), deadLetter.source(), operation)) {
                    span.attribute("contoso.outcome", "NO_REQUEST");
                    lease.abandon(); return false;
                }
                lease.check();
                store.prepareReplay(original, deadLetter.source(),
                    new OperationContext(invocation, span.context(), Instant.now().plusSeconds(30)));
                lease.complete();
                span.attribute("contoso.outcome", "REPLAY_QUEUED");
                return true;
            }
        }
    }
}
