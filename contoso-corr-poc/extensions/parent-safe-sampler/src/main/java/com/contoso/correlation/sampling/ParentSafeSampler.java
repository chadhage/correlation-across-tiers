package com.contoso.correlation.sampling;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.data.LinkData;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import io.opentelemetry.sdk.trace.samplers.SamplingResult;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

public final class ParentSafeSampler implements Sampler {
    private final Sampler delegate;
    private final AtomicLong unsampledDrops = new AtomicLong();
    private final AtomicLong delegatedDecisions = new AtomicLong();
    private final AtomicLong linkedRootDrops = new AtomicLong();

    public ParentSafeSampler(Sampler delegate) {
        this.delegate = Objects.requireNonNull(delegate, "existing agent sampler");
    }

    @Override
    public SamplingResult shouldSample(Context parentContext, String traceId, String name,
            SpanKind spanKind, Attributes attributes, List<LinkData> parentLinks) {
        var parent = Span.fromContext(parentContext).getSpanContext();
        if (parent.isValid() && !parent.isSampled()) {
            unsampledDrops.incrementAndGet();
            return SamplingResult.drop();
        }
        if (!parent.isValid() && parentLinks != null && !parentLinks.isEmpty() &&
            parentLinks.stream().allMatch(link -> link != null && link.getSpanContext().isValid() &&
                !link.getSpanContext().isSampled())) {
            linkedRootDrops.incrementAndGet();
            return SamplingResult.drop();
        }
        delegatedDecisions.incrementAndGet();
        return delegate.shouldSample(parentContext, traceId, name, spanKind, attributes, parentLinks);
    }

    @Override
    public String getDescription() {
        return "ContosoParentSafe[" + delegate.getDescription() + "]";
    }

    Sampler delegate() { return delegate; }
    long unsampledDrops() { return unsampledDrops.get(); }
    long delegatedDecisions() { return delegatedDecisions.get(); }
    long linkedRootDrops() { return linkedRootDrops.get(); }
}
