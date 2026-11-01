package com.contoso.inventory.data;

import java.util.Map;

final class DataInstrumentationGuard {
    private DataInstrumentationGuard() {}

    static void verify() { verify(System.getenv()); }

    static void verify(Map<String, String> environment) {
        for (String name : new String[]{"APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED",
            "APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED"}) {
            if (!"false".equalsIgnoreCase(environment.get(name))) {
                throw new IllegalStateException("manual_data_capture_configuration_required");
            }
        }
        for (String name : new String[]{"OTEL_INSTRUMENTATION_JDBC_ENABLED",
            "OTEL_INSTRUMENTATION_JDBC_DATASOURCE_ENABLED", "OTEL_INSTRUMENTATION_LETTUCE_ENABLED",
            "OTEL_INSTRUMENTATION_JEDIS_ENABLED"}) {
            if ("true".equalsIgnoreCase(environment.get(name))) {
                throw new IllegalStateException("conflicting_data_capture_configuration");
            }
        }
    }
}
