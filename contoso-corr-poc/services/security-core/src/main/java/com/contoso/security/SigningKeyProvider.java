package com.contoso.security;

import com.nimbusds.jose.jwk.RSAKey;

@FunctionalInterface
public interface SigningKeyProvider extends AutoCloseable {
    RSAKey key(String keyId, String expectedIssuer);
    @Override default void close() {}
}
