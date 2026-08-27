package me.bechberger.jfr.duckdb.commands;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import me.bechberger.jfr.duckdb.BasicParallelImporter;
import me.bechberger.jfr.duckdb.Options;
import me.bechberger.jfr.duckdb.RuntimeSQLException;
import me.bechberger.jfr.duckdb.jvmlog.CorrelationFinalizer;
import me.bechberger.jfr.duckdb.jvmlog.FileTypeRouter;
import me.bechberger.jfr.duckdb.jvmlog.JvmLogImporter;
import me.bechberger.jfr.duckdb.templates.TemplateService;
import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import picocli.CommandLine;

import java.awt.*;
import java.io.IOException;
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

    @CommandLine.Option(
            names = {"--jvmlog-patterns-dir"},
            description = "Directory containing user JVM log pattern files (.yaml)",
            defaultValue = "")
    private String jvmlogPatternsDir;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Load a single file into the given connection.
     * For JFR/CJFR uses BasicParallelImporter; for JVMLOG uses JvmLogImporter;
     * for DUCKDB attaches and copies tables.
     */
    public static void loadFileIntoConnection(DuckDBConnection conn, Path path, Options options,
                                               Optional<Path> jvmlogPatternsDir) throws Exception {
        FileTypeRouter.FileType type = FileTypeRouter.detect(path);
        switch (type) {
            case JFR, CJFR -> {
                System.out.println("Importing JFR: " + path);
                BasicParallelImporter.importIntoConnection(path, conn, options);
            }
            case JVMLOG -> {
                System.out.println("Importing JVM log: " + path);
                var sink = new JdbcDuckDBSink(conn);
                JvmLogImporter.importLog(path, sink);
            }
            case DUCKDB -> {
                System.out.println("Attaching DuckDB: " + path);
                String alias = "_src_" + System.nanoTime();
                // Escape single-quotes in path to prevent SQL injection
                String escapedPath = path.toAbsolutePath().toString().replace("'", "''");
                try (var stmt = conn.createStatement()) {
                    stmt.execute("ATTACH '" + escapedPath + "' AS " + alias + " (READ_ONLY)");
                    try {
                        List<String> tables = new ArrayList<>();
                        try (ResultSet rs = stmt.executeQuery(
                                "SELECT table_name FROM information_schema.tables WHERE table_catalog = '" + alias + "'")) {
                            while (rs.next()) tables.add(rs.getString(1));
                        }
                        for (String tbl : tables) {
                            stmt.execute("CREATE TABLE IF NOT EXISTS \"" + tbl + "\" AS SELECT * FROM " + alias + ".\"" + tbl + "\"");
                        }
                    } finally {
                        stmt.execute("DETACH " + alias);
                    }
                }
            }
        }
    }

    /**
     * Open all given files into a single in-memory DuckDB connection.
     * Returns the connection — caller is responsible for closing it.
     */
    public static DuckDBConnection openFiles(List<Path> paths, Options options,
                                              Optional<Path> jvmlogPatternsDir) throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try {
            for (Path p : paths) {
                loadFileIntoConnection(conn, p, options, jvmlogPatternsDir);
            }
            CorrelationFinalizer.runIfApplicable(conn);
        } catch (Exception e) {
            try { conn.close(); } catch (Exception ignored) {}
            throw e;
        }
        return conn;
    }

    private static DuckDBConnection openFile(String path, Options options) throws Exception {
        FileTypeRouter.FileType type;
        try {
            type = FileTypeRouter.detect(Path.of(path));
        } catch (IllegalArgumentException e) {
            // Fall back: treat as DuckDB if extension unknown
            System.out.println("Opening " + path + " ...");
            return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:" + path);
        }
        if (type == FileTypeRouter.FileType.DUCKDB) {
            System.out.println("Opening " + path + " ...");
            return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:" + path);
        }
        // For JFR, CJFR, JVMLOG: import into in-memory connection
        return openFiles(List.of(Path.of(path)), options, Optional.empty());
    }

    /**
     * Build a Javalin app wired to the given connection.
     *
     * @param initialConn        pre-opened DuckDB connection
     * @param options            query/import options
     * @param templatesDirStr    path to user templates dir, or null/empty for none
     * @param jvmlogPatternsDirStr path to user jvmlog patterns dir, or null/empty for none
     */
    public static Javalin buildApp(DuckDBConnection initialConn, Options options,
                                    String templatesDirStr, String jvmlogPatternsDirStr) {
        AtomicReference<DuckDBConnection> connRef = new AtomicReference<>(initialConn);
        AtomicReference<String> currentFile = new AtomicReference<>("<in-memory>");

        Optional<Path> userTemplatesDir = (templatesDirStr == null || templatesDirStr.isBlank())
                ? Optional.empty()
                : Optional.of(Path.of(templatesDirStr));
        Optional<Path> jvmlogPatternsDir = (jvmlogPatternsDirStr == null || jvmlogPatternsDirStr.isBlank())
                ? Optional.empty()
                : Optional.of(Path.of(jvmlogPatternsDirStr));

        TemplateService templateService;
        try {
            templateService = new TemplateService(userTemplatesDir);
        } catch (IllegalStateException e) {
            throw new RuntimeException("Failed to initialize template service: " + e.getMessage(), e);
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
            Map<?, ?> req;
            try {
                req = MAPPER.readValue(ctx.body(), Map.class);
            } catch (JsonProcessingException e) {
                ctx.status(400).json(Map.of("error", "Invalid JSON: " + e.getMessage()));
                return;
            }

            // Resolve the list of paths from either legacy "path" or new "files" key
            List<Path> paths;
            if (req.containsKey("path")) {
                // Legacy single-file form: { "path": "..." }
                String p = (String) req.get("path");
                if (p == null || p.isBlank()) {
                    ctx.status(400).json(Map.of("error", "Expected 'path' or 'files' field"));
                    return;
                }
                paths = List.of(Path.of(p));
            } else if (req.containsKey("files")) {
                // New multi-file form: { "files": [{"path":"...", "type":"..."}] }
                Object filesObj = req.get("files");
                if (!(filesObj instanceof List<?> filesList) || filesList.isEmpty()) {
                    ctx.status(400).json(Map.of("error", "Expected 'files' to be a non-empty array"));
                    return;
                }
                List<Path> collected = new ArrayList<>();
                for (Object entry : filesList) {
                    if (!(entry instanceof Map<?, ?> fileEntry)) {
                        ctx.status(400).json(Map.of("error", "Each file entry must be an object"));
                        return;
                    }
                    Object pathObj = fileEntry.get("path");
                    if (pathObj == null) {
                        ctx.status(400).json(Map.of("error", "File entry missing 'path'"));
                        return;
                    }
                    collected.add(Path.of(pathObj.toString()));
                }
                paths = collected;
            } else {
                ctx.status(400).json(Map.of("error", "Expected 'path' or 'files' field"));
                return;
            }

            // Validate all paths exist before doing any work
            for (Path p : paths) {
                if (!p.toFile().exists()) {
                    ctx.status(400).json(Map.of("error", "file not found: " + p));
                    return;
                }
            }

            try {
                DuckDBConnection newConn;
                if (paths.size() == 1) {
                    FileTypeRouter.FileType type = FileTypeRouter.detect(paths.get(0));
                    if (type == FileTypeRouter.FileType.DUCKDB) {
                        // Open DuckDB directly (persistent) — no correlation possible
                        newConn = (DuckDBConnection) DriverManager.getConnection(
                                "jdbc:duckdb:" + paths.get(0).toAbsolutePath());
                    } else {
                        newConn = openFiles(paths, options, jvmlogPatternsDir);
                    }
                } else {
                    newConn = openFiles(paths, options, jvmlogPatternsDir);
                }
                // Note: openFiles() already calls CorrelationFinalizer internally;
                // only the DUCKDB direct-open path skips openFiles, and correlation is not applicable there.
                DuckDBConnection old = connRef.getAndSet(newConn);
                currentFile.set(paths.size() == 1 ? paths.get(0).toString() : paths.toString());
                try { old.close(); } catch (SQLException ignored) {}
                List<String> pathStrs = paths.stream().map(Path::toString).toList();
                ctx.json(Map.of("ok", true, "paths", pathStrs));
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

        return app;
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

        Javalin app;
        try {
            app = buildApp(initialConn, options, templatesDir, jvmlogPatternsDir);
        } catch (RuntimeException e) {
            System.err.println(e.getMessage());
            System.exit(1);
            return;
        }

        // Wire shutdown to close the initial connection (connRef inside buildApp handles the rest)
        Runtime.getRuntime().addShutdownHook(new Thread(app::stop));

        app.start(port);
        String url = "http://localhost:" + port;
        System.out.println("Serving notebook at " + url);

        if (!noOpen) {
            openBrowser(url);
        }

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
