package com.contoso.demo.operator;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.inventory.data.InventorySchemaHooks;
import com.contoso.inventory.data.OwnedInventoryCache;
import com.contoso.inventory.data.RestorableInventoryCache;
import com.fasterxml.jackson.databind.JsonNode;
import io.opentelemetry.context.Context;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

final class OperatorRunStore {
    static final String SKU = "CONTOSO-001";
    record CacheState(Integer available, Long revision, String expiresAt) {
        static CacheState of(RestorableInventoryCache.Baseline baseline) {
            return new CacheState(baseline.value().map(OwnedInventoryCache.Value::available).orElse(null),
                baseline.value().map(OwnedInventoryCache.Value::revision).orElse(null),
                baseline.expiresAt() == null ? null : baseline.expiresAt().toString());
        }
        RestorableInventoryCache.Baseline baseline() {
            return available == null ? RestorableInventoryCache.Baseline.absent() :
                new RestorableInventoryCache.Baseline(Optional.of(new OwnedInventoryCache.Value(available, revision)),
                    expiresAt == null ? null : Instant.parse(expiresAt));
        }
    }
    record Baseline(int available, long revision, String itemNameHash, String unownedRowsHash,
                    Map<String, CacheState> caches) {}
    record RestoreCheckpoint(CacheState cache, int available, long revision) {}
    record Run(UUID runId, int demoId, String phase, String fault, String startsAt, String expiresAt, Baseline baseline) {}
    private final PgConnectionFactory database;
    private final RestorableInventoryCache cache;
    private final String expectedResourceId;

    OperatorRunStore(PgConnectionFactory database, RestorableInventoryCache cache, String expectedResourceId) {
        this.database = database; this.cache = cache; this.expectedResourceId = expectedResourceId;
    }

    void migrate() {
        try (var input = OperatorRunStore.class.getResourceAsStream("/db/operator.sql")) {
            if (input == null) throw new IllegalStateException("OPERATOR_MIGRATION_MISSING");
            String sql = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            tx(connection -> {
                for (String command : sql.split(";")) if (!command.isBlank()) {
                    try (var statement = connection.createStatement()) { statement.execute(command); }
                }
                return null;
            });
        } catch (java.io.IOException failure) { throw new IllegalStateException("OPERATOR_MIGRATION_UNREADABLE"); }
    }

    Run prepare(int demoId, Instant expiresAt) {
        if (demoId < 1 || demoId > 15 || !expiresAt.isAfter(Instant.now()) ||
            expiresAt.isAfter(Instant.now().plusSeconds(7200))) throw OperatorFailure.invalid();
        UUID id = UUID.randomUUID();
        return tx(connection -> {
            var snapshots = new LinkedHashMap<String, CacheState>();
            try (var insert = connection.prepareStatement(
                    "INSERT INTO contoso_operator.run(run_id,demo_id,started_at,expires_at,phase,baseline_json) VALUES (?,?,?,?,?,?)")) {
                insert.setObject(1, id); insert.setInt(2, demoId); insert.setObject(3, OffsetDateTime.now(ZoneOffset.UTC));
                insert.setObject(4, expiresAt.atOffset(ZoneOffset.UTC)); insert.setString(5, "PREPARING");
                insert.setString(6, "{}"); insert.executeUpdate();
            }
            try (var lease = connection.prepareStatement("INSERT INTO contoso_operator.lease(singleton,run_id) VALUES (1,?)")) {
                lease.setObject(1, id); lease.executeUpdate();
            }
            verifyDataset(connection);
            try (var query = connection.prepareStatement("SELECT reservation_id FROM contoso.inventory_reservation WHERE sku=?")) {
                query.setString(1, SKU);
                try (var rows = query.executeQuery()) { if (rows.next()) throw OperatorFailure.conflict(); }
            }
            int available; long revision; String nameHash;
            try (var query = connection.prepareStatement(
                    "SELECT available,revision,display_name,synthetic FROM contoso.inventory_item WHERE sku=? FOR UPDATE")) {
                query.setString(1, SKU);
                try (var rows = query.executeQuery()) {
                    if (!rows.next() || !rows.getBoolean(4)) throw OperatorFailure.conflict();
                    available = rows.getInt(1); revision = rows.getLong(2); nameHash = OperatorJson.hash(rows.getString(3));
                }
            }
            for (String sku : InventorySchemaHooks.SYNTHETIC_SKUS) {
                snapshots.put(sku, CacheState.of(cache.capture(sku, context(id))));
            }
            var baseline = new Baseline(available, revision, nameHash, unownedHash(connection, id), snapshots);
            try (var update = connection.prepareStatement("UPDATE contoso_operator.run SET baseline_json=?,phase='ACTIVE' WHERE run_id=?")) {
                update.setString(1, OperatorJson.write(baseline)); update.setObject(2, id); update.executeUpdate();
            }
            // The durable checkpoint commits before the first cache or inventory mutation.
            return new Run(id, demoId, "ACTIVE", "NONE", Instant.now().toString(), expiresAt.toString(), baseline);
        });
    }

