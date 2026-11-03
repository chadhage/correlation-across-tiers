package com.contoso.correlation.data;

import java.util.UUID;
import java.util.regex.Pattern;

public final class DataValidation {
    private static final Pattern SKU = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}");
    private static final Pattern ID = Pattern.compile("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}");

    private DataValidation() {}

    public static String sku(String value) {
        if (value == null || !SKU.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid_sku");
        }
        return value;
    }

    public static String id(String value) {
        if (value == null || !ID.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid_data_id");
        }
        UUID parsed = UUID.fromString(value);
        if (parsed.equals(new UUID(0, 0))) throw new IllegalArgumentException("invalid_data_id");
        return value;
    }
}
