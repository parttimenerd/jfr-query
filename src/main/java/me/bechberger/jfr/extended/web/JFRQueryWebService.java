package me.bechberger.jfr.extended.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import me.bechberger.jfr.extended.AutoCompletionService;
import me.bechberger.jfr.extended.SyntaxHighlighter;
import me.bechberger.jfr.extended.Parser;
import me.bechberger.jfr.extended.Lexer;
import me.bechberger.jfr.extended.ast.ASTNodes;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

/**
 * Web endpoints for JFR extended query language services
 */
public class JFRQueryWebService {

    private final HttpServer server;
    private final ObjectMapper objectMapper;
    private final SyntaxHighlighter syntaxHighlighter;
    private final AutoCompletionService autoCompletionService;

    public JFRQueryWebService(int port) throws IOException {
        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        this.objectMapper = new ObjectMapper();
        this.syntaxHighlighter = new SyntaxHighlighter();
        this.autoCompletionService = new AutoCompletionService();

        setupEndpoints();
        server.setExecutor(Executors.newFixedThreadPool(10));
    }

    private void setupEndpoints() {
        // Syntax highlighting endpoint
        server.createContext("/syntax-highlight", new SyntaxHighlightHandler());

        // Auto-completion endpoint
        server.createContext("/autocomplete", new AutoCompleteHandler());

        // Query validation endpoint
        server.createContext("/validate", new ValidateHandler());

        // Language server protocol endpoint
        server.createContext("/lsp", new LanguageServerHandler());

        // Documentation endpoint
        server.createContext("/docs", new DocumentationHandler());

        // Health check endpoint
        server.createContext("/health", new HealthHandler());
    }

    public void start() {
        server.start();
        System.out.println("JFR Query Web Service started on port " + server.getAddress().getPort());
    }

    public void stop() {
        server.stop(0);
        System.out.println("JFR Query Web Service stopped");
    }

    /**
     * Syntax highlighting endpoint
     * POST /syntax-highlight
     * Request: { "query": "@ SELECT * FROM GarbageCollection" }
     * Response: { "tokens": [...], "errors": [...] }
     */
    private class SyntaxHighlightHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                String requestBody = new String(exchange.getRequestBody().readAllBytes());
                Map<String, Object> request = objectMapper.readValue(requestBody, Map.class);

                String query = (String) request.get("query");
                if (query == null) {
                    sendResponse(exchange, 400, Map.of("error", "Missing 'query' parameter"));
                    return;
                }

                SyntaxHighlighter.HighlightResult result = syntaxHighlighter.highlight(query);

                Map<String, Object> response = Map.of(
                    "tokens", result.tokens().stream().map(token -> Map.of(
                        "start", token.start(),
                        "end", token.end(),
                        "text", token.text(),
                        "type", token.syntaxType(),
                        "tokenType", token.tokenType().name()
                    )).toList(),
                    "errors", result.errors()
                );

