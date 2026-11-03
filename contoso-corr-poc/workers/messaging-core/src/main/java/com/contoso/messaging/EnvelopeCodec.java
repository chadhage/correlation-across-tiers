package com.contoso.messaging;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class EnvelopeCodec {
    private final JsonMapper mapper = JsonMapper.builder(JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(8)
            .maxStringLength(Envelope.MAX_BYTES).maxNumberLength(12).build()).build())
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
        .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
        .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS).build();

    public byte[] encode(Envelope envelope) {
        try {
            byte[] bytes = mapper.writeValueAsBytes(envelope);
            size(bytes);
            return bytes;
        } catch (MessagingFailure safe) { throw safe; }
        catch (Exception ignored) { throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE); }
    }

    public Envelope decode(byte[] bytes) {
        size(bytes);
        try { return mapper.readValue(bytes, Envelope.class); }
        catch (Exception ignored) { throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE); }
    }

    public Envelope decode(String json) {
        if (json == null || json.length() > Envelope.MAX_BYTES) {
            throw new MessagingFailure(MessagingFailure.Code.ENVELOPE_TOO_LARGE);
        }
        return decode(json.getBytes(StandardCharsets.UTF_8));
    }

    public String json(Envelope envelope) { return new String(encode(envelope), StandardCharsets.UTF_8); }

    public String fingerprint(Envelope envelope) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(encode(envelope))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("sha256_unavailable"); }
    }

    private static void size(byte[] bytes) {
        if (bytes == null || bytes.length == 0) throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE);
        if (bytes.length > Envelope.MAX_BYTES) throw new MessagingFailure(MessagingFailure.Code.ENVELOPE_TOO_LARGE);
    }
}
