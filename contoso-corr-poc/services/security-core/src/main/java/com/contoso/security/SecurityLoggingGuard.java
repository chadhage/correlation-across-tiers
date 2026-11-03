package com.contoso.security;

import java.util.List;
import org.slf4j.LoggerFactory;

public final class SecurityLoggingGuard {
    private static final List<String> PACKAGES = List.of(
        "com.azure.identity", "com.azure.security.keyvault.secrets", "com.azure.core", "com.microsoft.aad.msal4j");
    private SecurityLoggingGuard() {}

    public static void verify() {
        try {
            Object context = LoggerFactory.getILoggerFactory();
            if (!"ch.qos.logback.classic.LoggerContext".equals(context.getClass().getName())) reject();
            var loggerMethod = context.getClass().getMethod("getLogger", String.class);
            for (String name : PACKAGES) requireOff(loggerMethod.invoke(context, name));
            for (Object logger : (List<?>) context.getClass().getMethod("getLoggerList").invoke(context)) {
                String name = (String) logger.getClass().getMethod("getName").invoke(logger);
                if (PACKAGES.stream().anyMatch(prefix -> name.equals(prefix) || name.startsWith(prefix + "."))) requireOff(logger);
            }
            if (!System.getProperty("jdk.httpclient.HttpClient.log", "").isBlank()) reject();
        } catch (Exception ignored) { throw new IllegalStateException("SECURITY_LOGGING_UNSAFE"); }
    }
    private static void requireOff(Object logger) throws ReflectiveOperationException {
        Object level = logger.getClass().getMethod("getEffectiveLevel").invoke(logger);
        if (!"OFF".equals(String.valueOf(level))) reject();
    }
    private static void reject() { throw new IllegalStateException("SECURITY_LOGGING_UNSAFE"); }
}
