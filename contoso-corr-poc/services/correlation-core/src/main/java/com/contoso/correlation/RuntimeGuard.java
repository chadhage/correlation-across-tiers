package com.contoso.correlation;

import java.io.InputStream;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.time.Instant;
import java.time.Duration;

public final class RuntimeGuard {
    public static final String AGENT_VERSION = "3.7.10";
    public static final String AGENT_SHA256 = "93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec";
    public static final List<String> MANUAL_MODULES = List.of("jdbc", "jdbc-datasource", "lettuce", "jedis",
        "redisson", "azure-core", "ai-azure-functions");
    private RuntimeGuard() {}

    public static void verify(String serviceName) {
        verify(serviceName, Thread.currentThread().getContextClassLoader());
    }

    public static void verify(String serviceName, ClassLoader applicationLoader) {
        verifyLauncherOptions(System.getenv());
        List<String> arguments = ManagementFactory.getRuntimeMXBean().getInputArguments();
        verifyAgentArguments(arguments);
        String agentArgument = arguments.stream().filter(a -> a.startsWith("-javaagent:")).findFirst().orElseThrow();
        String file = agentArgument.substring("-javaagent:".length()).split("=", 2)[0];
        try (InputStream input = Files.newInputStream(Path.of(file))) {
            var hash = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) hash.update(buffer, 0, read);
            if (!AGENT_SHA256.equals(HexFormat.of().formatHex(hash.digest()))) {
                throw new IllegalStateException("GATE_02_AGENT_CHECKSUM");
            }
        } catch (IllegalStateException failure) { throw failure; }
        catch (Exception failure) { throw new IllegalStateException("GATE_02_AGENT_UNREADABLE"); }
        RuntimeClasspathGuard.verify(applicationLoader);
        verifyConfiguration(System.getenv(), serviceName);
        verifyConfigurationSources(System.getenv());
        ExtensionGuard.verify(applicationLoader);
        for (String module : MANUAL_MODULES) {
            if (!"false".equalsIgnoreCase(System.getProperty("otel.instrumentation." + module + ".enabled"))) {
                throw new IllegalStateException("GATE_02_EXPLICIT_NATIVE_SUPPRESSION");
            }
        }
        SamplingRuntime.initialize(serviceName, verifyNativeSampling(System.getenv(), serviceName));
    }

    public interface WorkPermit extends AutoCloseable { @Override void close(); }
    public static WorkPermit admitWork() { return SamplingRuntime.admitWork(); }

    public static void verifyLauncherOptions(Map<String, String> environment) {
        for (String key : List.of("JDK_JAVA_OPTIONS", "_JAVA_OPTIONS")) {
            if (!environment.getOrDefault(key, "").isEmpty()) {
                throw new IllegalStateException("GATE_02_UNAPPROVED_LAUNCHER_OPTIONS");
            }
        }
    }

    public static void verifyAgentArguments(List<String> arguments) {
        List<String> agents = arguments.stream().filter(a -> a.startsWith("-javaagent:")).toList();
        if (agents.size() != 1 || agents.getFirst().contains("=") ||
            !Path.of(agents.getFirst().substring("-javaagent:".length())).getFileName().toString()
                .equals("applicationinsights-agent-3.7.10.jar")) {
            throw new IllegalStateException("GATE_02_SINGLE_PINNED_AGENT");
        }
    }

    public static void verifyConfiguration(Map<String, String> env, String serviceName) {
        if (!serviceName.equals(env.get("APPLICATIONINSIGHTS_ROLE_NAME")) ||
            !serviceName.equals(env.get("OTEL_SERVICE_NAME"))) {
            throw new IllegalStateException("GATE_02_ROLE_MAPPING");
        }
        for (String suffix : List.of("JDBC", "REDIS", "AZURE_SDK")) {
            if (!"false".equalsIgnoreCase(env.get("APPLICATIONINSIGHTS_INSTRUMENTATION_" + suffix + "_ENABLED"))) {
                throw new IllegalStateException("GATE_02_MANUAL_OWNERSHIP");
            }
        }
        if ("false".equalsIgnoreCase(env.get("APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_MASKING_ENABLED"))) {
            throw new IllegalStateException("GATE_02_MASKING");
        }
        if (!"INFO".equalsIgnoreCase(env.getOrDefault("APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL", "INFO")) &&
            !"WARN".equalsIgnoreCase(env.get("APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL"))) {
            throw new IllegalStateException("GATE_02_DIAGNOSTICS");
        }
        if (Boolean.parseBoolean(env.getOrDefault("CONTOSO_CERTIFICATION_MODE", "false"))) {
            throw new IllegalStateException("VERIFY_LIVE_PARENT_SAFE_CERTIFICATION");
        }
        for (var entry : env.entrySet()) {
            if (List.of("APPLICATIONINSIGHTS_ENABLE_AGENT", "INITIALIZED_FROM_PLACEHOLDER",
                "JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY").contains(entry.getKey().toUpperCase(java.util.Locale.ROOT)) &&
                !"false".equalsIgnoreCase(entry.getValue()) && !entry.getValue().isBlank()) {
                throw new IllegalStateException("GATE_02_PLATFORM_ATTACHMENT");
            }
            if ("APPLICATIONINSIGHTSAGENT_EXTENSION_VERSION".equals(entry.getKey().toUpperCase(java.util.Locale.ROOT)) &&
                !entry.getValue().isBlank() && !"disabled".equalsIgnoreCase(entry.getValue())) {
                throw new IllegalStateException("GATE_02_PLATFORM_ATTACHMENT");
            }
        }
    }

    public static void verifyConfigurationSources(Map<String, String> env) {
        verifyNativeInstrumentationOverrides(env);
        if (env.keySet().stream().anyMatch(key -> key.startsWith("OTEL_EXPORTER_OTLP_")) ||
            env.containsKey("OTEL_TRACES_SAMPLER") || env.containsKey("OTEL_TRACES_SAMPLER_ARG") ||
            env.containsKey("OTEL_JAVAAGENT_EXTENSIONS") ||
            (!env.getOrDefault("OTEL_TRACES_EXPORTER", "none").equals("none"))) {
            throw new IllegalStateException("GATE_02_EXTRA_EXPORTER_OR_EXTENSION");
        }

        if (env.containsKey("APPLICATIONINSIGHTS_CONFIGURATION_CONTENT") ||
            System.getProperty("applicationinsights.configuration.content") != null) {
            throw new IllegalStateException("GATE_02_INLINE_CONFIG");
        }
        if (env.keySet().stream().anyMatch(key -> key.startsWith("APPLICATIONINSIGHTS_SAMPLING_")) ||
            System.getProperties().stringPropertyNames().stream().anyMatch(key -> key.startsWith("applicationinsights.sampling."))) {
            throw new IllegalStateException("GATE_02_SAMPLING_OVERRIDE");
        }
        for (String field : List.of("jdbc", "redis", "azureSdk")) {
            String value = System.getProperty("applicationinsights.instrumentation." + field + ".enabled");
            if (value != null && !value.equalsIgnoreCase("false")) {
                throw new IllegalStateException("GATE_02_SYSTEM_OVERRIDE");
            }
        }
        String path = env.get("APPLICATIONINSIGHTS_CONFIGURATION_FILE");
        if (path == null || System.getProperty("applicationinsights.configuration.file") != null) {
            throw new IllegalStateException("GATE_02_CONFIG_FILE");
        }
        try {
            String sampling = env.getOrDefault("CONTOSO_SAMPLING_LEASE_FILE", "").isBlank() ?
                "\"requestsPerSecond\":5,\"overrides\":[]" : "\"percentage\":100,\"overrides\":[]";
            String expected = "{\"sampling\":{" + sampling + "},\"instrumentation\":{" +
                "\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false,\"masking\":{\"enabled\":true}}," +
                "\"redis\":{\"enabled\":false},\"logging\":{\"level\":\"INFO\"}}," +
                "\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"}}";
            if (!canonical(expected).equals(canonical(Files.readString(Path.of(path))))) {
                throw new IllegalStateException("GATE_02_CONFIG_DRIFT");
            }
        } catch (IllegalStateException failure) { throw failure; }
        catch (Exception failure) { throw new IllegalStateException("GATE_02_CONFIG_UNREADABLE"); }
    }

    private static SamplingLease verifyNativeSampling(Map<String, String> env, String serviceName) {
        var inventory = ExtensionGuard.inventory();
        String observed = SamplingRuntime.nativeOwnedConfiguration(inventory);
        String leasePath = env.get("CONTOSO_SAMPLING_LEASE_FILE");
        SamplingLease lease = null;
        try {
            String expected = SamplingLease.canonical(SamplingLease.JSON.readTree(
                leasePath == null || leasePath.isBlank() ? SamplingLease.BASELINE : SamplingLease.BOUNDED_FULL));
            if (!expected.equals(observed)) throw new IllegalStateException();
            if (leasePath != null && !leasePath.isBlank()) {
                lease = SamplingLease.load(Path.of(leasePath), Path.of(env.get("APPLICATIONINSIGHTS_CONFIGURATION_FILE")),
                    serviceName, inventory, Instant.now());
            }
        } catch (Exception failure) { throw new IllegalStateException("GATE_02_NATIVE_SAMPLING_OR_LEASE"); }
        return lease;
    }

    public static void verifyNativeInstrumentationOverrides(Map<String, String> environment) {
        if ("false".equalsIgnoreCase(System.getProperty("otel.javaagent.enabled")) ||
            "false".equalsIgnoreCase(environment.get("OTEL_JAVAAGENT_ENABLED")) ||
            "true".equalsIgnoreCase(System.getProperty("otel.sdk.disabled")) ||
            "true".equalsIgnoreCase(environment.get("OTEL_SDK_DISABLED"))) {
            throw new IllegalStateException("GATE_02_NATIVE_INSTRUMENTATION_OVERRIDE");
        }
        if ("false".equalsIgnoreCase(System.getProperty("otel.instrumentation.common.default-enabled")) ||
            "false".equalsIgnoreCase(environment.get("OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED"))) {
            throw new IllegalStateException("GATE_05_REQUIRED_HTTP_INSTRUMENTATION");
        }
        for (String key : System.getProperties().stringPropertyNames()) {
            if (key.startsWith("otel.instrumentation.") && key.endsWith(".enabled")) {
                String module = key.substring("otel.instrumentation.".length(), key.length() - ".enabled".length());
                if (manualOwnerModule(module) && !"false".equalsIgnoreCase(System.getProperty(key))) {
                    throw new IllegalStateException("GATE_02_NATIVE_INSTRUMENTATION_OVERRIDE");
                }
                if (requiredHttpModule(module) && !"true".equalsIgnoreCase(System.getProperty(key))) {
                    throw new IllegalStateException("GATE_05_REQUIRED_HTTP_INSTRUMENTATION");
                }
            }
        }
        for (var entry : environment.entrySet()) {
            if (entry.getKey().startsWith("OTEL_INSTRUMENTATION_") && entry.getKey().endsWith("_ENABLED")) {
                String module = entry.getKey().substring("OTEL_INSTRUMENTATION_".length(),
                    entry.getKey().length() - "_ENABLED".length()).toLowerCase(java.util.Locale.ROOT).replace('_', '-');
                if (manualOwnerModule(module) && !"false".equalsIgnoreCase(entry.getValue())) {
                    throw new IllegalStateException("GATE_02_NATIVE_INSTRUMENTATION_OVERRIDE");
                }
                if (requiredHttpModule(module) && !"true".equalsIgnoreCase(entry.getValue())) {
                    throw new IllegalStateException("GATE_05_REQUIRED_HTTP_INSTRUMENTATION");
                }
            }
        }
    }

    private static boolean manualOwnerModule(String module) {
        return module.matches("(jdbc|lettuce|jedis|redisson|azure-core|azure-sdk|ai-azure-functions)([.-].*)?");
    }

    private static boolean requiredHttpModule(String module) {
        return module.matches("(java-http-client|okhttp|netty|reactor-netty|servlet|tomcat|spring-webmvc|common-default)([.-].*)?");
    }

    private static String canonical(String json) {
        try { return SamplingLease.canonical(SamplingLease.JSON.readTree(json)); }
        catch (Exception failure) { throw new IllegalStateException("GATE_02_CONFIG_PARSE"); }
    }

    public static void requireRunWindow(Map<String, String> env, Instant now) {
        try {
            Instant start = Instant.parse(env.get("CONTOSO_CERT_START"));
            Instant end = Instant.parse(env.get("CONTOSO_CERT_END"));
            if (!end.isAfter(start) || Duration.between(start, end).compareTo(Duration.ofHours(1)) > 0 ||
                now.isBefore(start) || !now.isBefore(end) ||
                env.getOrDefault("CONTOSO_CERT_WINDOW_ID", "").isBlank()) {
                throw new SecurityException("RUN_WINDOW_CLOSED");
            }
        } catch (SecurityException failure) { throw failure; }
        catch (Exception failure) { throw new SecurityException("RUN_WINDOW_CLOSED"); }
    }
}
