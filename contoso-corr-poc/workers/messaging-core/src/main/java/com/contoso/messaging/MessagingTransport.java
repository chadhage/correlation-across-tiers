package com.contoso.messaging;

import java.time.Duration;
import java.util.List;

public interface MessagingTransport extends AutoCloseable {
    record HubRecord(Envelope envelope, String partitionId, long offset, long sequenceNumber, String rejection) {
        public HubRecord(Envelope envelope, String partitionId, long offset, long sequenceNumber) {
            this(envelope, partitionId, offset, sequenceNumber, null);
        }
    }
    void publish(Destination destination, Envelope envelope);
    List<Delivery> receive(Source source, int maximum, Duration wait);
    List<String> partitions();
    List<HubRecord> receiveBatch(String partitionId, long afterOffset, int maximum, Duration wait);
    @Override void close();
}
