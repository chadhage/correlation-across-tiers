package com.contoso.fulfillment;

import static org.junit.jupiter.api.Assertions.*;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import com.microsoft.azure.functions.annotation.TimerTrigger;
import org.junit.jupiter.api.Test;

class FulfillmentFunctionsTest {
    @Test void realTimerEntryDelegatesWithoutInterpretingOrLoggingHostBody() throws Exception {
        var called = new java.util.concurrent.atomic.AtomicInteger();
        new FulfillmentFunctions(called::incrementAndGet).poll("synthetic-host-data-never-logged", null);
        assertEquals(1, called.get());
        var method = FulfillmentFunctions.class.getMethod("poll", String.class, ExecutionContext.class);
        assertEquals("contosoFulfillmentPoll", method.getAnnotation(FunctionName.class).value());
        var trigger = method.getParameters()[0].getAnnotation(TimerTrigger.class);
        assertEquals("%CONTOSO_POLL_SCHEDULE%", trigger.schedule());
    }
}
