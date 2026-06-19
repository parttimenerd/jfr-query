package me.bechberger.jfr.duckdb.wasm;

import java.sql.SQLException;
import me.bechberger.jfr.duckdb.util.Appender;
import me.bechberger.jfr.duckdb.util.DuckDBSink;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * {@link DuckDBSink} backed by a JS-side {@code @duckdb/duckdb-wasm} connection.
 *
 * <p>DuckDB WASM does not expose the native Appender API, so {@link #createAppender} returns
 * a {@link JsAppender} that buffers rows and flushes them as INSERT VALUES batches over the
 * JS bridge.
 *
 * <p>{@link #duplicate} returns the same sink — DuckDB WASM AsyncDuckDB connections are
 * single-threaded under the JS event loop, and the importer's "parallel" code path collapses
 * to sequential when sinks share a connection. (Jafar still parses chunks in parallel inside
 * the WASM runtime, but JS calls serialize.)
 */
public final class JsDuckDBSink implements DuckDBSink {

    private final JSObject conn;

    public JsDuckDBSink(JSObject conn) {
        this.conn = conn;
    }

    @Override
    public void execute(String sql) throws SQLException {
        try {
            jsExecute(conn, sql);
        } catch (Exception e) {
            throw new SQLException("JS execute failed: " + e.getMessage(), e);
        }
    }

    @Override
    public Appender createAppender(String table) throws SQLException {
        return new JsAppender(conn, table);
    }

    @Override
    public DuckDBSink duplicate() {
        return this;
    }

    @Override
    public void close() {
        // The JS side owns the connection; nothing to release.
    }

    @JS.Coerce
    @JS("conn.query(sql);")
    static native void jsExecute(JSObject conn, String sql);
}
