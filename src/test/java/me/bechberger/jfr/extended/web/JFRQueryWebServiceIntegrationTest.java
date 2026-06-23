package me.bechberger.jfr.extended.web;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;

/**
 * Integration tests for JFR Query Web Service
 */
public class JFRQueryWebServiceIntegrationTest {

    private JFRQueryWebService webService;
    private HttpClient httpClient;
    private ObjectMapper objectMapper;
    private int port = 8081; // Use different port for tests

    @BeforeEach
    public void setUp() throws IOException {
        webService = new JFRQueryWebService(port);
        webService.start();
        httpClient = HttpClient.newHttpClient();
        objectMapper = new ObjectMapper();

        // Give the server a moment to start
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @AfterEach
    public void tearDown() {
        if (webService != null) {
            webService.stop();
        }
    }

    @Test
    public void testHealthEndpoint() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/health"))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertEquals("healthy", responseBody.get("status"));
        assertTrue(responseBody.containsKey("timestamp"));
    }

    @Test
    public void testSyntaxHighlightEndpoint() throws Exception {
        String queryJson = objectMapper.writeValueAsString(Map.of(
            "query", "@ SELECT * FROM GarbageCollection WHERE duration > 10ms"
        ));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/syntax-highlight"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(queryJson))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertTrue(responseBody.containsKey("tokens"));
        assertTrue(responseBody.containsKey("errors"));

        @SuppressWarnings("unchecked")
        var tokens = (java.util.List<Map<String, Object>>) responseBody.get("tokens");
        assertFalse(tokens.isEmpty());

        // Should have keyword tokens
        assertTrue(tokens.stream().anyMatch(token ->
            "SELECT".equals(token.get("text")) && "keyword".equals(token.get("type"))));
    }

    @Test
    public void testAutoCompleteEndpoint() throws Exception {
        String query = "@ SEL";
        int cursorPosition = 5;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/autocomplete?query=" +
                           java.net.URLEncoder.encode(query, java.nio.charset.StandardCharsets.UTF_8) +
                           "&cursorPosition=" + cursorPosition))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertTrue(responseBody.containsKey("items"));
        assertEquals(cursorPosition, responseBody.get("cursorPosition"));

        @SuppressWarnings("unchecked")
        var items = (java.util.List<Map<String, Object>>) responseBody.get("items");
        assertFalse(items.isEmpty());

        // Should suggest SELECT
        assertTrue(items.stream().anyMatch(item ->
            "SELECT".equals(item.get("text")) && "keyword".equals(item.get("type"))));
    }

    @Test
    public void testValidateEndpoint() throws Exception {
        String queryJson = objectMapper.writeValueAsString(Map.of(
            "query", "@ SELECT * FROM GarbageCollection WHERE duration > 10ms"
        ));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/validate"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(queryJson))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertTrue(responseBody.containsKey("valid"));
        assertTrue(responseBody.containsKey("errors"));
        assertTrue(responseBody.containsKey("ast"));

        assertTrue((Boolean) responseBody.get("valid"));

        @SuppressWarnings("unchecked")
        var errors = (java.util.List<String>) responseBody.get("errors");
        assertTrue(errors.isEmpty());
    }

    @Test
    public void testValidateEndpointWithError() throws Exception {
        String queryJson = objectMapper.writeValueAsString(Map.of(
            "query", "@ SELECT FROM" // Invalid syntax
        ));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/validate"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(queryJson))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertFalse((Boolean) responseBody.get("valid"));

        @SuppressWarnings("unchecked")
        var errors = (java.util.List<String>) responseBody.get("errors");
        assertFalse(errors.isEmpty());
    }

    @Test
    public void testDocumentationEndpoint() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/docs"))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertTrue(responseBody.containsKey("grammar"));
        assertTrue(responseBody.containsKey("examples"));
        assertTrue(responseBody.containsKey("functions"));
        assertTrue(responseBody.containsKey("syntaxTypes"));

        String grammar = (String) responseBody.get("grammar");
        assertTrue(grammar.contains("Extended JFR Query Language Grammar"));

        @SuppressWarnings("unchecked")
        var examples = (java.util.List<Map<String, Object>>) responseBody.get("examples");
        assertFalse(examples.isEmpty());

        @SuppressWarnings("unchecked")
        var functions = (java.util.List<Map<String, Object>>) responseBody.get("functions");
        assertFalse(functions.isEmpty());
        assertTrue(functions.stream().anyMatch(func -> "COUNT".equals(func.get("name"))));
    }

    @Test
    public void testLanguageServerEndpoint() throws Exception {
        String lspRequest = objectMapper.writeValueAsString(Map.of(
            "method", "textDocument/completion",
            "params", Map.of(
                "textDocument", Map.of("uri", "file:///test.jfr"),
                "position", Map.of("line", 0, "character", 5)
            )
        ));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/lsp"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(lspRequest))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertEquals("2.0", responseBody.get("jsonrpc"));
        assertTrue(responseBody.containsKey("result"));
    }

    @Test
    public void testCORSHeaders() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/health"))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        // Check CORS headers
        assertTrue(response.headers().firstValue("Access-Control-Allow-Origin").isPresent());
        assertEquals("*", response.headers().firstValue("Access-Control-Allow-Origin").get());

        assertTrue(response.headers().firstValue("Access-Control-Allow-Methods").isPresent());
        assertTrue(response.headers().firstValue("Access-Control-Allow-Headers").isPresent());
    }

    @Test
    public void testMethodNotAllowed() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/syntax-highlight"))
            .GET() // Should be POST
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(405, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);
        assertTrue(responseBody.containsKey("error"));
        assertTrue(responseBody.get("error").toString().contains("Method not allowed"));
    }

    @Test
    public void testBadRequest() throws Exception {
        String invalidJson = "{ invalid json }";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/syntax-highlight"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(invalidJson))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(500, response.statusCode()); // Internal server error due to JSON parsing
    }

    @Test
    public void testComplexQueryHighlighting() throws Exception {
        String complexQuery = """
            @ WHERE gc_threshold := P99(GarbageCollection, duration);
              SELECT * FROM ExecutionSample AS E 
              WHERE E.before_gc IN (SELECT id FROM GarbageCollection WHERE duration > gc_threshold)
              ORDER BY duration DESC
              LIMIT 100
            """;

        String queryJson = objectMapper.writeValueAsString(Map.of("query", complexQuery));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:" + port + "/syntax-highlight"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(queryJson))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), Map.class);

        @SuppressWarnings("unchecked")
        var tokens = (java.util.List<Map<String, Object>>) responseBody.get("tokens");
        assertFalse(tokens.isEmpty());

        // Should have various token types
        Set<String> tokenTypes = tokens.stream()
            .map(token -> (String) token.get("type"))
            .collect(java.util.stream.Collectors.toSet());

        assertTrue(tokenTypes.contains("keyword"));
        assertTrue(tokenTypes.contains("function"));
        assertTrue(tokenTypes.contains("operator"));
        assertTrue(tokenTypes.contains("identifier"));
    }
}