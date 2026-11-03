package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.URL;
import org.junit.jupiter.api.Test;

class RuntimeClasspathGuardTest {
    private static final String SDK = "io/opentelemetry/sdk/trace/SdkTracerProvider.class";
    private ClassLoader resourceLoader(String blocked) {
        return new ClassLoader(ClassLoader.getSystemClassLoader()) {
            @Override public URL getResource(String name) {
                try { return name.equals(blocked) ? URI.create("file:/construction-only/BOOT-INF/classes/" + name).toURL() : super.getResource(name); }
                catch (Exception failure) { throw new IllegalStateException(failure); }
            }
        };
    }

    @Test void sdkVisibleOnlyInContextLoaderFails() {
        assertNull(ClassLoader.getSystemResource(SDK));
        var previous = Thread.currentThread().getContextClassLoader();
        try {
            Thread.currentThread().setContextClassLoader(resourceLoader(SDK));
            assertThrows(IllegalStateException.class, RuntimeClasspathGuard::verify);
        } finally { Thread.currentThread().setContextClassLoader(previous); }
    }

    @Test void explicitApplicationLoaderAndExtensionOnApplicationClasspathFail() {
        assertThrows(IllegalStateException.class, () -> RuntimeClasspathGuard.verify(resourceLoader(SDK)));
        String provider = "com/contoso/correlation/sampling/ParentSafeSamplerCustomizer.class";
        assertThrows(IllegalStateException.class, () -> RuntimeClasspathGuard.reject(
            java.util.List.of(provider), "EXTENSION_ON_APPLICATION_CLASSPATH", resourceLoader(provider)));
    }
}
