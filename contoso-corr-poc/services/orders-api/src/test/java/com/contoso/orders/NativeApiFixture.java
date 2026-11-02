package com.contoso.orders;

import com.contoso.correlation.RuntimeGuard;
import com.contoso.correlation.data.PgConnectionFactory;
import com.contoso.inventory.data.InventorySchemaHooks;
import com.contoso.inventory.data.LettuceInventoryCache;
import com.contoso.inventory.data.OwnedInventoryCache;
import com.contoso.inventory.data.PgRedisInventoryDataAdapter;
import com.contoso.messaging.*;
import com.contoso.security.*;
import com.nimbusds.jose.jwk.RSAKey;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.protocol.ProtocolVersion;
import io.lettuce.core.resource.DefaultClientResources;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.h2.jdbcx.JdbcDataSource;
import org.springframework.boot.SpringApplication;

public final class NativeApiFixture {
    public static void main(String[] args) throws Exception {
        String role = args[0];
        String service = role.equals("orders") ? "contoso-orders-api" : "contoso-inventory-api";
        var management = java.lang.management.ManagementFactory.getPlatformMBeanServer();
        var observer = new javax.management.ObjectName("com.contoso.correlation:type=SamplingObservation");
        for (String attribute : List.of("GuardSha256", "ProviderClass", "SdkAbi", "ExtensionLoader", "DelegateClass",
            "DelegateLoader", "LoadedCount", "NativeStateAvailable", "EffectiveSamplingPercentage", "RequestsPerSecond", "DelegateDescription")) {
            System.out.println("NATIVE_OBSERVER " + attribute + "=" + management.getAttribute(observer, attribute));
        }
        RuntimeGuard.verify(service, NativeApiFixture.class.getClassLoader());
        var logging = (ch.qos.logback.classic.LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        for (String name : List.of("com.azure", "com.microsoft.aad.msal4j", "io.lettuce", "io.netty")) {
            logging.getLogger(name).setLevel(ch.qos.logback.classic.Level.OFF);
        }
        var source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:contoso_orders;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=0");
        source.setUser("SA");
        try (var anchor = source.getConnection(); var resp = new LocalResp()) {
            var schema = InventorySchemaHooks.class.getDeclaredMethod("applyV001", Connection.class);
            schema.setAccessible(true);
            schema.invoke(null, anchor);
            try (var marker = anchor.prepareStatement("UPDATE contoso.environment_marker SET expected_resource_id=? WHERE singleton=TRUE")) {
                marker.setString(1, "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-poc/providers/Microsoft.DBforPostgreSQL/flexibleServers/contoso-corr-poc-pg");
                if (marker.executeUpdate() != 1) throw new IllegalStateException("native_fixture_marker_missing");
            }
            if (role.equals("orders")) {
                try (var input = PgMessagingStore.class.getClassLoader().getResourceAsStream(PgMessagingStore.MIGRATION);
                     var statement = anchor.createStatement()) {
                    for (String command : new String(input.readAllBytes(), StandardCharsets.UTF_8).split(";")) {
                        if (!command.isBlank()) statement.execute(command);
                    }
                    statement.execute("CREATE USER orders PASSWORD '' ADMIN");
                }
            }
            PgConnectionFactory connections = new PgConnectionFactory() {
                public Connection open() throws SQLException {
                    return DriverManager.getConnection(source.getURL(), role.equals("orders") ? "orders" : "sa", "");
                }
                public Map<String, String> telemetryAttributes() {
                    return Map.of("db.system", "postgresql", "db.name", "contoso_orders",
                        "server.address", "contoso-local-jdbc", "server.port", "5432");
                }
            };
            var resources = DefaultClientResources.builder().ioThreadPoolSize(2).computationThreadPoolSize(2).build();
            var redis = RedisClient.create(resources, RedisURI.create("redis://127.0.0.1:" + resp.port()));
            redis.setOptions(ClientOptions.builder().protocolVersion(ProtocolVersion.RESP2).autoReconnect(false).build());
            var cacheConstructor = LettuceInventoryCache.class.getDeclaredConstructor(String.class, RedisClient.class,
                StatefulRedisConnection.class, AutoCloseable.class, AutoCloseable.class);
            cacheConstructor.setAccessible(true);
            OwnedInventoryCache cache = (OwnedInventoryCache) cacheConstructor.newInstance("contoso-local-redis", redis,
                redis.connect(), (AutoCloseable) () -> {}, (AutoCloseable) () -> resources.shutdown(0, 2, TimeUnit.SECONDS).get(3, TimeUnit.SECONDS));
            var adapter = new PgRedisInventoryDataAdapter(connections, cache);
            var auth = authenticator(service);
            var workflow = new MessagingWorkflowPort(new PgMessagingStore(connections, new EnvelopeCodec()), new UnavailableBroker());
            var inventory = new InventoryHttpClient(URI.create(System.getenv("CONTOSO_TEST_INVENTORY_BASE")),
                () -> System.getenv("CONTOSO_TEST_INVENTORY_TOKEN"));
            Class<?> application = role.equals("orders") ? OrdersApplication.class : Class.forName("com.contoso.inventory.InventoryApplication");
            var bootstrap = new SpringApplication(application);
            bootstrap.setDefaultProperties(Map.of("server.port", "0", "spring.main.banner-mode", "off"));
            boolean observeNativeRoots = "true".equals(System.getenv("CONTOSO_TRUST_ROOT_OBSERVER"));
            if (observeNativeRoots && !role.equals("orders")) throw new IllegalStateException("NATIVE_OBSERVER_ROLE");
            bootstrap.addInitializers(context -> context.addBeanFactoryPostProcessor(beans -> {
                beans.registerSingleton("authenticator", auth);
                if (observeNativeRoots) {
                    beans.registerSingleton("nativeTrustRootObservationFilter", new NativeTrustRootObservationFilter(service));
                }
                if (role.equals("orders")) {
                    beans.registerSingleton("connections", connections);
                    beans.registerSingleton("workflows", workflow);
                    beans.registerSingleton("inventoryHttpClient", inventory);
                } else beans.registerSingleton("adapter", adapter);
            }));
            try (var context = bootstrap.run()) {
                System.out.println("CONTOSO_NATIVE_API_READY " + context.getEnvironment().getProperty("local.server.port"));
                new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
            } finally {
                inventory.close();
                workflow.close();
                auth.close();
                adapter.close();
            }
        }
    }

    private static RequestAuthenticator authenticator(String service) throws Exception {
        var env = System.getenv();
        var publicKey = RSAKey.parse(env.get("CONTOSO_TEST_PUBLIC_JWK")).toPublicJWK();
        String tenant = env.get("CONTOSO_TEST_TENANT");
        var verifier = new EntraJwtVerifier(tenant, (kid, issuer) -> {
            if (!kid.equals(publicKey.getKeyID()) || !issuer.equals("https://login.microsoftonline.com/" + tenant + "/v2.0")) {
                throw new SecurityException("JWT_REJECTED");
            }
            return publicKey;
        }, Clock.systemUTC());
        var portal = new WorkloadIdentity(env.get("CONTOSO_TEST_PORTAL_CLIENT"), env.get("CONTOSO_TEST_PORTAL_OBJECT"));
        var orders = new WorkloadIdentity(env.get("CONTOSO_TEST_ORDERS_CLIENT"), env.get("CONTOSO_TEST_ORDERS_OBJECT"));
        var gateway = new WorkloadIdentity(env.get("CONTOSO_TEST_GATEWAY_CLIENT"), env.get("CONTOSO_TEST_GATEWAY_OBJECT"));
        boolean isOrders = service.equals("contoso-orders-api");
        var policy = new AuthorizationPolicy(service, Set.of(env.get(isOrders ? "CONTOSO_TEST_PUBLIC_AUDIENCE" : "CONTOSO_TEST_INVENTORY_AUDIENCE")),
            isOrders ? Set.of(env.get("CONTOSO_TEST_ORDERS_AUDIENCE")) : Set.of(),
            isOrders ? Set.of(env.get("CONTOSO_TEST_STOREFRONT_CLIENT")) : Set.of(), "Orders.Invoke",
            isOrders ? Set.of(gateway) : Set.of(), Set.of(isOrders ? portal : orders),
            Set.of(isOrders ? portal : orders), Set.of(), isOrders ? "Portal.Invoke" : "Inventory.Invoke");
        HmacPseudonymizer hmac = null;
        if (isOrders) {
            byte[] key = new byte[32];
            new java.security.SecureRandom().nextBytes(key);
            var reference = SecretVersionReference.parse("https://contoso-local.vault.azure.net/secrets/contoso-hmac/" +
                UUID.randomUUID().toString().replace("-", ""));
            hmac = new HmacPseudonymizer(reference, (ignored, timeout) -> new HmacPseudonymizer.SecretMaterial(key, Instant.now().minusSeconds(60),
                Instant.now().plusSeconds(3600), true), Clock.systemUTC());
        }
        return new RequestAuthenticator(verifier, policy, hmac);
    }

    private static final class UnavailableBroker implements MessagingTransport {
        public void publish(Destination destination, Envelope envelope) { throw new IllegalStateException("BROKER_UNAVAILABLE"); }
        public List<Delivery> receive(Source source, int count, Duration wait) { return List.of(); }
        public List<String> partitions() { return List.of(); }
        public List<HubRecord> receiveBatch(String partition, long offset, int count, Duration wait) { return List.of(); }
        public void close() {}
    }

    private static final class LocalResp implements AutoCloseable {
        private final ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        private final Map<String, String> values = new ConcurrentHashMap<>();
        private final List<Socket> clients = new CopyOnWriteArrayList<>();
        private final ExecutorService pool = Executors.newCachedThreadPool(action -> {
            var thread = new Thread(action, "contoso-native-api-resp"); thread.setDaemon(true); return thread;
        });
        LocalResp() throws IOException {
            pool.submit(() -> {
                while (!server.isClosed()) try {
                    Socket socket = server.accept(); clients.add(socket); pool.submit(() -> serve(socket));
                } catch (IOException closed) { return; }
            });
        }
        int port() { return server.getLocalPort(); }
        private void serve(Socket socket) {
            try (socket; var input = new BufferedInputStream(socket.getInputStream()); var output = socket.getOutputStream()) {
                while (input.read() == '*') {
                    int count = Integer.parseInt(line(input));
                    var args = new ArrayList<String>();
                    for (int i = 0; i < count; i++) {
                        if (input.read() != '$') throw new IOException();
                        args.add(new String(input.readNBytes(Integer.parseInt(line(input))), StandardCharsets.UTF_8));
                        input.read(); input.read();
                    }
                    String response = switch (args.getFirst().toUpperCase(Locale.ROOT)) {
                        case "PING" -> "+PONG\r\n";
                        case "AUTH", "CLIENT" -> "+OK\r\n";
                        case "GET" -> bulk(values.get(args.get(1)));
                        case "SETEX" -> { values.put(args.get(1), args.get(3)); yield "+OK\r\n"; }
                        case "DEL" -> ":" + (values.remove(args.get(1)) == null ? 0 : 1) + "\r\n";
                        default -> "-ERR unsupported\r\n";
                    };
                    output.write(response.getBytes(StandardCharsets.UTF_8)); output.flush();
                }
            } catch (IOException ignored) {}
        }
        private static String line(InputStream input) throws IOException {
            var result = new StringBuilder();
            for (int c; (c = input.read()) >= 0;) {
                if (c == '\r') { input.read(); return result.toString(); }
                result.append((char) c);
            }
            throw new IOException();
        }
        private static String bulk(String value) {
            return value == null ? "$-1\r\n" : "$" + value.getBytes(StandardCharsets.UTF_8).length + "\r\n" + value + "\r\n";
        }
        public void close() throws IOException {
            server.close(); for (Socket socket : clients) socket.close(); pool.shutdownNow();
        }
    }
}
