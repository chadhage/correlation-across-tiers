package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class HmacPseudonymizerTest {
    @Test void fullHmacIsContextBoundVersionedRotatableAndNeverAPublicSubjectHash() throws Exception {
        var clock = new SecurityFixture.MutableClock();
        byte[] first = key(), second = key();
        var reads = new AtomicInteger();
        try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) -> {
                reads.incrementAndGet();
                assertTrue(timeout.compareTo(Duration.ofSeconds(5)) <= 0);
                return new HmacPseudonymizer.SecretMaterial(ref.version().startsWith("1") ? first : second,
                    clock.instant().minusSeconds(1), clock.instant().plusSeconds(3600), true);
            }, clock)) {
            String before = hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER);
            assertEquals(before, hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
            assertNotEquals(before, hmac.pseudonymize(UUID.randomUUID().toString(), SecurityFixture.USER));
            assertNotEquals(before, hmac.pseudonymize(SecurityFixture.TENANT, UUID.randomUUID().toString()));
            assertEquals(1, reads.get());
            String hash = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(SecurityFixture.USER.getBytes(StandardCharsets.UTF_8)));
            assertFalse(before.contains(hash));
            assertFalse(before.contains(SecurityFixture.USER));
            assertFalse(hmac.toString().contains(before));
            hmac.rotate(SecurityFixture.reference("2"));
            String after = hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER);
            assertNotEquals(before.substring(before.lastIndexOf(':') + 1), after.substring(after.lastIndexOf(':') + 1));
            assertTrue(after.startsWith("h1:" + "2".repeat(32) + ":"));
            clock.advance(Duration.ofMinutes(6));
            assertEquals(after, hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
            assertEquals(3, reads.get());
        } finally { Arrays.fill(first, (byte) 0); Arrays.fill(second, (byte) 0); }
    }

    @Test void missingDisabledExpiredShortAndFailedSecretsDoNotFallbackToHash() {
        var clock = new SecurityFixture.MutableClock();
        for (int mode = 0; mode < 5; mode++) {
            int current = mode;
            try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) -> {
                    if (current == 0) return null;
                    if (current == 1) return new HmacPseudonymizer.SecretMaterial(key(), null, clock.instant().plusSeconds(60), false);
                    if (current == 2) return new HmacPseudonymizer.SecretMaterial(key(), null, clock.instant().minusSeconds(1), true);
                    if (current == 3) return new HmacPseudonymizer.SecretMaterial(new byte[16], null, clock.instant().plusSeconds(60), true);
                    throw new IllegalStateException("sensitive_sdk_message");
                }, clock)) {
                var failure = assertThrows(SecurityException.class,
                    () -> hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
                assertEquals("HMAC_UNAVAILABLE", failure.getMessage());
                assertNull(failure.getCause());
            }
        }
    }

    @Test void explicitVersionAndSameSecretRotationAreRequired() {
        for (String uri : List.of("https://contoso-corr-poc-kv.vault.azure.net/secrets/hmac",
                "http://contoso-corr-poc-kv.vault.azure.net/secrets/hmac/" + "1".repeat(32),
                "https://identity.example/secrets/hmac/" + "1".repeat(32),
                SecurityFixture.reference("1").uri() + "?version=latest")) {
            assertThrows(IllegalArgumentException.class, () -> SecretVersionReference.parse(uri));
        }
        var clock = new SecurityFixture.MutableClock();
        try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) ->
                new HmacPseudonymizer.SecretMaterial(key(), null, clock.instant().plusSeconds(60), true), clock)) {
            assertThrows(IllegalArgumentException.class, () -> hmac.rotate(SecurityFixture.reference("1")));
            hmac.close();
            assertThrows(SecurityException.class, () -> hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
        }
    }

    @Test void preparationGenerates256BitsOnlyInMemoryAndNeverCallsCloudSet() {
        try (var prepared = HmacSecretBootstrap.prepareInMemory()) {
            assertEquals(256, prepared.entropyBits());
            assertEquals("HmacSecretBootstrap[redacted]", prepared.toString());
        }
    }

    @Test void failedKeyVaultReadsAreThrottledWithoutReturningStaleOrPublicHashIdentity() {
        var clock = new SecurityFixture.MutableClock();
        var reads = new AtomicInteger();
        try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) -> {
                reads.incrementAndGet();
                throw new IllegalStateException("sensitive_sdk_message");
            }, clock)) {
            for (int index = 0; index < 25; index++)
                assertThrows(SecurityException.class, () -> hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
            assertEquals(1, reads.get());
            clock.advance(Duration.ofSeconds(31));
            assertThrows(SecurityException.class, () -> hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
            assertEquals(2, reads.get());
        }
    }

    @Test void aKeyThatExpiresDuringAcquisitionIsNotUsedWithTheEarlierClockSnapshot() {
        var clock = new SecurityFixture.MutableClock();
        try (var hmac = new HmacPseudonymizer(SecurityFixture.reference("1"), (ref, timeout) -> {
                Instant expiry = clock.instant().plusSeconds(1);
                clock.advance(Duration.ofSeconds(2));
                return new HmacPseudonymizer.SecretMaterial(key(), null, expiry, true);
            }, clock)) {
            assertThrows(SecurityException.class, () -> hmac.pseudonymize(SecurityFixture.TENANT, SecurityFixture.USER));
        }
    }

    private static byte[] key() { byte[] key = new byte[32]; new SecureRandom().nextBytes(key); return key; }
}
