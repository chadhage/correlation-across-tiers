package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class ProcessingLeaseTest {
    @Test void renewalSettlementAndCloseAreSerialized() {
        var delivery = new TestDelivery();
        try (var lease = new ProcessingLease(delivery, Clock.fixed(delivery.now, ZoneOffset.UTC), Duration.ofHours(1))) {
            lease.renewNow();
            assertEquals(1, delivery.renewals);
            lease.complete();
            lease.renewNow();
            assertEquals(1, delivery.completions);
            assertEquals(1, delivery.renewals);
            assertThrows(MessagingFailure.class, lease::complete);
        }
    }
    @Test void failedRenewalCannotAcknowledgeOrApplyAnotherSettlement() {
        var delivery = new TestDelivery(); delivery.failRenewal = true;
        try (var lease = new ProcessingLease(delivery, Clock.fixed(delivery.now, ZoneOffset.UTC), Duration.ofHours(1))) {
            lease.renewNow();
            assertThrows(MessagingFailure.class, lease::complete);
            assertThrows(MessagingFailure.class, lease::abandon);
            assertEquals(0, delivery.completions);
        }
    }
    @Test void expiredBrokerLockCannotBeSettled() {
        var delivery = new TestDelivery();
        try (var lease = new ProcessingLease(delivery, Clock.fixed(delivery.now.plusSeconds(60), ZoneOffset.UTC), Duration.ofHours(1))) {
            assertThrows(MessagingFailure.class, lease::complete);
            assertEquals(0, delivery.completions);
        }
    }
    static final class TestDelivery implements Delivery {
        final Instant now = Instant.now();
        int renewals, completions;
        boolean failRenewal;
        public Source source() { return Source.ORDERS; }
        public Envelope envelope() { return MessagingFixture.envelope(com.contoso.correlation.workflow.RunScenario.SYNC); }
        public int deliveryCount() { return 1; }
        public Instant lockedUntil() { return now.plusSeconds(45); }
        public Instant renew() { if (failRenewal) throw new IllegalStateException("safe_fixture_failure"); renewals++; return now.plusSeconds(90); }
        public void complete() { completions++; }
        public void abandon() { }
        public void deadLetter(String code) { }
    }
}
