package com.contoso.correlation.sampling;

import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizer;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;

public final class ParentSafeSamplerCustomizer implements AutoConfigurationCustomizerProvider {
    @Override
    public void customize(AutoConfigurationCustomizer autoConfiguration) {
        autoConfiguration.addSamplerCustomizer((existingSampler, properties) -> {
            System.out.println("CONTOSO_PARENT_SAFE_SAMPLER_LOADED abi=1.65.0 delegate="
                    + existingSampler.getClass().getName()
                    + " extensionLoader=" + getClass().getClassLoader().getClass().getName()
                    + " delegateLoader=" + existingSampler.getClass().getClassLoader().getClass().getName());
            return new ParentSafeSampler(existingSampler);
        });
    }
}
