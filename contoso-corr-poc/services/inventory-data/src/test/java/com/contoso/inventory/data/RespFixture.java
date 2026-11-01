package com.contoso.inventory.data;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

final class RespFixture implements AutoCloseable {
    final Map<String, String> values = new ConcurrentHashMap<>();
    final List<List<String>> commands = new CopyOnWriteArrayList<>();
    private final List<Socket> clients = new CopyOnWriteArrayList<>();
    private final ServerSocket server;
    private final java.util.concurrent.ExecutorService threads = Executors.newCachedThreadPool(action -> {
        Thread thread = new Thread(action, "contoso-test-resp");
        thread.setDaemon(true);
        return thread;
    });
    volatile String error;

    RespFixture() throws IOException {
        server = new ServerSocket(0, 10, InetAddress.getLoopbackAddress());
        threads.submit(() -> {
            while (!server.isClosed()) {
                try {
                    Socket client = server.accept();
                    clients.add(client);
                    threads.submit(() -> serve(client));
                } catch (IOException ignored) { return; }
            }
        });
    }

    int port() { return server.getLocalPort(); }

    private void serve(Socket client) {
        try (client; var input = new BufferedInputStream(client.getInputStream());
             var output = new BufferedOutputStream(client.getOutputStream())) {
            while (!client.isClosed()) {
                int prefix = input.read();
                if (prefix == -1) return;
                if (prefix != '*') throw new IOException("invalid_test_protocol");
                int count = Integer.parseInt(line(input));
                var command = new java.util.ArrayList<String>();
                for (int i = 0; i < count; i++) {
                    if (input.read() != '$') throw new IOException("invalid_test_protocol");
                    int length = Integer.parseInt(line(input));
                    command.add(new String(input.readNBytes(length), StandardCharsets.UTF_8));
                    input.read(); input.read();
                }
                commands.add(List.copyOf(command));
                String name = command.get(0).toUpperCase(java.util.Locale.ROOT);
                String response;
                if (error != null && (name.equals("GET") || name.equals("SETEX"))) response = "-" + error + "\r\n";
                else response = switch (name) {
                    case "PING" -> "+PONG\r\n";
                    case "AUTH", "CLIENT" -> "+OK\r\n";
                    case "GET" -> bulk(values.get(command.get(1)));
                    case "SETEX" -> {
                        values.put(command.get(1), command.get(3));
                        yield "+OK\r\n";
                    }
                    case "DEL" -> ":" + (values.remove(command.get(1)) == null ? 0 : 1) + "\r\n";
                    default -> "-ERR forbidden_test_command\r\n";
                };
                output.write(response.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
        } catch (IOException ignored) {}
    }

    private static String line(BufferedInputStream input) throws IOException {
        var value = new StringBuilder();
        for (int next; (next = input.read()) != -1;) {
            if (next == '\r') { input.read(); return value.toString(); }
            value.append((char) next);
        }
        throw new IOException("closed_test_protocol");
    }

    private static String bulk(String value) {
        return value == null ? "$-1\r\n" : "$" + value.getBytes(StandardCharsets.UTF_8).length + "\r\n" + value + "\r\n";
    }

    public void close() throws Exception {
        server.close();
        for (Socket client : clients) client.close();
        threads.shutdownNow();
        threads.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS);
    }
}
