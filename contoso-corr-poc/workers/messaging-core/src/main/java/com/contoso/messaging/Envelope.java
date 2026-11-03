package com.contoso.messaging;

import com.contoso.correlation.InvocationId;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record Envelope(int schemaVersion, String traceparent, String tracestate,
                       @JsonProperty("business.invocation_id") String businessInvocationId,
                       String messageId, String causationId, String workflowId, Kind kind,
                       String replayOf, WorkPayload payload) {
    public static final int VERSION = 1;
    public static final int MAX_BYTES = 32_768;
    public enum Kind { ORDER, RESULT, BATCH }

    public Envelope {
        if (schemaVersion != VERSION || kind == null || payload == null ||
            traceparent != null && traceparent.length() > 512 ||
            tracestate != null && tracestate.length() > 512) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE);
        }
        InvocationId.parse(businessInvocationId);
        InvocationId.parse(messageId);
        InvocationId.parse(workflowId);
        if (causationId != null) InvocationId.parse(causationId);
        if (replayOf != null) {
            InvocationId.parse(replayOf);
            if (messageId.equals(replayOf) || !replayOf.equals(causationId)) {
                throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE);
            }
        }
        if ((kind == Kind.RESULT) != (payload.contributor() != null)) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_ENVELOPE);
        }
    }

    public Envelope withContext(Map<String, String> carrier) {
        return new Envelope(schemaVersion, carrier.get("traceparent"), carrier.get("tracestate"),
            businessInvocationId, messageId, causationId, workflowId, kind, replayOf, payload);
    }

    public Envelope replay(String newMessageId) {
        return new Envelope(schemaVersion, traceparent, tracestate, businessInvocationId,
            newMessageId, messageId, workflowId, kind, messageId, payload);
    }

    @Override public String toString() { return "Envelope[v1,redacted]"; }
}
