package com.contoso.correlation;

import io.opentelemetry.api.GlobalOpenTelemetry;
import java.lang.management.ManagementFactory;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import javax.management.ObjectName;

public final class SamplingRuntime implements SamplingRuntimeMBean, AutoCloseable {
    public static final String OBJECT_NAME = "com.contoso.correlation:type=SamplingRuntime";
    private static final String SAMPLER_NAME = "com.contoso.correlation:type=SamplingObservation";
    private static volatile SamplingRuntime active = new SamplingRuntime("", null, Clock.systemUTC(),
        System::nanoTime, () -> {}, () -> {});
    private final String serviceName;
    private final SamplingLease lease;
    private final Clock clock;
    private final LongSupplier nanoTime;
    private final long startedNanos;
    private final Instant startedAt;
    private final Runnable expired;
    private final Runnable hardStop;
    private final AtomicBoolean expiryRequested = new AtomicBoolean();
    private final AtomicBoolean hardStopRequested = new AtomicBoolean();
    private final Object admission = new Object();
    private boolean admitting = true;
    private int inFlight;
    private ScheduledExecutorService watchdog;

    SamplingRuntime(String serviceName, SamplingLease lease, Clock clock, LongSupplier nanoTime,
                    Runnable expired, Runnable hardStop) {
        this.serviceName = serviceName;
        this.lease = lease;
        this.clock = clock;
        this.nanoTime = nanoTime;
        this.startedNanos = nanoTime.getAsLong();
        this.startedAt = clock.instant();
        this.expired = expired;
        this.hardStop = hardStop;
    }

    static synchronized void initialize(String serviceName, SamplingLease lease) {
        var server = ManagementFactory.getPlatformMBeanServer();
        try {
            var name = new ObjectName(OBJECT_NAME);
            if (server.isRegistered(name)) {
                if (!serviceName.equals(active.serviceName) || !java.util.Objects.equals(lease, active.lease)) throw new IllegalStateException();
                return;
            }
            var runtime = new SamplingRuntime(serviceName, lease, Clock.systemUTC(), System::nanoTime,
                () -> Thread.ofPlatform().daemon().name("contoso-sampling-expiry").start(() -> System.exit(78)),
                () -> Runtime.getRuntime().halt(78));
            server.registerMBean(runtime, name);
            active = runtime;
            if (lease != null) {
                runtime.watchdog = Executors.newSingleThreadScheduledExecutor(action -> {
                    Thread thread = new Thread(action, "contoso-sampling-watchdog");
                    thread.setDaemon(true);
                    return thread;
                });
                runtime.watchdog.scheduleAtFixedRate(runtime::tick, 0, 100, TimeUnit.MILLISECONDS);
            }
        } catch (Exception failure) { throw new IllegalStateException("GATE_02_RUNTIME_OBSERVER_UNAVAILABLE"); }
    }

    static RuntimeGuard.WorkPermit admitWork() { return active.admit(); }

    RuntimeGuard.WorkPermit admit() {
        synchronized (admission) {
            if (lease != null && reached(lease.drainAt())) admitting = false;
            if (!admitting) throw new IllegalStateException("SAMPLING_RUNTIME_DRAINING");
            inFlight++;
        }
        var closed = new AtomicBoolean();
        return () -> {
            if (!closed.compareAndSet(false, true)) return;
            synchronized (admission) { inFlight--; }
        };
    }

    void tick() {
        if (lease == null) return;
        synchronized (admission) { if (reached(lease.drainAt())) admitting = false; }
        if (reached(lease.expiresAt()) && expiryRequested.compareAndSet(false, true)) expired.run();
        if (reached(lease.restoreDeadline()) && hardStopRequested.compareAndSet(false, true)) hardStop.run();
    }

    private boolean reached(Instant deadline) {
        return !clock.instant().isBefore(deadline) ||
            nanoTime.getAsLong() - startedNanos >= Duration.between(startedAt, deadline).toNanos();
    }

