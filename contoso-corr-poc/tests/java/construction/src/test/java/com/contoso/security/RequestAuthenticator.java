package com.contoso.security;

// Frozen API header only. No authentication implementation; never packaged with applications.
public abstract class RequestAuthenticator {
    public static RequestAuthenticator fromEnvironment(String serviceName) {
        throw new UnsupportedOperationException("CONSTRUCTION_ONLY");
    }
    public abstract VerifiedCaller authenticate(String authorization, String gatewayAuthorization);
}
