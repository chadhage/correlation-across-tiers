package com.contoso.messaging;

import com.azure.core.amqp.AmqpRetryOptions;
import com.azure.core.credential.TokenCredential;
import com.azure.core.http.policy.FixedDelayOptions;
import com.azure.core.http.policy.HttpLogDetailLevel;
import com.azure.core.http.policy.HttpLogOptions;
import com.azure.core.http.policy.RetryOptions;
import com.azure.core.http.HttpClient;
import com.azure.core.http.netty.NettyAsyncHttpClientBuilder;
import com.azure.core.models.CloudEvent;
import com.azure.core.util.BinaryData;
import com.azure.messaging.eventgrid.EventGridPublisherClient;
import com.azure.messaging.eventgrid.EventGridPublisherClientBuilder;
import com.azure.messaging.eventhubs.EventHubClientBuilder;
import com.azure.messaging.eventhubs.EventHubConsumerClient;
import com.azure.messaging.eventhubs.EventHubProducerClient;
import com.azure.messaging.eventhubs.models.EventPosition;
import com.azure.messaging.servicebus.ServiceBusClientBuilder;
import com.azure.messaging.servicebus.ServiceBusReceiverClient;
import com.azure.messaging.servicebus.ServiceBusSenderClient;
import com.azure.messaging.servicebus.models.DeadLetterOptions;
import com.azure.messaging.servicebus.models.ServiceBusReceiveMode;
import com.azure.messaging.servicebus.models.SubQueue;
import com.azure.storage.queue.QueueClient;
import com.azure.storage.queue.QueueClientBuilder;
import com.azure.storage.queue.QueueMessageEncoding;
import com.azure.storage.queue.models.QueueMessageItem;
import com.azure.storage.queue.models.UpdateMessageResult;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

public final class AzureMessagingTransport implements MessagingTransport {
    private final MessagingSettings settings;
    private final TokenCredential credential;
    private final AzureCarriers carriers;
    private final HttpClient httpClient;
    private final Map<Destination, ServiceBusSenderClient> senders = new EnumMap<>(Destination.class);
    private final Map<Source, ServiceBusReceiverClient> receivers = new EnumMap<>(Source.class);
    private final Map<String, QueueClient> queues = new java.util.HashMap<>();
    private EventGridPublisherClient<CloudEvent> grid;
    private EventHubProducerClient hubProducer;
    private EventHubConsumerClient hubConsumer;
    private boolean closed;

    public AzureMessagingTransport(MessagingSettings settings, EnvelopeCodec codec) {
        this(settings, settings.credential(), codec);
    }
    public AzureMessagingTransport(MessagingSettings settings, TokenCredential credential, EnvelopeCodec codec) {
        this(settings, credential, codec, null);
    }
    public AzureMessagingTransport(MessagingSettings settings, TokenCredential credential, EnvelopeCodec codec, HttpClient httpClient) {
        this.settings = settings;
        this.credential = credential;
        this.carriers = new AzureCarriers(codec);
        this.httpClient = httpClient == null ? new NettyAsyncHttpClientBuilder().build() : httpClient;
    }

    public HttpClient businessHttpClient() { return httpClient; }

    private ServiceBusClientBuilder bus() {
        return new ServiceBusClientBuilder().credential(settings.serviceBusNamespace(), credential)
            .clientOptions(MessagingSettings.noTracing())
            .retryOptions(new AmqpRetryOptions().setMaxRetries(0).setTryTimeout(Duration.ofSeconds(10)));
    }

    private synchronized ServiceBusSenderClient sender(Destination destination) {
        open();
        return senders.computeIfAbsent(destination, value -> value == Destination.SERVICE_BUS_TOPIC ?
            bus().sender().topicName(value.entity()).buildClient() : bus().sender().queueName(value.entity()).buildClient());
    }

    private synchronized ServiceBusReceiverClient receiver(Source source) {
        open();
        return receivers.computeIfAbsent(source, value -> {
            var builder = bus().receiver().prefetchCount(0).receiveMode(ServiceBusReceiveMode.PEEK_LOCK);
            if (value.subscription() == null) builder.queueName(value.entity());
            else builder.topicName(value.entity()).subscriptionName(value.subscription());
            if (value.deadLetter()) builder.subQueue(SubQueue.DEAD_LETTER_QUEUE);
            return builder.buildClient();
        });
    }

