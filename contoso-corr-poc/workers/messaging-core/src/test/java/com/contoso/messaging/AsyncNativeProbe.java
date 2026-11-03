package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.ExtensionGuard;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeClasspathGuard;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.workflow.DemoRunCommand;
import com.contoso.correlation.workflow.RunAction;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.correlation.workflow.WorkTarget;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

public final class AsyncNativeProbe {
    private AsyncNativeProbe() {}
    public static void main(String[] args) throws Exception {
        RuntimeGuard.verifyAgentArguments(java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments());
        RuntimeClasspathGuard.verify(AsyncNativeProbe.class.getClassLoader());
        ExtensionGuard.verify();
        MessagingLoggingGuard.verify();
        try (var fixture = new MessagingFixture(); var transport = new LocalCarrierTransport(fixture.codec);
             var port = new MessagingWorkflowPort(fixture.store(MessagingFixture.ORDERS), transport)) {
            var fulfillment = new AsyncProcessor(fixture.store(MessagingFixture.FULFILLMENT), fixture.settings);
            var notify = new AsyncProcessor(fixture.store(MessagingFixture.NOTIFY), fixture.settings);
            var aggregator = new AsyncProcessor(fixture.store(MessagingFixture.AGGREGATOR), fixture.settings);
            var invocation = InvocationId.generate();
            try (var root = Correlation.start("contoso.async.oracle.root", SpanKind.SERVER, Context.root(), invocation, Map.of());
                 var scope = root.makeCurrent()) {
                if (!root.spanContext().isValid() || !io.opentelemetry.api.trace.Span.current().isRecording()) {
                    throw new IllegalStateException("NO_RECORDING_AGENT_API_BRIDGE");
                }
                var operation = new OperationContext(invocation, root.context(), Instant.now().plusSeconds(30));
                var retry = port.startRun(new DemoRunCommand(6, RunScenario.RETRY, 2), operation);
                for (int number = 1; number <= 3; number++) {
                    boolean complete = fulfillment.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER);
                    if (complete != (number == 3)) throw new IllegalStateException("incorrect_retry_outcome");
                }
                if (!"COMPLETED".equals(port.run(retry.id(), operation).orElseThrow().state())) throw new IllegalStateException("retry_state");
                var dlq = port.startRun(new DemoRunCommand(7, RunScenario.DLQ, 2), operation);
                fulfillment.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER);
                fulfillment.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER);
                port.controlRun(dlq.id(), new RunControl(RunAction.REPLAY, WorkTarget.SERVICE_BUS, 0), operation);
                new ReplayProcessor(fixture.store(MessagingFixture.FULFILLMENT), fixture.settings)
                    .replay(transport.receive(Source.ORDERS_DLQ, 1, Duration.ZERO).getFirst(), true);
                new OutboxPublisher(fixture.store(MessagingFixture.FULFILLMENT), transport).dispatch(8);
                if (!fulfillment.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER)) {
                    throw new IllegalStateException("replay_did_not_complete");
                }
                var fanout = port.startRun(new DemoRunCommand(8, RunScenario.FAN_OUT, 0), operation);
                fulfillment.process(transport.receive(Source.FULFILLMENT, 1, Duration.ZERO).getFirst(), Branch.FULFILLMENT);
                notify.process(transport.receive(Source.NOTIFY, 1, Duration.ZERO).getFirst(), Branch.NOTIFY);
                new OutboxPublisher(fixture.store(MessagingFixture.FULFILLMENT), transport).dispatch(8);
                new OutboxPublisher(fixture.store(MessagingFixture.NOTIFY), transport).dispatch(8);
                for (var result : transport.receive(Source.RESULTS, 2, Duration.ZERO)) aggregator.process(result, Branch.AGGREGATOR);
                aggregator.aggregatePending();
                if (!"COMPLETED".equals(port.run(fanout.id(), operation).orElseThrow().state())) throw new IllegalStateException("fanin_state");
                var batch = port.startRun(new DemoRunCommand(9, RunScenario.BATCH, 0), operation);
                if (!aggregator.processBatch(transport.receiveBatch("0", -1, 16, Duration.ZERO), 1)) throw new IllegalStateException("batch_state");
                if (!"COMPLETED".equals(port.run(batch.id(), operation).orElseThrow().state())) throw new IllegalStateException("batch_effect_state");
                if (fixture.count("async_replay") != 1 || fixture.count("async_contributor") != 2 || fixture.count("async_effect") != 7) {
                    throw new IllegalStateException("durable_effect_counts");
                }
                System.out.println("ASYNC_NATIVE_PROBE_COMPLETE");
            }
        }
        Thread.sleep(1000);
    }
}
