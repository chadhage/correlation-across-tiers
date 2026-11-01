package com.contoso.correlation;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.net.URI;
import java.net.http.*;
import java.util.List;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import tools.jackson.databind.json.JsonMapper;

@Configuration(proxyBeanMethods = false)
@EnableAutoConfiguration
public class HttpAgentProbe {
    public static void main(String[] args) throws Exception {
        ExtensionGuard.verify();
        var app = new SpringApplication(HttpAgentProbe.class);
        app.setDefaultProperties(Map.of("server.port", "0", "server.address", "127.0.0.1",
            "spring.main.banner-mode", "off", "logging.level.root", "WARN"));
        try (var application = app.run(args)) {
            int port = ((ServletWebServerApplicationContext) application).getWebServer().getPort();
            System.out.println("HTTP_BOOTED");
            var id = InvocationId.generate();
            try (var root = Correlation.start("contoso.http.root", SpanKind.INTERNAL, Context.root(), id, Map.of());
                 var scope = root.makeCurrent()) {
                try (var client = HttpClient.newBuilder().proxy(java.net.ProxySelector.of(null))
                        .connectTimeout(java.time.Duration.ofSeconds(3)).build()) {
                    var response = client.sendAsync(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/oracle"))
                        .timeout(java.time.Duration.ofSeconds(10))
                        .setHeader(InvocationIds.HEADER, id.value()).GET().build(), HttpResponse.BodyHandlers.ofString())
                        .get(10, java.util.concurrent.TimeUnit.SECONDS);
                    if (response.statusCode() != 200) throw new IllegalStateException("HTTP_ORACLE_FAILED");
                    var evidence = JsonMapper.builder().build().readTree(response.body());
                    System.out.printf("HTTP_ORACLE %s %s %s %s%n", root.spanContext().getTraceId(),
                        root.spanContext().getSpanId(), evidence.path("server").asText(), evidence.path("parent").asText());
                }
            }
        }
        Thread.sleep(1000);
    }

    @RestController
    static final class Endpoint {
        @GetMapping("/oracle") Map<String, String> get(HttpServletRequest request) {
            var current = Span.current();
            if (!current.getSpanContext().isValid() || !current.isRecording()) throw new IllegalStateException("NO_HTTP_SERVER_SPAN");
            current.updateName("contoso.http.server");
            Context remote = W3c.extract(request, new TextMapGetter<>() {
                public Iterable<String> keys(HttpServletRequest value) { return List.of("traceparent", "tracestate"); }
                public String get(HttpServletRequest value, String key) { return value.getHeader(key); }
            });
            var parent = Span.fromContext(remote).getSpanContext();
            try (var scope = Correlation.bind(InvocationId.parse(request.getHeader(InvocationIds.HEADER)))) {
                return Map.of("server", current.getSpanContext().getSpanId(), "parent", parent.getSpanId());
            }
        }
    }
}
