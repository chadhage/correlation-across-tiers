package com.contoso.security;

import java.net.URI;

public record SecretVersionReference(URI uri) {
    public SecretVersionReference {
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getHost() == null ||
                !uri.getHost().matches("[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\\.vault\\.azure\\.net") ||
                uri.getUserInfo() != null || uri.getPort() != -1 || uri.getQuery() != null ||
                uri.getFragment() != null || !uri.getRawPath().matches("/secrets/[A-Za-z0-9-]{1,127}/[0-9a-f]{32}"))
            throw new IllegalArgumentException("SECRET_REFERENCE_INVALID");
    }
    public static SecretVersionReference parse(String value) {
        try { return new SecretVersionReference(URI.create(value)); }
        catch (Exception ignored) { throw new IllegalArgumentException("SECRET_REFERENCE_INVALID"); }
    }
    public URI vaultUri() { return URI.create("https://" + uri.getHost()); }
    public String secretName() { return uri.getPath().split("/")[2]; }
    public String version() { return uri.getPath().split("/")[3]; }
    @Override public String toString() { return "SecretVersionReference[version=" + version() + "]"; }
}
