package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.ExtensionGuard;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.workflow.RunAction;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.RunScenario;
import com.contoso.correlation.workflow.WorkTarget;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class LinkedSamplingProbe {
    private LinkedSamplingProbe() {}
    public static void main(String[] args) throws Exception {
        RuntimeGuard.verifyAgentArguments(java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments());
        ExtensionGuard.verify();
        MessagingLoggingGuard.verify();
        var mapper = new ObjectMapper();
        try (var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            URI endpoint = URI.create(args[1]);
            if ("produce".equals(args[0])) {
                var inputs = produce();
                var reply = http.send(HttpRequest.newBuilder(endpoint.resolve("/carriers"))
                    .timeout(Duration.ofSeconds(5)).POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(inputs))).build(),
                    HttpResponse.BodyHandlers.discarding());
                if (reply.statusCode() != 200) throw new IllegalStateException("carrier_transfer_failed");
            } else {
                var input = http.send(HttpRequest.newBuilder(endpoint.resolve("/carriers")).timeout(Duration.ofSeconds(5)).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray()).body();
                var envelopes = List.of(mapper.readValue(input, Envelope[].class));
                Map<String, Object> decisions = exercise(envelopes);
                var reply = http.send(HttpRequest.newBuilder(endpoint.resolve("/decisions"))
                    .timeout(Duration.ofSeconds(5)).POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(decisions))).build(),
                    HttpResponse.BodyHandlers.discarding());
                if (reply.statusCode() != 200) throw new IllegalStateException("decision_transfer_failed");
            }
        }
        Thread.sleep(1000);
    }

    private static List<Envelope> produce() {
        var result = new ArrayList<Envelope>();
        var invocation = InvocationId.generate();
        String batchWorkflow = InvocationId.generate().value();
        for (RunScenario scenario : List.of(RunScenario.RETRY, RunScenario.DLQ, RunScenario.FAN_OUT, RunScenario.BATCH, RunScenario.BATCH)) {
            String workflow = scenario == RunScenario.BATCH ? batchWorkflow : InvocationId.generate().value();
            String message = InvocationId.generate().value();
            try (var span = Correlation.start("contoso.sampling.source.send", SpanKind.PRODUCER, Context.root(), invocation,
                    Map.of("contoso.message.id", message, "contoso.workflow.id", workflow)); var scope = span.makeCurrent()) {
                if (!span.spanContext().isValid()) throw new IllegalStateException("source_provider_missing");
                var carrier = TraceContexts.capture(span.context());
                var envelope = new Envelope(1, carrier.get("traceparent"), carrier.get("tracestate"), invocation.value(),
                    message, null, workflow, scenario == RunScenario.BATCH ? Envelope.Kind.BATCH : Envelope.Kind.ORDER,
                    null, new WorkPayload(workflow, "CONTOSO-001", 1, scenario, null));
                if (!TraceContexts.extract(envelope).spanContext().equals(span.spanContext())) {
                    var extracted = TraceContexts.extract(envelope).spanContext();
                    if (!extracted.getTraceId().equals(span.spanContext().getTraceId()) ||
                        !extracted.getSpanId().equals(span.spanContext().getSpanId()) ||
                        extracted.isSampled() != span.spanContext().isSampled()) throw new IllegalStateException("source_carrier_mismatch");
                }
                var codec = new EnvelopeCodec();
                var sdk = new AzureCarriers(codec);
                if (scenario == RunScenario.BATCH) envelope = sdk.eventHub(sdk.eventHub(envelope));
                else {
                    var broker = sdk.serviceBus(envelope);
                    envelope = sdk.serviceBus(broker.getBody(), broker.getMessageId(), broker.getApplicationProperties());
                }
                result.add(envelope);
            }
        }
        return List.copyOf(result);
    }

    private static Map<String, Object> exercise(List<Envelope> inputs) throws Exception {
        try (var fixture = new MessagingFixture(); var transport = new LocalCarrierTransport(fixture.codec)) {
            var result = new LinkedHashMap<String, Object>();
            try (var control = Correlation.start("contoso.sampling.unlinked.control", SpanKind.INTERNAL,
                    Context.root(), InvocationId.generate(), Map.of())) {
                var span = control.spanContext();
                if (!span.isValid()) throw new IllegalStateException("control_provider_missing");
                result.put("unlinkedRoot", Map.of("traceId", span.getTraceId(), "spanId", span.getSpanId(),
                    "sampled", span.isSampled()));
            }
            var store = fixture.store(MessagingFixture.ORDERS);
            for (Envelope input : inputs) {
                Destination destination = switch (input.payload().scenario()) {
                    case FAN_OUT -> Destination.SERVICE_BUS_TOPIC;
                    case BATCH -> Destination.EVENT_HUBS;
                    default -> Destination.SERVICE_BUS_ORDER;
                };
                store.create(new MessagingStore.NewWorkflow(input.workflowId(), "RUN", 6,
                    input.payload().scenario() == RunScenario.DLQ ? 1 : 0, input, List.of(destination)), context(input));
                try (var connection = fixture.factory(MessagingFixture.ORDERS).open();
                     var exists = connection.prepareStatement("SELECT message_id FROM contoso.async_outbox WHERE message_id=?")) {
                    exists.setObject(1, java.util.UUID.fromString(input.messageId()));
                    try (var rows = exists.executeQuery()) {
                        if (!rows.next()) try (var insert = connection.prepareStatement(
                            "INSERT INTO contoso.async_outbox(message_id,workflow_id,destination,draft_json) VALUES (?,?,?,?)")) {
                            insert.setObject(1, java.util.UUID.fromString(input.messageId()));
                            insert.setObject(2, java.util.UUID.fromString(input.workflowId()));
                            insert.setString(3, destination.name()); insert.setString(4, fixture.codec.json(input)); insert.executeUpdate();
                        }
                    }
                }
                var pending = store.claimOutbox(1, context(input)).getFirst();
                if (!pending.draft().messageId().equals(input.messageId())) throw new IllegalStateException("source_staging_mismatch");
                store.publicationRecorded(pending, input, context(input)); store.published(pending, input, context(input));
                transport.publish(destination, input);
            }
            var fulfillment = fixture.store(MessagingFixture.FULFILLMENT);
            var notify = fixture.store(MessagingFixture.NOTIFY);
            var aggregator = fixture.store(MessagingFixture.AGGREGATOR);
            var processor = new AsyncProcessor(fulfillment, fixture.settings);
            Envelope ordinary = inputs.get(0);
            processor.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER);
            result.put("ordinaryProcess", effect(fixture, ordinary.workflowId(), "ORDER"));
            Envelope dead = inputs.get(1);
            processor.process(transport.receive(Source.ORDERS, 1, Duration.ZERO).getFirst(), Branch.ORDER);
            store.control(dead.workflowId(), new RunControl(RunAction.REPLAY, WorkTarget.SERVICE_BUS, 0), context(dead));
            new ReplayProcessor(fulfillment, fixture.settings).replay(transport.receive(Source.ORDERS_DLQ, 1, Duration.ZERO).getFirst(), true);
            new OutboxPublisher(fulfillment, transport).dispatch(8);
            Envelope replay = transport.published.stream().filter(value -> value.replayOf() != null).findFirst().orElseThrow();
            result.put("replaySend", decision(replay));
            Envelope fanout = inputs.get(2);
            processor.process(transport.receive(Source.FULFILLMENT, 1, Duration.ZERO).getFirst(), Branch.FULFILLMENT);
            new AsyncProcessor(notify, fixture.settings).process(transport.receive(Source.NOTIFY, 1, Duration.ZERO).getFirst(), Branch.NOTIFY);
            new OutboxPublisher(fulfillment, transport).dispatch(8); new OutboxPublisher(notify, transport).dispatch(8);
            result.put("resultSends", transport.published.stream().filter(value -> value.kind() == Envelope.Kind.RESULT).map(LinkedSamplingProbe::decision).toList());
            var aggregate = new AsyncProcessor(aggregator, fixture.settings);
            for (var item : transport.receive(Source.RESULTS, 2, Duration.ZERO)) aggregate.process(item, Branch.AGGREGATOR);
            aggregate.aggregatePending();
            result.put("fanIn", effect(fixture, fanout.workflowId(), "AGGREGATOR"));
            aggregate.processBatch(transport.receiveBatch("0", -1, 16, Duration.ZERO), 1);
            var batchEffects = new ArrayList<Map<String, Object>>();
            for (String workflow : inputs.stream().filter(value -> value.kind() == Envelope.Kind.BATCH)
                    .map(Envelope::workflowId).distinct().toList()) {
                batchEffects.addAll(effects(fixture, workflow, "BATCH"));
            }
            result.put("batchItems", List.copyOf(batchEffects));
            result.put("inputContexts", inputs.stream().map(LinkedSamplingProbe::decision).toList());
            result.put("scope", "Actual current provider/source carriers and runtime/H2 outcomes; no Azure broker or permission proof");
            return result;
        }
    }

    private static OperationContext context(Envelope input) {
        return new OperationContext(InvocationId.parse(input.businessInvocationId()), Context.root(), Instant.now().plusSeconds(30));
    }
    private static Map<String, Object> decision(Envelope envelope) {
        var span = TraceContexts.extract(envelope).spanContext();
        if (!span.isValid()) throw new IllegalStateException("actual_context_missing");
        return Map.of("traceId", span.getTraceId(), "spanId", span.getSpanId(), "sampled", span.isSampled());
    }
    private static Map<String, Object> effect(MessagingFixture fixture, String workflow, String branch) throws Exception {
        return effects(fixture, workflow, branch).getFirst();
    }
    private static List<Map<String, Object>> effects(MessagingFixture fixture, String workflow, String branch) throws Exception {
        var result = new ArrayList<Map<String, Object>>();
        try (var query = fixture.anchor.prepareStatement("SELECT process_traceparent,process_tracestate FROM contoso.async_effect WHERE workflow_id=? AND branch=?")) {
            query.setObject(1, java.util.UUID.fromString(workflow)); query.setString(2, branch);
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    var span = TraceContexts.extract(rows.getString(1), rows.getString(2)).spanContext();
                    if (!span.isValid()) throw new IllegalStateException("actual_effect_context_missing");
                    result.add(Map.of("traceId", span.getTraceId(), "spanId", span.getSpanId(), "sampled", span.isSampled()));
                }
            }
        }
        return List.copyOf(result);
    }
}
