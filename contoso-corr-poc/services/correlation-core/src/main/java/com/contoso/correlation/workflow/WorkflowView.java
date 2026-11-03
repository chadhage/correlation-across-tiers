package com.contoso.correlation.workflow;

import com.contoso.correlation.InvocationId;
import java.util.Map;

public record WorkflowView(String id, String businessInvocationId, String state, Map<String, String> details) {
    public WorkflowView {
        InvocationId.parse(id);
        InvocationId.parse(businessInvocationId);
        if (state == null || !state.matches("[A-Z][A-Z0-9_]{0,63}")) {
            throw new IllegalArgumentException("invalid_workflow_state");
        }
        details = details == null ? Map.of() : Map.copyOf(details);
        if (details.size() > 32 || details.entrySet().stream().anyMatch(e ->
                !e.getKey().matches("[A-Za-z][A-Za-z0-9_.-]{0,63}") ||
                e.getKey().toLowerCase(java.util.Locale.ROOT).matches(".*(token|password|secret|authorization|cookie|payload|claims|receipt|fingerprint|connection).*") ||
                e.getValue().length() > 256 || e.getValue().chars().anyMatch(c -> c < 32))) {
            throw new IllegalArgumentException("invalid_workflow_view");
        }
    }
}
