package com.contoso.inventory.data;

import java.util.List;
import org.slf4j.LoggerFactory;

final class DataLoggingGuard {
    private DataLoggingGuard() {}

    static void verify() {
        for (String name : List.of("org.postgresql", "com.zaxxer.hikari", "io.lettuce.core.protocol",
            "redis.clients.authentication", "com.azure.identity", "com.microsoft.aad.msal4j")) {
            if (LoggerFactory.getLogger(name).isDebugEnabled()) {
                throw new IllegalStateException("unsafe_data_logging_configuration");
            }
        }
        java.util.logging.Logger driver = java.util.logging.Logger.getLogger("org.postgresql");
        if (driver.isLoggable(java.util.logging.Level.FINE)) {
            throw new IllegalStateException("unsafe_data_logging_configuration");
        }
    }
}
