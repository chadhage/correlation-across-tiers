package com.contoso.security;

import com.azure.core.credential.TokenCredential;
import com.azure.security.keyvault.secrets.SecretAsyncClient;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class HmacPseudonymizer implements AutoCloseable {
    private static final Duration CACHE_LIFETIME = Duration.ofMinutes(5);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(5);
    private final SecretReader reader;
    private final Clock clock;
    private SecretVersionReference reference;
    private SecretMaterial material;
    private Instant loadedAt;
    private SecretVersionReference failedReference;
    private Instant retryAfter;
    private boolean closed;

    @FunctionalInterface
    public interface SecretReader {
        SecretMaterial read(SecretVersionReference reference, Duration timeout);
    }

    public static final class SecretMaterial implements AutoCloseable {
        private final byte[] key;
        private final Instant notBefore;
        private final Instant expiresAt;
        private final boolean enabled;
        public SecretMaterial(byte[] key, Instant notBefore, Instant expiresAt, boolean enabled) {
            if (key == null || key.length < 32 || key.length > 64 || expiresAt == null)
                throw new IllegalArgumentException("HMAC_MATERIAL_INVALID");
            this.key = key.clone();
            this.notBefore = notBefore;
            this.expiresAt = expiresAt;
            this.enabled = enabled;
        }
        @Override public void close() { Arrays.fill(key, (byte) 0); }
        @Override public String toString() { return "SecretMaterial[redacted]"; }
    }

    public HmacPseudonymizer(SecretVersionReference reference, SecretReader reader, Clock clock) {
        this.reference = Objects.requireNonNull(reference);
        this.reader = Objects.requireNonNull(reader);
        this.clock = Objects.requireNonNull(clock);
    }

    public static HmacPseudonymizer fromKeyVault(SecretVersionReference reference, TokenCredential credential) {
        SecurityLoggingGuard.verify();
        SecretAsyncClient client = IdentityHttpClients.keyVaultSecrets(reference.vaultUri(), credential);
        SecretReader reader = (ref, timeout) -> {
            byte[] decoded = null;
            try {
                SecurityLoggingGuard.verify();
                var secret = client.getSecret(ref.secretName(), ref.version()).block(timeout);
                if (secret == null || secret.getValue() == null ||
                        !ref.version().equals(secret.getProperties().getVersion())) throw new SecurityException("HMAC_UNAVAILABLE");
                decoded = Base64.getDecoder().decode(secret.getValue());
                if (!Base64.getEncoder().encodeToString(decoded).equals(secret.getValue())) throw new SecurityException("HMAC_UNAVAILABLE");
                var properties = secret.getProperties();
                return new SecretMaterial(decoded,
                    properties.getNotBefore() == null ? null : properties.getNotBefore().toInstant(),
                    properties.getExpiresOn() == null ? null : properties.getExpiresOn().toInstant(),
                    Boolean.TRUE.equals(properties.isEnabled()));
            } catch (Exception ignored) { throw new SecurityException("HMAC_UNAVAILABLE"); }
            finally { if (decoded != null) Arrays.fill(decoded, (byte) 0); }
        };
        return new HmacPseudonymizer(reference, reader, Clock.systemUTC());
    }

    public synchronized String pseudonymize(String tenantId, String objectId) {
        if (closed) throw new SecurityException("HMAC_UNAVAILABLE");
        String tenant = WorkloadIdentity.canonical(tenantId), subject = WorkloadIdentity.canonical(objectId);
        Instant now = clock.instant();
        if (material == null || !now.isBefore(loadedAt.plus(CACHE_LIFETIME))) replace(load(reference, now), now);
        if (!usable(material, clock.instant())) throw new SecurityException("HMAC_UNAVAILABLE");
        byte[] message = ("contoso-corr:poc:user-pseudonym:v1\u0000" + tenant + "\u0000" + subject)
            .getBytes(StandardCharsets.UTF_8);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(material.key, "HmacSHA256"));
            byte[] digest = mac.doFinal(message);
            try { return "h1:" + reference.version() + ":" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest); }
            finally { Arrays.fill(digest, (byte) 0); }
        } catch (Exception ignored) { throw new SecurityException("HMAC_UNAVAILABLE"); }
        finally { Arrays.fill(message, (byte) 0); }
    }

    public synchronized void rotate(SecretVersionReference next) {
        if (closed || !reference.vaultUri().equals(next.vaultUri()) ||
                !reference.secretName().equals(next.secretName()) || reference.version().equals(next.version()))
            throw new IllegalArgumentException("HMAC_ROTATION_INVALID");
        Instant now = clock.instant();
        SecretMaterial candidate = load(next, now);
        reference = next;
        replace(candidate, now);
    }

    private SecretMaterial load(SecretVersionReference ref, Instant now) {
        if (ref.equals(failedReference) && retryAfter != null && now.isBefore(retryAfter))
            throw new SecurityException("HMAC_UNAVAILABLE");
        SecretMaterial candidate;
        try { candidate = reader.read(ref, READ_TIMEOUT); }
        catch (Exception ignored) {
            failedReference = ref;
            retryAfter = now.plusSeconds(30);
            throw new SecurityException("HMAC_UNAVAILABLE");
        }
        if (candidate == null || !usable(candidate, clock.instant())) {
            if (candidate != null) candidate.close();
            failedReference = ref;
            retryAfter = now.plusSeconds(30);
            throw new SecurityException("HMAC_UNAVAILABLE");
        }
        failedReference = null;
        retryAfter = null;
        return candidate;
    }
    private static boolean usable(SecretMaterial value, Instant now) {
        return value.enabled && now.isBefore(value.expiresAt) &&
            (value.notBefore == null || !now.isBefore(value.notBefore));
    }
    private void replace(SecretMaterial next, Instant now) {
        if (material != null) material.close();
        material = next;
        loadedAt = now;
    }
    @Override public synchronized void close() {
        closed = true;
        if (material != null) material.close();
        material = null;
    }
    @Override public String toString() { return "HmacPseudonymizer[redacted]"; }
}
