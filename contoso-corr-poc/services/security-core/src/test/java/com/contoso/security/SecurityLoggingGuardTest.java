package com.contoso.security;

import static org.junit.jupiter.api.Assertions.*;
import ch.qos.logback.classic.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class SecurityLoggingGuardTest {
    @Test void sdkWarningErrorOrChildOverrideCannotLeakDespiteDisabledHttpLogging() {
        var context = (LoggerContext) LoggerFactory.getILoggerFactory();
        List<String> names = List.of("com.azure.identity", "com.azure.security.keyvault.secrets",
            "com.azure.core", "com.microsoft.aad.msal4j", "com.azure.identity.guardCanary");
        Map<String, Level> levels = new HashMap<>();
        names.forEach(name -> levels.put(name, context.getLogger(name).getLevel()));
        try {
            names.forEach(name -> context.getLogger(name).setLevel(Level.OFF));
            SecurityLoggingGuard.verify();
            context.getLogger("com.azure.identity").setLevel(Level.ERROR);
            var failure = assertThrows(IllegalStateException.class, SecurityLoggingGuard::verify);
            assertEquals("SECURITY_LOGGING_UNSAFE", failure.getMessage());
            assertNull(failure.getCause());
            context.getLogger("com.azure.identity").setLevel(Level.OFF);
            context.getLogger("com.azure.identity.guardCanary").setLevel(Level.DEBUG);
            assertThrows(IllegalStateException.class, SecurityLoggingGuard::verify);
        } finally { levels.forEach((name, level) -> context.getLogger(name).setLevel(level)); }
    }
}
