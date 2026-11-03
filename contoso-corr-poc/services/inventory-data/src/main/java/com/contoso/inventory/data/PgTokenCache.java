package com.contoso.inventory.data;

import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenCredential;
import com.azure.core.credential.TokenRequestContext;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import java.time.Clock;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

final class PgTokenCache {
    static final String SCOPE = "https://ossrdbms-aad.database.windows.net/.default";
    private final TokenCredential credential;
    private final Clock clock;
    private final ReentrantLock refresh = new ReentrantLock();
    private volatile AccessToken cached;

    PgTokenCache(TokenCredential credential, Clock clock) {
        this.credential = Objects.requireNonNull(credential);
        this.clock = Objects.requireNonNull(clock);
    }

    void prepare(Duration budget) {
        if (usable()) return;
        long deadline = System.nanoTime() + budget.toNanos();
        boolean locked = false;
        try {
            locked = refresh.tryLock(Math.max(1, budget.toMillis()), TimeUnit.MILLISECONDS);
            if (!locked) throw new DataAccessException(DataErrorKind.TIMEOUT, false);
            if (usable()) return;
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new DataAccessException(DataErrorKind.TIMEOUT, false);
            AccessToken token = credential.getToken(new TokenRequestContext().addScopes(SCOPE))
                .timeout(Duration.ofNanos(remaining)).block(Duration.ofNanos(remaining));
            if (token == null || !token.getExpiresAt().toInstant().isAfter(clock.instant().plusSeconds(60))) {
                throw new DataAccessException(DataErrorKind.AUTHENTICATION, false);
            }
            cached = token;
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new DataAccessException(DataErrorKind.CANCELLED, false);
        } catch (DataAccessException failure) { throw failure; }
        catch (RuntimeException failure) {
            DataErrorKind kind = com.contoso.correlation.data.DataErrors.classify(failure);
            throw new DataAccessException(kind == DataErrorKind.TIMEOUT ? kind : DataErrorKind.AUTHENTICATION, false);
        } finally { if (locked) refresh.unlock(); }
    }

    String connectionPassword() {
        if (!usable()) throw new DataAccessException(DataErrorKind.AUTHENTICATION, false);
        return cached.getToken();
    }

    private boolean usable() {
        AccessToken token = cached;
        return token != null && token.getExpiresAt().toInstant().isAfter(clock.instant().plusSeconds(60));
    }

    @Override public String toString() { return "PgTokenCache[redacted]"; }
}
