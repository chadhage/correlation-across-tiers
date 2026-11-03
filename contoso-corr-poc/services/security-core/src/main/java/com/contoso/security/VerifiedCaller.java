package com.contoso.security;

import java.util.Optional;
import java.util.Set;

public final class VerifiedCaller {
    private final String actorType;
    private final Optional<String> pseudonym;
    private final boolean trustedInvocationIssuer;
    private final boolean canControlRuns;
    private final Set<String> roles;

    VerifiedCaller(String actorType, String pseudonym, boolean trustedInvocationIssuer,
                   boolean canControlRuns, Set<String> roles) {
        this.actorType = actorType;
        this.pseudonym = Optional.ofNullable(pseudonym);
        this.trustedInvocationIssuer = trustedInvocationIssuer;
        this.canControlRuns = canControlRuns;
        this.roles = Set.copyOf(roles);
    }

    public String actorType() { return actorType; }
    public Optional<String> pseudonym() { return pseudonym; }
    public boolean trustedInvocationIssuer() { return trustedInvocationIssuer; }
    public boolean canControlRuns() { return canControlRuns; }
    public Set<String> roles() { return roles; }
    @Override public String toString() { return "VerifiedCaller[" + actorType + ",redacted]"; }
}
