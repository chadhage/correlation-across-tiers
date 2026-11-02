package com.contoso.security;

import java.util.Set;
import java.util.stream.Collectors;

public record AuthorizationPolicy(
        String serviceName, Set<String> callerAudiences, Set<String> gatewayAudiences,
        Set<String> delegatedClientIds, String delegatedScope, Set<WorkloadIdentity> gateways,
        Set<WorkloadIdentity> callerWorkloads, Set<WorkloadIdentity> invocationIssuers,
        Set<WorkloadIdentity> runControllers, String callerWorkloadRole) {

    public AuthorizationPolicy {
        if (!Set.of("contoso-orders-api", "contoso-inventory-api").contains(serviceName))
            throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
        callerAudiences = audiences(callerAudiences);
        gatewayAudiences = gatewayAudiences.isEmpty() ? Set.of() : audiences(gatewayAudiences);
        delegatedClientIds = delegatedClientIds.stream().map(WorkloadIdentity::canonical).collect(Collectors.toUnmodifiableSet());
        gateways = Set.copyOf(gateways);
        callerWorkloads = Set.copyOf(callerWorkloads);
        invocationIssuers = Set.copyOf(invocationIssuers);
        runControllers = Set.copyOf(runControllers);
        if (callerWorkloads.isEmpty() || !callerWorkloads.containsAll(invocationIssuers) ||
                !callerWorkloads.containsAll(runControllers))
            throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
        if (serviceName.equals("contoso-orders-api")) {
            if (gateways.isEmpty() || gatewayAudiences.isEmpty() || delegatedClientIds.isEmpty() ||
                    !"Orders.Invoke".equals(delegatedScope) || !"Portal.Invoke".equals(callerWorkloadRole))
                throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
        } else if (!gateways.isEmpty() || !gatewayAudiences.isEmpty() || !delegatedClientIds.isEmpty() ||
                !runControllers.isEmpty() || !"Inventory.Invoke".equals(callerWorkloadRole)) {
            throw new IllegalArgumentException("AUTH_CONFIGURATION_INVALID");
        }
    }

    static Set<String> audiences(Set<String> values) {
        if (values == null || values.isEmpty() || values.size() > 4)
            throw new IllegalArgumentException("AUTH_AUDIENCE_INVALID");
        for (String value : values) {
            if (value == null || value.length() > 256 || !value.matches("[A-Za-z0-9:/._-]+"))
                throw new IllegalArgumentException("AUTH_AUDIENCE_INVALID");
        }
        return Set.copyOf(values);
    }

    @Override public String toString() { return "AuthorizationPolicy[" + serviceName + ",redacted]"; }
}
