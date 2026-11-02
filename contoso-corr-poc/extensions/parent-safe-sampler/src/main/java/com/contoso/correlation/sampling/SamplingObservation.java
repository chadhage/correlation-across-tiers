package com.contoso.correlation.sampling;

import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.management.ObjectName;

public final class SamplingObservation implements SamplingObservationMBean {
    public static final String OBJECT_NAME = "com.contoso.correlation:type=SamplingObservation";
    private static final String NATIVE_PACKAGE = "com.microsoft.applicationinsights.agent.internal.sampling.";
    private final ParentSafeSampler sampler;
    private final String hash;

    SamplingObservation(ParentSafeSampler sampler) {
        this.sampler = sampler;
        String observed;
        try {
            var resource = getClass().getResource("SamplingObservation.class");
            if (resource == null) throw new IllegalStateException("UNKNOWN_EXTENSION_CLASS_SOURCE");
            var connection = resource.openConnection();
            connection.setUseCaches(false);
            Path source;
            if (connection instanceof java.net.JarURLConnection jar) {
                source = Path.of(jar.getJarFileURL().toURI());
            } else if (resource.getProtocol().equals("otel") &&
                connection.getClass().getName().equals("io.opentelemetry.javaagent.tooling.RemappingUrlConnection")) {
                var archive = (java.util.jar.JarFile) field(connection, "delegateJarFile");
                var entry = (java.util.jar.JarEntry) field(connection, "entry");
                if (!entry.getName().equals(getClass().getName().replace('.', '/') + ".class")) {
                    throw new IllegalStateException("UNKNOWN_EXTENSION_CLASS_SOURCE");
                }
                source = Path.of(archive.getName());
            } else throw new IllegalStateException("UNKNOWN_EXTENSION_CLASS_SOURCE");
            observed = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source)));
        } catch (Exception failure) { observed = ""; }
        hash = observed;
    }

    static void register(ParentSafeSampler sampler) {
        try {
            var server = ManagementFactory.getPlatformMBeanServer();
            var name = new ObjectName(OBJECT_NAME);
            if (server.isRegistered(name)) throw new IllegalStateException("GATE_02_DUPLICATE_SAMPLER_LOAD");
            server.registerMBean(new SamplingObservation(sampler), name);
        } catch (Exception failure) {
            throw new IllegalStateException("GATE_02_SAMPLER_OBSERVER_UNAVAILABLE");
        }
    }

    public String getDelegateDescription() { return sampler.getDescription(); }
    public String getDelegateClass() { return sampler.delegate().getClass().getName(); }
    public String getDelegateLoader() { return sampler.delegate().getClass().getClassLoader().getClass().getName(); }
    public String getExtensionLoader() { return getClass().getClassLoader().getClass().getName(); }
    public String getProviderClass() { return ParentSafeSamplerCustomizer.class.getName(); }
    public String getGuardSha256() { return hash; }
    public String getSdkAbi() { return "1.65.0"; }
    public String getGuardPolicy() { return ParentSafeSamplerCustomizer.POLICY; }
    public String getArtifactVersion() { return ParentSafeSamplerCustomizer.ARTIFACT_VERSION; }
    public int getLoadedCount() { return 1; }
    public long getUnsampledDropCount() { return sampler.unsampledDrops(); }
    public long getDelegateDecisionCount() { return sampler.delegatedDecisions(); }
    public long getUnsampledLinkedRootDropCount() { return sampler.linkedRootDrops(); }
    public Double getEffectiveSamplingPercentage() { return snapshot().percentage(); }
    public Double getRequestsPerSecond() { return snapshot().requestsPerSecond(); }
    public boolean isNativeStateAvailable() { return snapshot().available(); }
    public String getOwnedConfigurationJson() {
        Snapshot state = snapshot();
        if (!state.available()) return null;
        return "{\"sampling.overrides\":[],\"sampling.percentage\":" + value(state.percentage()) +
            ",\"sampling.requestsPerSecond\":" + value(state.requestsPerSecond()) + "}";
    }

    private static String value(Double number) {
        return number == null ? "{\"$contosoAbsent\":true}" :
            java.math.BigDecimal.valueOf(number).stripTrailingZeros().toPlainString();
    }

    private Snapshot snapshot() {
        try {
            Object delegate = sampler.delegate();
            if (!delegate.getClass().getName().equals(NATIVE_PACKAGE + "DelegatingSampler")) return Snapshot.unknown();
            Object active = field(delegate, "delegate");
            if (!active.getClass().getName().equals(NATIVE_PACKAGE + "AiSampler")) return Snapshot.unknown();
            Object requests = field(active, "requestSamplingPercentage");
            Object dependencies = field(active, "parentlessDependencySamplingPercentage");
            if (requests.getClass().getName().equals(NATIVE_PACKAGE + "RateLimitedSamplingPercentage")) {
                // Calling its get() would mutate the live adaptive sampling state.
                double rate = ((Number) field(requests, "targetSpansPerNanosecondLimit")).doubleValue() * 1_000_000_000;
                if (!Double.isFinite(rate) || rate < 0 || fixed(dependencies) != 100) return Snapshot.unknown();
                return new Snapshot(null, rate, true);
            }
            double percentage = fixed(requests);
            if (percentage != fixed(dependencies)) return Snapshot.unknown();
            return new Snapshot(percentage, null, true);
        } catch (Exception failure) { return Snapshot.unknown(); }
    }

    private static double fixed(Object value) throws Exception {
        if (!value.getClass().getName().startsWith(NATIVE_PACKAGE + "SamplingPercentage$$Lambda")) {
            throw new IllegalStateException("UNKNOWN_NATIVE_SAMPLING_ABI");
        }
        Class<?> api = Class.forName(NATIVE_PACKAGE + "SamplingPercentage", false, value.getClass().getClassLoader());
        double percentage = ((Number) api.getMethod("get").invoke(value)).doubleValue();
        if (!Double.isFinite(percentage) || percentage < 0 || percentage > 100) {
            throw new IllegalStateException("UNKNOWN_NATIVE_SAMPLING_ABI");
        }
        return percentage;
    }

    private static Object field(Object target, String name) throws Exception {
        var field = target.getClass().getDeclaredField(name);
        if (!field.trySetAccessible()) throw new IllegalStateException("UNKNOWN_NATIVE_SAMPLING_ABI");
        return field.get(target);
    }

    private record Snapshot(Double percentage, Double requestsPerSecond, boolean available) {
        static Snapshot unknown() { return new Snapshot(null, null, false); }
    }
}
