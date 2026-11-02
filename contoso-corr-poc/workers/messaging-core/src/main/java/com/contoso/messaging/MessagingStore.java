package com.contoso.messaging;

import com.contoso.correlation.data.OperationContext;
import com.contoso.correlation.workflow.RunControl;
import com.contoso.correlation.workflow.WorkflowView;
import io.opentelemetry.api.trace.SpanContext;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public interface MessagingStore {
    record NewWorkflow(String id, String type, int demoId, int failureBudget, Envelope draft, List<Destination> destinations) {}
    record Pending(Envelope draft, Destination destination, String leaseToken, int publishAttempt) {}
    enum Disposition { EXECUTE, DUPLICATE, PAUSED, BUSY }
    record Attempt(String id, String leaseToken, int count, int failureBudget, Disposition disposition) {}
    record Contributor(Branch branch, String messageId, String resultMessageId, SpanContext context, String publisher,
                       SpanContext resultContext) {
        public Contributor(Branch branch, String messageId, String resultMessageId, SpanContext context, String publisher) {
            this(branch, messageId, resultMessageId, context, publisher, SpanContext.getInvalid());
        }
    }
    record PartitionLease(String partitionId, String token, long offset, long sequenceNumber, int receiveAttempt) {
        public PartitionLease(String partitionId, String token, long offset, long sequenceNumber) {
            this(partitionId, token, offset, sequenceNumber, 1);
        }
    }

    WorkflowView create(NewWorkflow command, OperationContext context);
    Optional<WorkflowView> find(String id, String type, OperationContext context);
    WorkflowView control(String id, RunControl command, OperationContext context);
    List<Pending> claimOutbox(int maximum, OperationContext context);
    void published(Pending pending, Envelope envelope, OperationContext context);
    void publicationRecorded(Pending pending, Envelope envelope, OperationContext context);
    void publicationFailed(Pending pending, String safeCode, OperationContext context);
    boolean trusted(Envelope envelope, Destination destination, Set<String> publishers, OperationContext context);
    Attempt begin(Envelope envelope, Branch branch, int deliveryCount, Map<String, String> processContext, OperationContext context);
    void complete(Envelope envelope, Branch branch, Attempt attempt, Map<String, String> processContext, OperationContext context);
    void failed(Envelope envelope, Branch branch, Attempt attempt, boolean deadLetter, OperationContext context);
    List<Contributor> contributors(String workflowId, Map<Branch, String> publishers, OperationContext context);
    List<Envelope> readyAggregates(int maximum, OperationContext context);
    Optional<Attempt> claimAggregate(Envelope result, OperationContext context);
    void aggregate(Envelope result, Attempt attempt, Map<String, String> processContext, OperationContext context);
    boolean replayRequested(String workflowId, OperationContext context);
    boolean replayRequested(String workflowId, Source source, OperationContext context);
    boolean replayAppliesTo(Envelope envelope, Source delivery, OperationContext context);
    String prepareReplay(Envelope original, Destination destination, OperationContext context);
    String prepareReplay(Envelope original, Source source, OperationContext context);
    Optional<PartitionLease> claimPartition(String partitionId, OperationContext context);
    void checkpoint(PartitionLease lease, long offset, long sequenceNumber, OperationContext context);
    void releasePartition(PartitionLease lease, OperationContext context);
    void quarantine(String partitionId, long offset, long sequenceNumber, String safeCode, OperationContext context);
}
