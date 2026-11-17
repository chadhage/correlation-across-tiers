package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.InvocationId;
import com.contoso.correlation.workflow.DemoRunCommand;
import com.contoso.correlation.workflow.RunScenario;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DemoWorkflowRoutingTest {
    @Test void deadLetterDemoPublishesToBothWorkerSubscriptionsRatherThanTheFulfillmentOnlyQueue() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var destinations = new ArrayList<Destination>();
            MessagingTransport transport = new MessagingTransport() {
                public void publish(Destination destination, Envelope envelope) { destinations.add(destination); }
                public List<Delivery> receive(Source source, int maximum, Duration wait) { throw new AssertionError("not a receiver"); }
                public List<String> partitions() { throw new AssertionError("not an Event Hubs consumer"); }
                public List<HubRecord> receiveBatch(String partition, long offset, int maximum, Duration wait) { throw new AssertionError("not an Event Hubs consumer"); }
                public void close() {}
            };
            try (var workflow = new MessagingWorkflowPort(fixture.store(MessagingFixture.ORDERS), transport)) {
                var result = workflow.startRun(new DemoRunCommand(7, RunScenario.DLQ, 2), MessagingFixture.lookup());
                assertEquals(List.of(Destination.SERVICE_BUS_TOPIC), destinations);
                assertEquals("DLQ", result.details().get("scenario"));
                assertEquals("2", result.details().get("failureBudget"));
            }
        }
    }

    @Test void independentlyTracedBatchPublicationsShareAWorkflowPartitionWithoutReusingTraceContext() {
        var first = MessagingFixture.envelope(RunScenario.BATCH);
        var second = new Envelope(1, "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01", null,
            first.businessInvocationId(), InvocationId.generate().value(), null, first.workflowId(),
            Envelope.Kind.BATCH, null, first.payload());
        assertNotEquals(first.traceparent(), second.traceparent());
        assertEquals(first.workflowId(), AzureMessagingTransport.batchOptions(first).getPartitionKey());
        assertEquals(first.workflowId(), AzureMessagingTransport.batchOptions(second).getPartitionKey());
        assertNull(AzureMessagingTransport.batchOptions(MessagingFixture.envelope(RunScenario.SYNC)).getPartitionKey());
    }
}