                sendResponse(exchange, 200, response);
            } catch (Exception e) {
                sendResponse(exchange, 500, Map.of("error", "Internal server error: " + e.getMessage()));
            }
        }
    }

    /**
     * Auto-completion endpoint
     * GET /autocomplete?query=SELECT * FROM G&cursorPosition=15
     * Response: { "items": [...], "cursorPosition": 15, "query": "..." }
     */
    private class AutoCompleteHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                String queryString = exchange.getRequestURI().getQuery();
                Map<String, String> params = parseQueryString(queryString);

                String query = params.get("query");
                String cursorPosStr = params.get("cursorPosition");

                if (query == null || cursorPosStr == null) {
                    sendResponse(exchange, 400, Map.of("error", "Missing 'query' or 'cursorPosition' parameter"));
                    return;
                }

                int cursorPosition = Integer.parseInt(cursorPosStr);

                AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

                Map<String, Object> response = Map.of(
                    "items", result.items().stream().map(item -> Map.of(
                        "text", item.text(),
                        "type", item.type(),
                        "description", item.description(),
                        "priority", item.priority(),
                        "insertText", item.insertText(),
                        "detail", item.detail().orElse("")
                    )).toList(),
                    "cursorPosition", result.cursorPosition(),
                    "query", result.query()
                );

                sendResponse(exchange, 200, response);
            } catch (Exception e) {
                sendResponse(exchange, 500, Map.of("error", "Internal server error: " + e.getMessage()));
            }
        }
    }

    /**
     * Query validation endpoint
     * POST /validate
     * Request: { "query": "@ SELECT * FROM GarbageCollection WHERE duration > 10ms" }
     * Response: { "valid": true, "errors": [], "ast": {...} }
     */
    private class ValidateHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                String requestBody = new String(exchange.getRequestBody().readAllBytes());
                Map<String, Object> request = objectMapper.readValue(requestBody, Map.class);

                String query = (String) request.get("query");
                if (query == null) {
                    sendResponse(exchange, 400, Map.of("error", "Missing 'query' parameter"));
                    return;
                }

                boolean valid = true;
                List<String> errors = List.of();
                String astString = "";

                try {
                    Lexer lexer = new Lexer(query);
                    var tokens = lexer.tokenize();

                    Parser parser = new Parser(tokens);
                    ASTNodes.Program program = parser.parse();

                    astString = program.toString();
                } catch (Exception e) {
                    valid = false;
                    errors = List.of(e.getMessage());
                }

                Map<String, Object> response = Map.of(
                    "valid", valid,
                    "errors", errors,
                    "ast", astString
                );

                sendResponse(exchange, 200, response);
            } catch (Exception e) {
                sendResponse(exchange, 500, Map.of("error", "Internal server error: " + e.getMessage()));
            }
        }
    }

    /**
     * Basic Language Server Protocol endpoint
     * POST /lsp
     * Request: { "method": "textDocument/completion", "params": {...} }
     * Response: LSP-compliant response
     */
    private class LanguageServerHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                String requestBody = new String(exchange.getRequestBody().readAllBytes());
                Map<String, Object> request = objectMapper.readValue(requestBody, Map.class);

                String method = (String) request.get("method");
                @SuppressWarnings("unchecked")
                Map<String, Object> params = (Map<String, Object>) request.get("params");

                if (method == null) {
                    sendResponse(exchange, 400, Map.of("error", "Missing 'method' parameter"));
                    return;
                }

                Object result = handleLSPMethod(method, params);

                Map<String, Object> response = Map.of(
                    "jsonrpc", "2.0",
                    "result", result
                );

                sendResponse(exchange, 200, response);
            } catch (Exception e) {
                Map<String, Object> errorResponse = Map.of(
                    "jsonrpc", "2.0",
                    "error", Map.of(
                        "code", -32603,
                        "message", "Internal error: " + e.getMessage()
                    )
                );
                sendResponse(exchange, 500, errorResponse);
            }
        }

        private Object handleLSPMethod(String method, Map<String, Object> params) {
            return switch (method) {
                case "textDocument/completion" -> handleCompletion(params);
                case "textDocument/hover" -> handleHover(params);
                case "textDocument/documentSymbol" -> handleDocumentSymbol(params);
                default -> Map.of("error", "Method not supported: " + method);
            };
        }

        private Object handleCompletion(Map<String, Object> params) {
            @SuppressWarnings("unchecked")
            Map<String, Object> textDocument = (Map<String, Object>) params.get("textDocument");
            @SuppressWarnings("unchecked")
            Map<String, Object> position = (Map<String, Object>) params.get("position");

            if (textDocument == null || position == null) {
                return List.of();
            }

            // For simplicity, we'll assume the query is provided in the URI
            String uri = (String) textDocument.get("uri");
            int line = (Integer) position.get("line");
            int character = (Integer) position.get("character");

            // This is a simplified implementation
            // In a real LSP server, you'd track document content
            return List.of();
        }

        private Object handleHover(Map<String, Object> params) {
            return Map.of("contents", "JFR Query Language hover information");
        }

        private Object handleDocumentSymbol(Map<String, Object> params) {
            return List.of();
        }
    }

    /**
     * Documentation endpoint
     * GET /docs
     * Response: { "grammar": "...", "examples": [...], "functions": [...] }
     */
    private class DocumentationHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
                Map<String, Object> response = Map.of(
                    "grammar", getGrammarDocumentation(),
                    "examples", getExamples(),
                    "functions", getFunctions(),
                    "syntaxTypes", SyntaxHighlighter.getSyntaxTypes()
                );

                sendResponse(exchange, 200, response);
            } catch (Exception e) {
                sendResponse(exchange, 500, Map.of("error", "Internal server error: " + e.getMessage()));
            }
        }

        private String getGrammarDocumentation() {
            return """
                Extended JFR Query Language Grammar:
                
                program ::= statement*
                statement ::= assignment | query
                assignment ::= IDENTIFIER "=" query
                query ::= extendedQuery | legacyQuery | showQuery
                extendedQuery ::= "@" sqlQuery
                legacyQuery ::= "[" jfrQuery "]"
                showQuery ::= "SHOW" ("EVENTS" | "FIELDS" type)
                
                Examples:
                @ SELECT * FROM GarbageCollection WHERE duration > 10ms
                @ SELECT thread, COUNT(*) FROM ExecutionSample GROUP BY thread
                [SELECT * FROM jdk.GarbageCollection WHERE cause = 'System.gc()']
                SHOW EVENTS
                SHOW FIELDS GarbageCollection
                """;
        }

        private List<Map<String, Object>> getExamples() {
            return List.of(
                Map.of(
                    "title", "Basic Query",
                    "query", "@ SELECT * FROM GarbageCollection WHERE duration > 10ms",
                    "description", "Find all garbage collections longer than 10 milliseconds"
                ),
                Map.of(
                    "title", "GC Correlation",
                    "query", "@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc IN P99(GarbageCollection, id, duration)",
                    "description", "Find execution samples that occurred before the slowest 1% of garbage collections"
                ),
                Map.of(
                    "title", "Time-aware Query",
                    "query", "@ SELECT * FROM ThreadPark WHERE duration BETWEEN 1s AND 5s",
                    "description", "Find thread park events lasting between 1 and 5 seconds"
                ),
                Map.of(
                    "title", "Memory-aware Query",
                    "query", "@ SELECT * FROM ObjectAllocationInNewTLAB WHERE allocationSize > 1MB",
                    "description", "Find large object allocations over 1MB"
                )
            );
        }

        private List<Map<String, Object>> getFunctions() {
            return List.of(
                Map.of("name", "AVG", "description", "Numeric average"),
                Map.of("name", "COUNT", "description", "Count of values"),
                Map.of("name", "MAX", "description", "Maximum value"),
                Map.of("name", "MIN", "description", "Minimum value"),
                Map.of("name", "P90", "description", "90th percentile"),
                Map.of("name", "P95", "description", "95th percentile"),
                Map.of("name", "P99", "description", "99th percentile"),
                Map.of("name", "P999", "description", "99.9th percentile"),
                Map.of("name", "SUM", "description", "Sum of values"),
                Map.of("name", "STDEV", "description", "Standard deviation")
            );
        }
    }

    /**
     * Health check endpoint
     * GET /health
     * Response: { "status": "healthy", "timestamp": "..." }
     */
    private class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> response = Map.of(
                "status", "healthy",
                "timestamp", java.time.Instant.now().toString(),
                "service", "JFR Query Web Service"
            );

            sendResponse(exchange, 200, response);
        }
    }

    private void sendResponse(HttpExchange exchange, int statusCode, Object responseBody) throws IOException {
        String jsonResponse = objectMapper.writeValueAsString(responseBody);
        byte[] responseBytes = jsonResponse.getBytes();

        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

        exchange.sendResponseHeaders(statusCode, responseBytes.length);
        exchange.getResponseBody().write(responseBytes);
        exchange.getResponseBody().close();
    }

    private Map<String, String> parseQueryString(String queryString) {
        Map<String, String> params = new java.util.HashMap<>();
        if (queryString != null) {
            String[] pairs = queryString.split("&");
            for (String pair : pairs) {
                String[] keyValue = pair.split("=");
                if (keyValue.length == 2) {
                    params.put(keyValue[0], java.net.URLDecoder.decode(keyValue[1], java.nio.charset.StandardCharsets.UTF_8));
                }
            }
        }
        return params;
    }

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        JFRQueryWebService service = new JFRQueryWebService(port);
        service.start();

        Runtime.getRuntime().addShutdownHook(new Thread(service::stop));
    }
}