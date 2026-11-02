package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.workflow.RunAction;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.correlation.workflow.WorkTarget;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class NotifyTopicReplayFixture implements AutoCloseable {
    static final String SCHEMA = "contoso.notify-topic-replay-fixture.v1";
    private final String url;
    private final Connection anchor;
    private final EnvelopeCodec codec = new EnvelopeCodec();
    private final MessagingSettings settings = new MessagingSettings("contoso-corr-poc-bus.servicebus.windows.net",
        "https://contoso-corr-poc-egt.centralus-1.eventgrid.azure.net/api/events",
        "contoso-corr-poc-eh.servicebus.windows.net", "https://contosocorrpocfixture.queue.core.windows.net",
        null, MessagingFixture.ORDERS, MessagingFixture.FULFILLMENT, MessagingFixture.NOTIFY,
        MessagingFixture.AGGREGATOR, 32, 16);
    private final TopicCarrierTransport transport = new TopicCarrierTransport();

    NotifyTopicReplayFixture(Path database, boolean initialize) throws Exception {
        url = "jdbc:h2:file:" + database.toAbsolutePath().normalize() +
            ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=0;TRACE_LEVEL_FILE=0;TRACE_LEVEL_SYSTEM_OUT=0" +
            (initialize ? "" : ";IFEXISTS=TRUE");
        anchor = DriverManager.getConnection(url, "SA", "");
        try {
            if (initialize) {
                try (var input = PgMessagingStore.class.getClassLoader().getResourceAsStream(PgMessagingStore.MIGRATION);
                     var statement = anchor.createStatement()) {
                    String sql = new String(java.util.Objects.requireNonNull(input).readAllBytes(), StandardCharsets.UTF_8);
                    for (String command : sql.split(";")) if (!command.isBlank()) statement.execute(command);
                    for (String role : List.of(MessagingFixture.ORDERS, MessagingFixture.FULFILLMENT,
                        MessagingFixture.NOTIFY, MessagingFixture.AGGREGATOR)) {
                        statement.execute("CREATE USER " + role + " PASSWORD '' ADMIN");
                    }
                    statement.execute("CREATE TABLE contoso.fixture_topic_delivery (" +
                        "sequence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY," +
                        "source VARCHAR(24) NOT NULL,envelope_json VARCHAR(32768) NOT NULL,delivery_count INTEGER NOT NULL)");
                }
            }
        } catch (Exception failure) {
            anchor.close();
            throw failure;
        }
    }

    private PgConnectionFactory factory(String role) {
        return new PgConnectionFactory() {
            public Connection open() throws SQLException { return DriverManager.getConnection(url, role, ""); }
            public Map<String, String> telemetryAttributes() {
                return Map.of("db.system", "postgresql", "db.name", "contoso_orders",
                    "server.address", "contoso-corr-poc-pg.postgres.database.azure.com", "server.port", "5432");
            }
        };
    }

    private PgMessagingStore store(String role) { return new PgMessagingStore(factory(role), codec); }

    InvocationId invocation(String phase) throws Exception {
        return phase.equals("prepare") ? InvocationId.generate() :
            InvocationId.parse(transport.peek(phase.equals("notify") ? Source.NOTIFY : Source.FULFILLMENT).businessInvocationId());
    }

    Map<String, Object> prepare(OperationContext operation) throws Exception {
        var carrier = TraceContexts.capture(operation.parentContext());
        String workflow = InvocationId.generate().value();
        var draft = new Envelope(1, carrier.get("traceparent"), carrier.get("tracestate"),
            operation.invocationId().value(), InvocationId.generate().value(), null, workflow, Envelope.Kind.ORDER,
            null, new WorkPayload(workflow, "CONTOSO-001", 1, RunScenario.DLQ, null));
        var orders = store(MessagingFixture.ORDERS);
        orders.create(new MessagingStore.NewWorkflow(workflow, "RUN", 7, 2, draft,
            List.of(Destination.SERVICE_BUS_TOPIC)), operation);
        require(new OutboxPublisher(orders, transport).dispatch(8) == 1, "ORIGINAL_SEND");
        Envelope original = transport.peek(Source.FULFILLMENT);
        var fulfillment = new AsyncProcessor(store(MessagingFixture.FULFILLMENT), settings);
        require(!fulfillment.process(transport.one(Source.FULFILLMENT), Branch.FULFILLMENT), "FULFILLMENT_FIRST_ATTEMPT");
        require(fulfillment.process(transport.one(Source.FULFILLMENT), Branch.FULFILLMENT), "FULFILLMENT_DLQ");
        require(transport.pending(Source.FULFILLMENT_DLQ) == 1, "FULFILLMENT_DLQ_RETAINED");
        orders.control(workflow, new RunControl(RunAction.FAIL_BEFORE_EFFECT, WorkTarget.FULFILLMENT, 3), operation);
        orders.control(workflow, new RunControl(RunAction.PAUSE, WorkTarget.FULFILLMENT, 0), operation);
        return state("prepare", original, null, false);
    }

    Map<String, Object> notifyReplay(OperationContext operation) throws Exception {
        Envelope original = transport.peek(Source.NOTIFY);
        var notifyStore = store(MessagingFixture.NOTIFY);
        var processor = new AsyncProcessor(notifyStore, settings);
        require(!processor.process(transport.one(Source.NOTIFY), Branch.NOTIFY), "NOTIFY_FIRST_ATTEMPT");
        require(processor.process(transport.one(Source.NOTIFY), Branch.NOTIFY), "NOTIFY_DLQ");
        var deadLetter = transport.one(Source.NOTIFY_DLQ);
        require(deadLetter.source() == Source.NOTIFY_DLQ &&
            deadLetter.envelope().messageId().equals(original.messageId()), "NOTIFY_DLQ_IDENTITY");
        var orders = store(MessagingFixture.ORDERS);
        orders.control(original.workflowId(), new RunControl(RunAction.FAIL_BEFORE_EFFECT, WorkTarget.NOTIFY, 2), operation);
        orders.control(original.workflowId(), new RunControl(RunAction.PAUSE, WorkTarget.NOTIFY, 0), operation);
        orders.control(original.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.NOTIFY, 0), operation);
        require(orders.replayRequested(original.workflowId(), Source.NOTIFY_DLQ, operation), "NOTIFY_REQUEST");
        require(!orders.replayRequested(original.workflowId(), Source.FULFILLMENT_DLQ, operation), "REQUEST_ISOLATION");
        require(new ReplayProcessor(notifyStore, settings).replay(deadLetter, true), "NOTIFY_REPLAY_PROCESS");
        String id = notifyStore.prepareReplay(original, Source.NOTIFY_DLQ, operation);
        require(id.equals(notifyStore.prepareReplay(original, Source.NOTIFY_DLQ, operation)), "COMPOSITE_IDEMPOTENCY");
        require(new OutboxPublisher(notifyStore, transport).dispatch(8) == 1, "NOTIFY_REPLAY_SEND");
        Envelope replay = transport.peek(Source.NOTIFY);
        require(id.equals(replay.messageId()), "REPLAY_OUTBOX_IDENTITY");
        verifyReplayIdentity(original, replay);
        var delivery = transport.one(Source.NOTIFY);
        require(processor.process(delivery, Branch.NOTIFY) && delivery.completed, "NOTIFY_EFFECT");
        var result = state("notify", original, replay, false);
        require(result.get("notifyEffects").equals(1) && result.get("fulfillmentEffects").equals(0), "EFFECT_ISOLATION");
        return result;
    }

    Map<String, Object> skipOtherTopicSubscription(OperationContext operation) throws Exception {
        Envelope original = transport.peek(Source.FULFILLMENT_DLQ);
        var delivery = transport.one(Source.FULFILLMENT);
        Envelope replay = delivery.envelope();
        verifyReplayIdentity(original, replay);
        var fulfillment = store(MessagingFixture.FULFILLMENT);
        require(!fulfillment.replayRequested(original.workflowId(), Source.FULFILLMENT_DLQ, operation), "NO_OTHER_REPLAY_REQUEST");
        boolean rejected = false;
        try { fulfillment.prepareReplay(original, Source.FULFILLMENT_DLQ, operation); }
        // PgOperations redacts transactional domain rejections; the following state checks also require no mutation.
        catch (DataAccessException expected) { rejected = true; }
        require(rejected, "WRONG_SOURCE_REPLAY_REJECTED");
        require(new AsyncProcessor(fulfillment, settings).process(delivery, Branch.FULFILLMENT) &&
            delivery.completed, "NON_TARGET_SETTLEMENT");
        var result = state("skip", original, replay, true);
        require(result.get("fulfillmentEffects").equals(0) && result.get("notifyEffects").equals(1) &&
            result.get("fulfillmentReplayInbox").equals(0) && result.get("notifyReplayInbox").equals(1), "NO_OTHER_EFFECT");
        require(result.get("retainedFulfillmentDeadLetters").equals(1) &&
            result.get("fulfillmentFaultBudget").equals(3) && result.get("fulfillmentPaused").equals(true), "OTHER_FAULT_RETAINED");
        return result;
    }

    private static void verifyReplayIdentity(Envelope original, Envelope replay) {
        require(!original.messageId().equals(replay.messageId()) &&
            original.messageId().equals(replay.replayOf()) && original.messageId().equals(replay.causationId()) &&
            original.businessInvocationId().equals(replay.businessInvocationId()) &&
            original.workflowId().equals(replay.workflowId()), "STABLE_REPLAY_IDENTITY");
    }

    private Map<String, Object> state(String phase, Envelope original, Envelope replay, boolean skipped) throws Exception {
        var result = new LinkedHashMap<String, Object>();
        result.put("schema", SCHEMA);
        result.put("phase", phase);
        result.put("businessInvocationId", original.businessInvocationId());
        result.put("workflowId", original.workflowId());
        result.put("originalMessageId", original.messageId());
        result.put("replayMessageId", replay == null ? "" : replay.messageId());
        result.put("replayOf", replay == null ? "" : replay.replayOf());
        result.put("causationId", replay == null ? "" : replay.causationId());
        var source = TraceContexts.extract(original).spanContext();
        var sent = replay == null ? null : TraceContexts.extract(replay).spanContext();
        result.put("originalTraceId", source.getTraceId());
        result.put("originalSpanId", source.getSpanId());
        result.put("replayTraceId", sent == null ? "" : sent.getTraceId());
        result.put("replaySpanId", sent == null ? "" : sent.getSpanId());
        result.put("replaySource", "");
        result.put("replayOwner", "");
        result.put("replayRecordCount", 0);
        try (var query = anchor.prepareStatement(
            "SELECT original_message_id,source,new_message_id,owner FROM contoso.async_replay WHERE workflow_id=?")) {
            query.setObject(1, UUID.fromString(original.workflowId()));
            try (var rows = query.executeQuery()) {
                if (rows.next()) {
                    require(original.messageId().equals(rows.getString(1)) && Source.NOTIFY_DLQ.name().equals(rows.getString(2)) &&
                        replay != null && replay.messageId().equals(rows.getString(3)), "COMPOSITE_SOURCE_RECORD");
                    result.put("replaySource", rows.getString(2));
                    require(MessagingFixture.NOTIFY.equalsIgnoreCase(rows.getString(4)), "TRUSTED_REPLAY_OWNER");
                    result.put("replayOwner", rows.getString(4));
                    result.put("replayRecordCount", 1);
                    require(!rows.next(), "ONE_NOTIFY_REPLAY_RECORD");
                }
            }
        }
        for (String branch : List.of("FULFILLMENT", "NOTIFY")) {
            try (var query = anchor.prepareStatement("SELECT COUNT(*) FROM contoso.async_effect WHERE workflow_id=? AND branch=?")) {
                query.setObject(1, UUID.fromString(original.workflowId())); query.setString(2, branch);
                try (var rows = query.executeQuery()) {
                    rows.next(); result.put(branch.equals("NOTIFY") ? "notifyEffects" : "fulfillmentEffects", rows.getInt(1));
                }
            }
            try (var query = anchor.prepareStatement(
                "SELECT COUNT(*) FROM contoso.async_inbox WHERE message_id=? AND branch=? AND completed=TRUE")) {
                query.setObject(1, UUID.fromString(replay == null ? original.messageId() : replay.messageId()));
                query.setString(2, branch);
                try (var rows = query.executeQuery()) {
                    rows.next(); result.put(branch.equals("NOTIFY") ? "notifyReplayInbox" : "fulfillmentReplayInbox", rows.getInt(1));
                }
            }
        }
        result.put("notifyEffectOwner", "");
        result.put("notifyReplayReceiver", "");
        result.put("notifyReplayPublisher", "");
        if (replay != null) result.putAll(notifyPrincipals(replay));
        try (var query = anchor.prepareStatement(
            "SELECT failure_budget,paused FROM contoso.async_fault WHERE workflow_id=? AND target='FULFILLMENT'")) {
            query.setObject(1, UUID.fromString(original.workflowId()));
            try (var rows = query.executeQuery()) {
                require(rows.next(), "FULFILLMENT_FAULT");
                result.put("fulfillmentFaultBudget", rows.getInt(1)); result.put("fulfillmentPaused", rows.getBoolean(2));
            }
        }
        result.put("retainedFulfillmentDeadLetters", transport.pending(Source.FULFILLMENT_DLQ));
        result.put("topicSkipSettled", skipped);
        result.put("fixtureOnly", true);
        return Map.copyOf(result);
    }

    private Map<String, String> notifyPrincipals(Envelope replay) throws Exception {
        String currentUser;
        try (var connection = factory(MessagingFixture.NOTIFY).open();
             var query = connection.createStatement();
             var rows = query.executeQuery("SELECT CURRENT_USER")) {
            require(rows.next(), "CURRENT_NOTIFY_USER");
            Object value = rows.getObject(1);
            require(value instanceof String, "CURRENT_NOTIFY_USER_TYPE");
            currentUser = (String) value;
            require(MessagingFixture.NOTIFY.equalsIgnoreCase(currentUser), "CURRENT_NOTIFY_USER_IDENTITY");
            require(!rows.next(), "ONE_CURRENT_NOTIFY_USER");
        }
        try (var query = anchor.prepareStatement(
            "SELECT e.owner,i.receiver,p.publisher,i.source_publisher,p.envelope_json FROM contoso.async_effect e " +
            "JOIN contoso.async_inbox i ON i.message_id=e.message_id AND i.branch=e.branch " +
            "JOIN contoso.async_publication p ON p.message_id=e.message_id " +
            "AND p.destination='SERVICE_BUS_TOPIC' AND p.envelope_hash=? " +
            "WHERE e.message_id=? AND e.branch='NOTIFY' AND i.completed=TRUE")) {
            query.setString(1, codec.fingerprint(replay));
            query.setObject(2, UUID.fromString(replay.messageId()));
            try (var rows = query.executeQuery()) {
                require(rows.next(), "TRUSTED_NOTIFY_EFFECT_AND_PUBLICATION");
                for (int column = 1; column <= 3; column++) {
                    Object value = rows.getObject(column);
                    require(value instanceof String && currentUser.equals(value),
                        "TRUSTED_NOTIFY_PRINCIPAL_COLUMN_" + column);
                }
                require(rows.getObject(4) == null, "ORDER_INBOX_HAS_NO_RESULT_PUBLISHER");
                require(codec.json(replay).equals(rows.getString(5)), "EXACT_PROTECTED_REPLAY_PUBLICATION");
                var result = Map.of("notifyEffectOwner", rows.getString(1), "notifyReplayReceiver", rows.getString(2),
                    "notifyReplayPublisher", rows.getString(3));
                require(!rows.next(), "ONE_NOTIFY_EFFECT_AND_PUBLICATION");
                return result;
            }
        }
    }

    static void require(boolean value, String code) {
        if (!value) throw new IllegalStateException("NOTIFY_TOPIC_" + code);
    }

    @Override public void close() throws Exception { anchor.close(); }

    // Sequential SDK-carrier fixture, not a broker or a cross-process lease implementation.
    private final class TopicCarrierTransport implements MessagingTransport {
        private final AzureCarriers carriers = new AzureCarriers(codec);
        public void publish(Destination destination, Envelope envelope) {
            require(destination == Destination.SERVICE_BUS_TOPIC, "FIXTURE_DESTINATION");
            var message = carriers.serviceBus(envelope);
            Envelope wire = carriers.serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties());
            enqueue(Source.FULFILLMENT, wire, 1); enqueue(Source.NOTIFY, wire, 1);
        }
        private void enqueue(Source source, Envelope envelope, int count) {
            try (var insert = anchor.prepareStatement(
                "INSERT INTO contoso.fixture_topic_delivery(source,envelope_json,delivery_count) VALUES (?,?,?)")) {
                insert.setString(1, source.name()); insert.setString(2, codec.json(envelope)); insert.setInt(3, count);
                insert.executeUpdate();
            } catch (SQLException failure) { throw new IllegalStateException("NOTIFY_TOPIC_CARRIER_WRITE"); }
        }
        Envelope peek(Source source) throws Exception {
            try (var query = anchor.prepareStatement(
                "SELECT envelope_json FROM contoso.fixture_topic_delivery WHERE source=? ORDER BY sequence_id LIMIT 1")) {
                query.setString(1, source.name());
                try (var rows = query.executeQuery()) {
                    require(rows.next(), "MISSING_CARRIER"); return codec.decode(rows.getString(1));
                }
            }
        }
        int pending(Source source) throws Exception {
            try (var query = anchor.prepareStatement("SELECT COUNT(*) FROM contoso.fixture_topic_delivery WHERE source=?")) {
                query.setString(1, source.name());
                try (var rows = query.executeQuery()) { rows.next(); return rows.getInt(1); }
            }
        }
        TopicDelivery one(Source source) throws Exception {
            var deliveries = receive(source, 1, Duration.ZERO);
            require(deliveries.size() == 1, "MISSING_DELIVERY");
            return (TopicDelivery) deliveries.getFirst();
        }
        public List<Delivery> receive(Source source, int maximum, Duration wait) {
            require(maximum >= 1 && maximum <= 16, "FIXTURE_BATCH_BOUND");
            try (var query = anchor.prepareStatement(
                "SELECT sequence_id,envelope_json,delivery_count FROM contoso.fixture_topic_delivery " +
                "WHERE source=? ORDER BY sequence_id LIMIT ?")) {
                query.setString(1, source.name()); query.setInt(2, maximum);
                var result = new ArrayList<Delivery>();
                var ids = new ArrayList<Long>();
                try (var rows = query.executeQuery()) {
                    while (rows.next()) {
                        ids.add(rows.getLong(1));
                        result.add(new TopicDelivery(source, codec.decode(rows.getString(2)), rows.getInt(3)));
                    }
                }
                try (var delete = anchor.prepareStatement("DELETE FROM contoso.fixture_topic_delivery WHERE sequence_id=?")) {
                    for (long id : ids) { delete.setLong(1, id); require(delete.executeUpdate() == 1, "FIXTURE_DELIVERY_DELETE"); }
                }
                return List.copyOf(result);
            } catch (SQLException failure) { throw new IllegalStateException("NOTIFY_TOPIC_CARRIER_READ"); }
        }
        public List<String> partitions() { throw new UnsupportedOperationException("NOTIFY_TOPIC_ONLY"); }
        public List<HubRecord> receiveBatch(String partition, long offset, int maximum, Duration wait) {
            throw new UnsupportedOperationException("NOTIFY_TOPIC_ONLY");
        }
        public void close() {}

        private final class TopicDelivery implements Delivery {
            private final Source source;
            private final Envelope envelope;
            private final int count;
            private boolean completed;
            TopicDelivery(Source source, Envelope envelope, int count) {
                this.source = source; this.envelope = envelope; this.count = count;
            }
            public Source source() { return source; }
            public Envelope envelope() { return envelope; }
            public int deliveryCount() { return count; }
            public Instant lockedUntil() { return Instant.now().plusSeconds(120); }
            public Instant renew() { return lockedUntil(); }
            public void complete() { completed = true; }
            public void abandon() { enqueue(source, envelope, count + 1); }
            public void deadLetter(String reason) {
                enqueue(switch (source) {
                    case FULFILLMENT -> Source.FULFILLMENT_DLQ;
                    case NOTIFY -> Source.NOTIFY_DLQ;
                    default -> throw new IllegalStateException("NOTIFY_TOPIC_DLQ_SOURCE");
                }, envelope, count);
            }
        }
    }
}
