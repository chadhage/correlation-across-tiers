package com.contoso.correlation.data;

import java.util.Locale;

public enum PgOperation {
    SELECT, INSERT, UPDATE, DELETE, TRANSACTION;

    public String spanName() { return "contoso.pg." + name().toLowerCase(Locale.ROOT); }
    public boolean mutating() { return this != SELECT; }
}
