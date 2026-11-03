package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.workflow.RunScenario;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class AsyncProcessor {
    private final MessagingStore store;
    private final MessagingSettings settings;
    public AsyncProcessor(MessagingStore store, MessagingSettings settings) {
        this.store = store; this.settings = settings;
    }
    private static OperationContext context(InvocationId invocation, Context parent) {
        return new OperationContext(invocation, parent, Instant.now().plusSeconds(30));
    }
    private boolean trusted(Envelope envelope, Destination destination) {
        return store.trusted(envelope, destination, settings.publishers(destination, envelope.replayOf() != null),
            context(InvocationId.generate(), Context.root()));
    }
    private static Map<String, String> attributes(Envelope envelope, Destination destination, Branch branch, int count) {
        var attributes = new HashMap<String, String>();
        attributes.put("messaging.system", destination.system());
        attributes.put("messaging.destination.name", destination.entity());
        attributes.put("messaging.operation.name", "process");
        attributes.put("messaging.message.id", envelope.messageId());
        attributes.put("contoso.message.id", envelope.messageId());
        attributes.put("contoso.workflow.id", envelope.workflowId());
        attributes.put("contoso.branch", branch.name());
        attributes.put("contoso.process.attempt", Integer.toString(count));
        attributes.put("contoso.transport", destination.name());
        return attributes;
    }

    public boolean process(Delivery delivery, Branch branch) {
        try (var admitted = RuntimeGuard.admitWork(); var lease = new ProcessingLease(delivery)) {
            Envelope envelope;
            try { envelope = delivery.envelope(); }
            catch (MessagingFailure failure) { reject(delivery, lease, failure.code().name()); return true; }
            if (!trusted(envelope, delivery.source().destination())) {
                reject(delivery, lease, "UNTRUSTED_PUBLICATION"); return true;
            }
            var inbound = TraceContexts.extract(envelope);
            InvocationId invocation = InvocationId.parse(envelope.businessInvocationId());
            String name = switch (branch) {
                case NOTIFY -> "contoso.notify.process";
                case AGGREGATOR -> "contoso.results.process";
                case EVENT_GRID -> "contoso.eventgrid.process";
                case STORAGE_QUEUE -> "contoso.storagequeue.process";
                default -> "contoso.fulfillment.process";
            };
            var attributes = attributes(envelope, delivery.source().destination(), branch, delivery.deliveryCount());
            attributes.put("contoso.context.rejection", inbound.rejection());
            try (var span = Correlation.start(name, SpanKind.CONSUMER, inbound.context(), invocation, attributes);
                 var scope = span.makeCurrent()) {
                var operation = context(invocation, span.context());
                MessagingStore.Attempt attempt = null;
                try {
                    lease.check();
                    if (!store.replayAppliesTo(envelope, delivery.source(), operation)) {
                        span.attribute("contoso.outcome", "SKIPPED_TARGET");
                        lease.complete(); return true;
                    }
                    attempt = store.begin(envelope, branch, delivery.deliveryCount(), TraceContexts.capture(span.context()), operation);
                    span.attribute("contoso.process.attempt", Integer.toString(attempt.count()));
                    switch (attempt.disposition()) {
                        case DUPLICATE -> {
                            if (envelope.kind() == Envelope.Kind.RESULT) aggregateIfReady(envelope);
                            span.attribute("contoso.outcome", "DUPLICATE");
                            lease.complete(); return true;
                        }
                        case PAUSED, BUSY -> {
                            span.attribute("contoso.outcome", attempt.disposition().name());
                            lease.abandon(); return false;
                        }
                        case EXECUTE -> { }
                    }
                    if (attempt.count() <= attempt.failureBudget()) {
                        boolean deadLetter = envelope.payload().scenario() == RunScenario.DLQ &&
                            attempt.count() >= attempt.failureBudget();
                        store.failed(envelope, branch, attempt, deadLetter, operation);
                        span.failure("TRANSIENT_FAILURE");
                        span.attribute("contoso.outcome", deadLetter ? "DEAD_LETTERED" : "RETRY");
                        if (deadLetter) lease.deadLetter("CONTOSO_FAILURE_BUDGET");
                        else lease.abandon();
                        return deadLetter;
                    }
                    store.complete(envelope, branch, attempt, TraceContexts.capture(span.context()), operation);
                    if (envelope.kind() == Envelope.Kind.RESULT) aggregateIfReady(envelope);
                    span.attribute("contoso.outcome", "SUCCESS");
                    lease.complete();
                    return true;
                } catch (RuntimeException failure) {
                    span.failure(safe(failure));
                    boolean uncertain = failure instanceof DataAccessException data && data.outcomeUnknown();
                    if (!uncertain && attempt != null && attempt.disposition() == MessagingStore.Disposition.EXECUTE) {
                        try { store.failed(envelope, branch, attempt, false, operation); } catch (RuntimeException ignored) {}
                    }
                    if (!uncertain) try { lease.abandon(); } catch (RuntimeException ignored) {}
                    return false;
                }
            }
        }
    }

    private void reject(Delivery delivery, ProcessingLease lease, String category) {
        var attributes = Map.of("messaging.system", delivery.source().destination().system(),
            "messaging.destination.name", delivery.source().entity(), "messaging.operation.name", "process",
            "contoso.process.attempt", Integer.toString(delivery.deliveryCount()), "contoso.context.rejection", category);
        try (var span = Correlation.start("contoso.rejected.process", SpanKind.CONSUMER, Context.root(),
                InvocationId.generate(), attributes); var scope = span.makeCurrent()) {
            span.failure(category);
            lease.deadLetter(category);
        }
    }

    public boolean processBatch(List<MessagingTransport.HubRecord> records) {
        return processBatch(records, 1);
    }

    public boolean processBatch(List<MessagingTransport.HubRecord> records, int receiveAttempt) {
        if (receiveAttempt < 1 || receiveAttempt > 1_000_000_000) throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        try (var admitted = RuntimeGuard.admitWork()) { return processBatchAdmitted(records, receiveAttempt); }
    }

    private boolean processBatchAdmitted(List<MessagingTransport.HubRecord> records, int receiveAttempt) {
        if (records.isEmpty()) return true;
        if (records.size() > settings.maxLinks()) throw new MessagingFailure(MessagingFailure.Code.LINK_LIMIT);
        var links = new ArrayList<io.opentelemetry.api.trace.SpanContext>();
        for (var record : records) {
            if (record.envelope() == null || !trusted(record.envelope(), Destination.EVENT_HUBS)) return perItem(records);
            var inbound = TraceContexts.extract(record.envelope()).spanContext();
            if (!inbound.isValid()) return perItem(records);
            links.add(inbound);
        }
        String business = records.getFirst().envelope().businessInvocationId();
        InvocationId batchInvocation = records.stream().allMatch(record -> business.equals(record.envelope().businessInvocationId()))
            ? InvocationId.parse(business) : null;
        try (var batch = Correlation.startLinked("contoso.eventhubs.batch.process", SpanKind.CONSUMER, batchInvocation,
                links, Map.of("messaging.system", "eventhubs", "messaging.operation.name", "process",
                    "messaging.destination.name", Destination.EVENT_HUBS.entity(),
                    "messaging.batch.message_count", Integer.toString(records.size()), "contoso.process.attempt", Integer.toString(receiveAttempt)));
             var scope = batch.makeCurrent()) {
            for (var record : records) {
                if (!processHubItem(record, batch.context())) { batch.failure("BATCH_RETRY"); return false; }
            }
            batch.attribute("contoso.outcome", "SUCCESS");
            return true;
        }
    }

    private boolean perItem(List<MessagingTransport.HubRecord> records) {
        for (var record : records) {
            if (record.envelope() == null || !trusted(record.envelope(), Destination.EVENT_HUBS)) {
                quarantine(record);
            } else if (!processHubItem(record, TraceContexts.extract(record.envelope()).context())) return false;
        }
        return true;
    }

    private void quarantine(MessagingTransport.HubRecord record) {
        String category = record.envelope() == null ? record.rejection() : "UNTRUSTED_PUBLICATION";
        if (category == null || !category.matches("[A-Z][A-Z0-9_]{0,47}")) category = "INVALID_CARRIER";
        var invocation = InvocationId.generate();
        try (var span = Correlation.start("contoso.eventhubs.rejected.process", SpanKind.CONSUMER, Context.root(), invocation,
                Map.of("messaging.system", "eventhubs", "messaging.operation.name", "process", "contoso.process.attempt", "1",
                    "messaging.destination.partition.id", record.partitionId(),
                    "messaging.eventhubs.message.offset", Long.toString(record.offset()),
                    "contoso.context.rejection", category)); var scope = span.makeCurrent()) {
            span.failure(category);
            store.quarantine(record.partitionId(), record.offset(), record.sequenceNumber(), category, context(invocation, span.context()));
        }
    }

    private boolean processHubItem(MessagingTransport.HubRecord record, Context parent) {
        Envelope envelope = record.envelope();
        var invocation = InvocationId.parse(envelope.businessInvocationId());
        var attributes = attributes(envelope, Destination.EVENT_HUBS, Branch.BATCH, 1);
        if (record.offset() < 0 || record.sequenceNumber() < 0 || !record.partitionId().matches("0|[1-9][0-9]{0,8}")) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_CARRIER);
        }
        attributes.put("messaging.destination.partition.id", record.partitionId());
        attributes.put("messaging.eventhubs.message.offset", Long.toString(record.offset()));
        attributes.put("contoso.context.rejection", TraceContexts.extract(envelope).rejection());
        try (var span = Correlation.start("contoso.eventhubs.item.process", SpanKind.CONSUMER, parent, invocation, attributes);
             var scope = span.makeCurrent()) {
            var operation = context(invocation, span.context());
            var attempt = store.begin(envelope, Branch.BATCH, 1, TraceContexts.capture(span.context()), operation);
            span.attribute("contoso.process.attempt", Integer.toString(attempt.count()));
            if (attempt.disposition() == MessagingStore.Disposition.DUPLICATE) {
                span.attribute("contoso.outcome", "DUPLICATE"); return true;
            }
            if (attempt.disposition() != MessagingStore.Disposition.EXECUTE) return false;
            try {
                if (attempt.count() <= attempt.failureBudget()) {
                    store.failed(envelope, Branch.BATCH, attempt, false, operation);
                    span.failure("TRANSIENT_FAILURE"); return false;
                }
                store.complete(envelope, Branch.BATCH, attempt, TraceContexts.capture(span.context()), operation);
                span.attribute("contoso.outcome", "SUCCESS"); return true;
            } catch (RuntimeException failure) {
                span.failure(safe(failure));
                return false;
            }
        }
    }

    public void aggregatePending() {
        try (var admitted = RuntimeGuard.admitWork()) {
            for (var result : store.readyAggregates(32, context(InvocationId.generate(), Context.root()))) aggregateIfReady(result);
        }
    }

    private void aggregateIfReady(Envelope result) {
        var invocation = InvocationId.parse(result.businessInvocationId());
        var lookup = context(invocation, Context.root());
        var contributors = store.contributors(result.workflowId(), settings.contributorPublishers(), lookup);
        if (contributors.size() != 2) return;
        if (result.kind() == Envelope.Kind.RESULT && contributors.stream().noneMatch(value ->
            value.branch() == result.payload().contributor() && value.resultMessageId().equals(result.messageId()))) {
            throw new MessagingFailure(MessagingFailure.Code.UNTRUSTED_PUBLICATION);
        }
        var links = contributors.stream().flatMap(value -> java.util.stream.Stream.of(value.context(), value.resultContext())).distinct().toList();
        if (links.size() > settings.maxLinks()) throw new MessagingFailure(MessagingFailure.Code.LINK_LIMIT);
        var attempt = store.claimAggregate(result, lookup);
        if (attempt.isEmpty()) return;
        try (var span = Correlation.startLinked("contoso.fanin.process", SpanKind.INTERNAL, invocation,
                links,
                Map.of("messaging.system", "servicebus", "messaging.operation.name", "process",
                    "contoso.workflow.id", result.workflowId(), "contoso.branch", "AGGREGATOR",
                    "contoso.process.attempt", Integer.toString(attempt.get().count())));
             var scope = span.makeCurrent()) {
            try {
                store.aggregate(result, attempt.get(), TraceContexts.capture(span.context()), context(invocation, span.context()));
                span.attribute("contoso.outcome", "SUCCESS");
            } catch (RuntimeException failure) {
                span.failure(safe(failure)); throw failure;
            }
        }
    }

    private static String safe(RuntimeException failure) {
        if (failure instanceof MessagingFailure messaging) return messaging.code().name();
        if (failure instanceof DataAccessException data) return data.kind().name();
        return "PROCESS_FAILURE";
    }
}