    static String nativeOwnedConfiguration(Properties expectedGuard) {
        try {
            var server = ManagementFactory.getPlatformMBeanServer();
            var sampler = new ObjectName(SAMPLER_NAME);
            for (String key : java.util.List.of("sha256", "providerClass", "sdkAbi", "version", "policy", "extensionLoader", "delegateClass", "delegateLoader")) {
                String attribute = switch (key) {
                    case "sha256" -> "GuardSha256";
                    case "providerClass" -> "ProviderClass";
                    case "sdkAbi" -> "SdkAbi";
                    case "version" -> "ArtifactVersion";
                    case "policy" -> "GuardPolicy";
                    case "extensionLoader" -> "ExtensionLoader";
                    case "delegateClass" -> "DelegateClass";
                    default -> "DelegateLoader";
                };
                if (!expectedGuard.getProperty(key).equals(server.getAttribute(sampler, attribute))) throw new IllegalStateException();
            }
            if (!Integer.valueOf(1).equals(server.getAttribute(sampler, "LoadedCount")) ||
                !Boolean.TRUE.equals(server.getAttribute(sampler, "NativeStateAvailable"))) throw new IllegalStateException();
            return SamplingLease.canonical(SamplingLease.JSON.readTree((String) server.getAttribute(sampler, "OwnedConfigurationJson")));
        } catch (Exception failure) { throw new IllegalStateException("GATE_02_NATIVE_SAMPLER_OBSERVATION"); }
    }

    public String getObservationJson() {
        try {
            var result = new LinkedHashMap<String, Object>();
            result.put("schema", "contoso.sampling-runtime-observation.v1");
            result.put("serviceName", serviceName);
            result.put("runtimeInstanceId", Long.toString(ProcessHandle.current().pid()));
            result.put("observedAtUtc", clock.instant().toString());
            result.put("revision", lease == null ? "production" : lease.revision());
            result.put("activeLeaseId", lease == null || expiryRequested.get() ? null : lease.runId().value());
            result.put("leaseExpiresAtUtc", lease == null ? null : lease.expiresAt().toString());
            result.put("drainAtUtc", lease == null ? null : lease.drainAt().toString());
            result.put("providerIdentity", System.identityHashCode(GlobalOpenTelemetry.getTracerProvider()));
            result.put("providerCount", null);
            result.put("exporterCount", null);
            result.put("agentAttachmentCount", ManagementFactory.getRuntimeMXBean().getInputArguments().stream()
                .filter(argument -> argument.startsWith("-javaagent:")).count());
            result.put("startupMechanism", "controlled-process-restart");
            synchronized (admission) { result.put("admitting", admitting); result.put("inFlight", inFlight); }
            var server = ManagementFactory.getPlatformMBeanServer();
            var sampler = new ObjectName(SAMPLER_NAME);
            if (server.isRegistered(sampler)) {
                result.put("nativeObservationAvailable", server.getAttribute(sampler, "NativeStateAvailable"));
                result.put("effectiveSamplingPercentage", server.getAttribute(sampler, "EffectiveSamplingPercentage"));
                result.put("requestsPerSecond", server.getAttribute(sampler, "RequestsPerSecond"));
                String owned = (String) server.getAttribute(sampler, "OwnedConfigurationJson");
                result.put("ownedConfiguration", owned == null ? null : SamplingLease.JSON.readTree(owned));
                result.put("guard", Map.of("sha256", server.getAttribute(sampler, "GuardSha256"),
                    "providerClass", server.getAttribute(sampler, "ProviderClass"), "sdkAbi", server.getAttribute(sampler, "SdkAbi"),
                    "version", server.getAttribute(sampler, "ArtifactVersion"), "policy", server.getAttribute(sampler, "GuardPolicy")));
                result.put("guardLoadedCount", server.getAttribute(sampler, "LoadedCount"));
                result.put("unsampledLinkedRootDropCount", server.getAttribute(sampler, "UnsampledLinkedRootDropCount"));
                result.put("unsampledDropCount", server.getAttribute(sampler, "UnsampledDropCount"));
                result.put("delegateDecisionCount", server.getAttribute(sampler, "DelegateDecisionCount"));
            }
            return SamplingLease.JSON.writeValueAsString(result);
        } catch (Exception failure) { throw new IllegalStateException("GATE_02_RUNTIME_OBSERVER_UNAVAILABLE"); }
    }

    public void close() {
        synchronized (admission) { admitting = false; }
        if (watchdog != null) watchdog.shutdownNow();
    }
}
