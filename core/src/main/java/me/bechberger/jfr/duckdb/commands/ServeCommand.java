package me.bechberger.jfr.duckdb.commands;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import me.bechberger.jfr.duckdb.BasicParallelImporter;
import me.bechberger.jfr.duckdb.Options;
import me.bechberger.jfr.duckdb.RuntimeSQLException;
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

@CommandLine.Command(
        name = "serve",
        mixinStandardHelpOptions = true,
        description = "Import a JFR recording and serve the notebook UI")
public class ServeCommand implements Runnable {

    @CommandLine.Mixin
    private Options options;

    @CommandLine.Parameters(index = "0", description = "The input JFR recording file")
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

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public void run() {
        System.out.println("Importing " + inputFile + " ...");
        // conn is kept open for the lifetime of the server; closed in the shutdown hook.
        DuckDBConnection conn;
        try {
            conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
            // importIntoConnection already calls addMacrosAndViews internally – no duplicate call needed.
            BasicParallelImporter.importIntoConnection(Path.of(inputFile), conn, options);
        } catch (Exception e) {
            System.err.println("Failed to import JFR file: " + e.getMessage());
            e.printStackTrace();
            // Best-effort close before exit so the DB is not left in a dirty state.
            try { ((DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:")).close(); } catch (Exception ignored) {}
            System.exit(1);
            return;
        }

        DuckDBConnection finalConn = conn;
        var app = Javalin.create(config -> {
            // Serve the built frontend assets from the classpath
            var devDist = Path.of("frontend/dist");
            if (devDist.toFile().exists()) {
                config.staticFiles.add(devDist.toAbsolutePath().toString(), Location.EXTERNAL);
            } else {
                config.staticFiles.add("/frontend-dist", Location.CLASSPATH);
            }
            config.staticFiles.enableWebjars();
        });

        // DuckDB-WASM uses SharedArrayBuffer (multi-threaded mode); browsers only
        // expose it when the page is "cross-origin isolated", which requires both
        // headers below. Server mode doesn't strictly need them — the page won't
        // touch the wasm bundle — but setting them unconditionally lets the same
        // build serve users who later switch to drop-a-file mode.
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
            // Use a per-request duplicate connection so concurrent requests are thread-safe.
            try (DuckDBConnection reqConn = (DuckDBConnection) finalConn.duplicate()) {
                var results = executeQuery(reqConn, sql);
                ctx.json(results);
            } catch (SQLException e) {
                ctx.status(400).json(Map.of("error", e.getMessage()));
            }
        });

        // SPA fallback: serve index.html only for extension-less paths (SPA routes).
        // Paths with a '.' (e.g. /assets/index-xxx.js) are static assets already handled
        // by Javalin's static-file handler above; falling through here would serve index.html
        // instead of the real asset and break the app.
        app.get("/*", ctx -> {
            String path = ctx.path();
            if (!path.startsWith("/api/") && !path.contains(".")) {
                var devIndex = Path.of("frontend/dist/index.html");
                if (devIndex.toFile().exists()) {
                    ctx.result(java.nio.file.Files.newInputStream(devIndex));
                    ctx.contentType("text/html");
                } else {
                    var stream = ServeCommand.class.getResourceAsStream("/frontend-dist/index.html");
                    if (stream != null) {
                        ctx.result(stream);
                        ctx.contentType("text/html");
                    } else {
                        ctx.status(404).result("Frontend not built. Run 'npm run build' in frontend/.");
                    }
                }
            }
        });

        app.start(port);
        String url = "http://localhost:" + port;
        System.out.println("Serving notebook at " + url);

        if (!noOpen) {
            openBrowser(url);
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            app.stop();
            try { finalConn.close(); } catch (SQLException ignored) {}
        }));

        // Keep alive
        try {
            Thread.currentThread().join();
        } catch (InterruptedException ignored) {}
    }

    private static List<Map<String, Object>> executeQuery(DuckDBConnection conn, String sql) throws SQLException {
        try (var stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            ResultSetMetaData meta = rs.getMetaData();
            int cols = meta.getColumnCount();
            var rows = new ArrayList<Map<String, Object>>();
            while (rs.next()) {
                var row = new LinkedHashMap<String, Object>();
                for (int i = 1; i <= cols; i++) {
                    row.put(meta.getColumnName(i), rs.getObject(i));
                }
                rows.add(row);
            }
            return rows;
        }
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
