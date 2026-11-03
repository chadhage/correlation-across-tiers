package com.contoso.correlation;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Properties;
import java.util.Set;

public record SamplingLease(InvocationId runId, String layerId, String revision, Instant startsAt,
                            Instant expiresAt, Instant drainAt, Instant restoreDeadline) {
    static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final String ABSENT = "{\"$contosoAbsent\":true}";
    static final String BASELINE = "{\"sampling.overrides\":[],\"sampling.percentage\":" + ABSENT +
        ",\"sampling.requestsPerSecond\":5}";
    static final String BOUNDED_FULL = "{\"sampling.overrides\":[],\"sampling.percentage\":100,\"sampling.requestsPerSecond\":" + ABSENT + "}";

    public SamplingLease {
        if (runId == null || layerId == null || !layerId.matches("[a-z][a-z0-9-]{1,63}") ||
            !("cert-" + runId.value()).equals(revision) || startsAt == null || expiresAt == null ||
            drainAt == null || restoreDeadline == null || !expiresAt.isAfter(startsAt) ||
            drainAt.isBefore(startsAt) || drainAt.isAfter(expiresAt) || restoreDeadline.isBefore(expiresAt) ||
            Duration.between(startsAt, expiresAt).compareTo(Duration.ofHours(2)) > 0 ||
            Duration.between(expiresAt, restoreDeadline).compareTo(Duration.ofSeconds(120)) > 0) {
            throw invalid();
        }
    }

    static SamplingLease load(Path path, Path configuration, String serviceName, Properties guard, Instant now) {
        try {
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 16384 ||
                !path.toRealPath().getParent().equals(configuration.toRealPath().getParent())) throw invalid();
            JsonNode value = JSON.readTree(Files.readAllBytes(path));
            Set<String> fields = Set.of("schema", "runId", "layerId", "revision", "startsAtUtc", "expiresAtUtc",
                "drainAtUtc", "restoreDeadlineUtc", "ownedConfigSha256", "baselineOwnedConfigSha256",
                "hashAlgorithm", "ownedConfiguration", "guard");
            if (!value.isObject() || value.size() != fields.size()) throw invalid();
            value.fieldNames().forEachRemaining(name -> { if (!fields.contains(name)) throw invalid(); });
            if (!"contoso.sampling-runtime-lease.v1".equals(value.path("schema").asText()) ||
                !"contoso.canonical-json.sha256.v1".equals(value.path("hashAlgorithm").asText()) ||
                !serviceName.equals(value.path("layerId").asText()) ||
                !hash(JSON.readTree(BOUNDED_FULL)).equals(value.path("ownedConfigSha256").asText()) ||
                !hash(JSON.readTree(BASELINE)).equals(value.path("baselineOwnedConfigSha256").asText()) ||
                !canonical(JSON.readTree(BOUNDED_FULL)).equals(canonical(value.path("ownedConfiguration")))) {
                throw invalid();
            }
            JsonNode claimedGuard = value.path("guard");
            if (!claimedGuard.isObject() || claimedGuard.size() != 5 ||
                !guard.getProperty("sha256").equals(claimedGuard.path("sha256").asText()) ||
                !guard.getProperty("providerClass").equals(claimedGuard.path("providerClass").asText()) ||
                !guard.getProperty("sdkAbi").equals(claimedGuard.path("sdkAbi").asText()) ||
                !guard.getProperty("version").equals(claimedGuard.path("version").asText()) ||
                !guard.getProperty("policy").equals(claimedGuard.path("policy").asText())) throw invalid();
            var lease = new SamplingLease(InvocationId.parse(value.path("runId").asText()), serviceName,
                value.path("revision").asText(), Instant.parse(value.path("startsAtUtc").asText()),
                Instant.parse(value.path("expiresAtUtc").asText()), Instant.parse(value.path("drainAtUtc").asText()),
                Instant.parse(value.path("restoreDeadlineUtc").asText()));
            if (now.isBefore(lease.startsAt()) || !now.isBefore(lease.expiresAt())) throw invalid();
            return lease;
        } catch (Exception failure) { throw invalid(); }
    }

    public static String canonical(JsonNode value) {
        try { return JSON.writeValueAsString(sorted(value)); }
        catch (Exception failure) { throw invalid(); }
    }

    public static String hash(JsonNode value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(canonical(value).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception failure) { throw invalid(); }
    }

    private static JsonNode sorted(JsonNode value) {
        if (value.isObject()) {
            ObjectNode result = JSON.createObjectNode();
            var names = new java.util.ArrayList<String>();
            value.fieldNames().forEachRemaining(names::add);
            names.sort(String::compareTo);
            names.forEach(name -> result.set(name, sorted(value.get(name))));
            return result;
        }
        if (value.isArray()) {
            var result = JSON.createArrayNode();
            value.forEach(item -> result.add(sorted(item)));
            return result;
        }
        if (value.isFloatingPointNumber()) {
            if (!Double.isFinite(value.doubleValue())) throw invalid();
            return JSON.getNodeFactory().numberNode(value.decimalValue().stripTrailingZeros());
        }
        if (!value.isValueNode()) throw invalid();
        return value;
    }

    private static IllegalStateException invalid() { return new IllegalStateException("GATE_02_SAMPLING_LEASE_INVALID"); }
}
