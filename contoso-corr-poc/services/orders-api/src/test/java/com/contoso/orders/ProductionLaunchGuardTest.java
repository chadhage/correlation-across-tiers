package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class ProductionLaunchGuardTest {
    @Test void productionMainCannotUseFalsePropertyOrImplicitJdkOptionsToSkipGuards() throws Exception {
        for (boolean implicit : new boolean[]{false, true}) {
            var command = new java.util.ArrayList<String>();
            command.add(Path.of(System.getProperty("java.home"), "bin", "java").toString());
            if (!implicit) command.add("-Dcontoso.requireAgent=false");
            command.add("-cp");
            command.add(System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")));
            command.add(OrdersApplication.class.getName());
            var builder = new ProcessBuilder(command).redirectErrorStream(true);
            builder.environment().remove("JDK_JAVA_OPTIONS");
            builder.environment().remove("_JAVA_OPTIONS");
            if (implicit) builder.environment().put("JDK_JAVA_OPTIONS", "-Dcontoso.requireAgent=false");
            Process process = builder.start();
            try {
                assertTrue(process.waitFor(Duration.ofSeconds(10)));
                String output = process.inputReader().lines().reduce("", (a, b) -> a + b + "\n");
                assertNotEquals(0, process.exitValue(), output);
                assertTrue(output.contains(implicit ? "GATE_02_UNAPPROVED_LAUNCHER_OPTIONS" : "GATE_02_SINGLE_PINNED_AGENT"), output);
                assertFalse(output.contains("CONSTRUCTION_ONLY"), "Production guard must fail before unpublished integration code");
            } finally { if (process.isAlive()) process.destroyForcibly(); }
        }
    }
}
