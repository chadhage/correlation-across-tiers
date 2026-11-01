package com.contoso.correlation;

import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.util.List;
import java.util.Map;
import org.slf4j.LoggerFactory;

public final class AgentProbe {
    private AgentProbe() {}
    public static void main(String[] args) throws Exception {
        RuntimeGuard.verifyAgentArguments(java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments());
        ExtensionGuard.verify();
        var id = InvocationId.generate();
        try (var root = Correlation.start("contoso.oracle.root", SpanKind.SERVER, Context.root(), id, Map.of());
             var scope = root.makeCurrent()) {
            if (!root.spanContext().isValid() ||
                !io.opentelemetry.api.trace.Span.current().isRecording()) {
                throw new IllegalStateException("NO_RECORDING_AGENT_API_BRIDGE");
            }
            try (var child = Correlation.start("contoso.oracle.client", SpanKind.CLIENT, root.context(), id,
                     Map.of("db.system", "postgresql", "db.name", "contoso_orders", "server.address", "localhost"));
                 var childScope = child.makeCurrent()) {
                Correlation.log(LoggerFactory.getLogger(AgentProbe.class), "oracle_log", "SUCCESS");
                try (var linked = Correlation.startLinked("contoso.oracle.linked", SpanKind.CONSUMER, id,
                        List.of(child.spanContext()), Map.of())) {
                    System.out.printf("ORACLE %s %s %s %s %s%n", root.spanContext().getTraceId(),
                        root.spanContext().getSpanId(), child.spanContext().getSpanId(),
                        linked.spanContext().getTraceId(), linked.spanContext().getSpanId());
                }
            }
        }
        Thread.sleep(1000);
    }
}
