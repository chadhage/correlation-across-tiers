package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RuntimeGuardTest {
    @Test void nativeSystemAndEnvironmentEnablesCannotDuplicateManualDataSpans() {
        for (String module : java.util.List.of("jdbc", "jdbc-datasource", "lettuce", "lettuce-5.1",
                "jedis", "redisson", "azure-core", "ai-azure-functions")) {
            String key = "otel.instrumentation." + module + ".enabled";
            System.setProperty(key, "true");
            try {
                assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
            } finally { System.clearProperty(key); }
        }
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyNativeInstrumentationOverrides(
            Map.of("OTEL_INSTRUMENTATION_LETTUCE_ENABLED", "true")));
        assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(
            Map.of("OTEL_INSTRUMENTATION_JDBC_ENABLED", "false")));
    }
    @Test void ineffectiveOkHttpDisableCannotReplaceHeaderIsolation() {
        assertFalse(RuntimeGuard.MANUAL_MODULES.contains("okhttp"));
        assertFalse(RuntimeGuard.MANUAL_MODULES.contains("java-http-client"));
        for (String module : List.of("okhttp", "okhttp-3.0", "okhttp-2.2")) {
            String key = "otel.instrumentation." + module + ".enabled";
            String previous = System.getProperty(key);
            try {
                System.setProperty(key, "false");
                var failure = assertThrows(IllegalStateException.class,
                    () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
                assertEquals("GATE_05_REQUIRED_HTTP_INSTRUMENTATION", failure.getMessage());
                System.setProperty(key, "true");
                assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
            } finally {
                if (previous == null) System.clearProperty(key);
                else System.setProperty(key, previous);
            }
        }
        for (String key : List.of("OTEL_INSTRUMENTATION_OKHTTP_ENABLED",
                "OTEL_INSTRUMENTATION_OKHTTP_3_0_ENABLED")) {
            assertThrows(IllegalStateException.class,
                () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of(key, "false")));
            assertDoesNotThrow(
                () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of(key, "true")));
        }
        String key = "otel.instrumentation.java-http-client.enabled";
        String previous = System.getProperty(key);
        try {
            System.setProperty(key, "false");
            var failure = assertThrows(IllegalStateException.class,
                () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
            assertEquals("GATE_05_REQUIRED_HTTP_INSTRUMENTATION", failure.getMessage());
            System.setProperty(key, "true");
            assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
        } finally {
            if (previous == null) System.clearProperty(key);
            else System.setProperty(key, previous);
        }
    }
    @Test void businessNettyAndCommonDefaultsCannotBeDisabled() {
        for (String module : List.of("netty", "netty-4.1", "reactor-netty",
                "reactor-netty-1.0")) {
            String key = "otel.instrumentation." + module + ".enabled";
            String previous = System.getProperty(key);
            try {
                System.setProperty(key, "false");
                var failure = assertThrows(IllegalStateException.class,
                    () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
                assertEquals("GATE_05_REQUIRED_HTTP_INSTRUMENTATION", failure.getMessage());
                System.setProperty(key, "true");
                assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
            } finally {
                if (previous == null) System.clearProperty(key);
                else System.setProperty(key, previous);
            }
        }
        for (String key : List.of("OTEL_INSTRUMENTATION_NETTY_ENABLED",
                "OTEL_INSTRUMENTATION_NETTY_4_1_ENABLED",
                "OTEL_INSTRUMENTATION_REACTOR_NETTY_ENABLED",
                "OTEL_INSTRUMENTATION_REACTOR_NETTY_1_0_ENABLED",
                "OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED")) {
            var failure = assertThrows(IllegalStateException.class,
                () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of(key, "false")));
            assertEquals("GATE_05_REQUIRED_HTTP_INSTRUMENTATION", failure.getMessage());
            assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of(key, "true")));
        }
        String key = "otel.instrumentation.common.default-enabled";
        String previous = System.getProperty(key);
        try {
            System.setProperty(key, "false");
            var failure = assertThrows(IllegalStateException.class,
                () -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
            assertEquals("GATE_05_REQUIRED_HTTP_INSTRUMENTATION", failure.getMessage());
            System.setProperty(key, "true");
            assertDoesNotThrow(() -> RuntimeGuard.verifyNativeInstrumentationOverrides(Map.of()));
        } finally {
            if (previous == null) System.clearProperty(key);
            else System.setProperty(key, previous);
        }
    }
    @Test void falsePropertyCannotDisableProductionGuard() {
        System.setProperty("contoso.requireAgent", "false");
        try { assertThrows(IllegalStateException.class, () -> RuntimeGuard.verify("contoso-orders-api")); }
        finally { System.clearProperty("contoso.requireAgent"); }
    }

    @Test void implicitJdkLauncherVariablesAreRejected() {
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyLauncherOptions(
            Map.of("JDK_JAVA_OPTIONS", "-Dcontoso.requireAgent=false")));
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyLauncherOptions(
            Map.of("_JAVA_OPTIONS", "-javaagent:unapproved.jar")));
        assertDoesNotThrow(() -> RuntimeGuard.verifyLauncherOptions(Map.of()));
    }
    @Test void seededDuplicateAgentAndMissingAgentFail() {
        String agent = "-javaagent:applicationinsights-agent-3.7.10.jar";
        assertDoesNotThrow(() -> RuntimeGuard.verifyAgentArguments(List.of(agent)));
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyAgentArguments(List.of(agent, agent)));
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyAgentArguments(List.of()));
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyAgentArguments(List.of("-javaagent:other.jar")));
    }

    @Test void conflictingCaptureAndCertificationFailClosed() {
        var env = new HashMap<>(Map.of("OTEL_SERVICE_NAME", "contoso-orders-api",
            "APPLICATIONINSIGHTS_ROLE_NAME", "contoso-orders-api",
            "APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED", "false",
            "APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED", "false",
            "APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED", "false"));
        assertDoesNotThrow(() -> RuntimeGuard.verifyConfiguration(env, "contoso-orders-api"));
        env.put("APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED", "true");
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyConfiguration(env, "contoso-orders-api"));
        env.put("APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED", "false");
        env.put("CONTOSO_CERTIFICATION_MODE", "true");
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyConfiguration(env, "contoso-orders-api"));
    }

    @Test void inlineAndSystemOverridesCannotBypassPolicy() {
        assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyConfigurationSources(
            Map.of("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT", "{\"instrumentation\":{\"jdbc\":{\"enabled\":true}}}")));
        System.setProperty("applicationinsights.instrumentation.jdbc.enabled", "true");
        try {
            assertThrows(IllegalStateException.class, () -> RuntimeGuard.verifyConfigurationSources(Map.of()));
        } finally { System.clearProperty("applicationinsights.instrumentation.jdbc.enabled"); }
    }

    @Test void windowIsBoundedAndCannotReplaceAuthorization() {
        var now = java.time.Instant.parse("2026-10-31T23:00:00Z");
        var env = Map.of("CONTOSO_CERT_START", "2026-10-31T22:45:00Z",
            "CONTOSO_CERT_END", "2026-10-31T23:15:00Z", "CONTOSO_CERT_WINDOW_ID", "synthetic-window");
        assertDoesNotThrow(() -> RuntimeGuard.requireRunWindow(env, now));
        assertThrows(SecurityException.class, () -> RuntimeGuard.requireRunWindow(Map.of(), now));
        assertThrows(SecurityException.class, () -> RuntimeGuard.requireRunWindow(env, now.plusSeconds(3600)));
        assertThrows(SecurityException.class, () -> RuntimeGuard.requireRunWindow(
            Map.of("CONTOSO_CERT_START", "2026-10-31T22:00:00Z", "CONTOSO_CERT_END", "2026-11-01T02:00:00Z",
                "CONTOSO_CERT_WINDOW_ID", "synthetic-window"), now));
    }
}
