package com.contoso.aggregator;

import com.contoso.messaging.WorkerRuntimeHolder;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import com.microsoft.azure.functions.annotation.TimerTrigger;

public final class AggregatorFunctions {
    private static final WorkerRuntimeHolder RUNTIME = new WorkerRuntimeHolder("contoso-order-aggregator");
    private final Runnable poll;
    public AggregatorFunctions() { this(() -> RUNTIME.get().pollAggregator()); }
    AggregatorFunctions(Runnable poll) { this.poll = poll; }

    @FunctionName("contosoAggregatorPoll")
    public void poll(@TimerTrigger(name = "timer", schedule = "%CONTOSO_POLL_SCHEDULE%")
                     String ignoredTimer, ExecutionContext ignoredContext) {
        poll.run();
    }
}
