package com.contoso.security;

import java.util.Map;

public final class SafeAuthenticationTelemetry {
    private SafeAuthenticationTelemetry() {}
    public static Map<String, String> success(VerifiedCaller caller) {
        return Map.of("contoso.auth.outcome", "authenticated",
            "contoso.auth.actor_type", caller.actorType(),
            "contoso.auth.role_category", caller.canControlRuns() ? "run_controller" : "invoker");
    }
    public static Map<String, String> failure() {
        return Map.of("contoso.auth.outcome", "rejected", "contoso.auth.actor_type", "unknown",
            "contoso.auth.role_category", "none");
    }
}
