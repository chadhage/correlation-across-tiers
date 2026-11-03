package com.contoso.messaging;

public final class MessagingFailure extends RuntimeException {
    public enum Code {
        INVALID_ENVELOPE, ENVELOPE_TOO_LARGE, INVALID_CARRIER, UNTRUSTED_PUBLICATION,
        INVALID_CONFIGURATION, BROKER_UNAVAILABLE, LOCK_LOST, LEASE_LOST,
        WORKFLOW_CONFLICT, TRANSIENT_FAILURE, INVALID_STATE, LINK_LIMIT
    }
    private final Code code;
    public MessagingFailure(Code code) { super(code.name(), null, false, false); this.code = code; }
    public Code code() { return code; }
}
