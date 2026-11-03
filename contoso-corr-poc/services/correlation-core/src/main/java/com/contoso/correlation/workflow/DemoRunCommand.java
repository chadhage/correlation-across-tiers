package com.contoso.correlation.workflow;

public record DemoRunCommand(int demoId, RunScenario scenario, int failureBudget, String runId) {
    public DemoRunCommand(int demoId, RunScenario scenario, int failureBudget) {
        this(demoId, scenario, failureBudget, com.contoso.correlation.InvocationId.generate().value());
    }
    public DemoRunCommand {
        com.contoso.correlation.InvocationId.parse(runId);
        if (demoId < 1 || demoId > 15 || scenario == null || failureBudget < 0 || failureBudget > 10) {
            throw new IllegalArgumentException("invalid_demo_run");
        }
    }
}
