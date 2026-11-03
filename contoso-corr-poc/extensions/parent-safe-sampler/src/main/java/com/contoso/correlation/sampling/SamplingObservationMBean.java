package com.contoso.correlation.sampling;

public interface SamplingObservationMBean {
    String getDelegateDescription();
    String getDelegateClass();
    String getDelegateLoader();
    String getExtensionLoader();
    String getProviderClass();
    String getGuardSha256();
    String getSdkAbi();
    String getGuardPolicy();
    String getArtifactVersion();
    int getLoadedCount();
    long getUnsampledDropCount();
    long getDelegateDecisionCount();
    long getUnsampledLinkedRootDropCount();
    Double getEffectiveSamplingPercentage();
    Double getRequestsPerSecond();
    String getOwnedConfigurationJson();
    boolean isNativeStateAvailable();
}
