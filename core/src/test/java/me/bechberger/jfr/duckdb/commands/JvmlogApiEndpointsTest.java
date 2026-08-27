package me.bechberger.jfr.duckdb.commands;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import me.bechberger.jfr.duckdb.Options;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

class JvmlogApiEndpointsTest {

    private Javalin app;
    private static final int PORT = 15001;
    private final ObjectMapper mapper = new ObjectMapper();
    @TempDir Path patternsDir;

    @BeforeEach
    void setUp() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        app = ServeCommand.buildApp(conn, new Options(), null, patternsDir.toString());
        app.start(PORT);
    }

    @AfterEach
    void tearDown() { app.stop(); }

    @Test
    void suggestPatternReturnsFields() throws Exception {
        String body = mapper.writeValueAsString(Map.of(
                "line", "[1.234s][info][gc] GC(42) Pause Young 12.34ms"));
        var resp = post("/api/jvmlog/suggest-pattern", body);
        assertThat(resp.statusCode()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        Map<String,?> result = (Map<String,?>) mapper.readValue(resp.body(), Map.class);
        assertThat(result).containsKeys("id", "pattern", "fields", "table");
        assertThat(result.get("table")).isEqualTo("jvmlog_gc_event");
    }

    @Test
    void suggestPatternMissingLineReturns400() throws Exception {
        var resp = post("/api/jvmlog/suggest-pattern", "{}");
        assertThat(resp.statusCode()).isEqualTo(400);
    }

    @Test
    void savePatternWritesYamlFile() throws Exception {
        String body = mapper.writeValueAsString(Map.of(
                "id", "test_pattern",
                "tags", List.of("gc"),
                "level", "info",
                "pattern", "GC\\((\\d+)\\) Using G1",
                "fields", List.of(Map.of("name", "gcId", "type", "int")),
                "table", "jvmlog_gc_event"
        ));
        var resp = post("/api/jvmlog/save-pattern", body);
        assertThat(resp.statusCode()).isEqualTo(200);

        Path yaml = patternsDir.resolve("test_pattern.yaml");
        assertThat(yaml).exists();
        assertThat(Files.readString(yaml))
                .contains("id: test_pattern")
                .contains("table: jvmlog_gc_event");
    }

    @Test
    void savePatternWithoutPatternsDirReturns400() throws Exception {
        DuckDBConnection conn2 = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        Javalin app2 = ServeCommand.buildApp(conn2, new Options(), null, null);
        app2.start(15002);
        try {
            String body = mapper.writeValueAsString(Map.of(
                    "id", "test", "pattern", "foo", "table", "jvmlog_gc_event",
                    "tags", List.of(), "level", "info", "fields", List.of()));
            var req = HttpRequest.newBuilder()
                    .uri(URI.create("http://localhost:15002/api/jvmlog/save-pattern"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            var resp = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
            assertThat(resp.statusCode()).isEqualTo(400);
            assertThat(resp.body()).contains("jvmlog-patterns-dir");
        } finally {
            app2.stop();
        }
    }

    private HttpResponse<String> post(String path, String body) throws Exception {
        var req = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + PORT + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
    }
}
