package com.contoso.security;

import com.azure.core.credential.*;
import java.time.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

public final class BoundedTokenProvider implements AutoCloseable {
    private final TokenCredential credential;
    private final String scope;
    private final Clock clock;
    private final ReentrantLock lock = new ReentrantLock();
    private volatile AccessToken cached;
    private volatile boolean closed;

    public BoundedTokenProvider(TokenCredential credential, String scope, Clock clock) {
        if (credential == null || clock == null || scope == null || scope.length() > 300 ||
                !scope.matches("(?:https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._-]+)*|api://[A-Za-z0-9._-]+|[0-9a-fA-F-]{36})/\\.default"))
            throw new IllegalArgumentException("TOKEN_CONFIGURATION_INVALID");
        this.credential = credential;
        this.scope = scope;
        this.clock = clock;
    }

    public String token(Duration remaining) {
        if (closed || remaining == null || remaining.isNegative() || remaining.isZero())
            throw new SecurityException("TOKEN_UNAVAILABLE");
        long budget = (remaining.compareTo(Duration.ofSeconds(30)) > 0 ? Duration.ofSeconds(30) : remaining).toNanos();
        long deadline = System.nanoTime() + budget;
        AccessToken current = cached;
        if (usable(current)) return current.getToken();
        boolean acquired = false;
        try {
            acquired = lock.tryLock(budget, TimeUnit.NANOSECONDS);
            if (!acquired || closed || deadline - System.nanoTime() <= 0) throw new SecurityException("TOKEN_UNAVAILABLE");
            current = cached;
            if (usable(current)) return current.getToken();
            if (credential.getClass().getName().startsWith("com.azure.identity.")) SecurityLoggingGuard.verify();
            current = credential.getToken(new TokenRequestContext().addScopes(scope))
                .block(Duration.ofNanos(deadline - System.nanoTime()));
            if (closed || deadline - System.nanoTime() <= 0 || !usable(current)) throw new SecurityException("TOKEN_UNAVAILABLE");
            cached = current;
            return current.getToken();
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            throw new SecurityException("TOKEN_UNAVAILABLE");
        } catch (Exception ignored) { throw new SecurityException("TOKEN_UNAVAILABLE"); }
        finally { if (acquired) lock.unlock(); }
    }

    private boolean usable(AccessToken token) {
        return token != null && token.getToken() != null && !token.getToken().isBlank() &&
            token.getExpiresAt().toInstant().isAfter(clock.instant().plusSeconds(60));
    }
    @Override public void close() { closed = true; cached = null; }
    @Override public String toString() { return "BoundedTokenProvider[redacted]"; }
}