    void seed(UUID id) {
        Run run = active(id);
        tx(connection -> {
            lock(connection, id);
            try (var update = connection.prepareStatement(
                    "UPDATE contoso.inventory_item SET available=20,revision=1 WHERE sku=? AND synthetic=TRUE AND available=? AND revision=?")) {
                update.setString(1, SKU); update.setInt(2, run.baseline.available); update.setLong(3, run.baseline.revision);
                if (update.executeUpdate() != 1) throw OperatorFailure.conflict();
            }
            return null;
        });
        cache.invalidate(SKU, context(id));
        event(id, "PREPARED", Map.of("baselineSha256", OperatorJson.hash(run.baseline)));
    }

    Run active(UUID id) {
        Run run = get(id);
        if (!run.phase.equals("ACTIVE") || !Instant.now().isBefore(Instant.parse(run.expiresAt))) {
            throw new OperatorFailure(409, "OPERATOR_RUN_INACTIVE");
        }
        return run;
    }

    Run get(UUID id) { return tx(connection -> read(connection, id)); }

    void checkReady() {
        tx(connection -> {
            try (var query = connection.prepareStatement("SELECT run_id FROM contoso_operator.lease WHERE 1=0");
                 var rows = query.executeQuery()) { return rows.getMetaData().getColumnCount(); }
        });
    }

    UUID beginGateway(UUID id) {
        UUID operation = UUID.randomUUID();
        tx(connection -> {
            lock(connection, id);
            Run run = read(connection, id);
            if (!run.phase.equals("ACTIVE") || !Instant.now().isBefore(Instant.parse(run.expiresAt))) {
                throw new OperatorFailure(409, "OPERATOR_RUN_INACTIVE");
            }
            try (var count = connection.prepareStatement(
                    "SELECT COUNT(*) FROM contoso_operator.event WHERE run_id=? AND kind='GATEWAY_BEGIN'")) {
                count.setObject(1, id);
                try (var row = count.executeQuery()) {
                    row.next();
                    if (row.getInt(1) >= 1500) throw new OperatorFailure(429, "OPERATOR_GATEWAY_BUDGET_EXHAUSTED");
                }
            }
            operationEvent(connection, id, operation, "GATEWAY_BEGIN");
            return null;
        });
        return operation;
    }

    void finishGateway(UUID id, UUID operation) {
        tx(connection -> { operationEvent(connection, id, operation, "GATEWAY_FINISHED"); return null; });
    }

    <T> T withActiveControlLease(UUID id, java.util.function.Supplier<T> operation) {
        return tx(connection -> {
            lock(connection, id);
            Run run = read(connection, id);
            if (!run.phase.equals("ACTIVE") || !Instant.now().isBefore(Instant.parse(run.expiresAt))) {
                throw new OperatorFailure(409, "OPERATOR_RUN_INACTIVE");
            }
            return operation.get();
        });
    }

