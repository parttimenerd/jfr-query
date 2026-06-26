package me.bechberger.jfr.duckdb.commands;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import me.bechberger.jfr.duckdb.BasicParallelImporter;
import me.bechberger.jfr.duckdb.Options;
import me.bechberger.jfr.duckdb.RuntimeSQLException;
import me.bechberger.jfr.duckdb.templates.TemplateService;
import org.duckdb.DuckDBConnection;
import picocli.CommandLine;

import java.awt.*;
import java.net.URI;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

@CommandLine.Command(
        name = "serve",
        mixinStandardHelpOptions = true,
        description = "Import a JFR recording or open a DuckDB file and serve the notebook UI")
public class ServeCommand implements Runnable {

    @CommandLine.Mixin
    private Options options;

    @CommandLine.Parameters(index = "0", description = "JFR recording or DuckDB database file")
    private String inputFile;

    @CommandLine.Option(
            names = {"-p", "--port"},
            description = "HTTP port to listen on (default: ${DEFAULT-VALUE})",
            defaultValue = "4244")
    private int port;

    @CommandLine.Option(
            names = {"--no-open"},
            description = "Do not open the browser automatically")
    private boolean noOpen;

    @CommandLine.Option(
            names = {"--templates-dir"},
            description = "Directory containing user notebook templates (.md files)",
            defaultValue = "")
    private String templatesDir;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static DuckDBConnection openFile(String path, Options options) throws Exception {
        if (path.toLowerCase().endsWith(".jfr")) {
            System.out.println("Importing " + path + " ...");
            DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
            BasicParallelImporter.importIntoConnection(Path.of(path), conn, options);
            return conn;
        } else {
            System.out.println("Opening " + path + " ...");
            return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:" + path);
        }
    }

    @Override
    public void run() {
        DuckDBConnection initialConn;
        try {
            initialConn = openFile(inputFile, options);
        } catch (Exception e) {
            System.err.println("Failed to open file: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
            return;
        }

        AtomicReference<DuckDBConnection> connRef = new AtomicReference<>(initialConn);
        AtomicReference<String> currentFile = new AtomicReference<>(inputFile);

        Optional<Path> userTemplatesDir = (templatesDir == null || templatesDir.isBlank())
                ? Optional.empty()
                : Optional.of(Path.of(templatesDir));
        TemplateService templateService;
        try {
            templateService = new TemplateService(userTemplatesDir);
        } catch (IllegalStateException e) {
            System.err.println("Failed to initialize template service: " + e.getMessage());
            System.exit(1);
            return;
        }

        var app = Javalin.create(config -> {
            var devDist = Path.of("frontend/dist");
            if (devDist.toFile().exists()) {
                config.staticFiles.add(devDist.toAbsolutePath().toString(), Location.EXTERNAL);
            } else {
                config.staticFiles.add("/frontend-dist", Location.CLASSPATH);
            }
            if (devDist.toFile().exists()) {
                config.spaRoot.addFile("/", devDist.resolve("index.html").toAbsolutePath().toString(), Location.EXTERNAL);
            } else {
                config.spaRoot.addFile("/", "/frontend-dist/index.html", Location.CLASSPATH);
            }
        });

        app.before(ctx -> {
            ctx.header("Cross-Origin-Embedder-Policy", "require-corp");
            ctx.header("Cross-Origin-Opener-Policy", "same-origin");
        });

        app.post("/api/query", ctx -> {
            String body = ctx.body();
            String sql;
            try {
                Map<?, ?> req = MAPPER.readValue(body, Map.class);
                sql = (String) req.get("sql");
            } catch (JsonProcessingException e) {
                ctx.status(400).json(Map.of("error", "Invalid JSON: " + e.getMessage()));
                return;
            }
            if (sql == null || sql.isBlank()) {
                ctx.status(400).json(Map.of("error", "Missing 'sql' field"));
                return;
            }
            try (DuckDBConnection reqConn = (DuckDBConnection) connRef.get().duplicate()) {
                var results = executeQuery(reqConn, sql);
                ctx.json(results);
            } catch (SQLException e) {
                ctx.status(400).json(Map.of("error", e.getMessage()));
            }
        });

        app.post("/api/load-file", ctx -> {
            String path;
            try {
                Map<?, ?> req = MAPPER.readValue(ctx.body(), Map.class);
                path = (String) req.get("path");
            } catch (JsonProcessingException e) {
                ctx.status(400).json(Map.of("error", "Invalid JSON: " + e.getMessage()));
                return;
            }
            if (path == null || path.isBlank()) {
                ctx.status(400).json(Map.of("error", "missing 'path' field"));
                return;
            }
            if (!Path.of(path).toFile().exists()) {
                ctx.status(400).json(Map.of("error", "file not found: " + path));
                return;
            }
            try {
                DuckDBConnection newConn = openFile(path, options);
                DuckDBConnection old = connRef.getAndSet(newConn);
                currentFile.set(path);
                try { old.close(); } catch (SQLException ignored) {}
                ctx.json(Map.of("ok", true, "path", path));
            } catch (Exception e) {
                ctx.status(500).json(Map.of("error", e.getMessage()));
            }
        });

        app.get("/api/status", ctx -> {
            ctx.json(Map.of("currentFile", currentFile.get()));
        });

        app.get("/api/templates", ctx -> {
            ctx.json(templateService.list());
        });

        app.get("/api/templates/{name}", ctx -> {
            String name = ctx.pathParam("name");
            Optional<String> body = templateService.load(name);
            if (body.isEmpty()) {
                ctx.status(404).json(Map.of("error", "template not found: " + name));
                return;
            }
            ctx.contentType("text/markdown; charset=utf-8");
            ctx.result(body.get());
        });

        app.start(port);
        String url = "http://localhost:" + port;
        System.out.println("Serving notebook at " + url);

        if (!noOpen) {
            openBrowser(url);
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            app.stop();
            try { connRef.get().close(); } catch (SQLException ignored) {}
        }));

        try {
            Thread.currentThread().join();
        } catch (InterruptedException ignored) {}
    }

    private static List<Map<String, Object>> executeQuery(DuckDBConnection conn, String sql) throws SQLException {
        try (var stmt = conn.createStatement()) {
            boolean hasRs = stmt.execute(sql);
            if (!hasRs) {
                return List.of();
            }
            try (ResultSet rs = stmt.getResultSet()) {
                ResultSetMetaData meta = rs.getMetaData();
                int cols = meta.getColumnCount();
                var rows = new ArrayList<Map<String, Object>>();
                while (rs.next()) {
                    var row = new LinkedHashMap<String, Object>();
                    for (int i = 1; i <= cols; i++) {
                        row.put(meta.getColumnName(i), unwrapForJson(rs.getObject(i)));
                    }
                    rows.add(row);
                }
                return rows;
            }
        }
    }

    private static Object unwrapForJson(Object v) throws SQLException {
        if (v == null) return null;
        if (v instanceof java.sql.Array a) {
            Object inner = a.getArray();
            if (inner instanceof Object[] arr) {
                var list = new ArrayList<Object>(arr.length);
                for (Object item : arr) list.add(unwrapForJson(item));
                return list;
            }
            return inner;
        }
        if (v instanceof java.sql.Struct s) {
            return s.getAttributes();
        }
        return v;
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI(url));
            }
        } catch (Exception e) {
            System.err.println("Could not open browser: " + e.getMessage());
        }
    }
}
