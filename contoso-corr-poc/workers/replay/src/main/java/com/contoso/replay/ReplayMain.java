package com.contoso.replay;

import com.contoso.messaging.MessagingRuntime;
import com.contoso.messaging.Source;
import java.util.Set;

public final class ReplayMain {
    private ReplayMain() {}
    public static Source source(String[] args) {
        if (args.length != 2 || !"--source".equals(args[0])) throw new IllegalArgumentException("invalid_replay_arguments");
        Source source;
        try { source = Source.valueOf(args[1]); }
        catch (IllegalArgumentException ignored) { throw new IllegalArgumentException("invalid_replay_source"); }
        if (!Set.of(Source.ORDERS_DLQ, Source.FULFILLMENT_DLQ, Source.NOTIFY_DLQ, Source.LEGACY_POISON).contains(source)) {
            throw new IllegalArgumentException("invalid_replay_source");
        }
        return source;
    }
    public static void main(String[] args) {
        Source source = source(args);
        String role = source == Source.NOTIFY_DLQ ? "contoso-notify-worker" : "contoso-fulfillment-worker";
        try (var runtime = MessagingRuntime.fromEnvironment(role)) {
            System.out.println(runtime.replayOnce(source, true) ? "REPLAY_QUEUED" : "NO_REQUESTED_WORK");
        }
    }
}
