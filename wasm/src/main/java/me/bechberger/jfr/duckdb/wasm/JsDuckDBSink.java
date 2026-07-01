package me.bechberger.jfr.duckdb.wasm;

import java.sql.SQLException;
import me.bechberger.jfr.duckdb.util.Appender;
import me.bechberger.jfr.duckdb.util.DuckDBSink;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * {@link DuckDBSink} backed by a JS-side {@code @duckdb/duckdb-wasm} connection.
 *
 * <p>Uses {@link CsvAppender} for bulk inserts: Java writes CSV bytes in WASM memory,
 * transfers them via base64 to JS, and DuckDB's native CSV parser loads them — avoiding
 * the expensive INSERT VALUES SQL string construction of the old approach.
 *
 * <p>{@link #duplicate} returns the same sink — DuckDB WASM AsyncDuckDB connections are
 * single-threaded under the JS event loop, and the importer's "parallel" code path collapses
 * to sequential when sinks share a connection.
 *
 * <p>When {@code tablePrefix} is non-empty, all table names in DDL and inserts are prefixed
 * so chunk-parallel workers can write to isolated tables that are later merged.
 */
public final class JsDuckDBSink implements DuckDBSink {

    private final JSObject conn;
    private final JSObject db;
    /** Empty string means no prefix (normal import). */
    private final String tablePrefix;

    public JsDuckDBSink(JSObject conn, JSObject db) {
        this(conn, db, "");
    }

    public JsDuckDBSink(JSObject conn, JSObject db, String tablePrefix) {
        this.conn = conn;
        this.db = db;
        this.tablePrefix = tablePrefix == null ? "" : tablePrefix;
    }

    /**
     * Rewrites the first double-quoted identifier in {@code sql} to include the table prefix.
     * Java DDL always starts with CREATE TABLE IF NOT EXISTS "Name" or COMMENT ON TABLE "Name".
     */
    private String prefixSql(String sql) {
        if (tablePrefix.isEmpty()) return sql;
        int q1 = sql.indexOf('"');
        if (q1 < 0) return sql;
        int q2 = sql.indexOf('"', q1 + 1);
        if (q2 < 0) return sql;
        return sql.substring(0, q1 + 1) + tablePrefix + sql.substring(q1 + 1);
    }

    @Override
    public void execute(String sql) throws SQLException {
        try {
            jsExecute(conn, prefixSql(sql));
        } catch (Exception e) {
            throw new SQLException("JS execute failed: " + e.getMessage(), e);
        }
    }

    @Override
    public Appender createAppender(String table) throws SQLException {
        return new BinaryAppender(conn, db, tablePrefix + table);
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

