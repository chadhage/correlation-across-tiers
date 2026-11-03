package com.contoso.orders;

import static org.junit.jupiter.api.Assertions.*;

import com.contoso.correlation.InvocationId;
import com.contoso.correlation.InvocationIds;
import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.SamplingLease;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class NativeApiIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper()
        .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    private static final String ABSENT = "{\"$contosoAbsent\":true}";
    private static final int PAYLOAD_LIMIT = 1_048_576;

    @Test @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
    void actualApisAuthenticatePropagateAndChangeJdbcRedisStateUnderOneAgentEach() throws Exception {
        Path root = Path.of(System.getProperty("basedir")).resolve("..\\..").normalize();
        Path directory = root.resolve("tests\\java\\generated-fixtures\\" + UUID.randomUUID());
        Files.createDirectories(directory);
        var key = new RSAKeyGenerator(2048).keyID("contoso-native-api").generate();
        Map<String, String> identity = identities(key);
        String userObject = UUID.randomUUID().toString();
        String userToken = token(key, identity, identity.get("CONTOSO_TEST_PUBLIC_AUDIENCE"),
            identity.get("CONTOSO_TEST_STOREFRONT_CLIENT"), userObject, "user", List.of("Demo.Control"), "Orders.Invoke");
        String gatewayToken = token(key, identity, identity.get("CONTOSO_TEST_ORDERS_AUDIENCE"),
            identity.get("CONTOSO_TEST_GATEWAY_CLIENT"), identity.get("CONTOSO_TEST_GATEWAY_OBJECT"), "app", List.of("Gateway.Invoke"), null);
        String inventoryToken = token(key, identity, identity.get("CONTOSO_TEST_INVENTORY_AUDIENCE"),
            identity.get("CONTOSO_TEST_ORDERS_CLIENT"), identity.get("CONTOSO_TEST_ORDERS_OBJECT"), "app", List.of("Inventory.Invoke"), null);
        List<String> publishers = List.of(UUID.randomUUID().toString(), UUID.randomUUID().toString());
        var forbiddenValues = new ArrayList<>(List.of(userToken, gatewayToken, inventoryToken, userObject,
            identity.get("CONTOSO_TEST_TENANT")));
        identity.forEach((name, value) -> { if (name.endsWith("_OBJECT")) forbiddenValues.add(value); });
        List<NativePayload> payloads = new CopyOnWriteArrayList<>();
        var excludedHttpRequests = new AtomicInteger();
        var captureFailure = new AtomicReference<String>();
        var captureCompletion = new NativeCaptureCompletion(captureFailure);
        List<JsonNode> received = new CopyOnWriteArrayList<>();
        var captureDeadlines = captureDeadlines();
        var receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        receiver.createContext("/", exchange -> {
            if (!captureCompletion.begin()) {
                try { exchange.sendResponseHeaders(503, -1); } finally { exchange.close(); }
                return;
            }
            var deadline = nativeCaptureDeadline(receiver, captureFailure, captureDeadlines);
            if (!"POST".equals(exchange.getRequestMethod()) ||
                !Set.of("/v2/track", "/v2.1/track").contains(exchange.getRequestURI().getPath())) {
                excludedHttpRequests.incrementAndGet();
                try { exchange.sendResponseHeaders(404, -1); }
                finally {
                    try { exchange.close(); }
                    finally { deadline.cancel(false); captureCompletion.complete(); }
                }
                return;
            }
            try {
                byte[] original = exchange.getRequestBody().readNBytes(PAYLOAD_LIMIT + 1);
                if (original.length == 0) throw new IOException("NATIVE_API_CAPTURE_EMPTY_BYTES");
                if (original.length > PAYLOAD_LIMIT) throw new IOException("NATIVE_API_CAPTURE_WIRE_BOUND");
                String encoding = exchange.getRequestHeaders().getFirst("Content-Encoding");
                if (encoding == null) encoding = "identity";
                if (!Set.of("gzip", "identity").contains(encoding)) throw new IOException("NATIVE_API_CAPTURE_ENCODING");
                byte[] decoded = original;
                if (encoding.equals("gzip")) {
                    try (var gzip = new GZIPInputStream(new ByteArrayInputStream(original))) {
                        decoded = gzip.readNBytes(PAYLOAD_LIMIT + 1);
                    }
                    if (decoded.length > PAYLOAD_LIMIT) throw new IOException("NATIVE_API_CAPTURE_DECOMPRESSED_BOUND");
                }
                int count = 0;
                try (var parser = JSON.getFactory().createParser(decoded)) {
                    while (parser.nextToken() != null) {
                        JsonNode item = JSON.readTree(parser);
                        if (item.isArray()) {
                            for (JsonNode envelope : item) {
                                if (!envelope.isObject()) throw new IOException("NATIVE_API_CAPTURE_SCHEMA");
                            }
                            count += item.size();
                        } else if (item.isObject()) count++;
                        else throw new IOException("NATIVE_API_CAPTURE_SCHEMA");
                    }
                }
                if (count == 0) throw new IOException("NATIVE_API_CAPTURE_EMPTY_ENVELOPES");
                if (count > 512) throw new IOException("NATIVE_API_CAPTURE_ENVELOPE_BOUND");
                synchronized (payloads) {
                    if (payloads.size() >= 16) throw new IOException("NATIVE_API_CAPTURE_PACKET_BOUND");
                    payloads.add(new NativePayload(original, encoding, count));
                }
                byte[] response = ("{\"itemsReceived\":" + count + ",\"itemsAccepted\":" + count + ",\"errors\":[]}")
                    .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } catch (IOException | RuntimeException failure) {
                String code = failure.getMessage();
                captureFailure.compareAndSet(null, code != null && code.matches("NATIVE_API_[A-Z_]+")
                    ? code : "NATIVE_API_CAPTURE_REJECTED_" + failure.getClass().getSimpleName());
                exchange.sendResponseHeaders(503, -1);
            } finally {
                try { exchange.close(); }
                finally { deadline.cancel(false); captureCompletion.complete(); }
            }
        });
        receiver.start();
        Child inventory = null, orders = null;
        try (var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()) {
            inventory = start(root, directory, "inventory", "http://127.0.0.1:1/api", inventoryToken, identity,
                receiver.getAddress().getPort(), publishers.get(0));
            orders = start(root, directory, "orders", inventory.base(), inventoryToken, identity,
                receiver.getAddress().getPort(), publishers.get(1));
            String business = InvocationId.generate().value();
            assertTrickleDeadline(inventory, "/api/inventory/reservations", inventoryToken, null, business, 6500);
            assertTrickleDeadline(orders, "/api/orders", userToken, gatewayToken, business, 11500);
            var created = send(client, orders.base() + "/orders", "POST",
                "{\"schemaVersion\":1,\"sku\":\"CONTOSO-001\",\"quantity\":2}", userToken, gatewayToken, business);
            assertEquals(202, created.statusCode(), created.body());
            JsonNode view = JSON.readTree(created.body());
            String orderId = view.path("id").asText();
            assertEquals(business, view.path("businessInvocationId").asText());
            assertEquals(business, view.path("workflowBusinessInvocationId").asText());
            assertNotEquals(business, orderId);
            String repeatInvocation = InvocationId.generate().value();
            var repeated = send(client, orders.base() + "/orders", "POST",
                "{\"schemaVersion\":1,\"orderId\":\"" + orderId + "\",\"sku\":\"CONTOSO-001\",\"quantity\":2}",
                userToken, gatewayToken, repeatInvocation);
            assertMutationIdentity(repeated, repeatInvocation, business, orderId);
            String readInvocation = InvocationId.generate().value();
            var persisted = send(client, orders.base() + "/orders/" + orderId, "GET", null, userToken, gatewayToken, readInvocation);
            assertEquals(200, persisted.statusCode(), persisted.body());
            assertEquals(business, JSON.readTree(persisted.body()).path("businessInvocationId").asText());
            assertEquals(readInvocation, persisted.headers().firstValue(InvocationIds.HEADER).orElseThrow());
            String reserveBody = "{\"schemaVersion\":1,\"orderId\":\"" + orderId + "\",\"sku\":\"CONTOSO-001\",\"quantity\":2}";
            var reserved = send(client, inventory.base() + "/inventory/reservations", "POST", reserveBody, inventoryToken, null, business);
            assertEquals(200, reserved.statusCode(), reserved.body());
            String reservation = JSON.readTree(reserved.body()).path("reservationId").asText();
            assertEquals(18, stock(client, inventory.base(), inventoryToken, business));
            var duplicate = send(client, inventory.base() + "/inventory/reservations", "POST", reserveBody, inventoryToken, null, business);
            assertEquals(reservation, JSON.readTree(duplicate.body()).path("reservationId").asText());
            assertEquals(18, stock(client, inventory.base(), inventoryToken, business));
            var released = send(client, inventory.base() + "/inventory/reservations/" + reservation + "/release", "POST",
                "{\"schemaVersion\":1,\"orderId\":\"" + orderId + "\"}", inventoryToken, null, business);
            assertEquals(200, released.statusCode(), released.body());
            assertEquals("RELEASED", JSON.readTree(released.body()).path("state").asText());
            assertEquals(20, stock(client, inventory.base(), inventoryToken, business));
            String runInvocation = InvocationId.generate().value();
            String runId = InvocationId.generate().value();
            String runBody = "{\"schemaVersion\":1,\"runId\":\"" + runId + "\",\"demoId\":1,\"scenario\":\"SYNC\"}";
            var run = send(client, orders.base() + "/demo-runs", "POST", runBody, userToken, gatewayToken, runInvocation);
            assertMutationIdentity(run, runInvocation, runInvocation, runId);
            String repeatRunInvocation = InvocationId.generate().value();
            assertMutationIdentity(send(client, orders.base() + "/demo-runs", "POST", runBody, userToken, gatewayToken,
                repeatRunInvocation), repeatRunInvocation, runInvocation, runId);
            String controlInvocation = InvocationId.generate().value();
            assertMutationIdentity(send(client, orders.base() + "/demo-runs/" + runId + "/controls", "POST",
                "{\"schemaVersion\":1,\"action\":\"PAUSE\",\"target\":\"ORDER\",\"failureBudget\":0}",
                userToken, gatewayToken, controlInvocation), controlInvocation, runInvocation, runId);
            String readRunInvocation = InvocationId.generate().value();
            var storedRun = send(client, orders.base() + "/demo-runs/" + runId, "GET", null, userToken, gatewayToken,
                readRunInvocation);
            assertEquals(200, storedRun.statusCode(), storedRun.body());
            assertEquals(readRunInvocation, storedRun.headers().firstValue(InvocationIds.HEADER).orElseThrow());
            assertEquals(runInvocation, JSON.readTree(storedRun.body()).path("businessInvocationId").asText());
            assertEquals("true", JSON.readTree(storedRun.body()).path("details").path("paused").asText());
            var me = send(client, orders.base() + "/me", "GET", null, userToken, gatewayToken, business);
            assertEquals("user", JSON.readTree(me.body()).path("actorType").asText());
            assertTrue(JSON.readTree(me.body()).path("pseudonym").asText().matches("h1:[0-9a-f]{32}:[A-Za-z0-9_-]{43}"));
            orders.stop(); inventory.stop();
            captureCompletion.sealAndAwait(receiver);
            JsonNode safeCapture = scanOriginalPayloads(root, List.copyOf(payloads), publishers, forbiddenValues);
            safeCapture.path("nativeEnvelopes").forEach(received::add);
            String executionId = java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssSSS'Z'")
                .withZone(ZoneOffset.UTC).format(Instant.now()) + "-" + UUID.randomUUID();
            Path epoch = createCaptureDirectory(root.resolve("evidence\\java-local\\native-api"), executionId);
            Path capturePath = persistCaptured(epoch, executionId, received, safeCapture);
            var request = received.stream().filter(row -> type(row).equals("RequestData") &&
                row.path("tags").path("ai.cloud.role").asText().equals("contoso-orders-api") &&
                data(row).path("responseCode").asText().equals("202") &&
                data(row).path("url").asText().endsWith("/api/orders")).findFirst().orElseThrow();
            String trace = request.path("tags").path("ai.operation.id").asText();
            var http = received.stream().filter(row -> type(row).equals("RemoteDependencyData") &&
                row.path("tags").path("ai.operation.id").asText().equals(trace) &&
                row.path("tags").path("ai.operation.parentId").asText().equals(data(request).path("id").asText()) &&
                data(row).path("data").asText().contains("/api/inventory/CONTOSO-001")).findFirst().orElseThrow();
            var server = received.stream().filter(row -> type(row).equals("RequestData") &&
                row.path("tags").path("ai.cloud.role").asText().equals("contoso-inventory-api") &&
                row.path("tags").path("ai.operation.id").asText().equals(trace) &&
                row.path("tags").path("ai.operation.parentId").asText().equals(data(http).path("id").asText())).findFirst().orElseThrow();
            assertEquals(business, data(server).path("properties").path("business.invocation_id").asText());
            for (String system : List.of("postgresql", "redis")) {
                assertTrue(received.stream().anyMatch(row -> row.path("tags").path("ai.operation.id").asText().equals(trace) &&
                    (system.equals("postgresql") ? data(row).path("properties").has("contoso.data.operation") :
                        data(row).path("type").asText().equalsIgnoreCase("redis") ||
                        data(row).path("properties").has("contoso.cache.outcome")) &&
                    data(row).path("properties").path("contoso.span.kind").asText().equals("CLIENT") &&
                    data(row).path("properties").path("business.invocation_id").asText().equals(business)),
                    system + received.stream().filter(row -> row.path("tags").path("ai.operation.id").asText().equals(trace))
                        .map(row -> data(row).path("type").asText() + ":" + data(row).path("properties")).toList());
            }
            var ids = received.stream().filter(row -> row.path("tags").path("ai.operation.id").asText().equals(trace) &&
                Set.of("RequestData", "RemoteDependencyData").contains(type(row))).map(row -> data(row).path("id").asText()).toList();
            assertEquals(ids.size(), new HashSet<>(ids).size());
            assertTrue(ids.stream().allMatch(id -> id.matches("[0-9a-f]{16}") && !id.equals("0".repeat(16))));
            var report = JSON.createObjectNode();
            report.put("schema", "contoso.real-api-native-receipts.v1").put("sourceKind", "real-two-jvm-agent-loopback")
                .put("certificationEligible", false).put("agentSha256", RuntimeGuard.AGENT_SHA256)
                .put("generatedAtUtc", Instant.now().toString()).put("businessInvocationId", business)
                .put("executionId", executionId)
                .put("capturePath", root.relativize(capturePath).toString())
                .put("captureSha256", HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(Files.readAllBytes(capturePath))))
                .put("excludedNonTelemetryHttpRequests", excludedHttpRequests.get())
                .put("orderId", orderId).put("inventoryStockAfterReserve", 18).put("inventoryStockAfterRelease", 20)
                .put("brokerDeliveryClaimed", false).put("directHttpClientBusinessAttributeObserved",
                    data(http).path("properties").has("business.invocation_id"));
            report.set("originalPrivacyCapture", privacyMetadata(safeCapture));
            var envelopes = report.putArray("nativeEnvelopes");
            received.forEach(envelopes::add);
            Path output = writeCapture(epoch, "receipts.json", report);
            System.out.println("CONTOSO_NATIVE_API_RECEIPT " + output);
        } finally {
            if (orders != null) orders.close();
            if (inventory != null) inventory.close();
            receiver.stop(0);
            captureDeadlines.shutdownNow();
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    private static ScheduledExecutorService captureDeadlines() {
        return Executors.newSingleThreadScheduledExecutor(action -> {
            Thread thread = new Thread(action, "contoso-native-capture-deadline");
            thread.setDaemon(true);
            return thread;
        });
    }
    private static ScheduledFuture<?> nativeCaptureDeadline(HttpServer receiver, AtomicReference<String> failure,
                                                            ScheduledExecutorService deadlines) {
        return deadlines.schedule(() -> {
            failure.compareAndSet(null, "NATIVE_API_CAPTURE_TIMEOUT");
            receiver.stop(0);
        }, 5, TimeUnit.SECONDS);
    }
    private static void requireCompleteCapture(AtomicReference<String> failure) {
        assertNull(failure.get(), "Original native payload capture failed");
    }

    private static final class NativeCaptureCompletion {
        private final AtomicReference<String> failure;
        private boolean sealed;
        private int active;

        NativeCaptureCompletion(AtomicReference<String> failure) { this.failure = failure; }
        synchronized boolean begin() {
            if (sealed) {
                failure.compareAndSet(null, "NATIVE_API_CAPTURE_AFTER_SEAL");
                return false;
            }
            active++;
            return true;
        }
        synchronized void complete() {
            if (active <= 0) throw new IllegalStateException("NATIVE_API_CAPTURE_COMPLETION_MISMATCH");
            active--;
            notifyAll();
        }
        void sealAndAwait(HttpServer receiver) throws InterruptedException {
            synchronized (this) { sealed = true; }
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
            receiver.stop(6);
            synchronized (this) {
                while (active > 0) {
                    long remaining = deadline - System.nanoTime();
                    if (remaining <= 0) {
                        failure.compareAndSet(null, "NATIVE_API_CAPTURE_INFLIGHT_TIMEOUT");
                        break;
                    }
                    TimeUnit.NANOSECONDS.timedWait(this, remaining);
                }
            }
            requireCompleteCapture(failure);
        }
    }

    @Test void activeNativeHttpBodyHasAbsoluteDeadlineAndCannotFinalizeAnEarlierGoodPrefix() throws Exception {
        var failure = new AtomicReference<String>();
        var deadlines = captureDeadlines();
        var completion = new NativeCaptureCompletion(failure);
        var accepted = new AtomicInteger();
        var activeBodyStarted = new CountDownLatch(1);
        var approved = new java.util.concurrent.atomic.AtomicBoolean();
        var finalizer = Executors.newSingleThreadExecutor();
        var receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        receiver.createContext("/", exchange -> {
            if (!completion.begin()) {
                try { exchange.sendResponseHeaders(503, -1); } finally { exchange.close(); }
                return;
            }
            var deadline = nativeCaptureDeadline(receiver, failure, deadlines);
            try {
                if ("100000".equals(exchange.getRequestHeaders().getFirst("Content-Length"))) activeBodyStarted.countDown();
                exchange.getRequestBody().readNBytes(1024);
                if (failure.get() != null) return;
                accepted.incrementAndGet();
                exchange.sendResponseHeaders(200, -1);
            } catch (IOException stopped) {
                failure.compareAndSet(null, "NATIVE_API_CAPTURE_READ_FAILED");
            } finally {
                try { exchange.close(); }
                finally { deadline.cancel(false); completion.complete(); }
            }
        });
        receiver.start();
        Thread writer = null;
        try (var first = new Socket("127.0.0.1", receiver.getAddress().getPort())) {
            first.setSoTimeout(2000);
            first.getOutputStream().write("POST /v2/track HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\n\r\nx"
                .getBytes(StandardCharsets.US_ASCII));
            assertTrue(new BufferedReader(new InputStreamReader(first.getInputStream(), StandardCharsets.US_ASCII))
                .readLine().contains(" 200 "));
            assertEquals(1, accepted.get());
            try (var active = new Socket("127.0.0.1", receiver.getAddress().getPort())) {
                active.setSoTimeout(6500);
                active.getOutputStream().write("POST /v2/track HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n"
                    .getBytes(StandardCharsets.US_ASCII));
                long start = System.nanoTime();
                writer = Thread.ofVirtual().start(() -> {
                    try {
                        for (;;) { active.getOutputStream().write('x'); active.getOutputStream().flush(); Thread.sleep(20); }
                    } catch (IOException stopped) {
                        if (!"NATIVE_API_CAPTURE_TIMEOUT".equals(failure.get())) failure.compareAndSet(null, "WRITER_FAILED");
                    } catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
                });
                assertTrue(activeBodyStarted.await(2, TimeUnit.SECONDS));
                Future<?> finalized = finalizer.submit(() -> {
                    try { completion.sealAndAwait(receiver); approved.set(true); }
                    catch (InterruptedException stopped) { Thread.currentThread().interrupt(); throw new AssertionError(stopped); }
                });
                Thread.sleep(100);
                assertFalse(finalized.isDone(), "An active capture must not approve the earlier good prefix before its deadline");
                assertFalse(approved.get());
                try { assertEquals(-1, active.getInputStream().read()); }
                catch (SocketException closed) { assertEquals("NATIVE_API_CAPTURE_TIMEOUT", failure.get()); }
                long elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis();
                assertTrue(elapsed >= 4500 && elapsed < 6500, "Absolute five-second native read budget");
                assertEquals("NATIVE_API_CAPTURE_TIMEOUT", failure.get());
                var rejected = assertThrows(ExecutionException.class, () -> finalized.get(2, TimeUnit.SECONDS));
                assertInstanceOf(AssertionError.class, rejected.getCause());
                assertFalse(approved.get());
                assertEquals(1, accepted.get());
            }
        } finally {
            if (writer != null) { writer.interrupt(); writer.join(1000); }
            receiver.stop(0);
            deadlines.shutdownNow();
            finalizer.shutdownNow();
        }
    }

    private static void assertMutationIdentity(HttpResponse<String> response, String action, String workflow,
                                                String id) throws Exception {
        assertEquals(202, response.statusCode(), response.body());
        assertEquals(action, response.headers().firstValue(InvocationIds.HEADER).orElseThrow());
        JsonNode value = JSON.readTree(response.body());
        assertEquals(id, value.path("id").asText());
        assertEquals(action, value.path("businessInvocationId").asText());
        assertEquals(workflow, value.path("workflowBusinessInvocationId").asText());
    }

    @Test void captureEpochAndFilesNeverOverwriteHistoricalOrExistingBytes() throws Exception {
        Path root = Path.of(System.getProperty("basedir")).resolve("..\\..").normalize();
        Path directory = root.resolve("tests\\java\\generated-fixtures\\" + UUID.randomUUID());
        Files.createDirectories(directory);
        try {
            byte[] sentinel = "historical capture sentinel".getBytes(StandardCharsets.UTF_8);
            for (String file : List.of("native-api-capture.json", "native-api-receipts.json")) {
                Files.write(directory.resolve(file), sentinel, StandardOpenOption.CREATE_NEW);
            }
            String id = "20261101T000000000Z-" + UUID.randomUUID();
            Path epoch = createCaptureDirectory(directory, id);
            JsonNode capture = JSON.createObjectNode().put("schema", "test-capture-only");
            Path output = writeCapture(epoch, "capture.json", capture);
            byte[] first = Files.readAllBytes(output);
            assertThrows(FileAlreadyExistsException.class, () -> writeCapture(epoch, "capture.json", capture));
            assertArrayEquals(first, Files.readAllBytes(output));
            assertThrows(FileAlreadyExistsException.class, () -> createCaptureDirectory(directory, id));
            for (String file : List.of("native-api-capture.json", "native-api-receipts.json")) {
                assertArrayEquals(sentinel, Files.readAllBytes(directory.resolve(file)));
            }
        } finally {
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    private static int stock(HttpClient client, String base, String token, String business) throws Exception {
        var response = send(client, base + "/inventory/CONTOSO-001", "GET", null, token, null, business);
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body()).path("available").asInt();
    }
    private static void assertTrickleDeadline(Child child, String path, String token, String gateway,
                                               String business, long maximumMillis) throws Exception {
        byte[] body = ("{\"schemaVersion\":1,\"orderId\":\"" + UUID.randomUUID() +
            "\",\"sku\":\"CONTOSO-001\",\"quantity\":2}").getBytes(StandardCharsets.UTF_8);
        try (var socket = new Socket("127.0.0.1", child.port)) {
            socket.setSoTimeout((int) maximumMillis + 1000);
            var output = socket.getOutputStream();
            String headers = "POST " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n" +
                "Content-Length: " + body.length + "\r\nAuthorization: Bearer " + token + "\r\n" +
                InvocationIds.HEADER + ": " + business + "\r\n" +
                (gateway == null ? "" : "X-Contoso-Gateway-Authorization: Bearer " + gateway + "\r\n") + "\r\n";
            output.write(headers.getBytes(StandardCharsets.US_ASCII)); output.flush();
            long started = System.nanoTime();
            Thread writer = Thread.ofVirtual().start(() -> {
                try {
                    for (byte value : body) { output.write(value); output.flush(); Thread.sleep(150); }
                } catch (IOException | InterruptedException stopped) {}
            });
            try {
                String status = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)).readLine();
                assertNotNull(status);
                assertTrue(status.contains(" 408 "), status);
                assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < maximumMillis,
                    "A byte cap/socket idle timeout is not an absolute request-body budget");
            } finally { writer.interrupt(); writer.join(1000); }
        }
    }
    private static HttpResponse<String> send(HttpClient client, String uri, String method, String body, String token, String gateway, String business) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(uri)).timeout(Duration.ofSeconds(15))
            .header("Authorization", "Bearer " + token).header(InvocationIds.HEADER, business);
        if (gateway != null) request.header("X-Contoso-Gateway-Authorization", "Bearer " + gateway);
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
    private static String type(JsonNode row) { return row.path("data").path("baseType").asText(); }
    private static JsonNode data(JsonNode row) { return row.path("data").path("baseData"); }
    private record NativePayload(byte[] original, String encoding, int envelopeCount) {}
    private static JsonNode scanOriginalPayloads(Path root, List<NativePayload> payloads,
                                                 List<String> publishers, List<String> forbiddenValues) throws Exception {
        var input = JSON.createObjectNode();
        input.set("publisherKeys", JSON.valueToTree(publishers));
        input.set("forbiddenValues", JSON.valueToTree(forbiddenValues));
        var packets = input.putArray("payloads");
        for (NativePayload payload : payloads) {
            packets.addObject().put("rawBase64", Base64.getEncoder().encodeToString(payload.original()))
                .put("encoding", payload.encoding());
        }
        var builder = new ProcessBuilder("node", root.resolve("tools\\java\\native-api-capture.mjs").toString());
        builder.environment().remove("NODE_OPTIONS");
        var process = builder.start();
        var stdout = CompletableFuture.supplyAsync(() -> readValidatorOutput(process.getInputStream(), 16 * PAYLOAD_LIMIT));
        var stderr = CompletableFuture.supplyAsync(() -> readValidatorOutput(process.getErrorStream(), 4096));
        try {
            try (var writer = process.getOutputStream()) { writer.write(JSON.writeValueAsBytes(input)); }
            if (!process.waitFor(20, TimeUnit.SECONDS)) throw new AssertionError("NATIVE_API_VALIDATOR_TIMEOUT");
            byte[] output = stdout.get(2, TimeUnit.SECONDS);
            stderr.get(2, TimeUnit.SECONDS);
            if (process.exitValue() != 0 || output.length > 16 * PAYLOAD_LIMIT) {
                throw new AssertionError("NATIVE_API_ORIGINAL_PRIVACY_REJECTED");
            }
            JsonNode capture = JSON.readTree(output);
            assertEquals("contoso.native-api-safe-capture.v1", capture.path("schema").asText());
            assertEquals(process.pid(), capture.path("validatorPid").asLong());
            assertTrue(capture.path("nativeEnvelopes").isArray());
            assertEquals(payloads.size(), capture.path("payloadReceipts").size());
            int envelopes = 0;
            for (int i = 0; i < payloads.size(); i++) {
                NativePayload payload = payloads.get(i);
                JsonNode receipt = capture.path("payloadReceipts").get(i);
                String digest = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(payload.original()));
                assertEquals(digest, receipt.path("originalPayloadSha256").asText());
                assertEquals(payload.original().length, receipt.path("originalPayloadBytes").asInt());
                assertEquals(payload.envelopeCount(), receipt.path("originalEnvelopeCount").asInt());
                assertTrue(receipt.path("scannedAllOriginalValues").asBoolean());
                assertTrue(receipt.path("projectedAfterScan").asBoolean());
                assertFalse(receipt.path("originalPayloadRetained").asBoolean());
                envelopes += payload.envelopeCount();
            }
            assertEquals(envelopes, capture.path("nativeEnvelopes").size());
            return capture;
        } finally {
            if (process.isAlive()) { process.destroyForcibly(); process.waitFor(2, TimeUnit.SECONDS); }
        }
    }
    private static byte[] readValidatorOutput(InputStream stream, int limit) {
        try {
            byte[] bytes = stream.readNBytes(limit + 1);
            if (bytes.length > limit) throw new IllegalStateException("NATIVE_API_VALIDATOR_OUTPUT_BOUND");
            return bytes;
        } catch (IOException failure) { throw new UncheckedIOException("NATIVE_API_VALIDATOR_OUTPUT_FAILED", failure); }
    }
    private static JsonNode privacyMetadata(JsonNode capture) {
        var metadata = (com.fasterxml.jackson.databind.node.ObjectNode) capture.deepCopy();
        metadata.remove("nativeEnvelopes");
        return metadata;
    }
    private static Path createCaptureDirectory(Path parent, String executionId) throws IOException {
        if (!executionId.matches("\\d{8}T\\d{9}Z-[0-9a-f-]{36}")) throw new IllegalArgumentException("NATIVE_API_EXECUTION_ID");
        Files.createDirectories(parent);
        return Files.createDirectory(parent.resolve(executionId));
    }
    private static Path writeCapture(Path directory, String file, JsonNode value) throws IOException {
        if (!Set.of("capture.json", "receipts.json").contains(file)) throw new IllegalArgumentException("NATIVE_API_OUTPUT_NAME");
        Path output = directory.resolve(file);
        Files.writeString(output, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(value),
            StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        return output;
    }
    private static Path persistCaptured(Path epoch, String executionId, List<JsonNode> rows, JsonNode safeCapture) throws Exception {
        var record = JSON.createObjectNode().put("schema", "contoso.native-api-capture.v1")
            .put("sourceKind", "real-two-jvm-agent-loopback").put("certificationEligible", false)
            .put("generatedAtUtc", Instant.now().toString()).put("oracleStatus", "PENDING").put("executionId", executionId);
        record.set("originalPrivacyCapture", privacyMetadata(safeCapture));
        var envelopes = record.putArray("nativeEnvelopes");
        rows.forEach(envelopes::add);
        return writeCapture(epoch, "capture.json", record);
    }
    private static Map<String, String> identities(RSAKey key) {
        var result = new HashMap<String, String>();
        result.put("CONTOSO_TEST_PUBLIC_JWK", key.toPublicJWK().toJSONString());
        for (String field : List.of("TENANT", "PUBLIC_AUDIENCE", "ORDERS_AUDIENCE", "INVENTORY_AUDIENCE", "STOREFRONT_CLIENT",
            "PORTAL_CLIENT", "PORTAL_OBJECT", "ORDERS_CLIENT", "ORDERS_OBJECT", "GATEWAY_CLIENT", "GATEWAY_OBJECT")) {
            result.put("CONTOSO_TEST_" + field, UUID.randomUUID().toString());
        }
        return result;
    }
    private static String token(RSAKey key, Map<String, String> identity, String audience, String client, String object, String actor, List<String> roles, String scope) throws Exception {
        Instant now = Instant.now();
        var claims = new JWTClaimsSet.Builder().issuer("https://login.microsoftonline.com/" + identity.get("CONTOSO_TEST_TENANT") + "/v2.0")
            .audience(audience).issueTime(Date.from(now)).notBeforeTime(Date.from(now.minusSeconds(5))).expirationTime(Date.from(now.plusSeconds(600)))
            .claim("ver", "2.0").claim("tid", identity.get("CONTOSO_TEST_TENANT")).claim("azp", client).claim("oid", object).claim("idtyp", actor).claim("roles", roles);
        if (scope != null) claims.claim("scp", scope);
        var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID(key.getKeyID()).build(), claims.build());
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
    private static Child start(Path root, Path directory, String role, String base, String token,
                               Map<String, String> identities, int ingestionPort, String publisherKey) throws Exception {
        String service = role.equals("orders") ? "contoso-orders-api" : "contoso-inventory-api";
        var lock = JSON.readTree(root.resolve("config\\versions.lock.json").toFile());
        var extension = lock.path("extensions").get(0);
        Path config = directory.resolve(role + ".json");
        var settings = JSON.readTree(root.resolve("config\\java-agent.json").toFile());
        ((com.fasterxml.jackson.databind.node.ObjectNode) settings.path("sampling")).remove("requestsPerSecond");
        ((com.fasterxml.jackson.databind.node.ObjectNode) settings.path("sampling")).put("percentage", 100);
        Files.writeString(config, settings.toString());
        var full = JSON.readTree("{\"sampling.percentage\":100,\"sampling.requestsPerSecond\":" + ABSENT + ",\"sampling.overrides\":[]}");
        var baseline = JSON.readTree("{\"sampling.percentage\":" + ABSENT + ",\"sampling.requestsPerSecond\":5,\"sampling.overrides\":[]}");
        String id = UUID.randomUUID().toString();
        Instant now = Instant.now();
        var lease = JSON.createObjectNode().put("schema", "contoso.sampling-runtime-lease.v1").put("runId", id).put("layerId", service)
            .put("revision", "cert-" + id).put("startsAtUtc", now.minusSeconds(1).toString()).put("expiresAtUtc", now.plusSeconds(150).toString())
            .put("drainAtUtc", now.plusSeconds(140).toString()).put("restoreDeadlineUtc", now.plusSeconds(170).toString())
            .put("hashAlgorithm", "contoso.canonical-json.sha256.v1").put("ownedConfigSha256", SamplingLease.hash(full))
            .put("baselineOwnedConfigSha256", SamplingLease.hash(baseline));
        lease.set("ownedConfiguration", full);
        lease.putObject("guard").put("sha256", extension.path("sha256").asText())
            .put("providerClass", extension.path("providerClass").asText()).put("sdkAbi", extension.path("sdkAbi").asText())
            .put("version", extension.path("version").asText()).put("policy", extension.path("guardPolicy").asText());
        Path leaseFile = directory.resolve(role + ".json." + id + ".lease.json");
        Files.writeString(leaseFile, lease.toString());
        var args = new ArrayList<String>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
            "-Djava.io.tmpdir=" + directory, "-javaagent:" + System.getenv("CONTOSO_AGENT_JAR"),
            "-Dotel.javaagent.extensions=" + root.resolve("extensions\\parent-safe-sampler").resolve(extension.path("file").asText().replace('/', '\\'))));
        RuntimeGuard.MANUAL_MODULES.forEach(module -> args.add("-Dotel.instrumentation." + module + ".enabled=false"));
        args.addAll(List.of("-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")) + ";" + root.resolve("services\\inventory-api\\target\\classes"),
            NativeApiFixture.class.getName(), role));
        var builder = new ProcessBuilder(args).redirectErrorStream(true);
        var env = builder.environment();
        for (String key : List.of("JAVA_TOOL_OPTIONS", "JAVA_OPTS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS",
            "APPLICATIONINSIGHTS_CONFIGURATION_CONTENT", "APPLICATIONINSIGHTS_AUTHENTICATION_STRING")) env.remove(key);
        env.putAll(identities);
        env.put("SERVER_PORT", "0");
        env.put("CONTOSO_TEST_INVENTORY_BASE", base); env.put("CONTOSO_TEST_INVENTORY_TOKEN", token);
        env.put("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=" + publisherKey + ";IngestionEndpoint=http://127.0.0.1:" + ingestionPort);
        env.put("APPLICATIONINSIGHTS_ROLE_NAME", service); env.put("OTEL_SERVICE_NAME", service);
        env.put("APPLICATIONINSIGHTS_CONFIGURATION_FILE", config.toString()); env.put("CONTOSO_SAMPLING_LEASE_FILE", leaseFile.toString());
        env.put("CONTOSO_CERTIFICATION_MODE", "false");
        env.put("CONTOSO_CERT_START", now.minusSeconds(1).toString());
        env.put("CONTOSO_CERT_END", now.plusSeconds(150).toString());
        env.put("CONTOSO_CERT_WINDOW_ID", id);
        for (String name : List.of("JDBC", "REDIS", "AZURE_SDK")) env.put("APPLICATIONINSIGHTS_INSTRUMENTATION_" + name + "_ENABLED", "false");
        for (String name : List.of("APPLICATIONINSIGHTS_ENABLE_AGENT", "JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY", "INITIALIZED_FROM_PLACEHOLDER")) env.put(name, "false");
        var child = new Child(builder.start());
        try { child.port = child.ready.get(45, TimeUnit.SECONDS); return child; }
        catch (Exception failure) { child.close(); throw new AssertionError(child.output.toString(), failure); }
    }
    private static final class Child implements AutoCloseable {
        final Process process;
        final CompletableFuture<Integer> ready = new CompletableFuture<>();
        final StringBuffer output = new StringBuffer();
        int port;
        Child(Process process) {
            this.process = process;
            Thread.ofVirtual().start(() -> {
                process.inputReader(StandardCharsets.UTF_8).lines().forEach(line -> {
                    if (output.length() < 131072) output.append(line).append('\n');
                    if (line.startsWith("CONTOSO_NATIVE_API_READY ")) ready.complete(Integer.parseInt(line.substring("CONTOSO_NATIVE_API_READY ".length())));
                });
                if (!ready.isDone()) ready.completeExceptionally(new IllegalStateException("native_api_exited_before_ready"));
            });
        }
        String base() { return "http://127.0.0.1:" + port + "/api"; }
        void stop() throws Exception {
            process.outputWriter(StandardCharsets.UTF_8).write("\n"); process.outputWriter(StandardCharsets.UTF_8).flush();
            assertTrue(process.waitFor(Duration.ofSeconds(45)), output.toString());
            assertEquals(0, process.exitValue(), output.toString());
            assertEquals(1, output.toString().lines().filter(line -> line.contains("CONTOSO_PARENT_SAFE_SAMPLER_LOADED")).count(), output.toString());
        }
        public void close() { if (process.isAlive()) process.destroyForcibly(); }
    }
}
