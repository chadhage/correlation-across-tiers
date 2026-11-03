package com.contoso.correlation.data;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

@FunctionalInterface
public interface PgConnectionFactory extends AutoCloseable {
    Connection open() throws SQLException;

    default Map<String, String> telemetryAttributes() { return Map.of("db.system", "postgresql"); }

    @Override default void close() {}
}
