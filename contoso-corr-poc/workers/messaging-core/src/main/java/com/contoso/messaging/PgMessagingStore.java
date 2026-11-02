package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.data.PgOperation;
import com.contoso.correlation.data.PgOperations;
import com.contoso.correlation.data.SqlWork;
import com.contoso.correlation.workflow.RunAction;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.WorkflowView;
import com.contoso.correlation.workflow.WorkTarget;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public final class PgMessagingStore implements MessagingStore {
    public static final String MIGRATION = "db/messaging/V002__messaging.sql";
    private static final Duration LEASE = Duration.ofSeconds(45);
    private final PgConnectionFactory connections;
    private final EnvelopeCodec codec;

    public PgMessagingStore(PgConnectionFactory connections, EnvelopeCodec codec) {
        this.connections = java.util.Objects.requireNonNull(connections);
        this.codec = java.util.Objects.requireNonNull(codec);
    }

    private <T> T tx(OperationContext context, SqlWork<T> work) {
        return PgOperations.execute(connections, PgOperation.TRANSACTION, context, 1, connection -> {
            connection.setAutoCommit(false);
            try {
                T result = work.run(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException failure) {
                try { connection.rollback(); } catch (SQLException ignored) {}
                throw failure;
            }
        });
    }

    @Override public WorkflowView create(NewWorkflow command, OperationContext context) {
        InvocationId.parse(command.id());
        if (!Set.of("ORDER", "RUN").contains(command.type()) || command.destinations().isEmpty() ||
            command.destinations().size() > 32 || command.failureBudget() < 0 || command.failureBudget() > 10 ||
            !command.id().equals(command.draft().workflowId()) ||
            !context.invocationId().value().equals(command.draft().businessInvocationId())) invalid();
        return tx(context, connection -> {
            var existing = find(connection, command.id(), command.type(), true);
            if (existing.isPresent()) {
                WorkflowView view = existing.get();
                if (!view.details().get("sku").equals(command.draft().payload().sku()) ||
                    !view.details().get("quantity").equals(Integer.toString(command.draft().payload().quantity())) ||
                    !view.details().get("scenario").equals(command.draft().payload().scenario().name())) conflict();
                return view;
            }
            var payload = command.draft().payload();
            try (var insert = connection.prepareStatement(
                "INSERT INTO contoso.async_workflow(workflow_id,invocation_id,workflow_type,scenario,demo_id,failure_budget,state,order_id,sku,quantity) VALUES (?,?,?,?,?,?,?,?,?,?)")) {
                uuid(insert, 1, command.id()); uuid(insert, 2, command.draft().businessInvocationId());
                insert.setString(3, command.type()); insert.setString(4, payload.scenario().name());
                insert.setInt(5, command.demoId()); insert.setInt(6, command.failureBudget());
                insert.setString(7, "QUEUED"); uuid(insert, 8, payload.orderId());
                insert.setString(9, payload.sku()); insert.setInt(10, payload.quantity()); insert.executeUpdate();
            }
            for (int index = 0; index < command.destinations().size(); index++) {
                Envelope draft = index == 0 ? command.draft() : new Envelope(1,
                    command.draft().traceparent(), command.draft().tracestate(), command.draft().businessInvocationId(),
                    InvocationId.generate().value(), command.draft().causationId(), command.id(),
                    command.draft().kind(), null, payload);
                outbox(connection, draft, command.destinations().get(index));
            }
            return find(connection, command.id(), command.type(), false).orElseThrow();
        });
    }

    @Override public Optional<WorkflowView> find(String id, String type, OperationContext context) {
        InvocationId.parse(id);
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1,
            connection -> find(connection, id, type, false));
    }

    private Optional<WorkflowView> find(Connection connection, String id, String type, boolean lock) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT invocation_id,state,scenario,demo_id,failure_budget,paused,replay_requested,sku,quantity,last_control_target FROM contoso.async_workflow WHERE workflow_id=? AND workflow_type=?" + (lock ? " FOR UPDATE" : ""))) {
            uuid(query, 1, id); query.setString(2, type);
            try (var rows = query.executeQuery()) {
                if (!rows.next()) return Optional.empty();
                return Optional.of(new WorkflowView(id, rows.getString(1), rows.getString(2), Map.of(
                    "scenario", rows.getString(3), "demoId", Integer.toString(rows.getInt(4)),
                    "failureBudget", Integer.toString(rows.getInt(5)), "paused", Boolean.toString(rows.getBoolean(6)),
                    "replayRequested", Boolean.toString(rows.getBoolean(7)), "sku", rows.getString(8),
                    "quantity", Integer.toString(rows.getInt(9)), "controlTarget", rows.getString(10))));
            }
        }
    }

    @Override public WorkflowView control(String id, RunControl command, OperationContext context) {
        InvocationId.parse(id);
        if (command.action() == RunAction.REPLAY && !Set.of(WorkTarget.ORDER, WorkTarget.FULFILLMENT,
            WorkTarget.NOTIFY, WorkTarget.SERVICE_BUS, WorkTarget.STORAGE_QUEUE).contains(command.target())) invalid();
        return tx(context, connection -> {
            find(connection, id, "RUN", true).orElseThrow(() -> new MessagingFailure(MessagingFailure.Code.INVALID_STATE));
            try (var update = connection.prepareStatement("UPDATE contoso.async_workflow SET last_control_target=? WHERE workflow_id=?")) {
                update.setString(1, command.target().name()); uuid(update, 2, id); update.executeUpdate();
            }
            if (command.action() == RunAction.REPLAY) {
                targetControl(connection, id, command);
                try (var update = connection.prepareStatement(
                    "UPDATE contoso.async_workflow SET replay_requested=TRUE,state='REPLAY_REQUESTED',updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?")) {
                    uuid(update, 1, id); update.executeUpdate();
                }
                return find(connection, id, "RUN", false).orElseThrow();
            }
            if (command.target() != WorkTarget.ORDER) {
                targetControl(connection, id, command);
                refreshReplayStatus(connection, id);
                return find(connection, id, "RUN", false).orElseThrow();
            }
            String sql = switch (command.action()) {
                case PAUSE -> "UPDATE contoso.async_workflow SET paused=TRUE,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?";
                case RESUME -> "UPDATE contoso.async_workflow SET paused=FALSE,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?";
                case FAIL_BEFORE_EFFECT -> "UPDATE contoso.async_workflow SET failure_budget=?,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?";
                case CLEAR_FAULTS -> "UPDATE contoso.async_workflow SET failure_budget=0,paused=FALSE,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?";
                case REPLAY -> throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
            };
            try (var update = connection.prepareStatement(sql)) {
                int index = 1;
                if (command.action() == RunAction.FAIL_BEFORE_EFFECT) update.setInt(index++, command.failureBudget());
                uuid(update, index, id); update.executeUpdate();
            }
            if (command.action() == RunAction.CLEAR_FAULTS) {
                try (var delete = connection.prepareStatement("DELETE FROM contoso.async_fault WHERE workflow_id=?")) {
                    uuid(delete, 1, id); delete.executeUpdate();
                }
                refreshReplayStatus(connection, id);
            }
            return find(connection, id, "RUN", false).orElseThrow();
        });
    }

    private void targetControl(Connection connection, String id, RunControl command) throws SQLException {
        try (var query = connection.prepareStatement("SELECT target FROM contoso.async_fault WHERE workflow_id=? AND target=?")) {
            uuid(query, 1, id); query.setString(2, command.target().name());
            try (var rows = query.executeQuery()) {
                if (!rows.next()) try (var insert = connection.prepareStatement("INSERT INTO contoso.async_fault(workflow_id,target) VALUES (?,?)")) {
                    uuid(insert, 1, id); insert.setString(2, command.target().name()); insert.executeUpdate();
                }
            }
        }
        String change = switch (command.action()) {
            case PAUSE -> "paused=TRUE";
            case RESUME -> "paused=FALSE";
            case FAIL_BEFORE_EFFECT -> "failure_budget=?";
            case CLEAR_FAULTS -> "paused=FALSE,failure_budget=0,replay_requested=FALSE";
            case REPLAY -> "paused=FALSE,failure_budget=0,replay_requested=TRUE";
            default -> throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        };
        try (var update = connection.prepareStatement("UPDATE contoso.async_fault SET " + change + " WHERE workflow_id=? AND target=?")) {
            int index = 1;
            if (command.action() == RunAction.FAIL_BEFORE_EFFECT) update.setInt(index++, command.failureBudget());
            uuid(update, index++, id); update.setString(index, command.target().name()); update.executeUpdate();
        }
    }

    private void outbox(Connection connection, Envelope draft, Destination destination) throws SQLException {
        try (var insert = connection.prepareStatement(
            "INSERT INTO contoso.async_outbox(message_id,workflow_id,destination,draft_json) VALUES (?,?,?,?)")) {
            uuid(insert, 1, draft.messageId()); uuid(insert, 2, draft.workflowId());
            insert.setString(3, destination.name()); insert.setString(4, codec.json(draft)); insert.executeUpdate();
        }
    }

    private boolean requested(Connection connection, String id, Set<WorkTarget> targets) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT target FROM contoso.async_fault WHERE workflow_id=? AND replay_requested=TRUE")) {
            uuid(query, 1, id);
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    String requestedTarget = rows.getString(1);
                    if (targets.stream().anyMatch(target -> target.name().equals(requestedTarget))) return true;
                }
                return false;
            }
        }
    }

    private void refreshReplayStatus(Connection connection, String id) throws SQLException {
        boolean requested = requested(connection, id, Set.of(WorkTarget.ORDER, WorkTarget.FULFILLMENT,
            WorkTarget.NOTIFY, WorkTarget.SERVICE_BUS, WorkTarget.STORAGE_QUEUE));
        try (var update = connection.prepareStatement("UPDATE contoso.async_workflow SET replay_requested=? WHERE workflow_id=?")) {
            update.setBoolean(1, requested); uuid(update, 2, id); update.executeUpdate();
        }
    }

    @Override public List<Pending> claimOutbox(int maximum, OperationContext context) {
        if (maximum < 1 || maximum > 32) invalid();
        return tx(context, connection -> {
            var pending = new ArrayList<Pending>();
            try (var query = connection.prepareStatement(
                "SELECT message_id,destination,draft_json,publish_attempt FROM contoso.async_outbox WHERE owner=CURRENT_USER AND state<>'SENT' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY created_at,message_id LIMIT ? FOR UPDATE SKIP LOCKED")) {
                query.setInt(1, maximum);
                try (var rows = query.executeQuery()) {
                    while (rows.next()) {
                        String token = InvocationId.generate().value();
                        int attempt = rows.getInt(4) + 1;
                        try (var update = connection.prepareStatement(
                            "UPDATE contoso.async_outbox SET state='PUBLISHING',lease_token=?,lease_until=?,publish_attempt=? WHERE message_id=?")) {
                            uuid(update, 1, token); timestamp(update, 2, Instant.now().plus(LEASE));
                            update.setInt(3, attempt); uuid(update, 4, rows.getString(1)); update.executeUpdate();
                        }
                        pending.add(new Pending(codec.decode(rows.getString(3)), Destination.valueOf(rows.getString(2)), token, attempt));
                    }
                }
            }
            return List.copyOf(pending);
        });
    }

    @Override public void publicationRecorded(Pending pending, Envelope envelope, OperationContext context) {
        tx(context, connection -> {
            outboxLease(connection, pending);
            try (var query = connection.prepareStatement(
                "SELECT publication_id FROM contoso.async_publication WHERE message_id=? AND destination=? AND envelope_hash=?")) {
                uuid(query, 1, envelope.messageId()); query.setString(2, pending.destination().name());
                query.setString(3, codec.fingerprint(envelope));
                try (var rows = query.executeQuery()) { if (rows.next()) return null; }
            }
            try (var insert = connection.prepareStatement(
                "INSERT INTO contoso.async_publication(publication_id,message_id,destination,envelope_hash,envelope_json) VALUES (?,?,?,?,?)")) {
                uuid(insert, 1, InvocationId.generate().value()); uuid(insert, 2, envelope.messageId());
                insert.setString(3, pending.destination().name()); insert.setString(4, codec.fingerprint(envelope));
                insert.setString(5, codec.json(envelope)); insert.executeUpdate();
            }
            return null;
        });
    }

    @Override public void published(Pending pending, Envelope envelope, OperationContext context) {
        tx(context, connection -> {
            outboxLease(connection, pending);
            try (var update = connection.prepareStatement(
                "UPDATE contoso.async_outbox SET state='SENT',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE message_id=? AND lease_token=?")) {
                uuid(update, 1, envelope.messageId()); uuid(update, 2, pending.leaseToken());
                if (update.executeUpdate() != 1) leaseLost();
            }
            return null;
        });
    }

    @Override public void publicationFailed(Pending pending, String safeCode, OperationContext context) {
        if (!safeCode.matches("[A-Z][A-Z0-9_]{0,47}")) invalid();
        tx(context, connection -> {
            try (var update = connection.prepareStatement(
                "UPDATE contoso.async_outbox SET state='PENDING',lease_token=NULL,lease_until=NULL,last_error=? WHERE message_id=? AND lease_token=? AND owner=CURRENT_USER")) {
                update.setString(1, safeCode); uuid(update, 2, pending.draft().messageId());
                uuid(update, 3, pending.leaseToken()); update.executeUpdate();
            }
            return null;
        });
    }

    private void outboxLease(Connection connection, Pending pending) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT lease_token,lease_until FROM contoso.async_outbox WHERE message_id=? AND owner=CURRENT_USER FOR UPDATE")) {
            uuid(query, 1, pending.draft().messageId());
            try (var rows = query.executeQuery()) {
                if (!rows.next() || !pending.leaseToken().equals(rows.getString(1)) ||
                    instant(rows, 2).isBefore(Instant.now())) leaseLost();
            }
        }
    }

    @Override public boolean trusted(Envelope envelope, Destination destination, Set<String> publishers, OperationContext context) {
        if (publishers == null || publishers.isEmpty() || publishers.size() > 4 ||
            publishers.stream().anyMatch(value -> !value.matches("[A-Za-z][A-Za-z0-9_-]{0,62}"))) invalid();
        if (destination == Destination.SERVICE_BUS_RESULT && envelope.kind() != Envelope.Kind.RESULT ||
            destination == Destination.EVENT_HUBS && envelope.kind() != Envelope.Kind.BATCH ||
            destination != Destination.SERVICE_BUS_RESULT && destination != Destination.EVENT_HUBS && envelope.kind() != Envelope.Kind.ORDER) return false;
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1, connection -> {
            try (var query = connection.prepareStatement(
                "SELECT publisher,envelope_json FROM contoso.async_publication WHERE message_id=? AND destination=? AND envelope_hash=?")) {
                uuid(query, 1, envelope.messageId()); query.setString(2, destination.name());
                query.setString(3, codec.fingerprint(envelope));
                try (var rows = query.executeQuery()) {
                    if (!rows.next() || !publishers.contains(rows.getString(1)) || !codec.json(envelope).equals(rows.getString(2))) return false;
                    if (envelope.replayOf() == null) return true;
                    String publisher = rows.getString(1);
                    try (var replay = connection.prepareStatement(
                        "SELECT owner FROM contoso.async_replay WHERE original_message_id=? AND new_message_id=? AND workflow_id=?")) {
                        uuid(replay, 1, envelope.replayOf()); uuid(replay, 2, envelope.messageId()); uuid(replay, 3, envelope.workflowId());
                        try (var original = replay.executeQuery()) { return original.next() && publisher.equals(original.getString(1)); }
                    }
                }
            }
        });
    }

    @Override public Attempt begin(Envelope envelope, Branch branch, int deliveryCount,
                                    Map<String, String> processContext, OperationContext context) {
        if (deliveryCount < 1 || deliveryCount > 1_000_000_000) invalid();
        return tx(context, connection -> begin(connection, envelope, branch, deliveryCount, processContext));
    }

    private Attempt begin(Connection connection, Envelope envelope, Branch branch, int deliveryCount,
                          Map<String, String> processContext) throws SQLException {
        var workflow = workflow(connection, envelope, branch);
        int count = 0;
        boolean completed = false;
        Instant expires = Instant.EPOCH;
        try (var query = connection.prepareStatement(
            "SELECT attempt_count,completed,lease_until FROM contoso.async_inbox WHERE message_id=? AND branch=? FOR UPDATE")) {
            uuid(query, 1, envelope.messageId()); query.setString(2, branch.name());
            try (var rows = query.executeQuery()) {
                if (rows.next()) {
                    count = rows.getInt(1); completed = rows.getBoolean(2);
                    if (rows.getObject(3) != null) expires = instant(rows, 3);
                } else {
                    try (var insert = connection.prepareStatement(
                        "INSERT INTO contoso.async_inbox(message_id,branch) VALUES (?,?)")) {
                        uuid(insert, 1, envelope.messageId()); insert.setString(2, branch.name()); insert.executeUpdate();
                    }
                }
            }
        }
        Disposition disposition = completed ? Disposition.DUPLICATE :
            workflow.paused ? Disposition.PAUSED : expires.isAfter(Instant.now()) ? Disposition.BUSY : Disposition.EXECUTE;
        String token = disposition == Disposition.EXECUTE ? InvocationId.generate().value() : null;
        count++;
        try (var update = connection.prepareStatement(
            "UPDATE contoso.async_inbox SET attempt_count=?" +
            (token == null ? "" : ",lease_token=?,lease_until=?") + " WHERE message_id=? AND branch=?")) {
            int index = 1;
            update.setInt(index++, count);
            if (token != null) { uuid(update, index++, token); timestamp(update, index++, Instant.now().plus(LEASE)); }
            uuid(update, index++, envelope.messageId()); update.setString(index, branch.name()); update.executeUpdate();
        }
        String attemptId = InvocationId.generate().value();
        try (var insert = connection.prepareStatement(
            "INSERT INTO contoso.async_attempt(attempt_id,workflow_id,message_id,branch,attempt_count,delivery_count,process_traceparent,process_tracestate,outcome) VALUES (?,?,?,?,?,?,?,?,?)")) {
            uuid(insert, 1, attemptId); uuid(insert, 2, envelope.workflowId()); uuid(insert, 3, envelope.messageId());
            insert.setString(4, branch.name()); insert.setInt(5, count); insert.setInt(6, deliveryCount);
            insert.setString(7, processContext.get("traceparent")); insert.setString(8, processContext.get("tracestate"));
            insert.setString(9, disposition.name()); insert.executeUpdate();
        }
        return new Attempt(attemptId, token, count, workflow.failureBudget, disposition);
    }

    private record Workflow(boolean paused, int failureBudget) {}
    private Workflow workflow(Connection connection, Envelope envelope, Branch branch) throws SQLException {
        Workflow base = workflow(connection, envelope);
        List<WorkTarget> targets = switch (branch) {
            case ORDER -> List.of(WorkTarget.SERVICE_BUS, WorkTarget.FULFILLMENT, WorkTarget.ORDER);
            case FULFILLMENT -> List.of(WorkTarget.SERVICE_BUS, WorkTarget.FULFILLMENT);
            case NOTIFY -> List.of(WorkTarget.SERVICE_BUS, WorkTarget.NOTIFY);
            case AGGREGATOR -> List.of(WorkTarget.SERVICE_BUS, WorkTarget.AGGREGATOR);
            case BATCH -> List.of(WorkTarget.AGGREGATOR, WorkTarget.EVENT_HUBS);
            case EVENT_GRID -> List.of(WorkTarget.FULFILLMENT, WorkTarget.EVENT_GRID);
            case STORAGE_QUEUE -> List.of(WorkTarget.FULFILLMENT, WorkTarget.STORAGE_QUEUE);
        };
        boolean paused = base.paused();
        int budget = base.failureBudget();
        for (WorkTarget target : targets) {
            try (var query = connection.prepareStatement("SELECT paused,failure_budget FROM contoso.async_fault WHERE workflow_id=? AND target=?")) {
                uuid(query, 1, envelope.workflowId()); query.setString(2, target.name());
                try (var rows = query.executeQuery()) {
                    if (rows.next()) {
                        paused |= rows.getBoolean(1);
                        if (rows.getObject(2) != null) budget = rows.getInt(2);
                    }
                }
            }
        }
        return new Workflow(paused, budget);
    }
    private Workflow workflow(Connection connection, Envelope envelope) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT invocation_id,paused,failure_budget FROM contoso.async_workflow WHERE workflow_id=? FOR UPDATE")) {
            uuid(query, 1, envelope.workflowId());
            try (var rows = query.executeQuery()) {
                if (!rows.next() || !envelope.businessInvocationId().equals(rows.getString(1))) conflict();
                return new Workflow(rows.getBoolean(2), rows.getInt(3));
            }
        }
    }

    @Override public void complete(Envelope envelope, Branch branch, Attempt attempt,
                                    Map<String, String> processContext, OperationContext context) {
        tx(context, connection -> {
            workflow(connection, envelope);
            inboxLease(connection, envelope.messageId(), branch, attempt);
            if (envelope.kind() == Envelope.Kind.RESULT) resultReceipt(connection, envelope, branch);
            boolean fresh = !hasEffect(connection, effectKey(envelope, branch), branch);
            if (fresh && envelope.kind() != Envelope.Kind.RESULT) {
                effect(connection, envelope, branch, processContext);
                if (branch == Branch.FULFILLMENT || branch == Branch.NOTIFY) {
                    var payload = envelope.payload();
                    var result = new Envelope(1, processContext.get("traceparent"), processContext.get("tracestate"),
                        envelope.businessInvocationId(), InvocationId.generate().value(), envelope.messageId(),
                        envelope.workflowId(), Envelope.Kind.RESULT, null,
                        new WorkPayload(payload.orderId(), payload.sku(), payload.quantity(), payload.scenario(), branch));
                    outbox(connection, result, Destination.SERVICE_BUS_RESULT);
                    try (var insert = connection.prepareStatement(
                        "INSERT INTO contoso.async_contributor(workflow_id,branch,message_id,result_message_id,process_traceparent,process_tracestate) VALUES (?,?,?,?,?,?)")) {
                        uuid(insert, 1, envelope.workflowId()); insert.setString(2, branch.name());
                        uuid(insert, 3, envelope.messageId()); uuid(insert, 4, result.messageId());
                        insert.setString(5, processContext.get("traceparent")); insert.setString(6, processContext.get("tracestate"));
                        insert.executeUpdate();
                    }

                    state(connection, envelope.workflowId(), "WAITING_RESULTS");
                } else if (branch == Branch.BATCH) {
                    try (var query = connection.prepareStatement(
                        "SELECT COUNT(*) FROM contoso.async_effect WHERE workflow_id=? AND branch='BATCH'")) {
                        uuid(query, 1, envelope.workflowId());
                        try (var rows = query.executeQuery()) { rows.next(); state(connection, envelope.workflowId(), rows.getInt(1) >= 2 ? "COMPLETED" : "PROCESSING"); }
                    }
                } else state(connection, envelope.workflowId(), "COMPLETED");
            }
            finish(connection, envelope.messageId(), branch, attempt, "SUCCESS", true);
            return null;
        });
    }

    private void resultReceipt(Connection connection, Envelope envelope, Branch branch) throws SQLException {
        if (branch != Branch.AGGREGATOR) invalid();
        String publisher;
        try (var query = connection.prepareStatement(
            "SELECT c.publisher,p.envelope_json FROM contoso.async_contributor c JOIN contoso.async_publication p ON p.message_id=c.result_message_id AND p.publisher=c.publisher WHERE c.workflow_id=? AND c.branch=? AND c.result_message_id=? AND c.message_id=? AND p.destination='SERVICE_BUS_RESULT' AND p.envelope_hash=?")) {
            uuid(query, 1, envelope.workflowId()); query.setString(2, envelope.payload().contributor().name());
            uuid(query, 3, envelope.messageId()); uuid(query, 4, envelope.causationId());
            query.setString(5, codec.fingerprint(envelope));
            try (var rows = query.executeQuery()) {
                if (!rows.next() || !codec.json(envelope).equals(rows.getString(2))) {
                    throw new MessagingFailure(MessagingFailure.Code.UNTRUSTED_PUBLICATION);
                }
                publisher = rows.getString(1);
            }
        }
        try (var update = connection.prepareStatement(
            "UPDATE contoso.async_inbox SET source_traceparent=?,source_tracestate=?,source_hash=?,source_publisher=? WHERE message_id=? AND branch=? AND receiver=CURRENT_USER")) {
            update.setString(1, envelope.traceparent()); update.setString(2, envelope.tracestate());
            update.setString(3, codec.fingerprint(envelope)); update.setString(4, publisher);
            uuid(update, 5, envelope.messageId()); update.setString(6, branch.name());
            if (update.executeUpdate() != 1) leaseLost();
        }
    }

    private String effectKey(Envelope envelope, Branch branch) {
        return branch == Branch.BATCH ? envelope.messageId() : envelope.workflowId();
    }

    private boolean hasEffect(Connection connection, String key, Branch branch) throws SQLException {
        try (var query = connection.prepareStatement(
            "SELECT effect_id FROM contoso.async_effect WHERE effect_key=? AND branch=?")) {
            uuid(query, 1, key); query.setString(2, branch.name());
            try (var rows = query.executeQuery()) { return rows.next(); }
        }
    }

    private void effect(Connection connection, Envelope envelope, Branch branch, Map<String, String> processContext) throws SQLException {
        try (var insert = connection.prepareStatement(
            "INSERT INTO contoso.async_effect(effect_id,effect_key,workflow_id,message_id,branch,process_traceparent,process_tracestate) VALUES (?,?,?,?,?,?,?)")) {
            uuid(insert, 1, InvocationId.generate().value()); uuid(insert, 2, effectKey(envelope, branch));
            uuid(insert, 3, envelope.workflowId()); uuid(insert, 4, envelope.messageId()); insert.setString(5, branch.name());
            insert.setString(6, processContext.get("traceparent")); insert.setString(7, processContext.get("tracestate"));
            insert.executeUpdate();
        }
    }

    @Override public void failed(Envelope envelope, Branch branch, Attempt attempt, boolean deadLetter, OperationContext context) {
        tx(context, connection -> {
            workflow(connection, envelope); inboxLease(connection, envelope.messageId(), branch, attempt);
            finish(connection, envelope.messageId(), branch, attempt, deadLetter ? "DEAD_LETTERED" : "RETRY", false);
            state(connection, envelope.workflowId(), deadLetter ? "DEAD_LETTERED" : "RETRYING");
            return null;
        });
    }

    private void inboxLease(Connection connection, String messageId, Branch branch, Attempt attempt) throws SQLException {
        if (attempt.disposition() != Disposition.EXECUTE || attempt.leaseToken() == null) leaseLost();
        try (var query = connection.prepareStatement(
            "SELECT lease_token,lease_until FROM contoso.async_inbox WHERE message_id=? AND branch=? FOR UPDATE")) {
            uuid(query, 1, messageId); query.setString(2, branch.name());
            try (var rows = query.executeQuery()) {
                if (!rows.next() || !attempt.leaseToken().equals(rows.getString(1)) ||
                    instant(rows, 2).isBefore(Instant.now())) leaseLost();
            }
        }
    }

    private void finish(Connection connection, String messageId, Branch branch, Attempt attempt, String outcome, boolean completed) throws SQLException {
        try (var update = connection.prepareStatement(
            "UPDATE contoso.async_inbox SET completed=?,lease_token=NULL,lease_until=NULL WHERE message_id=? AND branch=? AND lease_token=?")) {
            update.setBoolean(1, completed); uuid(update, 2, messageId); update.setString(3, branch.name());
            uuid(update, 4, attempt.leaseToken()); if (update.executeUpdate() != 1) leaseLost();
        }
        try (var update = connection.prepareStatement(
            "UPDATE contoso.async_attempt SET outcome=? WHERE attempt_id=?")) {
            update.setString(1, outcome); uuid(update, 2, attempt.id()); update.executeUpdate();
        }
    }

    private void state(Connection connection, String workflowId, String state) throws SQLException {
        try (var update = connection.prepareStatement(
            "UPDATE contoso.async_workflow SET state=?,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?")) {
            update.setString(1, state); uuid(update, 2, workflowId); update.executeUpdate();
        }
    }

    @Override public List<Contributor> contributors(String workflowId, Map<Branch, String> publishers, OperationContext context) {
        InvocationId.parse(workflowId);
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1, connection -> {
            var contributors = new ArrayList<Contributor>();
            try (var query = connection.prepareStatement(
                "SELECT c.branch,c.message_id,c.result_message_id,c.process_traceparent,c.process_tracestate,c.publisher,i.source_traceparent,i.source_tracestate FROM contoso.async_contributor c JOIN contoso.async_inbox i ON i.message_id=c.result_message_id AND i.branch='AGGREGATOR' AND i.completed=TRUE AND i.receiver=CURRENT_USER AND i.source_publisher=c.publisher JOIN contoso.async_publication p ON p.message_id=c.result_message_id AND p.envelope_hash=i.source_hash AND p.publisher=c.publisher AND p.destination='SERVICE_BUS_RESULT' WHERE c.workflow_id=? ORDER BY c.branch")) {
                uuid(query, 1, workflowId);
                try (var rows = query.executeQuery()) {
                    while (rows.next()) {
                        Branch branch = Branch.valueOf(rows.getString(1));
                        var parsed = TraceContexts.extract(rows.getString(4), rows.getString(5));
                        var sent = TraceContexts.extract(rows.getString(7), rows.getString(8));
                        if (!parsed.spanContext().isValid() || !sent.spanContext().isValid() || !rows.getString(6).equals(publishers.get(branch))) {
                            throw new MessagingFailure(MessagingFailure.Code.UNTRUSTED_PUBLICATION);
                        }
                        contributors.add(new Contributor(branch, rows.getString(2), rows.getString(3), parsed.spanContext(), rows.getString(6), sent.spanContext()));
                    }
                }
            }
            if (contributors.size() > 2) throw new MessagingFailure(MessagingFailure.Code.LINK_LIMIT);
            return List.copyOf(contributors);
        });
    }

    private Envelope aggregateEnvelope(Envelope result) {
        return new Envelope(1, null, null, result.businessInvocationId(), result.workflowId(), null,
            result.workflowId(), Envelope.Kind.ORDER, null, new WorkPayload(result.payload().orderId(),
            result.payload().sku(), result.payload().quantity(), result.payload().scenario(), null));
    }

    @Override public List<Envelope> readyAggregates(int maximum, OperationContext context) {
        if (maximum < 1 || maximum > 32) invalid();
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1, connection -> {
            var result = new ArrayList<Envelope>();
            try (var query = connection.prepareStatement(
                "SELECT o.draft_json FROM contoso.async_contributor c JOIN contoso.async_outbox o ON o.message_id=c.result_message_id JOIN contoso.async_workflow w ON w.workflow_id=c.workflow_id WHERE c.branch='FULFILLMENT' AND w.state='WAITING_RESULTS' AND (SELECT COUNT(*) FROM contoso.async_contributor n JOIN contoso.async_inbox i ON i.message_id=n.result_message_id AND i.branch='AGGREGATOR' AND i.completed=TRUE AND i.receiver=CURRENT_USER AND i.source_publisher=n.publisher WHERE n.workflow_id=c.workflow_id)=2 ORDER BY w.created_at LIMIT ?")) {
                query.setInt(1, maximum);
                try (var rows = query.executeQuery()) { while (rows.next()) result.add(codec.decode(rows.getString(1))); }
            }
            return List.copyOf(result);
        });
    }

    @Override public Optional<Attempt> claimAggregate(Envelope result, OperationContext context) {
        return tx(context, connection -> {
            workflow(connection, result);
            if (hasEffect(connection, result.workflowId(), Branch.AGGREGATOR)) return Optional.empty();
            var attempt = begin(connection, aggregateEnvelope(result), Branch.AGGREGATOR, 1, Map.of());
            return attempt.disposition() == Disposition.EXECUTE ? Optional.of(attempt) : Optional.empty();
        });
    }

    @Override public void aggregate(Envelope result, Attempt attempt, Map<String, String> processContext, OperationContext context) {
        Envelope aggregate = aggregateEnvelope(result);
        tx(context, connection -> {
            workflow(connection, aggregate); inboxLease(connection, aggregate.messageId(), Branch.AGGREGATOR, attempt);
            if (!hasEffect(connection, result.workflowId(), Branch.AGGREGATOR)) effect(connection, aggregate, Branch.AGGREGATOR, processContext);
            try (var update = connection.prepareStatement(
                "UPDATE contoso.async_attempt SET process_traceparent=?,process_tracestate=? WHERE attempt_id=?")) {
                update.setString(1, processContext.get("traceparent")); update.setString(2, processContext.get("tracestate"));
                uuid(update, 3, attempt.id()); update.executeUpdate();
            }
            finish(connection, aggregate.messageId(), Branch.AGGREGATOR, attempt, "SUCCESS", true);
            state(connection, result.workflowId(), "COMPLETED");
            return null;
        });
    }

    @Override public boolean replayRequested(String workflowId, OperationContext context) {
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1, connection -> {
            return requested(connection, workflowId, Set.of(WorkTarget.ORDER, WorkTarget.FULFILLMENT,
                WorkTarget.NOTIFY, WorkTarget.SERVICE_BUS, WorkTarget.STORAGE_QUEUE));
        });
    }

    @Override public boolean replayRequested(String workflowId, Source source, OperationContext context) {
        if (source == null || !source.deadLetter()) invalid();
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1,
            connection -> requested(connection, workflowId, source.replayTargets()));
    }

    @Override public boolean replayAppliesTo(Envelope envelope, Source delivery, OperationContext context) {
        if (envelope.replayOf() == null) return true;
        return PgOperations.execute(connections, PgOperation.SELECT, context, 1, connection -> {
            try (var query = connection.prepareStatement(
                "SELECT source FROM contoso.async_replay WHERE original_message_id=? AND new_message_id=? AND workflow_id=?")) {
                uuid(query, 1, envelope.replayOf()); uuid(query, 2, envelope.messageId()); uuid(query, 3, envelope.workflowId());
                try (var rows = query.executeQuery()) {
                    return rows.next() && Source.valueOf(rows.getString(1)).replayDelivery() == delivery;
                }
            }
        });
    }

    @Override public String prepareReplay(Envelope original, Destination destination, OperationContext context) {
        Source source = switch (destination) {
            case SERVICE_BUS_ORDER -> Source.ORDERS_DLQ;
            case STORAGE_QUEUE -> Source.LEGACY_POISON;
            default -> throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        };
        return prepareReplay(original, source, context);
    }

    @Override public String prepareReplay(Envelope original, Source source, OperationContext context) {
        if (source == null || !source.deadLetter()) invalid();
        return tx(context, connection -> {
            workflow(connection, original);
            if (!requested(connection, original.workflowId(), source.replayTargets())) invalid();
            try (var query = connection.prepareStatement("SELECT new_message_id FROM contoso.async_replay WHERE original_message_id=? AND source=?")) {
                uuid(query, 1, original.messageId()); query.setString(2, source.name());
                try (var rows = query.executeQuery()) { if (rows.next()) return rows.getString(1); }
            }
            String id = InvocationId.generate().value();
            outbox(connection, original.replay(id), source.destination());
            try (var insert = connection.prepareStatement(
                "INSERT INTO contoso.async_replay(original_message_id,source,workflow_id,new_message_id) VALUES (?,?,?,?)")) {
                uuid(insert, 1, original.messageId()); insert.setString(2, source.name());
                uuid(insert, 3, original.workflowId()); uuid(insert, 4, id); insert.executeUpdate();
            }
            state(connection, original.workflowId(), "REPLAY_QUEUED");
            return id;
        });
    }

    @Override public Optional<PartitionLease> claimPartition(String partitionId, OperationContext context) {
        partition(partitionId);
        return tx(context, connection -> {
            long offset = -1, sequence = -1;
            int receiveAttempt = 1;
            try (var query = connection.prepareStatement(
                "SELECT offset_value,sequence_number,lease_until,receive_attempt FROM contoso.async_checkpoint WHERE partition_id=? FOR UPDATE")) {
                query.setString(1, partitionId);
                try (var rows = query.executeQuery()) {
                    if (rows.next()) {
                        if (rows.getObject(3) != null && instant(rows, 3).isAfter(Instant.now())) return Optional.empty();
                        offset = rows.getLong(1); sequence = rows.getLong(2);
                        receiveAttempt = rows.getInt(4) + 1;
                    } else {
                        try (var insert = connection.prepareStatement("INSERT INTO contoso.async_checkpoint(partition_id) VALUES (?)")) {
                            insert.setString(1, partitionId); insert.executeUpdate();
                        }
                    }
                }
            }
            String token = InvocationId.generate().value();
            try (var update = connection.prepareStatement("UPDATE contoso.async_checkpoint SET lease_token=?,lease_until=?,receive_attempt=? WHERE partition_id=?")) {
                uuid(update, 1, token); timestamp(update, 2, Instant.now().plus(LEASE));
                update.setInt(3, receiveAttempt); update.setString(4, partitionId); update.executeUpdate();
            }
            return Optional.of(new PartitionLease(partitionId, token, offset, sequence, receiveAttempt));
        });
    }

    @Override public void checkpoint(PartitionLease lease, long offset, long sequenceNumber, OperationContext context) {
        if (offset < lease.offset() || sequenceNumber < lease.sequenceNumber()) invalid();
        tx(context, connection -> {
            try (var update = connection.prepareStatement(
                "UPDATE contoso.async_checkpoint SET offset_value=?,sequence_number=?,lease_token=NULL,lease_until=NULL WHERE partition_id=? AND lease_token=? AND lease_until>CURRENT_TIMESTAMP AND offset_value<=? AND sequence_number<=?")) {
                update.setLong(1, offset); update.setLong(2, sequenceNumber); update.setString(3, lease.partitionId());
                uuid(update, 4, lease.token()); update.setLong(5, offset); update.setLong(6, sequenceNumber);
                if (update.executeUpdate() != 1) leaseLost();
            }
            return null;
        });
    }

    @Override public void releasePartition(PartitionLease lease, OperationContext context) {
        tx(context, connection -> {
            try (var update = connection.prepareStatement("UPDATE contoso.async_checkpoint SET lease_token=NULL,lease_until=NULL WHERE partition_id=? AND lease_token=?")) {
                update.setString(1, lease.partitionId()); uuid(update, 2, lease.token()); update.executeUpdate();
            }

            return null;
        });
    }

    @Override public void quarantine(String partitionId, long offset, long sequenceNumber, String safeCode, OperationContext context) {
        partition(partitionId);
        if (offset < 0 || sequenceNumber < 0 || safeCode == null || !safeCode.matches("[A-Z][A-Z0-9_]{0,47}")) invalid();
        tx(context, connection -> {
            try (var query = connection.prepareStatement("SELECT reason_code FROM contoso.async_quarantine WHERE partition_id=? AND offset_value=?")) {
                query.setString(1, partitionId); query.setLong(2, offset);
                try (var rows = query.executeQuery()) { if (rows.next()) return null; }
            }
            try (var insert = connection.prepareStatement(
                "INSERT INTO contoso.async_quarantine(partition_id,offset_value,sequence_number,reason_code) VALUES (?,?,?,?)")) {
                insert.setString(1, partitionId); insert.setLong(2, offset); insert.setLong(3, sequenceNumber);
                insert.setString(4, safeCode); insert.executeUpdate();
            }
            return null;
        });
    }

    private static void partition(String value) {
        if (value == null || !value.matches("0|[1-9][0-9]{0,8}")) invalid();
    }
    private static void uuid(PreparedStatement statement, int index, String value) throws SQLException {
        statement.setObject(index, value == null ? null : UUID.fromString(InvocationId.parse(value).value()));
    }
    private static void timestamp(PreparedStatement statement, int index, Instant value) throws SQLException {
        statement.setObject(index, OffsetDateTime.ofInstant(value, ZoneOffset.UTC));
    }
    private static Instant instant(ResultSet rows, int index) throws SQLException {
        return rows.getObject(index, OffsetDateTime.class).toInstant();
    }
    private static void invalid() { throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE); }
    private static void conflict() { throw new MessagingFailure(MessagingFailure.Code.WORKFLOW_CONFLICT); }
    private static void leaseLost() { throw new MessagingFailure(MessagingFailure.Code.LEASE_LOST); }
}
