package com.contoso.messaging;

import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.correlation.workflow.WorkflowPort;

// No state/delivery implementation. This header cannot produce a business outcome.
public final class MessagingWorkflowPort {
    public static WorkflowPort fromEnvironment(PgConnectionFactory connections) {
        throw new UnsupportedOperationException("CONSTRUCTION_ONLY");
    }
}
