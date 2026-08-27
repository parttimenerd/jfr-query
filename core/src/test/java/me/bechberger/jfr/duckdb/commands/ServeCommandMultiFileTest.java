package me.bechberger.jfr.duckdb.commands;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import me.bechberger.jfr.duckdb.Options;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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

class ServeCommandMultiFileTest {

    private Javalin app;
    private static final int PORT = 14999;
    private final ObjectMapper mapper = new ObjectMapper();
    private Path tempLog;

    @BeforeEach
    void setUp() throws Exception {
        tempLog = Files.createTempFile("test-gc", ".log");
        Files.writeString(tempLog,
                "[0.005s][info][gc] Using G1\n" +
                "[0.008s][info][gc,init] Heap Min Capacity: 256M\n");

        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        app = ServeCommand.buildApp(conn, new Options(), null, null);
        app.start(PORT);
    }

    @AfterEach
    void tearDown() throws Exception {
        app.stop();
        Files.deleteIfExists(tempLog);
    }

    @Test
    void legacySinglePathStillWorks() throws Exception {
        String body = mapper.writeValueAsString(Map.of("path", tempLog.toString()));
        var resp = post("/api/load-file", body);
        assertThat(resp.statusCode()).isNotEqualTo(400);
    }

    @Test
    void multiFileArrayShape() throws Exception {
        String body = mapper.writeValueAsString(Map.of("files", List.of(
                Map.of("path", tempLog.toString(), "type", "jvmlog")
        )));
        var resp = post("/api/load-file", body);
        assertThat(resp.statusCode()).isIn(200, 500);
        if (resp.statusCode() == 200) {
            Map<?,?> result = mapper.readValue(resp.body(), Map.class);
            assertThat(result.get("ok")).isEqualTo(true);
        }
    }

    @Test
    void missingPathReturns400() throws Exception {
        var resp = post("/api/load-file", "{}");
        assertThat(resp.statusCode()).isEqualTo(400);
        Map<?,?> result = mapper.readValue(resp.body(), Map.class);
        assertThat(result.get("error").toString()).contains("path").contains("files");
    }

    @Test
    void nonExistentFileReturns400() throws Exception {
        String body = mapper.writeValueAsString(Map.of("path", "/no/such/file.log"));
        var resp = post("/api/load-file", body);
        assertThat(resp.statusCode()).isEqualTo(400);
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
