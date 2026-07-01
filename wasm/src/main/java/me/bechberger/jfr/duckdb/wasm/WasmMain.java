package me.bechberger.jfr.duckdb.wasm;

import java.nio.file.Files;
import java.nio.file.Path;
import me.bechberger.jfr.duckdb.BasicParallelImporter;
import me.bechberger.jfr.duckdb.Options;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * GraalVM Web Image entry point — wires the JFR → DuckDB importer into the browser.
 *
 * <p>The frontend loads this WASM bundle, which calls {@link #installEntry} from
 * {@link #main(String[])} to register a {@code globalThis.JFRImporter.importJfrIntoDuckDB}
 * function. The frontend invokes that function with a {@link Uint8Array} of the JFR file
 * bytes plus an opaque handle to a {@code @duckdb/duckdb-wasm} connection. The same
 * {@link BasicParallelImporter} that runs in the CLI/server runs here, but writes through a
 * {@link JsDuckDBSink} that bridges to JS.
 *
 * <p><b>Byte-transfer strategy:</b> The GraalVM JS→WASM bridge has high per-call overhead.
 * Calling {@code arr[i]} 52 million times for a 50 MB file takes ~61 s. Instead we stage the
 * {@code Uint8Array} in a JS global and transfer it in 1 KB base64-encoded chunks (~50 K
 * bridge calls total). Java decodes the base64 locally. This cuts transfer time to ~1–2 s.
 */
public class WasmMain {

    // Bytes per base64 round-trip. 1 KB → ~50 K bridge calls for a 50 MB file.
    private static final int B64_CHUNK = 1024;

    // Base64 decode table (standard alphabet, indices 0–63).
    private static final byte[] B64_DEC = new byte[128];
    static {
        String a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < a.length(); i++) B64_DEC[a.charAt(i)] = (byte) i;
    }

    @FunctionalInterface
    public interface JfrImportFn {
        void apply(JSObject bytes, JSObject jsConn, JSObject jsDb);
    }

    /** Imports a JFR recording into the provided duckdb-wasm connection. */
    public static void importJfrIntoDuckDB(JSObject bytesJs, JSObject jsConn, JSObject jsDb) {
        int stacktraceDepth = getStacktraceDepth();
        String tablePrefix = getTablePrefix();
        try {
            int len = getLength(bytesJs);
            stageBytes(bytesJs);

            // Transfer via base64: ~50 K bridge calls for 50 MB instead of 52 M.
            byte[] bytes = new byte[len];
            int off = 0;
            while (off < len) {
                int chunkLen = Math.min(B64_CHUNK, len - off);
                String b64 = getBytesBase64(off, chunkLen);
                decodeBase64Into(b64, bytes, off, chunkLen);
                off += chunkLen;
            }
            clearStagedBytes();
            log("JFR bytes received: " + len);

            // Short-circuit the VFS round-trip: instead of writing to a temp file and
            // re-reading it, wire the bytes straight into CustomByteBuffer.map().
            // This eliminates two O(len) copies (write + readAllBytes) and the associated
            // temporary byte[] allocation in the VFS layer.
            io.jafar.utils.CustomByteBuffer.INLINE_BYTES.set(bytes);
            Path tmp = java.nio.file.Paths.get("/inline.jfr"); // ignored by map() when INLINE_BYTES is set
            log("JFR bytes staged for inline read: " + len);

            JsDuckDBSink rootSink = new JsDuckDBSink(jsConn, jsDb, tablePrefix);
            // Redirect stdout so [jfr-timing]/[flush] lines land in globalThis._jfrLog (JS-readable).
            java.io.PrintStream origOut = System.out;
            java.io.PrintStream capture = new java.io.PrintStream(new java.io.OutputStream() {
                private final StringBuilder line = new StringBuilder();
                @Override public void write(int b) {
                    if (b == '\n') {
                        storeLog(line.toString());
                        line.setLength(0);
                    } else {
                        line.append((char) b);
                    }
                }
                @Override public void write(byte[] buf, int off, int len) {
                    for (int i = off; i < off + len; i++) write(buf[i] & 0xFF);
                }
            });
            System.setOut(capture);
            BasicParallelImporter importer =
                    new BasicParallelImporter(() -> rootSink, new Options().withMaxStackTraceDepth(stacktraceDepth));
            log("BasicParallelImporter constructed; calling importRecording()");
            long t0 = System.currentTimeMillis();
            importer.importRecording(tmp);
            long t1 = System.currentTimeMillis();
            capture.flush();
            System.setOut(origOut);

            Files.deleteIfExists(tmp); // no-op for the inline path (file was never created)
            log("JFR import complete: " + bytes.length + " bytes in " + (t1 - t0) + "ms");
        } catch (Throwable t) {
            clearStagedBytes();
            StringBuilder sb = new StringBuilder("JFR import failed:\n");
            Throwable cur = t;
            while (cur != null) {
                sb.append("  ").append(cur.getClass().getName());
                if (cur.getMessage() != null) sb.append(": ").append(cur.getMessage());
                sb.append('\n');
                StackTraceElement[] trace = cur.getStackTrace();
                int n = Math.min(trace.length, 12);
                for (int i = 0; i < n; i++) {
                    sb.append("    at ").append(trace[i]).append('\n');
                }
                cur = cur.getCause();
                if (cur != null) sb.append("  Caused by: ");
            }
            log(sb.toString());
            throw new RuntimeException(t);
        }
    }

    /** Decodes a base64 string into {@code dest[destOff .. destOff+byteCount)}. */
    private static void decodeBase64Into(String s, byte[] dest, int destOff, int byteCount) {
        int si = 0;
        int di = destOff;
        int end = destOff + byteCount;
        while (di < end) {
            int b0 = B64_DEC[s.charAt(si++)];
            int b1 = B64_DEC[s.charAt(si++)];
            char c2 = si < s.length() ? s.charAt(si) : '=';
            int b2 = (c2 != '=') ? B64_DEC[c2] : -1;
            if (c2 != '=') si++;
            char c3 = si < s.length() ? s.charAt(si) : '=';
            int b3 = (c3 != '=') ? B64_DEC[c3] : -1;
            if (c3 != '=') si++;

            dest[di++] = (byte) ((b0 << 2) | (b1 >> 4));
            if (b2 >= 0 && di < end) dest[di++] = (byte) (((b1 & 0xF) << 4) | (b2 >> 2));
            if (b3 >= 0 && di < end) dest[di++] = (byte) (((b2 & 0x3) << 6) | b3);
        }
    }

    public static void main(String[] args) {
        log("jfr-importer.wasm loaded");
        installEntry(WasmMain::importJfrIntoDuckDB);
    }

    @JS.Coerce
    @JS("globalThis.JFRImporter = { importJfrIntoDuckDB: (bytes, conn, db, stacktraceDepth, tablePrefix) => { globalThis._jfrStacktraceDepth = (typeof stacktraceDepth === 'number') ? stacktraceDepth : 10; globalThis._jfrTablePrefix = (typeof tablePrefix === 'string') ? tablePrefix : ''; fn(bytes, conn, db); } };")
    private static native void installEntry(JfrImportFn fn);

    @JS.Coerce
    @JS("return arr.length;")
    private static native int getLength(JSObject arr);

    @JS.Coerce
    @JS("globalThis._jfrStagedBytes = arr;")
    private static native void stageBytes(JSObject arr);

    // Encode bytes[offset .. offset+len) from the staged Uint8Array to base64.
    // btoa + String.fromCharCode is the standard fast path for typed-array base64
    // in browsers; subarray() is a zero-copy view (no heap allocation for the slice).
    @JS.Coerce
    @JS("const chunk = globalThis._jfrStagedBytes.subarray(offset, offset + len); return btoa(String.fromCharCode.apply(null, chunk));")
    private static native String getBytesBase64(int offset, int len);

    @JS.Coerce
    @JS("globalThis._jfrStagedBytes = null;")
    private static native void clearStagedBytes();

    @JS.Coerce
    @JS("console.log(msg);")
    private static native void log(String msg);

    @JS.Coerce
    @JS("if (!globalThis._jfrLog) globalThis._jfrLog = []; globalThis._jfrLog.push(msg); console.log(msg);")
    static native void storeLog(String msg);

    /** Reads the stacktrace depth set by the JS wrapper before calling importJfrIntoDuckDB. */
    @JS.Coerce
    @JS("return (typeof globalThis._jfrStacktraceDepth === 'number') ? globalThis._jfrStacktraceDepth : 10;")
    private static native int getStacktraceDepth();

    /** Reads the table prefix set by the JS wrapper before calling importJfrIntoDuckDB. */
    @JS.Coerce
    @JS("return (typeof globalThis._jfrTablePrefix === 'string') ? globalThis._jfrTablePrefix : '';")
    private static native String getTablePrefix();
}
