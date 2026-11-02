package com.contoso.correlation.sampling;

import static org.junit.jupiter.api.Assertions.*;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.data.LinkData;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import io.opentelemetry.sdk.trace.samplers.SamplingResult;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

class ParentSafeSamplerTest {
    private static final String TRACE = "11111111111111111111111111111111";
    private static final String PARENT = "aaaaaaaaaaaaaaaa";
    private static final Attributes ATTRIBUTES = Attributes.of(AttributeKey.stringKey("flow"), "critical");

    @Test void allValidUnsampledLinksDropOnlyADeclaredRoot() {
        var delegate = new MutableSampler();
        var guard = new ParentSafeSampler(delegate);
        var links = List.of(LinkData.create(Span.fromContext(parent(false, true)).getSpanContext()));
        assertEquals(SamplingResult.drop().getDecision(),
            guard.shouldSample(Context.root(), TRACE, "linked-work", SpanKind.INTERNAL, ATTRIBUTES, links).getDecision());
        assertEquals(0, delegate.calls);
        assertSame(delegate.result,
            guard.shouldSample(parent(true, true), TRACE, "linked-work", SpanKind.INTERNAL, ATTRIBUTES, links));
        assertEquals(1, delegate.calls);
    }

    @Test void sampledMixedEmptyAndInvalidLinkedInputsDelegateUnchanged() {
        var delegate = new MutableSampler();
        var guard = new ParentSafeSampler(delegate);
        var zero = LinkData.create(Span.fromContext(parent(false, true)).getSpanContext());
        var one = LinkData.create(Span.fromContext(parent(true, true)).getSpanContext());
        var invalid = LinkData.create(SpanContext.getInvalid());
        for (List<LinkData> links : List.of(List.of(one), List.of(zero, one), List.<LinkData>of(), List.of(zero, invalid))) {
            assertSame(delegate.result,
                guard.shouldSample(Context.root(), TRACE, "linked-work", SpanKind.INTERNAL, ATTRIBUTES, links));
            assertSame(links, delegate.links);
        }
        assertEquals(4, delegate.calls);
    }

    @Test void remoteUnsampledParentDropsBeforeTheDelegate() {
        var delegate = new MutableSampler();
        var guard = new ParentSafeSampler(delegate);
        assertEquals(SamplingResult.drop().getDecision(), sample(guard, parent(false, true)).getDecision());
        assertEquals(0, delegate.calls);
    }

    @Test void localUnsampledParentCannotBeResurrectedByAnOverride() {
        var delegate = new MutableSampler();
        var result = sample(new ParentSafeSampler(delegate), parent(false, false));
        assertEquals(SamplingResult.drop().getDecision(), result.getDecision());
        assertEquals(0, delegate.calls);
    }

    @Test void sampledParentDelegatesAllInputsWithoutChangingTheResult() {
        var delegate = new MutableSampler();
        var guard = new ParentSafeSampler(delegate);
        Context context = parent(true, true);
        List<LinkData> links = List.of();
        var result = guard.shouldSample(context, TRACE, "actual-work", SpanKind.CONSUMER, ATTRIBUTES, links);
        assertSame(delegate.result, result);
        assertSame(context, delegate.context);
        assertEquals(TRACE, delegate.trace);
        assertEquals("actual-work", delegate.name);
        assertEquals(SpanKind.CONSUMER, delegate.kind);
        assertSame(ATTRIBUTES, delegate.attributes);
        assertSame(links, delegate.links);
    }

    @Test void noValidParentUsesTheExistingRootDecision() {
        var delegate = new MutableSampler();
        assertSame(delegate.result, sample(new ParentSafeSampler(delegate), Context.root()));
        assertEquals(1, delegate.calls);
    }

    @Test void theSameOuterGuardPreservesLazyDelegateReconfiguration() {
        var delegate = new MutableSampler();
        var guard = new ParentSafeSampler(delegate);
        assertSame(delegate.result, sample(guard, parent(true, true)));
        delegate.result = SamplingResult.drop();
        delegate.description = "reconfigured";
        assertSame(delegate.result, sample(guard, parent(true, true)));
        assertEquals("ContosoParentSafe[reconfigured]", guard.getDescription());
        int calls = delegate.calls;
        sample(guard, parent(false, true));
        assertEquals(calls, delegate.calls);
    }

    @Test void nullDelegateIsRejected() {
        assertThrows(NullPointerException.class, () -> new ParentSafeSampler(null));
    }

    @Test void observationCountsRealDecisionsAndFailsClosedForUnknownNativeAbi() {
        var delegate = new MutableSampler();
        var sampler = new ParentSafeSampler(delegate);
        var observation = new SamplingObservation(sampler);
        sample(sampler, parent(false, true));
        sample(sampler, parent(true, true));
        assertEquals(1, observation.getUnsampledDropCount());
        assertEquals(1, observation.getDelegateDecisionCount());
        assertFalse(observation.isNativeStateAvailable());
        assertNull(observation.getEffectiveSamplingPercentage());
        assertNull(observation.getRequestsPerSecond());
        assertNull(observation.getOwnedConfigurationJson());
        assertEquals(1, delegate.calls, "Observing must not call or mutate the supplied sampler");
    }

    @Test void exactlyOneSpiServiceIsDeclared() throws Exception {
        String resource = "META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider";
        try (var stream = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream);
            assertEquals("com.contoso.correlation.sampling.ParentSafeSamplerCustomizer",
                    new String(stream.readAllBytes(), StandardCharsets.UTF_8).strip());
        }
    }

    @Test void localSampledParentStillUsesTheExistingDecision() {
        var delegate = new MutableSampler();
        delegate.result = SamplingResult.drop();
        assertSame(delegate.result, sample(new ParentSafeSampler(delegate), parent(true, false)));
        assertEquals(1, delegate.calls);
    }

    private static SamplingResult sample(Sampler sampler, Context context) {
        return sampler.shouldSample(context, TRACE, "actual-work", SpanKind.SERVER, ATTRIBUTES, List.of());
    }

    private static Context parent(boolean sampled, boolean remote) {
        var flags = sampled ? TraceFlags.getSampled() : TraceFlags.getDefault();
        var state = TraceState.getDefault();
        var span = remote ? SpanContext.createFromRemoteParent(TRACE, PARENT, flags, state)
                          : SpanContext.create(TRACE, PARENT, flags, state);
        return Context.root().with(Span.wrap(span));
    }

    private static final class MutableSampler implements Sampler {
        SamplingResult result = SamplingResult.recordAndSample();
        String description = "initial";
        int calls;
        Context context;
        String trace;
        String name;
        SpanKind kind;
        Attributes attributes;
        List<LinkData> links;
        @Override public SamplingResult shouldSample(Context context, String trace, String name,
                SpanKind kind, Attributes attributes, List<LinkData> links) {
            calls++;
            this.context = context;
            this.trace = trace;
            this.name = name;
            this.kind = kind;
            this.attributes = attributes;
            this.links = links;
            return result;
        }
        @Override public String getDescription() { return description; }
    }
}