    void claimSampling(UUID id, JsonNode baseline) {
        tx(connection -> {
            lock(connection, id);
            Run run = read(connection, id);
            if (!run.phase.equals("ACTIVE") || !Instant.now().isBefore(Instant.parse(run.expiresAt))) {
                throw new OperatorFailure(409, "OPERATOR_RUN_INACTIVE");
            }
            try (var query = connection.prepareStatement(
                    "SELECT COUNT(*) FROM contoso_operator.event WHERE run_id=? AND kind='APIM_BASELINE'")) {
                query.setObject(1, id);
                try (var row = query.executeQuery()) { row.next(); if (row.getInt(1) != 0) throw OperatorFailure.conflict(); }
            }
            appendEvent(connection, id, "APIM_BASELINE", Map.of("sampling", baseline), null);
            appendEvent(connection, id, "APIM_ACTIVATION_INTENT", Map.of("configurationOnly", true), null);
            return null;
        });
    }

    UUID allocate(UUID id, String type) {
        active(id);
        if (!List.of("ORDER", "RUN").contains(type)) throw OperatorFailure.invalid();
        UUID workflow = UUID.randomUUID();
        tx(connection -> {
            lock(connection, id);
            try (var count = connection.prepareStatement("SELECT COUNT(*) FROM contoso_operator.work WHERE run_id=?")) {
                count.setObject(1, id);
                try (var rows = count.executeQuery()) { rows.next(); if (rows.getInt(1) >= 64) throw OperatorFailure.conflict(); }
            }
            try (var insert = connection.prepareStatement("INSERT INTO contoso_operator.work(workflow_id,run_id,workflow_type) VALUES (?,?,?)")) {
                insert.setObject(1, workflow); insert.setObject(2, id); insert.setString(3, type); insert.executeUpdate();
            }
            return null;
        });
        return workflow;
    }

    void attach(UUID id, UUID workflow) {
        active(id);
        tx(connection -> {
            lock(connection, id);
            try (var update = connection.prepareStatement(
                    "UPDATE contoso_operator.work SET invocation_id=(SELECT w.invocation_id FROM contoso.async_workflow w " +
                    "JOIN contoso_operator.run r ON r.run_id=? WHERE w.workflow_id=? AND w.created_at>=r.started_at AND w.sku=?) " +
                    "WHERE run_id=? AND workflow_id=?")) {
                update.setObject(1, id); update.setObject(2, workflow); update.setString(3, SKU);
                update.setObject(4, id); update.setObject(5, workflow);
                if (update.executeUpdate() != 1) throw OperatorFailure.conflict();
            }
            return null;
        });
    }

    void requireOwned(UUID id, UUID workflow) {
        tx(connection -> {
            try (var query = connection.prepareStatement("SELECT workflow_id FROM contoso_operator.work WHERE run_id=? AND workflow_id=?")) {
                query.setObject(1, id); query.setObject(2, workflow);
                try (var rows = query.executeQuery()) { if (!rows.next()) throw OperatorFailure.conflict(); }
            }
            return null;
        });
    }

    void fault(UUID id, String fault) {
        Run run = active(id);
        if (!(run.demoId == 5 && List.of("NONE", "INVENTORY_TIMEOUT", "POSTGRES_ERROR").contains(fault) ||
              run.demoId == 12 && List.of("NONE", "DATA_CANARY").contains(fault))) throw OperatorFailure.invalid();
        tx(connection -> {
            lock(connection, id);
            try (var update = connection.prepareStatement("UPDATE contoso_operator.run SET fault=? WHERE run_id=?")) {
                update.setString(1, fault); update.setObject(2, id); update.executeUpdate();
            }
            return null;
        });
    }

    void stop(UUID id) {
        tx(connection -> {
            lock(connection, id);
            try (var update = connection.prepareStatement("UPDATE contoso_operator.run SET phase='DRAINING',fault='NONE' WHERE run_id=?")) {
                update.setObject(1, id); update.executeUpdate();
            }
            return null;
        });
    }

