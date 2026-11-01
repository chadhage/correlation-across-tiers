package com.contoso.security;

import java.util.Optional;
import java.util.Set;

// API shape only; no principal can be created or authenticated by this fixture.
public abstract class VerifiedCaller {
    public abstract String actorType();
    public abstract Optional<String> pseudonym();
    public abstract boolean trustedInvocationIssuer();
    public abstract boolean canControlRuns();
    public abstract Set<String> roles();
}
