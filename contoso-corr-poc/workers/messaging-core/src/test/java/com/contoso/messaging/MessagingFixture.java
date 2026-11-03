package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.workflow.RunScenario;
import io.opentelemetry.context.Context;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.h2.jdbcx.JdbcDataSource;

final class MessagingFixture implements AutoCloseable {
    static final String ORDERS = "orders", FULFILLMENT = "fulfillment", NOTIFY = "notify", AGGREGATOR = "aggregator";
    static final String TP = "00-12345678901234567890123456789012-1234567890123456-01";
    final EnvelopeCodec codec = new EnvelopeCodec();
    final String url = "jdbc:h2:mem:r5_" + InvocationId.generate().value() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=0";
    final Connection anchor;
    final MessagingSettings settings = new MessagingSettings("contoso-corr-poc-bus.servicebus.windows.net",
        "https://contoso-corr-poc-egt.centralus-1.eventgrid.azure.net/api/events",
        "contoso-corr-poc-eh.servicebus.windows.net", "https://contosocorrpocfixture.queue.core.windows.net",
        null, ORDERS, FULFILLMENT, NOTIFY, AGGREGATOR, 32, 16);

    MessagingFixture() throws Exception {
        var source = new JdbcDataSource(); source.setURL(url); source.setUser("SA");
        anchor = source.getConnection();
        try (var input = PgMessagingStore.class.getClassLoader().getResourceAsStream(PgMessagingStore.MIGRATION);
             var statement = anchor.createStatement()) {
            String sql = new String(java.util.Objects.requireNonNull(input).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            for (String command : sql.split(";")) if (!command.isBlank()) statement.execute(command);
            // These isolated H2 administrators establish distinct CURRENT_USER values, not Azure/RBAC proof.
            for (String role : List.of(ORDERS, FULFILLMENT, NOTIFY, AGGREGATOR)) {
                statement.execute("CREATE USER " + role + " PASSWORD '' ADMIN");
            }
        }
    }
    PgConnectionFactory factory(String role) {
        return new PgConnectionFactory() {
            public Connection open() throws java.sql.SQLException { return DriverManager.getConnection(url, role, ""); }
            public Map<String, String> telemetryAttributes() {
                return Map.of("db.system", "postgresql", "db.name", "contoso_orders",
                    "server.address", "contoso-corr-poc-pg.postgres.database.azure.com", "server.port", "5432");
            }
        };
    }
    PgMessagingStore store(String role) { return new PgMessagingStore(factory(role), codec); }
    static OperationContext context(Envelope envelope) {
        return new OperationContext(InvocationId.parse(envelope.businessInvocationId()), Context.current(), Instant.now().plusSeconds(20));
    }
    static OperationContext lookup() { return new OperationContext(InvocationId.generate(), Context.root(), Instant.now().plusSeconds(20)); }
    static Envelope envelope(RunScenario scenario) {
        String id = InvocationId.generate().value();
        return new Envelope(1, TP, "contoso=test", InvocationId.generate().value(), InvocationId.generate().value(),
            null, id, scenario == RunScenario.BATCH ? Envelope.Kind.BATCH : Envelope.Kind.ORDER, null,
            new WorkPayload(id, "CONTOSO-001", 1, scenario, null));
    }
    void create(Envelope envelope, int failures, Destination destination) {
        store(ORDERS).create(new MessagingStore.NewWorkflow(envelope.workflowId(), "RUN", 6, failures,
            envelope, List.of(destination)), context(envelope));
    }
    MessagingStore.Pending publication(Envelope envelope, Destination destination) {
        var store = store(ORDERS);
        var pending = store.claimOutbox(1, context(envelope)).getFirst();
        store.publicationRecorded(pending, envelope, context(envelope));
        store.published(pending, envelope, context(envelope));
        return pending;
    }
    int count(String table) throws Exception {
        if (!table.matches("async_[a-z_]+")) throw new IllegalArgumentException();
        try (var statement = anchor.createStatement(); var rows = statement.executeQuery("SELECT COUNT(*) FROM contoso." + table)) {
            rows.next(); return rows.getInt(1);
        }
    }
    static Map<String, String> processContext(int number) {
        return Map.of("traceparent", "00-12345678901234567890123456789012-" + Integer.toString(number).repeat(16) + "-01",
            "tracestate", "contoso=test");
    }
    @Override public void close() throws Exception { anchor.close(); }
}
