package com.contoso.messaging;

import com.contoso.correlation.Correlation;
import com.contoso.correlation.ExtensionGuard;
import com.contoso.correlation.RuntimeClasspathGuard;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.OperationContext;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import java.lang.management.ManagementFactory;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;

public final class NotifyTopicReplayProbe {
    private NotifyTopicReplayProbe() {}

    static String role(String phase) {
        return switch (phase) {
            case "prepare", "skip" -> "contoso-fulfillment-worker";
            case "notify" -> "contoso-notify-worker";
            default -> throw new IllegalArgumentException("NOTIFY_TOPIC_PHASE");
        };
    }

    public static void main(String[] args) throws Exception {
        try {
            NotifyTopicReplayFixture.require(args.length == 2, "ARGUMENTS");
            String phase = args[0];
            String role = role(phase);
            NotifyTopicReplayFixture.require(role.equals(System.getenv("APPLICATIONINSIGHTS_ROLE_NAME")) &&
                role.equals(System.getenv("OTEL_SERVICE_NAME")), "PHYSICAL_ROLE");
            Path database = Path.of(args[1]).toAbsolutePath().normalize();
            NotifyTopicReplayFixture.require(database.getParent().equals(
                Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize()) &&
                database.getFileName().toString().equals("notify-topic-db"), "PROJECT_EPOCH_DATABASE");
            RuntimeGuard.verifyAgentArguments(ManagementFactory.getRuntimeMXBean().getInputArguments());
            RuntimeClasspathGuard.verify(NotifyTopicReplayProbe.class.getClassLoader());
            ExtensionGuard.verify();
            MessagingLoggingGuard.verify();
            try (var fixture = new NotifyTopicReplayFixture(database, phase.equals("prepare"))) {
                var invocation = fixture.invocation(phase);
                try (var root = Correlation.start("contoso.notify.topic.fixture." + phase, SpanKind.SERVER,
                    Context.root(), invocation, Map.of()); var scope = root.makeCurrent()) {
                    NotifyTopicReplayFixture.require(root.spanContext().isValid() && Span.current().isRecording(), "RECORDING_AGENT");
                    var operation = new OperationContext(invocation, root.context(), Instant.now().plusSeconds(30));
                    Map<String, Object> result = switch (phase) {
                        case "prepare" -> fixture.prepare(operation);
                        case "notify" -> fixture.notifyReplay(operation);
                        case "skip" -> fixture.skipOtherTopicSubscription(operation);
                        default -> throw new IllegalArgumentException("NOTIFY_TOPIC_PHASE");
                    };
                    System.out.println("ASYNC_NOTIFY_REPLAY_STATE " + NativeTestCapture.JSON.writeValueAsString(result));
                    System.out.println("ASYNC_NOTIFY_TOPIC_PROBE_COMPLETE");
                }
            }
            Thread.sleep(1000);
        } catch (Exception failure) {
            throw new IllegalStateException("ASYNC_NOTIFY_TOPIC_PROBE_FAILED");
        }
    }
}
