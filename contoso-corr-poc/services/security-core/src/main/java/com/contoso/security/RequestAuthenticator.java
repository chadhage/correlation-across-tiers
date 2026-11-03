package com.contoso.security;

import java.util.*;

public final class RequestAuthenticator implements AutoCloseable {
    private final EntraJwtVerifier verifier;
    private final AuthorizationPolicy policy;
    private final HmacPseudonymizer pseudonymizer;
    private volatile boolean closed;

    public RequestAuthenticator(EntraJwtVerifier verifier, AuthorizationPolicy policy, HmacPseudonymizer pseudonymizer) {
        this.verifier = Objects.requireNonNull(verifier);
        this.policy = Objects.requireNonNull(policy);
        if (policy.serviceName().equals("contoso-orders-api") && pseudonymizer == null)
            throw new IllegalArgumentException("HMAC_CONFIGURATION_REQUIRED");
        this.pseudonymizer = pseudonymizer;
    }

    public static RequestAuthenticator fromEnvironment(String serviceName) {
        Map<String, String> env = System.getenv();
        AuthorizationPolicy policy = policyFromEnvironment(serviceName, env);
        EntraJwtVerifier verifier = EntraJwtVerifier.forTenant(required(env, "CONTOSO_TENANT_ID"));
        try {
            SecurityLoggingGuard.verify();
            HmacPseudonymizer hmac = null;
            if (serviceName.equals("contoso-orders-api")) {
                String clientId = env.get("CONTOSO_MANAGED_IDENTITY_CLIENT_ID");
                hmac = HmacPseudonymizer.fromKeyVault(
                    SecretVersionReference.parse(required(env, "CONTOSO_HMAC_SECRET_URI")),
                    IdentityHttpClients.managedIdentity(clientId));
            }
            return new RequestAuthenticator(verifier, policy, hmac);
        } catch (Exception failure) {
            verifier.close();
            throw new IllegalStateException("AUTH_CONFIGURATION_INVALID");
        }
    }

    static AuthorizationPolicy policyFromEnvironment(String serviceName, Map<String, String> env) {
        try {
            if ("contoso-orders-api".equals(serviceName)) {
                WorkloadIdentity portal = workload(env, "PORTAL");
                WorkloadIdentity gateway = workload(env, "GATEWAY");
                Set<WorkloadIdentity> runControllers = Set.of();
                String controller = env.get("CONTOSO_RUN_CONTROLLER_CLIENT_ID");
                if (controller != null && !controller.isBlank()) {
                    WorkloadIdentity identity = workload(env, "RUN_CONTROLLER");
                    if (!identity.equals(portal)) throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
                    runControllers = Set.of(identity);
                }
                return new AuthorizationPolicy(serviceName,
                    audiences(required(env, "CONTOSO_PUBLIC_AUDIENCE")),
                    audiences(required(env, "CONTOSO_ORDERS_AUDIENCE")),
                    Set.of(WorkloadIdentity.canonical(required(env, "CONTOSO_STOREFRONT_CLIENT_ID"))),
                    env.getOrDefault("CONTOSO_DELEGATED_SCOPE", "Orders.Invoke"),
                    Set.of(gateway), Set.of(portal), Set.of(portal), runControllers, "Portal.Invoke");
            }
            if ("contoso-inventory-api".equals(serviceName)) {
                WorkloadIdentity orders = workload(env, "ORDERS");
                return new AuthorizationPolicy(serviceName, audiences(required(env, "CONTOSO_INVENTORY_AUDIENCE")),
                    Set.of(), Set.of(), "Orders.Invoke", Set.of(), Set.of(orders), Set.of(orders), Set.of(), "Inventory.Invoke");
            }
            throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
        } catch (Exception ignored) { throw new IllegalStateException("AUTH_CONFIGURATION_INVALID"); }
    }

    public VerifiedCaller authenticate(String authorization, String gatewayAuthorization) {
        if (closed) throw new SecurityException("AUTHENTICATION_REJECTED");
        try {
            boolean orders = policy.serviceName().equals("contoso-orders-api");
            if (orders) {
                var gateway = verifier.verify(gatewayAuthorization, policy.gatewayAudiences());
                if (!gateway.appOnly() || !gateway.roles().contains("Gateway.Invoke") ||
                        !policy.gateways().contains(gateway.workload())) reject();
            } else if (gatewayAuthorization != null) reject();
            var caller = verifier.verify(authorization, policy.callerAudiences());
            if (caller.appOnly()) {
                WorkloadIdentity identity = caller.workload();
                if (!policy.callerWorkloads().contains(identity) || !caller.roles().contains(policy.callerWorkloadRole())) reject();
                boolean controls = caller.roles().contains("Demo.Control") && policy.runControllers().contains(identity);
                return new VerifiedCaller("workload", null, policy.invocationIssuers().contains(identity),
                    controls, caller.roles());
            }
            if (!orders || !caller.hasScopes() || !caller.scopes().contains(policy.delegatedScope()) ||
                    !policy.delegatedClientIds().contains(caller.clientId())) reject();
            String pseudonym = pseudonymizer.pseudonymize(caller.tenant(), caller.objectId());
            return new VerifiedCaller("user", pseudonym, true, caller.roles().contains("Demo.Control"), caller.roles());
        } catch (Exception ignored) { throw new SecurityException("AUTHENTICATION_REJECTED"); }
    }

    private static Set<String> audiences(String value) {
        return AuthorizationPolicy.audiences(Set.copyOf(Arrays.asList(value.split(",", -1))));
    }
    private static WorkloadIdentity workload(Map<String, String> env, String name) {
        return new WorkloadIdentity(required(env, "CONTOSO_" + name + "_CLIENT_ID"),
            required(env, "CONTOSO_" + name + "_OBJECT_ID"));
    }
    private static String required(Map<String, String> env, String name) {
        String value = env.get(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("AUTH_CONFIGURATION_MISSING");
        return value;
    }
    private static void reject() { throw new SecurityException("AUTHENTICATION_REJECTED"); }
    @Override public void close() {
        closed = true;
        verifier.close();
        if (pseudonymizer != null) pseudonymizer.close();
    }
    @Override public String toString() { return "RequestAuthenticator[" + policy.serviceName() + ",redacted]"; }
}
