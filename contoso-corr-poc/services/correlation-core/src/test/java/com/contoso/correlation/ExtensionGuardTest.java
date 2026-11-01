package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class ExtensionGuardTest {
    @Test void absentRequiredExtensionFailsClosed() {
        System.clearProperty("otel.javaagent.extensions");
        assertThrows(IllegalStateException.class, ExtensionGuard::verify);
    }
    @Test void absentOrWrongHashExtensionCannotBeLoadedByApplication() {
        System.setProperty("otel.javaagent.extensions", "contoso-parent-safe-sampler-1.0.0.jar");
        try { assertThrows(IllegalStateException.class, ExtensionGuard::verify); }
        finally { System.clearProperty("otel.javaagent.extensions"); }
    }
}
