package com.contoso.security;

import com.azure.security.keyvault.secrets.SecretAsyncClient;
import com.azure.core.credential.TokenCredential;
import com.azure.security.keyvault.secrets.models.KeyVaultSecret;
import java.net.URI;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;

public final class HmacSecretBootstrap implements AutoCloseable {
    private final byte[] material = new byte[32];
    private boolean closed;
    private HmacSecretBootstrap() { new SecureRandom().nextBytes(material); }
    public static HmacSecretBootstrap prepareInMemory() { return new HmacSecretBootstrap(); }

    public SecretVersionReference storeAfterExplicitApproval(
            TokenCredential credential, String approvedVaultUrl, String approvedSecretName, OffsetDateTime expiresOn) {
        URI vault;
        try { vault = URI.create(approvedVaultUrl); }
        catch (Exception ignored) { throw new IllegalArgumentException("BOOTSTRAP_APPROVAL_TARGET_INVALID"); }
        return storeAfterExplicitApproval(IdentityHttpClients.keyVaultSecrets(vault, credential),
            approvedVaultUrl, approvedSecretName, expiresOn);
    }

    // Reference API only: no application startup, CLI or deployment invokes this cloud-write method.
    public synchronized SecretVersionReference storeAfterExplicitApproval(
            SecretAsyncClient client, String approvedVaultUrl, String approvedSecretName, OffsetDateTime expiresOn) {
        URI approved;
        try { approved = URI.create(approvedVaultUrl); }
        catch (Exception ignored) { throw new IllegalArgumentException("BOOTSTRAP_APPROVAL_TARGET_INVALID"); }
        if (closed || client == null || !client.getVaultUrl().equals(approvedVaultUrl) ||
                !"https".equals(approved.getScheme()) || approved.getHost() == null ||
                !approved.getHost().matches("[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\\.vault\\.azure\\.net") ||
                approved.getUserInfo() != null || approved.getPort() != -1 ||
                approved.getQuery() != null || approved.getFragment() != null ||
                !(approved.getPath().isEmpty() || approved.getPath().equals("/")) ||
                approvedSecretName == null || !approvedSecretName.matches("[A-Za-z0-9-]{1,127}") ||
                expiresOn == null || !expiresOn.isAfter(OffsetDateTime.now().plusHours(1)))
            throw new IllegalArgumentException("BOOTSTRAP_APPROVAL_TARGET_INVALID");
        try {
            SecurityLoggingGuard.verify();
            var secret = new KeyVaultSecret(approvedSecretName, Base64.getEncoder().encodeToString(material));
            secret.getProperties().setEnabled(true).setNotBefore(OffsetDateTime.now()).setExpiresOn(expiresOn);
            var stored = client.setSecret(secret).block(Duration.ofSeconds(30));
            if (stored == null) throw new IllegalStateException("BOOTSTRAP_UNAVAILABLE");
            return new SecretVersionReference(URI.create(stored.getId()));
        } catch (Exception ignored) { throw new IllegalStateException("BOOTSTRAP_UNAVAILABLE"); }
        finally { close(); }
    }

    int entropyBits() { return material.length * 8; }
    @Override public synchronized void close() { closed = true; Arrays.fill(material, (byte) 0); }
    @Override public String toString() { return "HmacSecretBootstrap[redacted]"; }
}