    private synchronized QueueClient queue(String name) {
        open();
        return queues.computeIfAbsent(name, value -> {
            var builder = new QueueClientBuilder().endpoint(settings.queueEndpoint() + "/" + value).credential(credential)
            .clientOptions(MessagingSettings.noTracing()).messageEncoding(QueueMessageEncoding.BASE64)
            .retryOptions(new RetryOptions(new FixedDelayOptions(0, Duration.ofMillis(1))))
            .httpLogOptions(new HttpLogOptions().setLogLevel(HttpLogDetailLevel.NONE));
            builder.httpClient(httpClient);
            return builder.buildClient();
        });
    }

    private synchronized EventGridPublisherClient<CloudEvent> grid() {
        open();
        if (grid == null) {
            var builder = new EventGridPublisherClientBuilder().endpoint(settings.eventGridEndpoint())
            .credential(credential).clientOptions(MessagingSettings.noTracing())
            .httpLogOptions(new HttpLogOptions().setLogLevel(HttpLogDetailLevel.NONE))
            .retryOptions(new RetryOptions(new FixedDelayOptions(0, Duration.ofMillis(1))));
            builder.httpClient(httpClient);
            grid = builder.buildCloudEventPublisherClient();
        }
        return grid;
    }

    private EventHubClientBuilder hubs() {
        return new EventHubClientBuilder().credential(settings.eventHubsNamespace(), Destination.EVENT_HUBS.entity(), credential)
            .clientOptions(MessagingSettings.noTracing())
            .retryOptions(new AmqpRetryOptions().setMaxRetries(0).setTryTimeout(Duration.ofSeconds(10)));
    }
    private synchronized EventHubProducerClient hubProducer() {
        open();
        if (hubProducer == null) hubProducer = hubs().buildProducerClient();
        return hubProducer;
    }
    private synchronized EventHubConsumerClient hubConsumer() {
        open();
        if (hubConsumer == null) hubConsumer = hubs().consumerGroup("contoso-workers").buildConsumerClient();
        return hubConsumer;
    }

