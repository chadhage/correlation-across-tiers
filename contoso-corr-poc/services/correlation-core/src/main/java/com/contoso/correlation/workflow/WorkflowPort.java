package com.contoso.correlation.workflow;

import com.contoso.correlation.data.OperationContext;
import java.util.Optional;

public interface WorkflowPort {
    WorkflowView submitOrder(OrderCommand command, OperationContext context);
    Optional<WorkflowView> order(String orderId, OperationContext context);
    WorkflowView startRun(DemoRunCommand command, OperationContext context);
    Optional<WorkflowView> run(String runId, OperationContext context);
    WorkflowView controlRun(String runId, RunControl command, OperationContext context);
}
