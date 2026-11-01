package com.contoso.correlation.workflow;

public record RunControl(RunAction action, WorkTarget target, int failureBudget) {
    public RunControl {
        if (action == null || target == null || failureBudget < 0 || failureBudget > 10) {
            throw new IllegalArgumentException("invalid_run_control");
        }
    }
}
