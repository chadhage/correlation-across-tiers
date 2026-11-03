package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class SamplingRuntimeTest {
    @Test void canonicalOwnedHashUsesSortedKeysAndExplicitAbsence() throws Exception {
        var node = SamplingLease.JSON.readTree("{\"sampling.requestsPerSecond\":{\"$contosoAbsent\":true}," +
            "\"sampling.percentage\":100,\"sampling.overrides\":[]}");
        assertEquals(SamplingLease.BOUNDED_FULL, SamplingLease.canonical(node));
        assertEquals(SamplingLease.hash(node), SamplingLease.hash(SamplingLease.JSON.readTree(SamplingLease.BOUNDED_FULL)));
    }

    @Test void leaseBindsRoleHashesGuardAndUtcLifetime() throws Exception {
        var directory = Path.of(System.getProperty("basedir"), "target", "sampling-runtime-fixtures", InvocationId.generate().value());
        Files.createDirectories(directory);
        try {
            var configuration = directory.resolve("applicationinsights.json");
            Files.writeString(configuration, "{}");
            var id = InvocationId.generate();
            var leasePath = directory.resolve("applicationinsights.json." + id.value() + ".lease.json");
            var now = Instant.parse("2026-11-01T05:00:00Z");
            var guard = ExtensionGuard.inventory();
            var json = SamplingLease.JSON.createObjectNode();
            json.put("schema", "contoso.sampling-runtime-lease.v1").put("runId", id.value())
                .put("layerId", "contoso-orders-api").put("revision", "cert-" + id.value())
                .put("startsAtUtc", now.minusSeconds(1).toString()).put("expiresAtUtc", now.plusSeconds(30).toString())
                .put("drainAtUtc", now.plusSeconds(20).toString()).put("restoreDeadlineUtc", now.plusSeconds(40).toString())
                .put("ownedConfigSha256", SamplingLease.hash(SamplingLease.JSON.readTree(SamplingLease.BOUNDED_FULL)))
                .put("baselineOwnedConfigSha256", SamplingLease.hash(SamplingLease.JSON.readTree(SamplingLease.BASELINE)))
                .put("hashAlgorithm", "contoso.canonical-json.sha256.v1");
            json.set("ownedConfiguration", SamplingLease.JSON.readTree(SamplingLease.BOUNDED_FULL));
            json.putObject("guard").put("sha256", guard.getProperty("sha256"))
                .put("providerClass", guard.getProperty("providerClass")).put("sdkAbi", guard.getProperty("sdkAbi"))
                .put("version", guard.getProperty("version")).put("policy", guard.getProperty("policy"));
            Files.writeString(leasePath, json.toString());
            assertEquals(id, SamplingLease.load(leasePath, configuration, "contoso-orders-api", guard, now).runId());
            assertThrows(IllegalStateException.class, () -> SamplingLease.load(leasePath, configuration, "contoso-inventory-api", guard, now));
            assertThrows(IllegalStateException.class, () -> SamplingLease.load(leasePath, configuration, "contoso-orders-api", guard, now.plusSeconds(31)));
            json.put("baselineOwnedConfigSha256", "0".repeat(64));
            Files.writeString(leasePath, json.toString());
            assertThrows(IllegalStateException.class, () -> SamplingLease.load(leasePath, configuration, "contoso-orders-api", guard, now));
        } finally {
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    @Test void quiesceCountsActualWorkAndExpiryDoesNotWaitForAFileAcknowledgement() throws Exception {
        var clock = new MutableClock();
        var nanos = new AtomicLong();
        var expirations = new AtomicInteger();
        var stops = new AtomicInteger();
        var id = InvocationId.generate();
        var lease = new SamplingLease(id, "contoso-orders-api", "cert-" + id.value(), clock.instant(),
            clock.instant().plusSeconds(3), clock.instant().plusSeconds(1), clock.instant().plusSeconds(4));
        try (var runtime = new SamplingRuntime("contoso-orders-api", lease, clock, nanos::get, expirations::incrementAndGet, stops::incrementAndGet)) {
            var first = runtime.admit();
            var second = runtime.admit();
            assertEquals(2, SamplingLease.JSON.readTree(runtime.getObservationJson()).path("inFlight").asInt());
            nanos.set(1_000_000_001L);
            runtime.tick();
            assertThrows(IllegalStateException.class, runtime::admit);
            assertFalse(SamplingLease.JSON.readTree(runtime.getObservationJson()).path("admitting").asBoolean());
            first.close(); first.close(); second.close();
            assertEquals(0, SamplingLease.JSON.readTree(runtime.getObservationJson()).path("inFlight").asInt());
            nanos.set(3_000_000_001L);
            runtime.tick(); runtime.tick();
            assertEquals(1, expirations.get());
            nanos.set(4_000_000_001L);
            runtime.tick(); runtime.tick();
            assertEquals(1, stops.get());
        }
    }

    @Test void clockRollbackCannotExtendTheNativeLeaseOrReopenAdmission() {
        var clock = new MutableClock();
        var nanos = new AtomicLong();
        var expires = new AtomicInteger();
        var id = InvocationId.generate();
        var lease = new SamplingLease(id, "contoso-orders-api", "cert-" + id.value(), clock.instant(),
            clock.instant().plusSeconds(2), clock.instant().plusSeconds(1), clock.instant().plusSeconds(3));
        try (var runtime = new SamplingRuntime("contoso-orders-api", lease, clock, nanos::get, expires::incrementAndGet, () -> {})) {
            clock.now = clock.now.minusSeconds(3600);
            nanos.set(2_000_000_001L);
            runtime.tick();
            assertThrows(IllegalStateException.class, runtime::admit);
            assertEquals(1, expires.get());
        }
    }

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-01T05:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}
