package com.contoso.messaging;

import org.slf4j.LoggerFactory;

public final class MessagingLoggingGuard {
    private MessagingLoggingGuard() {}
    public static void verify() {
        for (String name : java.util.List.of("com.azure", "com.azure.core", "com.azure.identity",
            "com.azure.messaging", "com.azure.storage", "com.microsoft.aad.msal4j")) {
            if (LoggerFactory.getLogger(name).isErrorEnabled()) {
                throw new IllegalStateException("unsafe_messaging_sdk_logging");
            }
        }
    }
}
