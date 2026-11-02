package com.contoso.messaging;

import static org.junit.jupiter.api.Assertions.*;
import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenCredential;
import com.azure.core.http.HttpClient;
import com.azure.core.http.HttpHeaders;
import com.azure.core.http.HttpMethod;
import com.azure.core.http.HttpRequest;
import com.azure.core.http.HttpResponse;
import com.azure.core.models.CloudEvent;
import com.contoso.correlation.workflow.RunScenario;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class AzureSdkBoundaryTest {
    private static final String TOKEN = "synthetic-nonsecret-fixture-token";
    private static TokenCredential credential(List<String> scopes) {
        return request -> {
            scopes.addAll(request.getScopes());
            return Mono.just(new AccessToken(TOKEN, OffsetDateTime.now(ZoneOffset.UTC).plusHours(1)));
        };
    }
    @Test void businessTransportPinsNettyAndPreservesExplicitInjectedClient() throws Exception {
        try (var fixture = new MessagingFixture()) {
            TokenCredential tokens = credential(new ArrayList<>());
            try (var transport = new AzureMessagingTransport(fixture.settings, tokens, fixture.codec)) {
                assertTrue(transport.businessHttpClient().getClass().getName().startsWith("com.azure.core.http.netty."),
                    "business transport must not depend on HTTP provider discovery");
            }
            HttpClient injected = request -> Mono.just(response(request, 200, new HttpHeaders(), ""));
            try (var transport = new AzureMessagingTransport(fixture.settings, tokens, fixture.codec, injected)) {
                assertSame(injected, transport.businessHttpClient());
            }
        }
    }
    @Test void actualQueueSdkBase64EnvelopeRenewalRotatesReceiptUsedForDelete() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var scopes = new ArrayList<String>();
            var observed = new ArrayList<HttpRequest>();
            var envelope = MessagingFixture.envelope(RunScenario.STORAGE_QUEUE);
            String body = fixture.codec.json(envelope);
            String encoded = Base64.getEncoder().encodeToString(body.getBytes(StandardCharsets.UTF_8));
            String date = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.now().plusSeconds(300).atOffset(ZoneOffset.UTC));
            HttpClient http = request -> {
                observed.add(request);
                assertEquals("Bearer " + TOKEN, request.getHeaders().getValue("Authorization"));
                if (request.getHttpMethod() == HttpMethod.POST) {
                    assertTrue(request.getBodyAsBinaryData().toString().contains(encoded));
                    return Mono.just(response(request, 201, new HttpHeaders().set("Content-Type", "application/xml"),
                        "<QueueMessagesList><QueueMessage><MessageId>broker-message-id</MessageId><InsertionTime>" + date +
                        "</InsertionTime><ExpirationTime>" + date + "</ExpirationTime><PopReceipt>receipt-one</PopReceipt><TimeNextVisible>" +
                        date + "</TimeNextVisible></QueueMessage></QueueMessagesList>"));
                }
                if (request.getHttpMethod() == HttpMethod.GET) {
                    return Mono.just(response(request, 200, new HttpHeaders().set("Content-Type", "application/xml"),
                        "<QueueMessagesList><QueueMessage><MessageId>broker-message-id</MessageId><InsertionTime>" + date +
                        "</InsertionTime><ExpirationTime>" + date + "</ExpirationTime><PopReceipt>receipt-one</PopReceipt><TimeNextVisible>" +
                        date + "</TimeNextVisible><DequeueCount>2</DequeueCount><MessageText>" + encoded +
                        "</MessageText></QueueMessage></QueueMessagesList>"));
                }
                if (request.getHttpMethod() == HttpMethod.PUT) {
                    assertTrue(request.getUrl().getQuery().contains("popreceipt=receipt-one"));
                    return Mono.just(response(request, 204, new HttpHeaders().set("x-ms-popreceipt", "receipt-two")
                        .set("x-ms-time-next-visible", date), ""));
                }
                assertEquals(HttpMethod.DELETE, request.getHttpMethod());
                assertTrue(request.getUrl().getQuery().contains("popreceipt=receipt-two"));
                return Mono.just(response(request, 204, new HttpHeaders(), ""));
            };
            try (var transport = new AzureMessagingTransport(fixture.settings, credential(scopes), fixture.codec, http)) {
                transport.publish(Destination.STORAGE_QUEUE, envelope);
                var delivery = transport.receive(Source.LEGACY, 1, java.time.Duration.ofSeconds(1)).getFirst();
                assertEquals(envelope, delivery.envelope());
                assertEquals(2, delivery.deliveryCount());
                delivery.renew();
                delivery.complete();
            }
            assertEquals(4, observed.size());
            assertTrue(scopes.stream().allMatch(value -> value.equals("https://storage.azure.com/.default")));
        }
    }
    @Test void actualEventGridSdkUsesCredentialAndStructuredCloudEventExtensions() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var scopes = new ArrayList<String>();
            var envelope = MessagingFixture.envelope(RunScenario.EVENT_GRID);
            var sent = new ArrayList<CloudEvent>();
            HttpClient http = request -> {
                assertEquals(HttpMethod.POST, request.getHttpMethod());
                assertEquals("Bearer " + TOKEN, request.getHeaders().getValue("Authorization"));
                sent.addAll(CloudEvent.fromString(request.getBodyAsBinaryData().toString()));
                return Mono.just(response(request, 200, new HttpHeaders().set("Content-Type", "application/json"), "[]"));
            };
            try (var transport = new AzureMessagingTransport(fixture.settings, credential(scopes), fixture.codec, http)) {
                transport.publish(Destination.EVENT_GRID, envelope);
            }
            assertEquals(1, sent.size());
            assertEquals(envelope, new AzureCarriers(fixture.codec).cloudEvent(sent.getFirst()));
            assertTrue(scopes.stream().allMatch(value -> value.equals("https://eventgrid.azure.net/.default")));
        }
    }
    @Test void transportFailureDoesNotExposeRawSdkResponseOrCredentials() throws Exception {
        try (var fixture = new MessagingFixture()) {
            var scopes = new ArrayList<String>();
            HttpClient http = request -> Mono.just(response(request, 500, new HttpHeaders().set("Content-Type", "application/json"),
                "{\"error\":{\"code\":\"Fixture\",\"message\":\"raw-synthetic-sensitive-response\"}}"));
            try (var transport = new AzureMessagingTransport(fixture.settings, credential(scopes), fixture.codec, http)) {
                var failure = assertThrows(MessagingFailure.class,
                    () -> transport.publish(Destination.EVENT_GRID, MessagingFixture.envelope(RunScenario.EVENT_GRID)));
                assertEquals(MessagingFailure.Code.BROKER_UNAVAILABLE, failure.code());
                assertNull(failure.getCause());
                assertFalse(failure.getMessage().contains("raw-synthetic"));
                assertFalse(failure.getMessage().contains(TOKEN));
            }
        }
    }
    private static HttpResponse response(HttpRequest request, int status, HttpHeaders headers, String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return new HttpResponse(request) {
            public int getStatusCode() { return status; }
            public String getHeaderValue(String name) { return headers.getValue(name); }
            public HttpHeaders getHeaders() { return headers; }
            public Flux<ByteBuffer> getBody() { return bytes.length == 0 ? Flux.empty() : Flux.just(ByteBuffer.wrap(bytes)); }
            public Mono<byte[]> getBodyAsByteArray() { return Mono.just(bytes); }
            public Mono<String> getBodyAsString() { return Mono.just(body); }
            public Mono<String> getBodyAsString(Charset charset) { return Mono.just(new String(bytes, charset)); }
        };
    }
}
