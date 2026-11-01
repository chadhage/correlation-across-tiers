package com.contoso.correlation.data;

import com.contoso.correlation.InvocationId;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.Objects;

public record OperationContext(InvocationId invocationId, Context parentContext, Instant deadline) {
    public OperationContext {
        Objects.requireNonNull(invocationId, "invocation_required");
        Objects.requireNonNull(parentContext, "parent_context_required");
        Objects.requireNonNull(deadline, "deadline_required");
    }

    @Override public String toString() { return "OperationContext[redacted]"; }
}
