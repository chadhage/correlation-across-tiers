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
    }

    public static void verifyLauncherOptions(Map<String, String> environment) {
        for (String key : List.of("JDK_JAVA_OPTIONS", "_JAVA_OPTIONS")) {
            if (!environment.getOrDefault(key, "").isEmpty()) {
                throw new IllegalStateException("GATE_02_UNAPPROVED_LAUNCHER_OPTIONS");
            }
        }
    }

    public static void verifyAgentArguments(List<String> arguments) {
        List<String> agents = arguments.stream().filter(a -> a.startsWith("-javaagent:")).toList();
        if (agents.size() != 1 || !agents.getFirst().contains("applicationinsights-agent-3.7.10.jar")) {
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
            String expected = "{\"sampling\":{\"requestsPerSecond\":5},\"instrumentation\":{" +
                "\"azureSdk\":{\"enabled\":false},\"jdbc\":{\"enabled\":false,\"masking\":{\"enabled\":true}}," +
                "\"redis\":{\"enabled\":false},\"logging\":{\"level\":\"INFO\"}}," +
                "\"selfDiagnostics\":{\"level\":\"WARN\",\"destination\":\"console\"}}";
            if (!expected.equals(canonical(Files.readString(Path.of(path))))) {
                throw new IllegalStateException("GATE_02_CONFIG_DRIFT");
            }
        } catch (IllegalStateException failure) { throw failure; }
        catch (Exception failure) { throw new IllegalStateException("GATE_02_CONFIG_UNREADABLE"); }
    }

    public static void verifyNativeInstrumentationOverrides(Map<String, String> environment) {
        for (String key : System.getProperties().stringPropertyNames()) {
            if (key.startsWith("otel.instrumentation.") && key.endsWith(".enabled")) {
                String module = key.substring("otel.instrumentation.".length(), key.length() - ".enabled".length());
                if (manualOwnerModule(module) && !"false".equalsIgnoreCase(System.getProperty(key))) {
                    throw new IllegalStateException("GATE_02_NATIVE_INSTRUMENTATION_OVERRIDE");
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
            }
        }
    }

    private static boolean manualOwnerModule(String module) {
        return module.matches("(jdbc|lettuce|jedis|redisson|azure-core|azure-sdk|ai-azure-functions)([.-].*)?");
    }

    private static String canonical(String json) {
        var result = new StringBuilder();
        boolean quoted = false, escaped = false;
        for (char c : json.toCharArray()) {
            if (c == '"' && !escaped) quoted = !quoted;
            if (quoted || !Character.isWhitespace(c)) result.append(c);
            escaped = c == '\\' && !escaped;
        }
        return result.toString();
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
