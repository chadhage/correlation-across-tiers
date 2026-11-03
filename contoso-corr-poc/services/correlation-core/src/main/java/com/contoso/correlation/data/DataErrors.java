package com.contoso.correlation.data;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import javax.net.ssl.SSLException;

public final class DataErrors {
    private DataErrors() {}

    public static DataErrorKind classify(Throwable failure) {
        if (failure instanceof DataAccessException safe) return safe.kind();
        if (Thread.currentThread().isInterrupted()) return DataErrorKind.CANCELLED;
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 8; depth++, current = current.getCause()) {
            if (current instanceof SQLTimeoutException || current instanceof SocketTimeoutException ||
                current instanceof java.util.concurrent.TimeoutException) {
                return DataErrorKind.TIMEOUT;
            }
            if (current instanceof SSLException) return DataErrorKind.TLS;
            if (current instanceof UnknownHostException) return DataErrorKind.DNS_OR_CONNECTIVITY;
            if (current instanceof SQLException sql) {
                String state = sql.getSQLState();
                if (state != null) {
                    if (state.startsWith("28")) return DataErrorKind.AUTHENTICATION;
                    if (state.equals("42501")) return DataErrorKind.AUTHORIZATION;
                    if (state.equals("57014")) return DataErrorKind.TIMEOUT;
                    if (state.equals("53300")) return DataErrorKind.RESOURCE_EXHAUSTED;
                    if (state.equals("40001") || state.equals("40P01")) return DataErrorKind.TRANSIENT_CONCURRENCY;
                    if (state.equals("23505")) return DataErrorKind.CONFLICT;
                    if (state.startsWith("23")) return DataErrorKind.INVALID_REQUEST;
                    if (state.startsWith("08")) return DataErrorKind.DNS_OR_CONNECTIVITY;
                }
            }
        }
        return failure instanceof IllegalArgumentException ? DataErrorKind.INVALID_REQUEST : DataErrorKind.INTERNAL;
    }

    public static SQLException sanitized(SQLException failure) {
        String state = failure.getSQLState();
        if (state == null || !state.matches("[0-9A-Z]{5}")) state = "XX000";
        DataErrorKind kind = classify(failure);
        String message = "data_" + kind.name().toLowerCase(java.util.Locale.ROOT);
        return kind == DataErrorKind.TIMEOUT
            ? new SQLTimeoutException(message, state) : new SQLException(message, state);
    }
}
