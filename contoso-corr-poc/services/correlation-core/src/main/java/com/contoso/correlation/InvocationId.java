package com.contoso.correlation;

import java.util.UUID;
import java.util.regex.Pattern;

public record InvocationId(UUID uuid) {
    private static final Pattern CANONICAL = Pattern.compile(
        "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");

    public InvocationId {
        if (uuid == null || uuid.version() != 4 || uuid.variant() != 2) {
            throw new IllegalArgumentException("invalid_invocation_id");
        }
    }

    public static InvocationId parse(String value) {
        if (value == null || value.length() != 36 || !CANONICAL.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid_invocation_id");
        }
        return new InvocationId(UUID.fromString(value));
    }

    public static InvocationId generate() { return new InvocationId(UUID.randomUUID()); }
    public String value() { return uuid.toString(); }
}
