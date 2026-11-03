package com.contoso.notify;

import com.contoso.messaging.WorkerRuntimeHolder;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import com.microsoft.azure.functions.annotation.TimerTrigger;

public final class NotificationFunctions {
    private static final WorkerRuntimeHolder RUNTIME = new WorkerRuntimeHolder("contoso-notify-worker");
    private final Runnable poll;
    public NotificationFunctions() { this(() -> RUNTIME.get().pollNotify()); }
    NotificationFunctions(Runnable poll) { this.poll = poll; }

    @FunctionName("contosoNotifyPoll")
    public void poll(@TimerTrigger(name = "timer", schedule = "%CONTOSO_POLL_SCHEDULE%")
                     String ignoredTimer, ExecutionContext ignoredContext) {
        poll.run();
    }
}
