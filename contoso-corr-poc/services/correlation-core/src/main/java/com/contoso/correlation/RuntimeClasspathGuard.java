package com.contoso.correlation;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

public final class RuntimeClasspathGuard {
    private RuntimeClasspathGuard() {}

    public static void verify(ClassLoader... applicationLoaders) {
        reject(List.of(
            "io/opentelemetry/sdk/trace/SdkTracerProvider.class",
            "io/opentelemetry/sdk/metrics/SdkMeterProvider.class",
            "io/opentelemetry/sdk/logs/SdkLoggerProvider.class",
            "io/opentelemetry/sdk/common/CompletableResultCode.class",
            "io/opentelemetry/sdk/autoconfigure/spi/AutoConfigurationCustomizerProvider.class",
            "com/microsoft/applicationinsights/TelemetryClient.class"),
            "GATE_02_APPLICATION_SDK", applicationLoaders);
    }

    public static void reject(List<String> resources, String failureCode, ClassLoader... applicationLoaders) {
        Set<ClassLoader> loaders = Collections.newSetFromMap(new IdentityHashMap<>());
        add(loaders, ClassLoader.getSystemClassLoader());
        add(loaders, Thread.currentThread().getContextClassLoader());
        add(loaders, RuntimeClasspathGuard.class.getClassLoader());
        for (ClassLoader loader : applicationLoaders) add(loaders, loader);
        for (ClassLoader loader : loaders) {
            for (String resource : resources) {
                if (loader.getResource(resource) != null) throw new IllegalStateException(failureCode);
            }
        }
    }

    private static void add(Set<ClassLoader> loaders, ClassLoader loader) {
        if (loader != null) loaders.add(loader);
    }
}
