package com.contoso.correlation.sampling;

import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizer;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;

public final class ParentSafeSamplerCustomizer implements AutoConfigurationCustomizerProvider {
    public static final String ARTIFACT_VERSION = "1.1.0";
    public static final String POLICY = "DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS";
    @Override
    public void customize(AutoConfigurationCustomizer autoConfiguration) {
        autoConfiguration.addSamplerCustomizer((existingSampler, properties) -> {
            var guarded = new ParentSafeSampler(existingSampler);
            SamplingObservation.register(guarded);
            System.out.println("CONTOSO_PARENT_SAFE_SAMPLER_LOADED abi=1.65.0 delegate="
                    + existingSampler.getClass().getName()
                    + " extensionLoader=" + getClass().getClassLoader().getClass().getName()
                    + " delegateLoader=" + existingSampler.getClass().getClassLoader().getClass().getName());
            return guarded;
        });
    }
}
