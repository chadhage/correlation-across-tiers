package com.contoso.security;

import java.util.UUID;

public record WorkloadIdentity(String clientId, String objectId) {
    public WorkloadIdentity {
        clientId = canonical(clientId);
        objectId = canonical(objectId);
    }

    static String canonical(String value) {
        if (value == null || !value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw new IllegalArgumentException("IDENTITY_CONFIGURATION_INVALID");
        UUID id = UUID.fromString(value);
        if (id.getMostSignificantBits() == 0 && id.getLeastSignificantBits() == 0)
            throw new IllegalArgumentException("IDENTITY_CONFIGURATION_INVALID");
        return id.toString();
    }

    @Override public String toString() { return "WorkloadIdentity[redacted]"; }
}