    List<Map<String, Object>> rows(UUID id, String kind) {
        get(id);
        String query = switch (kind) {
            case "workflows" -> "SELECT w.workflow_id,w.invocation_id,w.state,w.scenario FROM contoso.async_workflow w " +
                "JOIN contoso_operator.work o ON o.workflow_id=w.workflow_id WHERE o.run_id=? ORDER BY w.workflow_id";
            case "attempts" -> "SELECT a.message_id,a.branch,a.attempt_count,a.delivery_count,a.process_traceparent,a.outcome " +
                "FROM contoso.async_attempt a JOIN contoso_operator.work o ON o.workflow_id=a.workflow_id WHERE o.run_id=? ORDER BY a.created_at,a.attempt_id";
            case "publications" -> "SELECT p.message_id,p.destination,p.envelope_json FROM contoso.async_publication p " +
                "JOIN contoso.async_outbox b ON b.message_id=p.message_id JOIN contoso_operator.work o ON o.workflow_id=b.workflow_id " +
                "WHERE o.run_id=? ORDER BY p.created_at,p.publication_id";
            case "contributors" -> "SELECT c.workflow_id,c.branch,c.process_traceparent,c.result_message_id," +
                "i.source_traceparent AS result_traceparent FROM contoso.async_contributor c " +
                "JOIN contoso_operator.work o ON o.workflow_id=c.workflow_id " +
                "JOIN contoso.async_inbox i ON i.message_id=c.result_message_id AND i.branch='AGGREGATOR' AND i.completed=TRUE AND i.source_publisher=c.publisher " +
                "JOIN contoso.async_publication p ON p.message_id=c.result_message_id AND p.envelope_hash=i.source_hash " +
                "AND p.publisher=i.source_publisher AND p.destination='SERVICE_BUS_RESULT' " +
                "WHERE o.run_id=? ORDER BY c.workflow_id,c.branch";
            case "events" -> "SELECT event_id,kind,observed_at,facts_json FROM contoso_operator.event WHERE run_id=? ORDER BY observed_at,event_id";
            default -> throw OperatorFailure.invalid();
        };
        int limit = kind.equals("events") ? 4096 : 2048;
        return tx(connection -> {
            try (var statement = connection.prepareStatement(query)) {
                statement.setObject(1, id); statement.setMaxRows(limit + 1);
                try (var result = statement.executeQuery()) {
                    var values = new ArrayList<Map<String, Object>>();
                    while (result.next()) {
                        if (values.size() == limit) throw new OperatorFailure(413, "OPERATOR_OBSERVATION_LIMIT");
                        var row = new LinkedHashMap<String, Object>();
                        for (int i = 1; i <= result.getMetaData().getColumnCount(); i++) {
                            String name = result.getMetaData().getColumnLabel(i).toLowerCase(java.util.Locale.ROOT);
                            Object value = result.getObject(i);
                            row.put(name, value == null ? null : name.endsWith("_json")
                                ? OperatorJson.read(result.getString(i).getBytes(StandardCharsets.UTF_8)) : value.toString());
                        }
                        values.add(row);
                    }
                    return List.copyOf(values);
                }
            }
        });
    }

    boolean drained(UUID id) {
        return tx(connection -> {
            try (var query = connection.prepareStatement(
                    "SELECT COUNT(*) FROM contoso_operator.event b WHERE b.run_id=? AND b.kind IN ('INVENTORY_SDK','GATEWAY_BEGIN') AND NOT EXISTS " +
                    "(SELECT 1 FROM contoso_operator.event e WHERE e.run_id=b.run_id AND " +
                    "e.kind=CASE WHEN b.kind='INVENTORY_SDK' THEN 'INVENTORY_FINISHED' ELSE 'GATEWAY_FINISHED' END AND e.operation_id=b.operation_id)")) {
                query.setObject(1, id);
                try (var row = query.executeQuery()) { row.next(); if (row.getInt(1) != 0) return false; }
            }
            try (var query = connection.prepareStatement(
                    "SELECT COUNT(*) FROM contoso.async_workflow w JOIN contoso_operator.work o ON o.workflow_id=w.workflow_id " +
                    "WHERE o.run_id=? AND (w.state<>'COMPLETED' OR EXISTS (SELECT 1 FROM contoso.async_outbox b " +
                    "WHERE b.workflow_id=w.workflow_id AND (b.state<>'SENT' OR b.lease_token IS NOT NULL)) OR EXISTS " +
                    "(SELECT 1 FROM contoso.async_inbox i JOIN contoso.async_outbox b ON b.message_id=i.message_id " +
                    "WHERE b.workflow_id=w.workflow_id AND i.lease_token IS NOT NULL))")) {
                query.setObject(1, id);
                try (var result = query.executeQuery()) { result.next(); return result.getInt(1) == 0; }
            }
        });
    }

