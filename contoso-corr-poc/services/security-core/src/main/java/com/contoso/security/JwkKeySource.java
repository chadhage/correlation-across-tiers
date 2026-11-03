package com.contoso.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.util.JSONObjectUtils;
import com.azure.core.http.HttpClient;
import com.azure.core.http.HttpMethod;
import com.azure.core.http.HttpRequest;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

public final class JwkKeySource implements SigningKeyProvider {
    private static final Duration REFRESH = Duration.ofHours(1);
    private static final Duration MAX_STALE = Duration.ofHours(24);
    private static final Duration MIN_FETCH_INTERVAL = Duration.ofMinutes(5);
    private final URI endpoint;
    private final String expectedIssuer;
    private final Clock clock;
    private final HttpClient client;
    private final ScheduledExecutorService refresh;
    private Map<String, RSAKey> keys = Map.of();
    private Instant loadedAt;
    private Instant attemptedAt;
    private boolean closed;

    public JwkKeySource(URI endpoint, String expectedIssuer, Clock clock) {
        if (endpoint == null || endpoint.getHost() == null || endpoint.getUserInfo() != null ||
                endpoint.getQuery() != null || endpoint.getFragment() != null ||
                !("https".equals(endpoint.getScheme()) ||
                  ("http".equals(endpoint.getScheme()) && Set.of("127.0.0.1", "[::1]").contains(endpoint.getHost()))))
            throw new IllegalArgumentException("JWKS_CONFIGURATION_INVALID");
        this.endpoint = endpoint;
        this.expectedIssuer = Objects.requireNonNull(expectedIssuer);
        this.clock = Objects.requireNonNull(clock);
        client = IdentityHttpClients.httpClient();
        refresh = Executors.newSingleThreadScheduledExecutor(action -> {
            var thread = new Thread(action, "contoso-jwks-refresh");
            thread.setDaemon(true);
            return thread;
        });
        refresh.scheduleWithFixedDelay(this::refreshQuietly, REFRESH.toSeconds(), REFRESH.toSeconds(), TimeUnit.SECONDS);
    }

    @Override public synchronized RSAKey key(String keyId, String issuer) {
        if (closed || !expectedIssuer.equals(issuer)) throw new SecurityException("JWT_REJECTED");
        Instant now = clock.instant();
        boolean unknown = !keys.containsKey(keyId);
        boolean old = loadedAt == null || !now.isBefore(loadedAt.plus(REFRESH));
        if ((unknown || old) && mayFetch(now)) {
            try { fetch(now); }
            catch (SecurityException ignored) {
                if (unknown || loadedAt == null || !now.isBefore(loadedAt.plus(MAX_STALE))) throw ignored;
            }
        }
        if (loadedAt == null || !now.isBefore(loadedAt.plus(MAX_STALE)) || !keys.containsKey(keyId))
            throw new SecurityException("JWT_REJECTED");
        return keys.get(keyId);
    }

    private boolean mayFetch(Instant now) {
        return attemptedAt == null || !now.isBefore(attemptedAt.plus(MIN_FETCH_INTERVAL));
    }

    private synchronized void refreshQuietly() {
        if (closed || !mayFetch(clock.instant())) return;
        try { fetch(clock.instant()); } catch (SecurityException ignored) {}
    }

    private void fetch(Instant now) {
        attemptedAt = now;
        try {
            var request = new HttpRequest(HttpMethod.GET, endpoint.toString()).setHeader("Accept", "application/json");
            byte[] body = client.send(request).flatMap(response -> {
                if (response.getStatusCode() != 200) {
                    response.close();
                    return reactor.core.publisher.Mono.<byte[]>error(new SecurityException("JWKS_UNAVAILABLE"));
                }
                return response.getBody().collect(ByteArrayOutputStream::new, (output, chunk) -> {
                    if (chunk.remaining() > 262144 - output.size()) throw new SecurityException("JWKS_UNAVAILABLE");
                    byte[] bytes = new byte[chunk.remaining()];
                    chunk.get(bytes);
                    output.writeBytes(bytes);
                }).map(ByteArrayOutputStream::toByteArray).doFinally(ignored -> response.close());
            }).block(Duration.ofSeconds(5));
            if (body == null) throw new SecurityException("JWKS_UNAVAILABLE");
            EntraJwtVerifier.strictJson(body);
            String json = new String(body, StandardCharsets.UTF_8);
            var set = JWKSet.parse(json);
            var rawKeys = JSONObjectUtils.getJSONObjectArray(JSONObjectUtils.parse(json), "keys");
            if (set.getKeys().isEmpty() || set.getKeys().size() > 1000) throw new SecurityException("JWKS_UNAVAILABLE");
            Map<String, RSAKey> next = new HashMap<>();
            for (int index = 0; index < set.getKeys().size(); index++) {
                JWK jwk = set.getKeys().get(index);
                if (!(jwk instanceof RSAKey rsa)) continue;
                String id = rsa.getKeyID();
                if (rsa.isPrivate() || id == null || !id.matches("[A-Za-z0-9_-]{1,128}") ||
                        rsa.size() < 2048 || rsa.size() > 4096 ||
                        (rsa.getAlgorithm() != null && !JWSAlgorithm.RS256.equals(rsa.getAlgorithm())) ||
                        (rsa.getKeyUse() != null && !KeyUse.SIGNATURE.equals(rsa.getKeyUse())) ||
                        (rsa.getKeyOperations() != null && !rsa.getKeyOperations().contains(KeyOperation.VERIFY)))
                    throw new SecurityException("JWKS_UNAVAILABLE");
                Object issuer = rawKeys[index].get("issuer");
                if (issuer != null && (!(issuer instanceof String value) || !keyIssuer(value).equals(expectedIssuer)))
                    throw new SecurityException("JWKS_UNAVAILABLE");
                if (next.put(id, rsa.toPublicJWK()) != null) throw new SecurityException("JWKS_UNAVAILABLE");
            }
            if (next.isEmpty()) throw new SecurityException("JWKS_UNAVAILABLE");
            keys = Map.copyOf(next);
            loadedAt = now;
        } catch (Exception failure) {
            throw new SecurityException("JWKS_UNAVAILABLE");
        }
    }

    private String keyIssuer(String value) {
        String tenant = URI.create(expectedIssuer).getPath().split("/")[1];
        return value.replace("{tenantid}", tenant);
    }

    @Override public synchronized void close() {
        closed = true;
        keys = Map.of();
        refresh.shutdownNow();
    }

    @Override public String toString() { return "JwkKeySource[redacted]"; }
}
