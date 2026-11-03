package com.contoso.correlation;

import java.util.List;

public final class InvocationIds {
    public static final String HEADER = "x-business-invocation-id";
    private InvocationIds() {}

    public static InvocationId resolve(List<String> values, boolean trustedIssuer) {
        if (trustedIssuer && values != null && values.size() == 1) {
            try { return InvocationId.parse(values.getFirst()); }
            catch (IllegalArgumentException ignored) { }
        }
        return InvocationId.generate();
    }
}
