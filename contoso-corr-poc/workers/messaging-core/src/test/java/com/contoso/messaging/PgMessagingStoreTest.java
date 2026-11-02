package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.workflow.RunAction;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.correlation.workflow.WorkTarget;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class PgMessagingStoreTest {
    @Test void actualJdbcPublicationRecordsAuthenticateFixedWriterNotMessageClaims() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.RETRY);
            fixture.create(envelope, 2, Destination.SERVICE_BUS_ORDER);
            fixture.publication(envelope, Destination.SERVICE_BUS_ORDER);
            var consumer = fixture.store(MessagingFixture.FULFILLMENT);
            assertTrue(consumer.trusted(envelope, Destination.SERVICE_BUS_ORDER, Set.of(MessagingFixture.ORDERS), MessagingFixture.context(envelope)));
            assertFalse(consumer.trusted(envelope, Destination.SERVICE_BUS_ORDER, Set.of(MessagingFixture.NOTIFY), MessagingFixture.context(envelope)));
            assertFalse(consumer.trusted(envelope, Destination.EVENT_GRID, Set.of(MessagingFixture.ORDERS), MessagingFixture.context(envelope)));
            assertFalse(consumer.trusted(envelope.withContext(Map.of("traceparent", envelope.traceparent().replace("-01", "-00"))),
                Destination.SERVICE_BUS_ORDER, Set.of(MessagingFixture.ORDERS), MessagingFixture.context(envelope)));
            assertEquals(1, fixture.count("async_publication"));
        }
    }
    @Test void outboxSurvivesFailureAndOldLeaseCannotSettleNewAttempt() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.SYNC);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_ORDER);
            var store = fixture.store(MessagingFixture.ORDERS);
            var first = store.claimOutbox(1, MessagingFixture.context(envelope)).getFirst();
            assertTrue(store.claimOutbox(1, MessagingFixture.context(envelope)).isEmpty());
            assertTrue(fixture.store(MessagingFixture.NOTIFY).claimOutbox(1, MessagingFixture.context(envelope)).isEmpty());
            store.publicationFailed(first, "PUBLISH_UNCERTAIN", MessagingFixture.context(envelope));
            var second = store.claimOutbox(1, MessagingFixture.context(envelope)).getFirst();
            assertEquals(envelope.messageId(), second.draft().messageId());
            assertEquals(2, second.publishAttempt());
            assertThrows(RuntimeException.class, () -> store.published(first, envelope, MessagingFixture.context(envelope)));
            store.publicationRecorded(second, envelope, MessagingFixture.context(envelope));
            store.published(second, envelope, MessagingFixture.context(envelope));
            assertTrue(store.claimOutbox(1, MessagingFixture.context(envelope)).isEmpty());
        }
    }
    @Test void durableNFailuresAndSuccessAreNPlusOneAttemptsWithOneBusinessEffect() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.RETRY);
            fixture.create(envelope, 2, Destination.SERVICE_BUS_ORDER);
            var store = fixture.store(MessagingFixture.FULFILLMENT);
            for (int attempt = 1; attempt <= 2; attempt++) {
                var lease = store.begin(envelope, Branch.ORDER, attempt, MessagingFixture.processContext(attempt), MessagingFixture.context(envelope));
                assertEquals(attempt, lease.count());
                assertEquals(2, lease.failureBudget());
                store.failed(envelope, Branch.ORDER, lease, false, MessagingFixture.context(envelope));
                assertEquals(0, fixture.count("async_effect"));
            }
            var success = store.begin(envelope, Branch.ORDER, 3, MessagingFixture.processContext(3), MessagingFixture.context(envelope));
            store.complete(envelope, Branch.ORDER, success, MessagingFixture.processContext(3), MessagingFixture.context(envelope));
            assertEquals(3, fixture.count("async_attempt"));
            assertEquals(1, fixture.count("async_effect"));
            var view = store.find(envelope.workflowId(), "RUN", MessagingFixture.context(envelope)).orElseThrow();
            assertEquals("COMPLETED", view.state());
            assertEquals(envelope.businessInvocationId(), view.businessInvocationId());
            var duplicate = store.begin(envelope, Branch.ORDER, 4, MessagingFixture.processContext(4), MessagingFixture.context(envelope));
            assertEquals(MessagingStore.Disposition.DUPLICATE, duplicate.disposition());
            assertEquals(1, fixture.count("async_effect"));
        }
    }
    @Test void databaseLeaseFencesConcurrentAndStaleWorkers() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.SYNC);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_ORDER);
            var store = fixture.store(MessagingFixture.FULFILLMENT);
            var first = store.begin(envelope, Branch.ORDER, 1, Map.of(), MessagingFixture.context(envelope));
            var busy = store.begin(envelope, Branch.ORDER, 2, Map.of(), MessagingFixture.context(envelope));
            assertEquals(MessagingStore.Disposition.BUSY, busy.disposition());
            store.failed(envelope, Branch.ORDER, first, false, MessagingFixture.context(envelope));
            var next = store.begin(envelope, Branch.ORDER, 3, Map.of(), MessagingFixture.context(envelope));
            assertThrows(RuntimeException.class, () -> store.complete(envelope, Branch.ORDER, first, Map.of(), MessagingFixture.context(envelope)));
            store.complete(envelope, Branch.ORDER, next, Map.of(), MessagingFixture.context(envelope));
            assertEquals(1, fixture.count("async_effect"));
        }
    }
    @Test void branchEffectResultOutboxAndContributorAreOneAtomicTransaction() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.FAN_OUT);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_TOPIC);
            var factory = fixture.factory(MessagingFixture.FULFILLMENT);
            PgConnectionFactory injected = new PgConnectionFactory() {
                public Map<String, String> telemetryAttributes() { return factory.telemetryAttributes(); }
                public Connection open() throws SQLException {
                    Connection delegate = factory.open();
                    return (Connection) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                        if (method.getName().equals("prepareStatement") && ((String) args[0]).startsWith("INSERT INTO contoso.async_contributor")) {
                            throw new SQLException("synthetic_failure_never_exported", "40001");
                        }
                        try { return method.invoke(delegate, args); }
                        catch (java.lang.reflect.InvocationTargetException failure) { throw failure.getCause(); }
                    });
                }
            };
            var store = new PgMessagingStore(injected, fixture.codec);
            var attempt = store.begin(envelope, Branch.FULFILLMENT, 1, MessagingFixture.processContext(1), MessagingFixture.context(envelope));
            assertThrows(RuntimeException.class, () -> store.complete(envelope, Branch.FULFILLMENT, attempt,
                MessagingFixture.processContext(1), MessagingFixture.context(envelope)));
            assertEquals(0, fixture.count("async_effect"));
            assertEquals(0, fixture.count("async_contributor"));
            assertEquals(1, fixture.count("async_outbox"));
        }
    }
    @Test void allPersistedContributorIdentitiesAndContextsPrecedeOneAggregateEffect() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.FAN_OUT);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_TOPIC);
            int number = 2;
            for (var pair : Map.of(Branch.FULFILLMENT, MessagingFixture.FULFILLMENT, Branch.NOTIFY, MessagingFixture.NOTIFY).entrySet()) {
                var store = fixture.store(pair.getValue());
                var trace = MessagingFixture.processContext(number++);
                var attempt = store.begin(envelope, pair.getKey(), 1, trace, MessagingFixture.context(envelope));
                store.complete(envelope, pair.getKey(), attempt, trace, MessagingFixture.context(envelope));
            }
            var aggregator = fixture.store(MessagingFixture.AGGREGATOR);
            assertTrue(aggregator.contributors(envelope.workflowId(), fixture.settings.contributorPublishers(), MessagingFixture.context(envelope)).isEmpty());
            int published = 5;
            for (String role : List.of(MessagingFixture.FULFILLMENT, MessagingFixture.NOTIFY)) {
                var writer = fixture.store(role);
                var pending = writer.claimOutbox(1, MessagingFixture.context(envelope)).getFirst();
                Envelope result = pending.draft().withContext(MessagingFixture.processContext(published++));
                writer.publicationRecorded(pending, result, MessagingFixture.context(envelope));
                writer.published(pending, result, MessagingFixture.context(envelope));
                var receipt = aggregator.begin(result, Branch.AGGREGATOR, 1, MessagingFixture.processContext(7), MessagingFixture.context(envelope));
                aggregator.complete(result, Branch.AGGREGATOR, receipt, MessagingFixture.processContext(7), MessagingFixture.context(envelope));
            }
            var contributors = aggregator.contributors(envelope.workflowId(), fixture.settings.contributorPublishers(), MessagingFixture.context(envelope));
            assertEquals(Set.of(Branch.FULFILLMENT, Branch.NOTIFY), contributors.stream().map(MessagingStore.Contributor::branch).collect(java.util.stream.Collectors.toSet()));
            assertEquals(2, contributors.stream().map(value -> value.context().getSpanId()).distinct().count());
            assertEquals(4, contributors.stream().flatMap(value -> java.util.stream.Stream.of(value.context(), value.resultContext()))
                .map(value -> value.getSpanId()).distinct().count());
            assertEquals(3, fixture.count("async_outbox"));
            assertThrows(RuntimeException.class, () -> aggregator.contributors(envelope.workflowId(),
                Map.of(Branch.FULFILLMENT, MessagingFixture.FULFILLMENT, Branch.NOTIFY, "UNTRUSTED"), MessagingFixture.context(envelope)));
            var result = aggregator.readyAggregates(1, MessagingFixture.context(envelope)).getFirst();
            var attempt = aggregator.claimAggregate(result, MessagingFixture.context(envelope)).orElseThrow();
            aggregator.aggregate(result, attempt, MessagingFixture.processContext(4), MessagingFixture.context(envelope));
            assertTrue(aggregator.claimAggregate(result, MessagingFixture.context(envelope)).isEmpty());
            assertTrue(aggregator.readyAggregates(1, MessagingFixture.context(envelope)).isEmpty());
            assertEquals("COMPLETED", aggregator.find(envelope.workflowId(), "RUN", MessagingFixture.context(envelope)).orElseThrow().state());
        }
    }
    @Test void replayCreatesDurableNewWorkExactlyOnceAndCannotRepeatSuccessfulEffect() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var original = MessagingFixture.envelope(RunScenario.DLQ);
            fixture.create(original, 1, Destination.SERVICE_BUS_ORDER);
            var store = fixture.store(MessagingFixture.FULFILLMENT);
            var failed = store.begin(original, Branch.ORDER, 1, Map.of(), MessagingFixture.context(original));
            store.failed(original, Branch.ORDER, failed, true, MessagingFixture.context(original));
            fixture.store(MessagingFixture.ORDERS).control(original.workflowId(),
                new RunControl(RunAction.REPLAY, WorkTarget.SERVICE_BUS, 0), MessagingFixture.context(original));
            String next = store.prepareReplay(original, Destination.SERVICE_BUS_ORDER, MessagingFixture.context(original));
            assertNotEquals(original.messageId(), next);
            assertEquals(next, store.prepareReplay(original, Destination.SERVICE_BUS_ORDER, MessagingFixture.context(original)));
            assertEquals(1, fixture.count("async_replay"));
            Envelope replay = store.claimOutbox(1, MessagingFixture.context(original)).getFirst().draft();
            assertEquals(original.messageId(), replay.replayOf());
            assertEquals(original.businessInvocationId(), replay.businessInvocationId());
            var attempt = store.begin(replay, Branch.ORDER, 1, Map.of(), MessagingFixture.context(original));
            assertEquals(0, attempt.failureBudget());
            store.complete(replay, Branch.ORDER, attempt, Map.of(), MessagingFixture.context(original));
            var delayedOriginal = store.begin(original, Branch.ORDER, 2, Map.of(), MessagingFixture.context(original));
            store.complete(original, Branch.ORDER, delayedOriginal, Map.of(), MessagingFixture.context(original));
            assertEquals(1, fixture.count("async_effect"));
        }
    }
    @Test void partitionCursorIsDurableExclusiveAndFencedAgainstOldReceivers() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var store = fixture.store(MessagingFixture.AGGREGATOR);
            var first = store.claimPartition("0", MessagingFixture.lookup()).orElseThrow();
            assertEquals(-1, first.offset());
            assertTrue(store.claimPartition("0", MessagingFixture.lookup()).isEmpty());
            store.checkpoint(first, 42, 7, MessagingFixture.lookup());
            var second = store.claimPartition("0", MessagingFixture.lookup()).orElseThrow();
            assertEquals(42, second.offset());
            assertEquals(7, second.sequenceNumber());
            assertThrows(RuntimeException.class, () -> store.checkpoint(first, 100, 20, MessagingFixture.lookup()));
            assertThrows(RuntimeException.class, () -> store.checkpoint(second, 40, 6, MessagingFixture.lookup()));
            store.releasePartition(second, MessagingFixture.lookup());
            assertEquals(42, store.claimPartition("0", MessagingFixture.lookup()).orElseThrow().offset());
        }
    }
    @Test void frozenControlTargetActuallyScopesFaultsToNamedWorker() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.FAN_OUT);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_TOPIC);
            fixture.store(MessagingFixture.ORDERS).control(envelope.workflowId(),
                new RunControl(RunAction.FAIL_BEFORE_EFFECT, WorkTarget.NOTIFY, 2), MessagingFixture.context(envelope));
            var fulfillment = fixture.store(MessagingFixture.FULFILLMENT).begin(envelope, Branch.FULFILLMENT, 1, Map.of(), MessagingFixture.context(envelope));
            var notify = fixture.store(MessagingFixture.NOTIFY).begin(envelope, Branch.NOTIFY, 1, Map.of(), MessagingFixture.context(envelope));
            assertEquals(0, fulfillment.failureBudget());
            assertEquals(2, notify.failureBudget());
            fixture.store(MessagingFixture.NOTIFY).failed(envelope, Branch.NOTIFY, notify, false, MessagingFixture.context(envelope));
            fixture.store(MessagingFixture.ORDERS).control(envelope.workflowId(),
                new RunControl(RunAction.PAUSE, WorkTarget.NOTIFY, 0), MessagingFixture.context(envelope));
            assertEquals(MessagingStore.Disposition.PAUSED, fixture.store(MessagingFixture.NOTIFY)
                .begin(envelope, Branch.NOTIFY, 2, Map.of(), MessagingFixture.context(envelope)).disposition());
        }
    }
    @Test void eventHubsPoisonQuarantineIsDurableWithoutRetainingUntrustedContextOrBody() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var store = fixture.store(MessagingFixture.AGGREGATOR);
            store.quarantine("0", 123, 4, "INVALID_CARRIER", MessagingFixture.lookup());
            store.quarantine("0", 123, 4, "INVALID_CARRIER", MessagingFixture.lookup());
            assertEquals(1, fixture.count("async_quarantine"));
            assertThrows(RuntimeException.class, () -> store.quarantine("0", 124, 5, "raw rejected input\n", MessagingFixture.lookup()));
        }
    }

    @Test void targetedNotificationReplayPreservesOtherFaultsAndCannotWithdrawOtherDlqs() throws Exception {
        try (var fixture = new MessagingFixture(); var transport = new LocalCarrierTransport(fixture.codec)) {
            var envelope = MessagingFixture.envelope(RunScenario.FAN_OUT);
            fixture.create(envelope, 4, Destination.SERVICE_BUS_TOPIC);
            fixture.publication(envelope, Destination.SERVICE_BUS_TOPIC);
            var orders = fixture.store(MessagingFixture.ORDERS);
            orders.control(envelope.workflowId(), new RunControl(RunAction.FAIL_BEFORE_EFFECT, WorkTarget.FULFILLMENT, 3), MessagingFixture.context(envelope));
            orders.control(envelope.workflowId(), new RunControl(RunAction.PAUSE, WorkTarget.FULFILLMENT, 0), MessagingFixture.context(envelope));
            orders.control(envelope.workflowId(), new RunControl(RunAction.FAIL_BEFORE_EFFECT, WorkTarget.NOTIFY, 2), MessagingFixture.context(envelope));
            orders.control(envelope.workflowId(), new RunControl(RunAction.PAUSE, WorkTarget.NOTIFY, 0), MessagingFixture.context(envelope));
            transport.publish(Destination.SERVICE_BUS_TOPIC, envelope);
            transport.receive(Source.FULFILLMENT, 1, java.time.Duration.ZERO).getFirst().deadLetter("CONTOSO_FAILURE_BUDGET");
            transport.receive(Source.NOTIFY, 1, java.time.Duration.ZERO).getFirst().deadLetter("CONTOSO_FAILURE_BUDGET");
            orders.control(envelope.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.NOTIFY, 0), MessagingFixture.context(envelope));
            assertTrue(orders.replayRequested(envelope.workflowId(), Source.NOTIFY_DLQ, MessagingFixture.context(envelope)));
            for (var source : List.of(Source.ORDERS_DLQ, Source.FULFILLMENT_DLQ, Source.LEGACY_POISON)) {
                assertFalse(orders.replayRequested(envelope.workflowId(), source, MessagingFixture.context(envelope)));
            }
            try (var query = fixture.anchor.prepareStatement(
                "SELECT target,paused,failure_budget,replay_requested FROM contoso.async_fault WHERE workflow_id=? ORDER BY target")) {
                query.setObject(1, java.util.UUID.fromString(envelope.workflowId()));
                try (var rows = query.executeQuery()) {
                    assertTrue(rows.next()); assertEquals("FULFILLMENT", rows.getString(1));
                    assertTrue(rows.getBoolean(2)); assertEquals(3, rows.getInt(3)); assertFalse(rows.getBoolean(4));
                    assertTrue(rows.next()); assertEquals("NOTIFY", rows.getString(1));
                    assertFalse(rows.getBoolean(2)); assertEquals(0, rows.getInt(3)); assertTrue(rows.getBoolean(4));
                    assertFalse(rows.next());
                }
            }
            assertEquals("4", orders.find(envelope.workflowId(), "RUN", MessagingFixture.context(envelope)).orElseThrow().details().get("failureBudget"));
            var fulfillment = fixture.store(MessagingFixture.FULFILLMENT);
            assertFalse(new ReplayProcessor(fulfillment, fixture.settings).replay(
                transport.receive(Source.FULFILLMENT_DLQ, 1, java.time.Duration.ZERO).getFirst(), true));
            assertEquals(0, fixture.count("async_replay"));
            assertThrows(RuntimeException.class, () -> fulfillment.prepareReplay(envelope, Source.FULFILLMENT_DLQ, MessagingFixture.context(envelope)));
            var notify = fixture.store(MessagingFixture.NOTIFY);
            assertTrue(new ReplayProcessor(notify, fixture.settings).replay(
                transport.receive(Source.NOTIFY_DLQ, 1, java.time.Duration.ZERO).getFirst(), true));
            var pending = notify.claimOutbox(1, MessagingFixture.context(envelope)).getFirst();
            var replay = pending.draft();
            assertTrue(notify.replayAppliesTo(replay, Source.NOTIFY, MessagingFixture.context(envelope)));
            assertFalse(notify.replayAppliesTo(replay, Source.FULFILLMENT, MessagingFixture.context(envelope)));
            notify.publicationRecorded(pending, replay, MessagingFixture.context(envelope));
            notify.published(pending, replay, MessagingFixture.context(envelope));
            transport.publish(Destination.SERVICE_BUS_TOPIC, replay);
            assertTrue(new AsyncProcessor(fulfillment, fixture.settings).process(
                transport.receive(Source.FULFILLMENT, 1, java.time.Duration.ZERO).getFirst(), Branch.FULFILLMENT));
            assertEquals(0, fixture.count("async_effect"));
            assertTrue(new AsyncProcessor(notify, fixture.settings).process(
                transport.receive(Source.NOTIFY, 1, java.time.Duration.ZERO).getFirst(), Branch.NOTIFY));
            assertEquals(1, fixture.count("async_effect"));
            assertEquals(1, fixture.count("async_replay"));
            assertFalse(transport.receive(Source.FULFILLMENT_DLQ, 1, java.time.Duration.ZERO).isEmpty());
        }
    }

    @Test void replayTransportTargetsStaySeparateAndUnsupportedTargetsCannotMutateState() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.DLQ);
            fixture.create(envelope, 2, Destination.SERVICE_BUS_ORDER);
            var store = fixture.store(MessagingFixture.ORDERS);
            for (var target : List.of(WorkTarget.EVENT_GRID, WorkTarget.EVENT_HUBS, WorkTarget.AGGREGATOR)) {
                assertThrows(RuntimeException.class, () -> store.control(envelope.workflowId(),
                    new RunControl(RunAction.REPLAY, target, 0), MessagingFixture.context(envelope)));
                assertEquals(0, fixture.count("async_fault"));
                assertEquals("QUEUED", store.find(envelope.workflowId(), "RUN", MessagingFixture.context(envelope)).orElseThrow().state());
            }
            store.control(envelope.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.STORAGE_QUEUE, 0), MessagingFixture.context(envelope));
            assertTrue(store.replayRequested(envelope.workflowId(), Source.LEGACY_POISON, MessagingFixture.context(envelope)));
            assertFalse(store.replayRequested(envelope.workflowId(), Source.ORDERS_DLQ, MessagingFixture.context(envelope)));
            store.control(envelope.workflowId(), new RunControl(RunAction.CLEAR_FAULTS, WorkTarget.STORAGE_QUEUE, 0), MessagingFixture.context(envelope));
            assertFalse(store.replayRequested(envelope.workflowId(), MessagingFixture.context(envelope)));
            store.control(envelope.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.SERVICE_BUS, 0), MessagingFixture.context(envelope));
            for (var source : List.of(Source.ORDERS_DLQ, Source.FULFILLMENT_DLQ, Source.NOTIFY_DLQ)) {
                assertTrue(store.replayRequested(envelope.workflowId(), source, MessagingFixture.context(envelope)));
            }
            assertFalse(store.replayRequested(envelope.workflowId(), Source.LEGACY_POISON, MessagingFixture.context(envelope)));
        }
    }

    @Test void sharedTopicReplayDeduplicatesEachActualSubscriptionIndependently() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var envelope = MessagingFixture.envelope(RunScenario.FAN_OUT);
            fixture.create(envelope, 0, Destination.SERVICE_BUS_TOPIC);
            var store = fixture.store(MessagingFixture.ORDERS);
            store.control(envelope.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.SERVICE_BUS, 0), MessagingFixture.context(envelope));
            var fulfillment = fixture.store(MessagingFixture.FULFILLMENT);
            var notify = fixture.store(MessagingFixture.NOTIFY);
            String first = fulfillment.prepareReplay(envelope, Source.FULFILLMENT_DLQ, MessagingFixture.context(envelope));
            String second = notify.prepareReplay(envelope, Source.NOTIFY_DLQ, MessagingFixture.context(envelope));
            assertNotEquals(first, second);
            assertEquals(first, fulfillment.prepareReplay(envelope, Source.FULFILLMENT_DLQ, MessagingFixture.context(envelope)));
            assertEquals(second, notify.prepareReplay(envelope, Source.NOTIFY_DLQ, MessagingFixture.context(envelope)));
            assertEquals(2, fixture.count("async_replay"));
        }
    }
}
