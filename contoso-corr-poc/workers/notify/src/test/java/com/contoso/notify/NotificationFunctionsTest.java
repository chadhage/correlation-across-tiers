package com.contoso.notify;

import static org.junit.jupiter.api.Assertions.*;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import org.junit.jupiter.api.Test;

class NotificationFunctionsTest {
    @Test void timerInvokesNotificationSdkPollingBoundary() throws Exception {
        var called = new java.util.concurrent.atomic.AtomicInteger();
        new NotificationFunctions(called::incrementAndGet).poll("synthetic-host-data-never-logged", null);
        assertEquals(1, called.get());
        assertEquals("contosoNotifyPoll", NotificationFunctions.class.getMethod("poll", String.class, ExecutionContext.class)
            .getAnnotation(FunctionName.class).value());
    }
}
