package me.bechberger.jfr.duckdb.wasm;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.Instant;
import me.bechberger.jfr.duckdb.util.Appender;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * CSV-based {@link Appender} for DuckDB WASM.
 *
 * <p>Builds RFC-4180 CSV in a {@link ByteArrayOutputStream} and on {@link #close()} transfers
 * the bytes via base64 to a JS global, then calls {@code registerFileBuffer} + {@code INSERT INTO
 * ... SELECT * FROM read_csv(...)} via the DuckDB WASM connection. This is ~5-10x faster than the
 * INSERT VALUES SQL text approach because:
 * <ul>
 *   <li>No SQL quoting overhead per cell (just CSV escaping)</li>
 *   <li>DuckDB's native C++ CSV parser is much faster than SQL text parsing</li>
 *   <li>Only two bridge calls per table (stageCSV + insertCSV) vs one per BATCH_SIZE rows</li>
 * </ul>
 */
final class CsvAppender implements Appender {

    // Base64 encode table
    private static final char[] B64 =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    private final JSObject conn;
    private final JSObject db;
    private final String tableName;
    private final ByteArrayOutputStream buf = new ByteArrayOutputStream(1 << 20); // 1 MB initial
    private final OutputStreamWriter writer = new OutputStreamWriter(buf, StandardCharsets.UTF_8);
    private boolean firstCol = true;
    private boolean hasRows = false;

    CsvAppender(JSObject conn, JSObject db, String tableName) {
        this.conn = conn;
        this.db = db;
        this.tableName = tableName;
    }

    // ── row boundary ─────────────────────────────────────────────────────────

    @Override
    public void beginRow() {
        firstCol = true;
    }

    @Override
    public void endRow() {
        try {
            writer.write('\n');
            hasRows = true;
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    // ── cell writers ──────────────────────────────────────────────────────────

    private void sep() throws IOException {
        if (!firstCol) writer.write(',');
        firstCol = false;
    }

    @Override
    public void appendNull() {
        try { sep(); /* empty field = NULL in DuckDB CSV */ } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(boolean v) {
        try { sep(); writer.write(v ? "true" : "false"); } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(byte v) {
        try { sep(); writer.write(Integer.toString(v)); } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(short v) {
        try { sep(); writer.write(Integer.toString(v)); } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(int v) {
        try { sep(); writer.write(Integer.toString(v)); } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(long v) {
        try { sep(); writer.write(Long.toString(v)); } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(float v) {
        try {
            sep();
            if (Float.isNaN(v)) writer.write("NaN");
            else if (Float.isInfinite(v)) writer.write(v > 0 ? "Infinity" : "-Infinity");
            else writer.write(Float.toString(v));
        } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(double v) {
        try {
            sep();
            if (Double.isNaN(v)) writer.write("NaN");
            else if (Double.isInfinite(v)) writer.write(v > 0 ? "Infinity" : "-Infinity");
            else writer.write(Double.toString(v));
        } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(String v) {
        try {
            sep();
            if (v == null) return; // empty = NULL
            // RFC-4180: quote if contains comma, newline, or double-quote
            boolean needsQuote = v.indexOf(',') >= 0 || v.indexOf('"') >= 0
                    || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0;
            if (!needsQuote) {
                writer.write(v);
            } else {
                writer.write('"');
                for (int i = 0; i < v.length(); i++) {
                    char c = v.charAt(i);
                    if (c == '"') writer.write('"');
                    writer.write(c);
                }
                writer.write('"');
            }
        } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(Instant v) {
        try {
            sep();
            if (v == null) return;
            // ISO-8601 without T and Z — matches DuckDB's default TIMESTAMP parser
            writer.write(v.toString().replace('T', ' ').replace("Z", ""));
        } catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override
    public void append(int[] arr) {
        try {
            sep();
            // DuckDB LIST literal: [1,2,3]
            writer.write('[');
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) writer.write(',');
                writer.write(Integer.toString(arr[i]));
            }
            writer.write(']');
        } catch (IOException e) { throw new RuntimeException(e); }
    }

    // ── flush ─────────────────────────────────────────────────────────────────

    @Override
    public void close() throws SQLException {
        if (!hasRows) return;
        try {
            writer.flush();
        } catch (IOException e) {
            throw new SQLException("CSV flush failed", e);
        }
        byte[] csv = buf.toByteArray();
        // Transfer as base64, then bulk-insert via read_csv
        String b64 = encodeBase64(csv);
        stageAndInsert(conn, db, tableName, b64);
    }

    // ── base64 encoder ────────────────────────────────────────────────────────

    private static String encodeBase64(byte[] data) {
        int len = data.length;
        int outLen = ((len + 2) / 3) * 4;
        char[] out = new char[outLen];
        int oi = 0;
        for (int i = 0; i < len; ) {
            int b0 = data[i++] & 0xFF;
            int b1 = i < len ? data[i++] & 0xFF : 0;
            int b2 = i < len ? data[i++] & 0xFF : 0;
            out[oi++] = B64[b0 >> 2];
            out[oi++] = B64[((b0 & 3) << 4) | (b1 >> 4)];
            out[oi++] = B64[((b1 & 0xF) << 2) | (b2 >> 6)];
            out[oi++] = B64[b2 & 0x3F];
        }
        // Padding
        int pad = (3 - (len % 3)) % 3;
        for (int i = 0; i < pad; i++) out[outLen - 1 - i] = '=';
        return new String(out);
    }

    /**
     * Decodes base64 CSV bytes on the JS side, registers as a file buffer, and bulk-inserts
     * into the named table.
     *
     * <p>JS steps:
     * <ol>
     *   <li>Decode base64 → Uint8Array</li>
     *   <li>{@code db.registerFileBuffer(fname, bytes)} — registers in DuckDB WASM VFS</li>
     *   <li>{@code conn.query("INSERT INTO ... SELECT * FROM read_csv(fname, ...)")} </li>
     *   <li>Deregister the file buffer (housekeeping)</li>
     * </ol>
     * A global counter {@code globalThis._jfrCsvPending} is incremented before the async chain
     * and decremented when done, so the JS drain loop can wait for completion.
     */
    @JS.Coerce
    @JS("""
        if (!globalThis._jfrCsvPending) globalThis._jfrCsvPending = 0;
        globalThis._jfrCsvPending++;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const fname = 'csv_' + tableName.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + (Date.now() % 1000000) + '.csv';
        const tbl = '"' + tableName.replace(/"/g, '""') + '"';
        db.registerFileBuffer(fname, bytes).then(() => {
            return conn.query(
                "COPY " + tbl + " FROM '" + fname + "' (FORMAT csv, HEADER false, NULLSTR '')"
            );
        }).then(() => {
            db.dropFile(fname).catch(() => {});
            globalThis._jfrCsvPending--;
        }).catch(e => {
            console.error('[csv-insert] ' + tableName + ': ' + e);
            globalThis._jfrCsvPending--;
        });
        """)
    static native void stageAndInsert(JSObject conn, JSObject db, String tableName, String b64);
}