    Map<String, Object> reset(UUID id) {
        Run run = get(id);
        if (run.phase.equals("RESTORED")) {
            return Map.of("result", "ALREADY_RESTORED", "runId", id.toString(), "certificationStatus", "NOT CERTIFIED");
        }
        stop(id);
        if (!drained(id)) throw new OperatorFailure(409, "OPERATOR_WORK_NOT_DRAINED");
        for (var entry : run.baseline.caches.entrySet()) if (!entry.getKey().equals(SKU) &&
            !cacheMatches(entry.getValue(), CacheState.of(cache.capture(entry.getKey(), context(id))))) throw OperatorFailure.conflict();
        var observedCache = CacheState.of(cache.capture(SKU, context(id)));
        tx(connection -> {
            lock(connection, id);
            verifyDataset(connection);
            if (!run.baseline.unownedRowsHash.equals(unownedHash(connection, id))) throw OperatorFailure.conflict();
            int reserved = 0, revisions = 0;
            try (var query = connection.prepareStatement(
                    "SELECT quantity,state,synthetic,order_id,invocation_id FROM contoso.inventory_reservation WHERE sku=? FOR UPDATE")) {
                query.setString(1, SKU);
                try (var result = query.executeQuery()) {
                    while (result.next()) {
                        UUID order = UUID.fromString(result.getString(4));
                        if (!result.getBoolean(3) || !ownedInvocation(connection, id, order, result.getString(5))) throw OperatorFailure.conflict();
                        if ("RESERVED".equals(result.getString(2))) reserved += result.getInt(1);
                        revisions += "RELEASED".equals(result.getString(2)) ? 2 : 1;
                    }
                }
            }
            RestoreCheckpoint checkpoint = null;
            try (var query = connection.prepareStatement("SELECT restore_json FROM contoso_operator.run WHERE run_id=?")) {
                query.setObject(1, id);
                try (var row = query.executeQuery()) {
                    row.next();
                    if (row.getString(1) != null) {
                        try { checkpoint = OperatorJson.MAPPER.readValue(row.getString(1), RestoreCheckpoint.class); }
                        catch (java.io.IOException failure) { throw OperatorFailure.conflict(); }
                    }
                }
            }
            try (var query = connection.prepareStatement(
                    "SELECT available,revision,display_name,synthetic FROM contoso.inventory_item WHERE sku=? FOR UPDATE")) {
                query.setString(1, SKU);
                try (var result = query.executeQuery()) {
                    if (!result.next() || !result.getBoolean(4) ||
                        !OperatorJson.hash(result.getString(3)).equals(run.baseline.itemNameHash) ||
                        !(result.getInt(1) == 20 - reserved && result.getLong(2) == 1L + revisions ||
                          reserved == 0 && result.getInt(1) == run.baseline.available && result.getLong(2) == run.baseline.revision)) {
                        throw OperatorFailure.conflict();
                    }
                    if (checkpoint == null) {
                        var currentValue = observedCache.baseline().valueAt(Instant.now());
                        if (currentValue.isPresent() && !currentValue.get().equals(new OwnedInventoryCache.Value(result.getInt(1), result.getLong(2))) &&
                            !cacheMatches(run.baseline.caches.get(SKU), observedCache)) throw OperatorFailure.conflict();
                        checkpoint = new RestoreCheckpoint(observedCache, result.getInt(1), result.getLong(2));
                        try (var save = connection.prepareStatement("UPDATE contoso_operator.run SET restore_json=? WHERE run_id=?")) {
                            save.setString(1, OperatorJson.write(checkpoint)); save.setObject(2, id); save.executeUpdate();
                        }
                    } else if (!cacheMatches(checkpoint.cache, observedCache) &&
                        !cacheMatches(run.baseline.caches.get(SKU), observedCache)) throw OperatorFailure.conflict();
                }
            }
            try (var delete = connection.prepareStatement("DELETE FROM contoso.inventory_reservation WHERE sku=?")) {
                delete.setString(1, SKU); delete.executeUpdate();
            }
            try (var update = connection.prepareStatement("UPDATE contoso.inventory_item SET available=?,revision=? WHERE sku=?")) {
                update.setInt(1, run.baseline.available); update.setLong(2, run.baseline.revision); update.setString(3, SKU);
                update.executeUpdate();
            }
            return null;
        });
        cache.restore(SKU, run.baseline.caches.get(SKU).baseline(), context(id));
        for (var entry : run.baseline.caches.entrySet()) {
            var actual = cache.capture(entry.getKey(), context(id));
            if (!cacheMatches(entry.getValue(), CacheState.of(actual))) throw OperatorFailure.conflict();
        }
        tx(connection -> {
            lock(connection, id);
            if (!run.baseline.unownedRowsHash.equals(unownedHash(connection, id))) throw OperatorFailure.conflict();
            try (var update = connection.prepareStatement("UPDATE contoso_operator.run SET phase='RESTORED',fault='NONE' WHERE run_id=?")) {
                update.setObject(1, id); update.executeUpdate();
            }
            try (var delete = connection.prepareStatement("DELETE FROM contoso_operator.lease WHERE run_id=?")) {
                delete.setObject(1, id); if (delete.executeUpdate() != 1) throw OperatorFailure.conflict();
            }
            return null;
        });
        var receipt = Map.<String, Object>of("runId", id.toString(), "result", "RESTORED",
            "baselineSha256", OperatorJson.hash(run.baseline), "unownedInventoryUnchanged", true,
            "workflowAuditRetained", true, "checkpointRewound", false, "certificationStatus", "NOT CERTIFIED");
        event(id, "RESET", receipt);
        return receipt;
    }

