package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.workflow.DemoRunCommand;
import com.contoso.correlation.workflow.OrderCommand;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.correlation.workflow.WorkflowPort;
import com.contoso.correlation.workflow.WorkflowView;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MessagingWorkflowPort implements WorkflowPort, AutoCloseable {
    private final MessagingStore store;
    private final MessagingTransport transport;
    private final OutboxPublisher publisher;
    private final ScheduledExecutorService dispatcher;
    private final AtomicBoolean closed = new AtomicBoolean();
    public MessagingWorkflowPort(MessagingStore store, MessagingTransport transport) {
        this(store, transport, false);
    }
    private MessagingWorkflowPort(MessagingStore store, MessagingTransport transport, boolean background) {
        this.store = java.util.Objects.requireNonNull(store);
        this.transport = java.util.Objects.requireNonNull(transport);
        publisher = new OutboxPublisher(store, transport);
        dispatcher = background ? Executors.newSingleThreadScheduledExecutor(action -> {
            Thread thread = new Thread(action, "contoso-durable-outbox-dispatch"); thread.setDaemon(true); return thread;
        }) : null;
        if (dispatcher != null) dispatcher.scheduleWithFixedDelay(() -> {
            if (closed.get()) return;
            try { publisher.dispatch(8); }
            catch (RuntimeException ignored) {
                com.contoso.correlation.Correlation.log(org.slf4j.LoggerFactory.getLogger(MessagingWorkflowPort.class), "outbox_retry", "PENDING");
            }
        }, 0, 5, TimeUnit.SECONDS);
    }
    public static MessagingWorkflowPort fromEnvironment(PgConnectionFactory connections) {
        MessagingLoggingGuard.verify();
        var settings = MessagingSettings.fromEnvironment();
        var codec = new EnvelopeCodec();
        return new MessagingWorkflowPort(new PgMessagingStore(connections, codec), new AzureMessagingTransport(settings, codec), true);
    }
    @Override public WorkflowView submitOrder(OrderCommand command, OperationContext context) {
        var draft = draft(command.orderId(), command, RunScenario.SYNC, Envelope.Kind.ORDER, context);
        WorkflowView view = store.create(new MessagingStore.NewWorkflow(command.orderId(), "ORDER", 0, 0,
            draft, List.of(Destination.SERVICE_BUS_ORDER)), context);
        if (dispatcher == null) publisher.dispatch(32);
        return view;
    }
    @Override public Optional<WorkflowView> order(String orderId, OperationContext context) {
        if (dispatcher == null) publisher.dispatch(32);
        return store.find(orderId, "ORDER", context);
    }
    @Override public WorkflowView startRun(DemoRunCommand command, OperationContext context) {
        Destination destination = switch (command.scenario()) {
            case FAN_OUT, FAN_IN -> Destination.SERVICE_BUS_TOPIC;
            case BATCH -> Destination.EVENT_HUBS;
            case EVENT_GRID -> Destination.EVENT_GRID;
            case STORAGE_QUEUE -> Destination.STORAGE_QUEUE;
            default -> Destination.SERVICE_BUS_ORDER;
        };
        var order = new OrderCommand(command.runId(), "CONTOSO-001", 1);
        var draft = draft(command.runId(), order, command.scenario(),
            command.scenario() == RunScenario.BATCH ? Envelope.Kind.BATCH : Envelope.Kind.ORDER, context);
        int failures = command.scenario() == RunScenario.DLQ && command.failureBudget() == 0 ? 3 : command.failureBudget();
        var destinations = command.scenario() == RunScenario.BATCH
            ? Collections.nCopies(2, destination) : List.of(destination);
        WorkflowView view = store.create(new MessagingStore.NewWorkflow(command.runId(), "RUN", command.demoId(),
            failures, draft, destinations), context);
        if (dispatcher == null) publisher.dispatch(32);
        return view;
    }
    private Envelope draft(String id, OrderCommand command, RunScenario scenario, Envelope.Kind kind, OperationContext context) {
        var carrier = TraceContexts.capture(context.parentContext());
        return new Envelope(1, carrier.get("traceparent"), carrier.get("tracestate"), context.invocationId().value(),
            InvocationId.generate().value(), null, id, kind, null,
            new WorkPayload(command.orderId(), command.sku(), command.quantity(), scenario, null));
    }
    @Override public Optional<WorkflowView> run(String runId, OperationContext context) {
        if (dispatcher == null) publisher.dispatch(32);
        return store.find(runId, "RUN", context);
    }
    @Override public WorkflowView controlRun(String runId, RunControl command, OperationContext context) {
        return store.control(runId, command, context);
    }
    public int dispatchPending() { return publisher.dispatch(8); }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        if (dispatcher != null) {
            dispatcher.shutdownNow();
            try { dispatcher.awaitTermination(5, TimeUnit.SECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        transport.close();
    }
}