    @Override public void publish(Destination destination, Envelope envelope) {
        try {
            switch (destination) {
                case SERVICE_BUS_ORDER, SERVICE_BUS_TOPIC, SERVICE_BUS_RESULT ->
                    sender(destination).sendMessage(carriers.serviceBus(envelope));
                case EVENT_GRID -> grid().sendEvent(carriers.cloudEvent(envelope));
                case EVENT_HUBS -> {
                    var batch = hubProducer().createBatch();
                    if (!batch.tryAdd(carriers.eventHub(envelope))) throw new MessagingFailure(MessagingFailure.Code.ENVELOPE_TOO_LARGE);
                    hubProducer().send(batch);
                }
                case STORAGE_QUEUE -> queue(destination.entity()).sendMessageWithResponse(carriers.queue(envelope),
                    Duration.ZERO, Duration.ofDays(1), Duration.ofSeconds(10), com.azure.core.util.Context.NONE);
            }
        } catch (MessagingFailure safe) { throw safe; }
        catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.BROKER_UNAVAILABLE); }
    }

    @Override public List<Delivery> receive(Source source, int maximum, Duration wait) {
        bounds(maximum, wait);
        try {
            var deliveries = new ArrayList<Delivery>();
            if (source == Source.LEGACY || source == Source.LEGACY_POISON) {
                QueueClient queue = queue(source.entity());
                for (var item : queue.receiveMessages(maximum, Duration.ofSeconds(45), Duration.ofSeconds(10), com.azure.core.util.Context.NONE)) {
                    deliveries.add(queueDelivery(source, queue, item));
                }
            } else {
                ServiceBusReceiverClient receiver = receiver(source);
                for (var message : receiver.receiveMessages(maximum, wait)) {
                    deliveries.add(new Delivery() {
                        private volatile Instant expires = message.getLockedUntil().toInstant();
                        public Source source() { return source; }
                        public Envelope envelope() {
                            if (source != Source.EVENT_GRID_RELAY) return carriers.serviceBus(message);
                            byte[] bytes = message.getBody().toBytes();
                            if (bytes.length > Envelope.MAX_BYTES + 2048) throw new MessagingFailure(MessagingFailure.Code.ENVELOPE_TOO_LARGE);
                            try {
                                var events = CloudEvent.fromString(message.getBody().toString());
                                if (events.size() != 1) throw new MessagingFailure(MessagingFailure.Code.INVALID_CARRIER);
                                return carriers.cloudEvent(events.getFirst());
                            } catch (MessagingFailure safe) { throw safe; }
                            catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.INVALID_CARRIER); }
                        }
                        public int deliveryCount() { return (int) Math.max(1, Math.min(1_000_000_000L, message.getDeliveryCount())); }
                        public Instant lockedUntil() { return expires; }
                        public Instant renew() {
                            try { expires = receiver.renewMessageLock(message).toInstant(); return expires; }
                            catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.LOCK_LOST); }
                        }
                        public void complete() { settle(() -> receiver.complete(message)); }
                        public void abandon() { settle(() -> receiver.abandon(message)); }
                        public void deadLetter(String reason) {
                            safeReason(reason);
                            settle(() -> receiver.deadLetter(message, new DeadLetterOptions().setDeadLetterReason(reason)));
                        }
                    });
                }
            }
            return List.copyOf(deliveries);
        } catch (MessagingFailure safe) { throw safe; }
        catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.BROKER_UNAVAILABLE); }
    }

    private Delivery queueDelivery(Source source, QueueClient queue, QueueMessageItem item) {
        return new Delivery() {
            private final AtomicReference<String> receipt = new AtomicReference<>(item.getPopReceipt());
            private volatile Instant expires = item.getTimeNextVisible().toInstant();
            public Source source() { return source; }
            public Envelope envelope() { return carriers.queue(item.getBody()); }
            public int deliveryCount() { return (int) Math.max(1, Math.min(1_000_000_000L, item.getDequeueCount())); }
            public Instant lockedUntil() { return expires; }
            private Instant visibility(Duration duration) {
                try {
                    UpdateMessageResult result = queue.updateMessageWithResponse(item.getMessageId(),
                        receipt.get(), null, duration, Duration.ofSeconds(10), com.azure.core.util.Context.NONE).getValue();
                    receipt.set(result.getPopReceipt()); expires = result.getTimeNextVisible().toInstant(); return expires;
                } catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.LOCK_LOST); }
            }
            public Instant renew() { return visibility(Duration.ofSeconds(45)); }
            public void complete() {
                settle(() -> queue.deleteMessageWithResponse(item.getMessageId(), receipt.get(), Duration.ofSeconds(10), com.azure.core.util.Context.NONE));
            }
            public void abandon() { visibility(Duration.ZERO); }
            public void deadLetter(String reason) {
                safeReason(reason);
                if (source == Source.LEGACY_POISON) throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
                settle(() -> queue("contoso-legacy-poison").sendMessageWithResponse(item.getBody(),
                    Duration.ZERO, Duration.ofDays(1), Duration.ofSeconds(10), com.azure.core.util.Context.NONE));
                complete();
            }
        };
    }

    @Override public List<String> partitions() {
        try { return hubConsumer().getPartitionIds().stream().toList(); }
        catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.BROKER_UNAVAILABLE); }
    }

    @Override public List<HubRecord> receiveBatch(String partitionId, long afterOffset, int maximum, Duration wait) {
        bounds(maximum, wait);
        if (partitionId == null || !partitionId.matches("0|[1-9][0-9]{0,8}") || afterOffset < -1) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        }
        try {
            var records = new ArrayList<HubRecord>();
            var position = afterOffset < 0 ? EventPosition.earliest() : EventPosition.fromOffsetString(Long.toString(afterOffset));
            for (var item : hubConsumer().receiveFromPartition(partitionId, maximum, position, wait)) {
                var data = item.getData();
                try { records.add(new HubRecord(carriers.eventHub(data), partitionId, data.getOffset(), data.getSequenceNumber())); }
                catch (MessagingFailure failure) {
                    records.add(new HubRecord(null, partitionId, data.getOffset(), data.getSequenceNumber(), failure.code().name()));
                }
            }
            return List.copyOf(records);
        } catch (MessagingFailure safe) { throw safe; }
        catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.BROKER_UNAVAILABLE); }
    }

    private static void bounds(int maximum, Duration wait) {
        if (maximum < 1 || maximum > 32 || wait == null || wait.isNegative() || wait.compareTo(Duration.ofSeconds(10)) > 0) {
            throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
        }
    }
    private static void settle(Runnable action) {
        try { action.run(); }
        catch (RuntimeException ignored) { throw new MessagingFailure(MessagingFailure.Code.LOCK_LOST); }
    }
    private static void safeReason(String reason) {
        if (reason == null || !reason.matches("[A-Z][A-Z0-9_]{0,47}")) throw new MessagingFailure(MessagingFailure.Code.INVALID_STATE);
    }
    private synchronized void open() { if (closed) throw new MessagingFailure(MessagingFailure.Code.BROKER_UNAVAILABLE); }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        receivers.values().forEach(ServiceBusReceiverClient::close);
        senders.values().forEach(ServiceBusSenderClient::close);
        if (hubConsumer != null) hubConsumer.close();
        if (hubProducer != null) hubProducer.close();
    }
}
