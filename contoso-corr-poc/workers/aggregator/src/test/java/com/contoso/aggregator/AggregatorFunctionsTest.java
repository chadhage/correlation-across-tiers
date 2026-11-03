package com.contoso.aggregator;

import static org.junit.jupiter.api.Assertions.*;
import com.microsoft.azure.functions.ExecutionContext;
import com.microsoft.azure.functions.annotation.FunctionName;
import org.junit.jupiter.api.Test;

class AggregatorFunctionsTest {
    @Test void timerInvokesDurableFanInAndPartitionPollingBoundary() throws Exception {
        var called = new java.util.concurrent.atomic.AtomicInteger();
        new AggregatorFunctions(called::incrementAndGet).poll("synthetic-host-data-never-logged", null);
        assertEquals(1, called.get());
        assertEquals("contosoAggregatorPoll", AggregatorFunctions.class.getMethod("poll", String.class, ExecutionContext.class)
            .getAnnotation(FunctionName.class).value());
    }
}
