package com.contoso.inventory.data;

import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenCredential;
import com.azure.core.credential.TokenRequestContext;
import com.contoso.correlation.data.DataAccessException;
import com.contoso.correlation.data.DataErrorKind;
import com.contoso.correlation.data.DataErrors;
import com.microsoft.aad.msal4j.IAccount;
import com.microsoft.aad.msal4j.IAuthenticationResult;
import com.microsoft.aad.msal4j.ITenantProfile;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.Objects;
import java.util.function.Supplier;

final class RedisEntraIdAuthenticationSupplier implements Supplier<IAuthenticationResult> {
    static final String SCOPE = "https://redis.azure.com/.default";
    private final TokenCredential credential;
    private final Clock clock;
    private final Duration budget;

    RedisEntraIdAuthenticationSupplier(TokenCredential credential) {
        this(credential, Clock.systemUTC(), Duration.ofSeconds(3));
    }

    RedisEntraIdAuthenticationSupplier(TokenCredential credential, Clock clock, Duration budget) {
        this.credential = Objects.requireNonNull(credential);
        this.clock = Objects.requireNonNull(clock);
        if (budget == null || budget.isZero() || budget.isNegative() || budget.compareTo(Duration.ofSeconds(3)) > 0) {
            throw new IllegalArgumentException("invalid_identity_budget");
        }
        this.budget = budget;
    }

    @Override public IAuthenticationResult get() {
        DataLoggingGuard.verify();
        try {
            AccessToken token = credential.getToken(new TokenRequestContext().addScopes(SCOPE))
                .timeout(budget).block(budget);
            if (token == null || token.getToken() == null || token.getToken().isBlank() ||
                !token.getExpiresAt().toInstant().isAfter(clock.instant().plusSeconds(60))) {
                throw new DataAccessException(DataErrorKind.AUTHENTICATION, false);
            }
            return new IAuthenticationResult() {
                @Override public String accessToken() { return token.getToken(); }
                @Override public String idToken() { return null; }
                @Override public IAccount account() { return null; }
                @Override public ITenantProfile tenantProfile() { return null; }
                @Override public String environment() { return "login.microsoftonline.com"; }
                @Override public String scopes() { return SCOPE; }
                @Override public Date expiresOnDate() { return Date.from(token.getExpiresAt().toInstant()); }
                @Override public String toString() { return "RedisAuthenticationResult[redacted]"; }
            };
        } catch (DataAccessException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            DataErrorKind kind = DataErrors.classify(failure);
            throw new DataAccessException(kind == DataErrorKind.TIMEOUT || kind == DataErrorKind.CANCELLED
                ? kind : DataErrorKind.AUTHENTICATION, false);
        }
    }

    @Override public String toString() { return "RedisEntraIdAuthenticationSupplier[redacted]"; }
}
