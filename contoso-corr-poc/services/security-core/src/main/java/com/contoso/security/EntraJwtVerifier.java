package com.contoso.security;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.*;
import java.net.URI;
import java.time.*;
import java.util.*;
import tools.jackson.core.*;
import tools.jackson.core.json.JsonFactory;

public final class EntraJwtVerifier implements AutoCloseable {
    private static final Set<String> SAFE_ROLES = Set.of(
        "Gateway.Invoke", "Portal.Invoke", "Inventory.Invoke", "Demo.Control", "Invocation.Issue");
    private static final JsonFactory JSON = JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(12)
            .maxStringLength(8192).maxNumberLength(24).build()).build();
    private final String tenantId;
    private final SigningKeyProvider keys;
    private final Clock clock;
    private final Duration skew;
    private final Duration maxLifetime;

    public EntraJwtVerifier(String tenantId, SigningKeyProvider keys, Clock clock) {
        this(tenantId, keys, clock, Duration.ofSeconds(30), Duration.ofHours(2));
    }

    public EntraJwtVerifier(String tenantId, SigningKeyProvider keys, Clock clock,
                            Duration skew, Duration maxLifetime) {
        this.tenantId = WorkloadIdentity.canonical(tenantId);
        this.keys = Objects.requireNonNull(keys);
        this.clock = Objects.requireNonNull(clock);
        if (skew == null || skew.isNegative() || skew.compareTo(Duration.ofSeconds(60)) > 0 ||
                maxLifetime == null || maxLifetime.compareTo(Duration.ofMinutes(5)) < 0 ||
                maxLifetime.compareTo(Duration.ofHours(28)) > 0)
            throw new IllegalArgumentException("JWT_CONFIGURATION_INVALID");
        this.skew = skew;
        this.maxLifetime = maxLifetime;
    }

    public static EntraJwtVerifier forTenant(String tenantId) {
        String tenant = WorkloadIdentity.canonical(tenantId);
        Clock clock = Clock.systemUTC();
        String issuer1 = issuer(tenant, "1.0");
        String issuer2 = issuer(tenant, "2.0");
        var v1 = new JwkKeySource(URI.create("https://login.microsoftonline.com/" + tenant + "/discovery/keys"), issuer1, clock);
        var v2 = new JwkKeySource(URI.create("https://login.microsoftonline.com/" + tenant + "/discovery/v2.0/keys"), issuer2, clock);
        SigningKeyProvider provider = new SigningKeyProvider() {
            public com.nimbusds.jose.jwk.RSAKey key(String id, String issuer) {
                if (issuer1.equals(issuer)) return v1.key(id, issuer);
                if (issuer2.equals(issuer)) return v2.key(id, issuer);
                throw new SecurityException("JWT_REJECTED");
            }
            public void close() { v1.close(); v2.close(); }
        };
        return new EntraJwtVerifier(tenant, provider, clock);
    }

    VerifiedClaims verify(String authorization, Set<String> audiences) {
        try {
            String token = bearer(authorization);
            SignedJWT jwt = SignedJWT.parse(token);
            strictJson(jwt.getHeader().toBase64URL().decode());
            strictJson(jwt.getPayload().toBytes());
            JWSHeader header = jwt.getHeader();
            if (!JWSAlgorithm.RS256.equals(header.getAlgorithm()) ||
                    header.getType() == null || !"JWT".equalsIgnoreCase(header.getType().toString()) ||
                    header.getKeyID() == null || !header.getKeyID().matches("[A-Za-z0-9_-]{1,128}") ||
                    (header.getCriticalParams() != null && !header.getCriticalParams().isEmpty()) ||
                    header.getJWKURL() != null || header.getJWK() != null || header.getX509CertURL() != null)
                reject();
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            String version = claims.getStringClaim("ver");
            String issuer = issuer(tenantId, version);
            var key = keys.key(header.getKeyID(), issuer);
            if (key == null || key.isPrivate() || !header.getKeyID().equals(key.getKeyID()) ||
                    key.size() < 2048 || key.size() > 4096 ||
                    (key.getAlgorithm() != null && !JWSAlgorithm.RS256.equals(key.getAlgorithm())) ||
                    (key.getKeyUse() != null && !com.nimbusds.jose.jwk.KeyUse.SIGNATURE.equals(key.getKeyUse())) ||
                    !jwt.verify(new RSASSAVerifier(key))) reject();
            if (!issuer.equals(claims.getIssuer()) ||
                    !tenantId.equals(WorkloadIdentity.canonical(claims.getStringClaim("tid"))) ||
                    claims.getAudience().size() != 1 || !audiences.contains(claims.getAudience().getFirst())) reject();
            if (version.equals("2.0")) WorkloadIdentity.canonical(claims.getAudience().getFirst());
            Instant now = clock.instant();
            Date expiry = claims.getExpirationTime(), notBefore = claims.getNotBeforeTime(), issuedAt = claims.getIssueTime();
            if (expiry == null || notBefore == null || issuedAt == null ||
                    !expiry.toInstant().isAfter(now.minus(skew)) ||
                    notBefore.toInstant().isAfter(now.plus(skew)) || issuedAt.toInstant().isAfter(now.plus(skew)) ||
                    !expiry.after(notBefore) || !expiry.after(issuedAt) ||
                    Duration.between(issuedAt.toInstant(), expiry.toInstant()).compareTo(maxLifetime) > 0) reject();
            String party = WorkloadIdentity.canonical(claims.getStringClaim(version.equals("2.0") ? "azp" : "appid"));
            String alternate = claims.getStringClaim(version.equals("2.0") ? "appid" : "azp");
            if (alternate != null && !party.equals(WorkloadIdentity.canonical(alternate))) reject();
            String oid = WorkloadIdentity.canonical(claims.getStringClaim("oid"));
            String identityType = claims.getStringClaim("idtyp");
            boolean hasScopes = claims.getClaims().containsKey("scp");
            String scope = hasScopes ? claims.getStringClaim("scp") : null;
            if (hasScopes && (scope == null || scope.isBlank() || scope.length() > 2048 ||
                    !scope.matches("[A-Za-z0-9._/-]+(?: [A-Za-z0-9._/-]+)*"))) reject();
            Set<String> scopes = scope == null ? Set.of() : Set.copyOf(Arrays.asList(scope.split(" ")));
            Object rawRoles = claims.getClaim("roles");
            Set<String> roles = new HashSet<>();
            if (rawRoles != null) {
                if (!(rawRoles instanceof List<?> list) || list.size() > 32) reject();
                for (Object raw : (List<?>) rawRoles) {
                    if (!(raw instanceof String role) || role.length() > 64 || !role.matches("[A-Za-z0-9._-]+")) reject();
                    if (SAFE_ROLES.contains(raw)) roles.add((String) raw);
                }
            }
            if ("app".equals(identityType) && hasScopes) reject();
            if (identityType != null && !Set.of("app", "user").contains(identityType)) reject();
            return new VerifiedClaims(tenantId, oid, party, identityType, hasScopes, scopes, Set.copyOf(roles));
        } catch (Exception ignored) {
            throw new SecurityException("JWT_REJECTED");
        }
    }

    static void strictJson(byte[] bytes) {
        if (bytes.length == 0 || bytes.length > 262144) throw new SecurityException("JWT_REJECTED");
        try (var parser = JSON.createParser(bytes)) {
            if (parser.nextToken() != JsonToken.START_OBJECT) reject();
            parser.skipChildren();
            if (parser.nextToken() != null) reject();
        } catch (Exception ignored) { throw new SecurityException("JWT_REJECTED"); }
    }

    static String bearer(String value) {
        if (value == null || value.length() > 8192 || value.length() < 16 ||
                !value.regionMatches(true, 0, "Bearer ", 0, 7) ||
                !value.substring(7).matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"))
            throw new SecurityException("JWT_REJECTED");
        return value.substring(7);
    }

    static String issuer(String tenant, String version) {
        if ("1.0".equals(version)) return "https://sts.windows.net/" + tenant + "/";
        if ("2.0".equals(version)) return "https://login.microsoftonline.com/" + tenant + "/v2.0";
        throw new SecurityException("JWT_REJECTED");
    }

    private static void reject() { throw new SecurityException("JWT_REJECTED"); }
    @Override public void close() { keys.close(); }
    @Override public String toString() { return "EntraJwtVerifier[redacted]"; }

    record VerifiedClaims(String tenant, String objectId, String clientId, String identityType,
                          boolean hasScopes, Set<String> scopes, Set<String> roles) {
        boolean appOnly() { return "app".equals(identityType) && !hasScopes; }
        WorkloadIdentity workload() { return new WorkloadIdentity(clientId, objectId); }
        @Override public String toString() { return "VerifiedClaims[redacted]"; }
    }
}
