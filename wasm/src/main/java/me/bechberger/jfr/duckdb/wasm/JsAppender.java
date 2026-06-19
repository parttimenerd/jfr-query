package me.bechberger.jfr.duckdb.wasm;

import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import me.bechberger.jfr.duckdb.util.Appender;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * INSERT-batching {@link Appender} for DuckDB WASM.
 *
 * <p>Buffers rows of literal SQL fragments, and flushes them as a single
 * {@code INSERT INTO "table" VALUES (...), (...), ...} statement every {@link #BATCH_SIZE} rows
 * or on {@link #close()}.
 *
 * <p>Using literal SQL (instead of parameterized prepared statements) keeps the JS bridge
 * surface tiny — one {@link JsDuckDBSink#jsExecute} call per batch — and avoids round-tripping
 * Java values through {@link JSObject} for prepared-statement parameters.
 */
public final class JsAppender implements Appender {

    private static final int BATCH_SIZE = 1000;

    private final JSObject conn;
    private final String tableName;
    private final List<String> rows = new ArrayList<>(BATCH_SIZE);
    private final StringBuilder currentRow = new StringBuilder();
    private boolean firstColumn = true;
    private int columnCount = -1;

    public JsAppender(JSObject conn, String tableName) {
        this.conn = conn;
        this.tableName = tableName;
    }

    @Override
    public void beginRow() {
        currentRow.setLength(0);
        currentRow.append('(');
        firstColumn = true;
    }

    @Override
    public void endRow() throws SQLException {
        currentRow.append(')');
        if (columnCount < 0) {
            // Trust the first row; we don't validate later rows.
            columnCount = countColumns(currentRow);
        }
        rows.add(currentRow.toString());
        if (rows.size() >= BATCH_SIZE) {
            flush();
        }
    }

    private static int countColumns(StringBuilder sb) {
        // Naive: count top-level commas inside the parens.
        int depth = 0;
        int count = 1;
        boolean inQuote = false;
        for (int i = 1; i < sb.length() - 1; i++) {
            char c = sb.charAt(i);
            if (c == '\'' && (i == 0 || sb.charAt(i - 1) != '\\')) inQuote = !inQuote;
            if (inQuote) continue;
            if (c == '(' || c == '[') depth++;
            else if (c == ')' || c == ']') depth--;
            else if (c == ',' && depth == 0) count++;
        }
        return count;
    }

    private void appendSep() {
        if (!firstColumn) currentRow.append(',');
        firstColumn = false;
    }

    @Override
    public void appendNull() {
        appendSep();
        currentRow.append("NULL");
    }

    @Override
    public void append(boolean v) {
        appendSep();
        currentRow.append(v ? "TRUE" : "FALSE");
    }

    @Override
    public void append(byte v) {
        appendSep();
        currentRow.append((int) v);
    }

    @Override
    public void append(short v) {
        appendSep();
        currentRow.append((int) v);
    }

    @Override
    public void append(int v) {
        appendSep();
        currentRow.append(v);
    }

    @Override
    public void append(long v) {
        appendSep();
        currentRow.append(v);
    }

    @Override
    public void append(float v) {
        appendSep();
        if (Float.isNaN(v)) currentRow.append("'NaN'::DOUBLE");
        else if (Float.isInfinite(v)) currentRow.append(v > 0 ? "'Infinity'::DOUBLE" : "'-Infinity'::DOUBLE");
        else currentRow.append(v);
    }

    @Override
    public void append(double v) {
        appendSep();
        if (Double.isNaN(v)) currentRow.append("'NaN'::DOUBLE");
        else if (Double.isInfinite(v)) currentRow.append(v > 0 ? "'Infinity'::DOUBLE" : "'-Infinity'::DOUBLE");
        else currentRow.append(v);
    }

    @Override
    public void append(String v) {
        appendSep();
        if (v == null) {
            currentRow.append("NULL");
            return;
        }
        currentRow.append('\'');
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            if (c == '\'') currentRow.append("''");
            else currentRow.append(c);
        }
        currentRow.append('\'');
    }

    @Override
    public void append(Instant v) {
        appendSep();
        if (v == null) {
            currentRow.append("NULL");
            return;
        }
        // ISO-8601 format DuckDB parses natively for TIMESTAMP.
        currentRow.append("TIMESTAMP '").append(v.toString().replace("T", " ").replace("Z", "")).append('\'');
    }

    @Override
    public void append(int[] arr) {
        appendSep();
        currentRow.append('[');
        for (int i = 0; i < arr.length; i++) {
            if (i > 0) currentRow.append(',');
            currentRow.append(arr[i]);
        }
        currentRow.append(']');
    }

    @Override
    public void close() throws SQLException {
        flush();
    }

    private void flush() throws SQLException {
        if (rows.isEmpty()) return;
        StringBuilder sql = new StringBuilder();
        sql.append("INSERT INTO \"").append(tableName.replace("\"", "\"\"")).append("\" VALUES ");
        for (int i = 0; i < rows.size(); i++) {
            if (i > 0) sql.append(',');
            sql.append(rows.get(i));
        }
        try {
            JsDuckDBSink.jsExecute(conn, sql.toString());
        } catch (Exception e) {
            throw new SQLException("Batch insert failed for table " + tableName + ": " + e.getMessage(), e);
        }
        rows.clear();
    }
}
