package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.inventory.data.EntraPgConnectionFactory;
import io.opentelemetry.context.Context;
import java.time.Duration;
import java.time.Instant;

public final class MessagingRuntime implements AutoCloseable {
    private final MessagingStore store;
    private final MessagingTransport transport;
    private final MessagingSettings settings;
    private final PgConnectionFactory ownedConnections;
    private final OutboxPublisher publisher;
    private final AsyncProcessor processor;
    private final ReplayProcessor replay;

    public MessagingRuntime(MessagingStore store, MessagingTransport transport, MessagingSettings settings) {
        this(store, transport, settings, null);
    }
    private MessagingRuntime(MessagingStore store, MessagingTransport transport, MessagingSettings settings, PgConnectionFactory owned) {
        this.store = store; this.transport = transport; this.settings = settings; this.ownedConnections = owned;
        publisher = new OutboxPublisher(store, transport); processor = new AsyncProcessor(store, settings);
        replay = new ReplayProcessor(store, settings);
    }
    public static MessagingRuntime fromEnvironment(String serviceName) {
        RuntimeGuard.verify(serviceName, MessagingRuntime.class.getClassLoader());
        MessagingLoggingGuard.verify();
        var settings = MessagingSettings.fromEnvironment();
        var codec = new EnvelopeCodec();
        var connections = EntraPgConnectionFactory.fromEnvironment(serviceName);
        return new MessagingRuntime(new PgMessagingStore(connections, codec), new AzureMessagingTransport(settings, codec), settings, connections);
    }
    public void pollFulfillment() {
        publisher.dispatch(32);
        one(Source.ORDERS, Branch.ORDER); one(Source.FULFILLMENT, Branch.FULFILLMENT);
        one(Source.EVENT_GRID_RELAY, Branch.EVENT_GRID); one(Source.LEGACY, Branch.STORAGE_QUEUE);
        replayOne(Source.ORDERS_DLQ, true); replayOne(Source.FULFILLMENT_DLQ, true);
        replayOne(Source.LEGACY_POISON, true);
        publisher.dispatch(32);
    }
    public void pollNotify() {
        publisher.dispatch(32); one(Source.NOTIFY, Branch.NOTIFY);
        replayOne(Source.NOTIFY_DLQ, true); publisher.dispatch(32);
    }
    public void pollAggregator() {
        one(Source.RESULTS, Branch.AGGREGATOR);
        processor.aggregatePending();
        for (String partition : transport.partitions()) {
            try (var admitted = RuntimeGuard.admitWork()) {
            var context = new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(30));
            var lease = store.claimPartition(partition, context);
            if (lease.isEmpty()) continue;
            try {
                var records = transport.receiveBatch(partition, lease.get().offset(), settings.batchSize(), Duration.ofSeconds(2));
                if (!records.isEmpty() && processor.processBatch(records, lease.get().receiveAttempt())) {
                    var last = records.getLast();
                    store.checkpoint(lease.get(), last.offset(), last.sequenceNumber(),
                        new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(30)));
                } else store.releasePartition(lease.get(), context);
            } catch (RuntimeException failure) {
                try { store.releasePartition(lease.get(), context); } catch (RuntimeException ignored) {}
                throw failure;
            }
            }
        }
    }
    private void one(Source source, Branch branch) {
        try (var admitted = RuntimeGuard.admitWork()) {
            for (var delivery : transport.receive(source, 1, Duration.ofSeconds(2))) processor.process(delivery, branch);
        }
    }
    private boolean replayOne(Source source, boolean requireRequest) {
        try (var admitted = RuntimeGuard.admitWork()) {
        boolean any = false;
        for (var delivery : transport.receive(source, 1, Duration.ofSeconds(2))) any |= replay.replay(delivery, requireRequest);
        return any;
        }
    }
    public boolean replayOnce(Source source, boolean requireRequest) {
        boolean any = replayOne(source, requireRequest);
        publisher.dispatch(32);
        return any;
    }
    @Override public void close() {
        try { transport.close(); }
        finally { if (ownedConnections != null) ownedConnections.close(); }
    }
}
