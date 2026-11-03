package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.correlation.data.OperationContext;
import io.opentelemetry.context.Context;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NotifyTopicReplayFixtureTest {
    @Test void separateFileOpenPhasesPreserveNotifyReplayIdentityAndActualOtherSubscriptionIsolation() throws Exception {
        Path directory = Files.createDirectories(Path.of(System.getProperty("basedir"), "target",
            "notify-topic-fixture-unit", UUID.randomUUID().toString()));
        Path database = directory.resolve("notify-topic-db");
        java.util.Map<String, Object> prepared;
        java.util.Map<String, Object> notified;
        java.util.Map<String, Object> skipped;
        try {
            try (var fixture = new NotifyTopicReplayFixture(database, true)) {
                prepared = fixture.prepare(new OperationContext(fixture.invocation("prepare"), Context.root(), Instant.now().plusSeconds(30)));
            }
            try (var fixture = new NotifyTopicReplayFixture(database, false)) {
                notified = fixture.notifyReplay(new OperationContext(fixture.invocation("notify"), Context.root(), Instant.now().plusSeconds(30)));
            }
            try (var fixture = new NotifyTopicReplayFixture(database, false)) {
                skipped = fixture.skipOtherTopicSubscription(new OperationContext(fixture.invocation("skip"), Context.root(), Instant.now().plusSeconds(30)));
            }
            assertEquals(prepared.get("originalMessageId"), notified.get("originalMessageId"));
            assertEquals(prepared.get("businessInvocationId"), notified.get("businessInvocationId"));
            assertEquals(notified.get("businessInvocationId"), skipped.get("businessInvocationId"));
            assertNotEquals(notified.get("originalMessageId"), notified.get("replayMessageId"));
            assertEquals(notified.get("originalMessageId"), notified.get("replayOf"));
            assertEquals(notified.get("originalMessageId"), notified.get("causationId"));
            assertEquals("NOTIFY_DLQ", skipped.get("replaySource"));
            assertEquals(1, skipped.get("replayRecordCount"));
            assertEquals(1, skipped.get("notifyEffects"));
            assertEquals(0, skipped.get("fulfillmentEffects"));
            assertEquals(0, skipped.get("fulfillmentReplayInbox"));
            assertEquals(1, skipped.get("notifyReplayInbox"));
            assertEquals(3, skipped.get("fulfillmentFaultBudget"));
            assertEquals(true, skipped.get("fulfillmentPaused"));
            assertEquals(1, skipped.get("retainedFulfillmentDeadLetters"));
            assertEquals(true, skipped.get("topicSkipSettled"));
            for (String field : new String[]{"notifyEffectOwner", "notifyReplayReceiver", "notifyReplayPublisher"}) {
                assertInstanceOf(String.class, skipped.get(field));
                assertTrue(MessagingFixture.NOTIFY.equalsIgnoreCase((String) skipped.get(field)));
            }
        } finally {
            for (String suffix : new String[]{".mv.db", ".trace.db", ".lock.db"}) Files.deleteIfExists(Path.of(database + suffix));
            Files.deleteIfExists(directory);
        }
    }

    @Test void continuationCannotCreateANewEmptyDatabaseOrInventPriorProducerState() throws Exception {
        Path directory = Files.createDirectories(Path.of(System.getProperty("basedir"), "target",
            "notify-topic-fixture-unit", UUID.randomUUID().toString()));
        Path database = directory.resolve("notify-topic-db");
        assertThrows(java.sql.SQLException.class, () -> new NotifyTopicReplayFixture(database, false));
        assertFalse(Files.exists(Path.of(database + ".mv.db")));
        Files.deleteIfExists(Path.of(database + ".trace.db"));
        Files.deleteIfExists(directory);
    }

    @Test void physicalActorMappingIsFixedByPhaseAndCannotBeSuppliedAsAReplayClaim() {
        assertEquals("contoso-fulfillment-worker", NotifyTopicReplayProbe.role("prepare"));
        assertEquals("contoso-notify-worker", NotifyTopicReplayProbe.role("notify"));
        assertEquals("contoso-fulfillment-worker", NotifyTopicReplayProbe.role("skip"));
        assertThrows(IllegalArgumentException.class, () -> NotifyTopicReplayProbe.role("orders"));
        assertThrows(IllegalArgumentException.class, () -> NotifyTopicReplayProbe.role("contoso-notify-worker"));
    }
}
