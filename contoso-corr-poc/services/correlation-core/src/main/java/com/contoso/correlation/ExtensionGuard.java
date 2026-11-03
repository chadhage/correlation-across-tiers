package com.contoso.correlation;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Properties;
import java.util.zip.ZipFile;

public final class ExtensionGuard {
    private ExtensionGuard() {}

    static Properties inventory() {
        Properties inventory = new Properties();
        try (InputStream source = ExtensionGuard.class.getResourceAsStream("/contoso-parent-safe-sampler.properties")) {
            if (source == null) fail("UNFROZEN");
            inventory.load(source);
        } catch (Exception failure) { fail("UNFROZEN"); }
        return inventory;
    }

    public static void verify(ClassLoader... applicationLoaders) {
        Properties inventory = inventory();
        String configured = System.getProperty(inventory.getProperty("loaderProperty", "otel.javaagent.extensions"));
        if (configured == null) {
            if (Boolean.parseBoolean(inventory.getProperty("required", "false"))) fail("REQUIRED");
            return;
        }
        String expectedHash = inventory.getProperty("sha256", "");
        String provider = inventory.getProperty("providerClass", "");
        if (!expectedHash.matches("[0-9a-f]{64}") || provider.isBlank() ||
            configured.contains(",") || configured.contains(";") ||
            !"1.65.0".equals(inventory.getProperty("sdkAbi"))) fail("UNFROZEN");
        Path jar = Path.of(configured);
        if (!jar.getFileName().toString().equals(inventory.getProperty("artifactId") + "-" + inventory.getProperty("version") + ".jar")) fail("ARTIFACT");
        RuntimeClasspathGuard.verify(applicationLoaders);
        RuntimeClasspathGuard.reject(java.util.List.of(provider.replace('.', '/') + ".class"),
            "GATE_02_EXTENSION_APPLICATION_CLASSLOADER", applicationLoaders);
        try (InputStream input = Files.newInputStream(jar)) {
            var sha = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) sha.update(buffer, 0, count);
            if (!expectedHash.equals(HexFormat.of().formatHex(sha.digest()))) fail("HASH");
        } catch (Exception failure) { fail("HASH"); }
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            var entries = zip.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                if (name.startsWith("io/opentelemetry/") || name.endsWith(".jar") ||
                    (name.endsWith(".class") && !name.startsWith("com/contoso/"))) fail("BUNDLED_RUNTIME");
            }
            var service = zip.getEntry("META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider");
            if (service == null) fail("SPI");
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(zip.getInputStream(service)))) {
                var providers = reader.lines().map(String::trim).filter(line -> !line.isBlank() && !line.startsWith("#")).toList();
                if (providers.size() != 1 || !provider.equals(providers.getFirst())) fail("SPI");
            }
        } catch (Exception failure) { fail("SPI"); }
    }

    private static void fail(String code) { throw new IllegalStateException("GATE_02_EXTENSION_" + code); }
}
