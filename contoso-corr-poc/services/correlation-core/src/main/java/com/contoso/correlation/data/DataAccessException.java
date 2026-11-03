package com.contoso.correlation.data;

import java.util.Objects;

public final class DataAccessException extends RuntimeException {
    private final DataErrorKind kind;
    private final boolean outcomeUnknown;

    public DataAccessException(DataErrorKind kind, boolean outcomeUnknown) {
        super("data_" + Objects.requireNonNull(kind).name().toLowerCase(java.util.Locale.ROOT),
              null, false, false);
        this.kind = kind;
        this.outcomeUnknown = outcomeUnknown;
    }

    public DataErrorKind kind() { return kind; }
    public boolean outcomeUnknown() { return outcomeUnknown; }
}
