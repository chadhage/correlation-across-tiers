package com.contoso.fulfillment;

import com.contoso.messaging.WorkerRuntimeHolder;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import com.microsoft.azure.functions.annotation.TimerTrigger;

public final class FulfillmentFunctions {
    private static final WorkerRuntimeHolder RUNTIME = new WorkerRuntimeHolder("contoso-fulfillment-worker");
    private final Runnable poll;
    public FulfillmentFunctions() { this(() -> RUNTIME.get().pollFulfillment()); }
    FulfillmentFunctions(Runnable poll) { this.poll = poll; }

    @FunctionName("contosoFulfillmentPoll")
    public void poll(@TimerTrigger(name = "timer", schedule = "%CONTOSO_POLL_SCHEDULE%")
                     String ignoredTimer, ExecutionContext ignoredContext) {
        poll.run();
    }
}
