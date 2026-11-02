package com.contoso.messaging;

import java.util.Set;

public final class WorkerRuntimeHolder implements AutoCloseable {
    private final String serviceName;
    private MessagingRuntime runtime;
    public WorkerRuntimeHolder(String serviceName) {
        if (!Set.of("contoso-fulfillment-worker", "contoso-notify-worker", "contoso-order-aggregator").contains(serviceName)) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_CONFIGURATION);
        }
        this.serviceName = serviceName;
    }
    public synchronized MessagingRuntime get() {
        if (runtime == null) {
            runtime = MessagingRuntime.fromEnvironment(serviceName);
            Runtime.getRuntime().addShutdownHook(new Thread(this::close, "contoso-worker-shutdown"));
        }
        return runtime;
    }
    @Override public synchronized void close() {
        if (runtime != null) { runtime.close(); runtime = null; }
    }
}