    void event(UUID id, String kind, Object facts) {
        tx(connection -> { appendEvent(connection, id, kind, facts, null); return null; });
    }

    List<UUID> expired() {
        return tx(connection -> {
            var result = new ArrayList<UUID>();
            try (var query = connection.prepareStatement(
                    "SELECT r.run_id FROM contoso_operator.run r JOIN contoso_operator.lease l ON l.run_id=r.run_id WHERE r.expires_at<=CURRENT_TIMESTAMP");
                 var rows = query.executeQuery()) {
                while (rows.next()) result.add(UUID.fromString(rows.getString(1)));
            }
            return result;
        });
    }

    private Run read(Connection connection, UUID id) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT demo_id,phase,fault,started_at,expires_at,baseline_json FROM contoso_operator.run WHERE run_id=?")) {
            query.setObject(1, id);
            try (var row = query.executeQuery()) {
                if (!row.next()) throw new OperatorFailure(404, "OPERATOR_RUN_NOT_FOUND");
                Baseline baseline;
                try { baseline = OperatorJson.MAPPER.readValue(row.getString(6), Baseline.class); }
                catch (java.io.IOException failure) { throw new OperatorFailure(500, "OPERATOR_BASELINE_INVALID"); }
                return new Run(id, row.getInt(1), row.getString(2), row.getString(3),
                    row.getObject(4, OffsetDateTime.class).toInstant().toString(),
                    row.getObject(5, OffsetDateTime.class).toInstant().toString(), baseline);
            }
        }
    }

    private void lock(Connection connection, UUID id) throws SQLException {
        try (var query = connection.prepareStatement("SELECT run_id FROM contoso_operator.lease WHERE singleton=1 FOR UPDATE");
             var row = query.executeQuery()) {
            if (!row.next() || !id.toString().equals(row.getString(1))) throw OperatorFailure.conflict();
        }
    }

    private boolean ownedInvocation(Connection connection, UUID id, UUID order, String invocation) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT invocation_id FROM contoso_operator.work WHERE run_id=? AND workflow_id=?")) {
            query.setObject(1, id); query.setObject(2, order);
            try (var row = query.executeQuery()) { return row.next() && invocation.equals(row.getString(1)); }
        }
    }

    private void verifyDataset(Connection connection) throws SQLException {
        try (var query = connection.prepareStatement(
                "SELECT workload,environment,seed_version,expected_resource_id FROM contoso.environment_marker WHERE singleton=TRUE FOR UPDATE");
             var row = query.executeQuery()) {
            if (!row.next() || !"contoso-corr".equals(row.getString(1)) || !"poc".equals(row.getString(2)) ||
                row.getInt(3) != 1 || !expectedResourceId.equals(row.getString(4))) throw OperatorFailure.conflict();
        }
    }

    private String unownedHash(Connection connection, UUID id) throws SQLException {
        var rows = new ArrayList<List<String>>();
        for (String sql : List.of(
                "SELECT sku,display_name,available,revision,synthetic FROM contoso.inventory_item WHERE sku<>? ORDER BY sku",
                "SELECT reservation_id,order_id,sku,quantity,state,invocation_id,synthetic FROM contoso.inventory_reservation WHERE sku<>? ORDER BY reservation_id")) {
            try (var query = connection.prepareStatement(sql)) {
                query.setString(1, SKU); query.setMaxRows(10001);
                try (var values = query.executeQuery()) {
                    while (values.next()) {
                        if (rows.size() >= 10000) throw new OperatorFailure(413, "OPERATOR_BASELINE_LIMIT");
                        var row = new ArrayList<String>();
                        for (int i = 1; i <= values.getMetaData().getColumnCount(); i++) row.add(values.getString(i));
                        rows.add(row);
                    }
                }
            }
        }
        return OperatorJson.hash(rows);
    }

    private static OperationContext context(UUID id) {
        return new OperationContext(InvocationId.parse(id.toString()), Context.root(), Instant.now().plusSeconds(5));
    }

    private static void operationEvent(Connection connection, UUID id, UUID operation, String kind) throws SQLException {
        appendEvent(connection, id, kind, Map.of(), operation);
    }

    private static void appendEvent(Connection connection, UUID id, String kind, Object facts, UUID operation) throws SQLException {
        if (!kind.matches("[A-Z_]{1,32}")) throw OperatorFailure.invalid();
        String json = OperatorJson.write(facts);
        if (json.length() > 32768) throw OperatorFailure.invalid();
        try (var insert = connection.prepareStatement(
                "INSERT INTO contoso_operator.event(event_id,run_id,kind,observed_at,facts_json,operation_id) VALUES (?,?,?,?,?,?)")) {
            insert.setObject(1, UUID.randomUUID()); insert.setObject(2, id); insert.setString(3, kind);
            insert.setObject(4, OffsetDateTime.now(ZoneOffset.UTC)); insert.setString(5, json);
            insert.setObject(6, operation); insert.executeUpdate();
        }
    }

    private static boolean cacheMatches(CacheState expected, CacheState actual) {
        Instant now = Instant.now();
        if (!expected.baseline().valueAt(now).equals(actual.baseline().valueAt(now))) return false;
        if (expected.baseline().valueAt(now).isEmpty()) return true;
        return expected.expiresAt == null ? actual.expiresAt == null :
            actual.expiresAt != null && Math.abs(Instant.parse(expected.expiresAt).toEpochMilli() -
                Instant.parse(actual.expiresAt).toEpochMilli()) <= 1000;
    }

    @FunctionalInterface interface Transaction<T> { T run(Connection connection) throws SQLException; }
    private <T> T tx(Transaction<T> operation) {
        try (var connection = database.open()) {
            connection.setAutoCommit(false);
            try {
                T result = operation.run(connection); connection.commit(); return result;
            } catch (SQLException | RuntimeException failure) {
                try { connection.rollback(); } catch (SQLException rollback) { failure.addSuppressed(rollback); }
                throw failure;
            }
        } catch (SQLException failure) {
            throw new OperatorFailure(409, "OPERATOR_DATABASE_OPERATION_FAILED");
        }
    }
}
