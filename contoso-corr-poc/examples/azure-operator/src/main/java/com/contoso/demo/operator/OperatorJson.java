package com.contoso.demo.operator;

import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;

final class OperatorJson {
    static final JsonMapper MAPPER = JsonMapper.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
        .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS).build();
    static {
        MAPPER.getFactory().setStreamReadConstraints(StreamReadConstraints.builder()
            .maxNestingDepth(16).maxStringLength(65536).maxNumberLength(24).build());
    }
    private OperatorJson() {}
    static String write(Object value) {
        try { return MAPPER.writeValueAsString(value); }
        catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new OperatorFailure(500, "OPERATOR_SERIALIZATION_FAILED");
        }
    }
    static JsonNode read(byte[] bytes) {
        return read(bytes, 65536);
    }
    static JsonNode read(byte[] bytes, int limit) {
        if (bytes.length == 0 || bytes.length > limit || limit > 8388608) throw OperatorFailure.invalid();
        try { return MAPPER.readTree(bytes); }
        catch (java.io.IOException failure) { throw OperatorFailure.invalid(); }
    }
    static void fields(JsonNode node, String... names) {
        if (node == null || !node.isObject()) throw OperatorFailure.invalid();
        Set<String> allowed = Set.of(names);
        node.fieldNames().forEachRemaining(name -> { if (!allowed.contains(name)) throw OperatorFailure.invalid(); });
    }
    static String text(JsonNode node, String name) {
        if (!node.path(name).isTextual()) throw OperatorFailure.invalid();
        return node.path(name).textValue();
    }
    static String hash(Object value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest(write(value).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
