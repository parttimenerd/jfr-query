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
 * <p>GraalVM Web Image does not expose static Java methods to JS by their fully-qualified
 * name. The supported pattern is to pass a Java functional-interface lambda *into* JS via a
 * {@code @JS} bridge — GraalVM coerces it to a callable JS function. We use that here:
 * {@link #installEntry} hands the JS world a {@link JfrImportFn} that the bridge stores on
 * {@code globalThis.JFRImporter}.
 *
 * <p><b>Known limitation (2026-06):</b> the import currently fails inside {@code Files.write}
 * because GraalVM Web Image stubs {@code RandomAccessFile.initIDs} as
 * {@code UnsupportedOperationException}. {@code jafar-parser}'s
 * {@code UntypedJafarParser.open} API only accepts {@code String}/{@code Path}, so we have to
 * spill bytes to disk first. Resolving this needs either a {@code byte[]}/{@code ByteBuffer}
 * overload in jafar or a vendored fork. Until then the WASM bridge is wired end-to-end but
 * dead at the file-spill step. CLI and server modes are unaffected.
 */
public class WasmMain {

    @FunctionalInterface
    public interface JfrImportFn {
        // bytes is a JS Uint8Array; we marshal it to byte[] via getLength + getByteAt below.
        // Passing TypedArrays through a {@code byte[]} parameter doesn't work in current
        // GraalVM Web Image — the SAM-coercion path raises ClassCastException.
        void apply(JSObject bytes, JSObject jsConn);
    }

    /** Imports a JFR recording into the provided duckdb-wasm connection. */
    public static void importJfrIntoDuckDB(JSObject bytesJs, JSObject jsConn) {
        try {
            int len = getLength(bytesJs);
            byte[] bytes = new byte[len];
            for (int i = 0; i < len; i++) {
                bytes[i] = (byte) getByteAt(bytesJs, i);
            }
            log("JFR bytes received: " + len);

            Path tmp = Files.createTempFile("upload", ".jfr");
            Files.write(tmp, bytes);
            log("JFR bytes written to " + tmp);

            JsDuckDBSink rootSink = new JsDuckDBSink(jsConn);
            BasicParallelImporter importer =
                    new BasicParallelImporter(() -> rootSink, new Options());
            log("BasicParallelImporter constructed; calling importRecording()");
            importer.importRecording(tmp);

            Files.deleteIfExists(tmp);
            log("JFR import complete: " + bytes.length + " bytes");
        } catch (Throwable t) {
            // Walk the cause chain so `ExceptionInInitializerError` etc. don't hide
            // the real failure. Printing here logs to the JS console; the rethrow
            // surfaces it to the JS caller as a proxied exception.
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

    public static void main(String[] args) {
        log("jfr-importer.wasm loaded");
        installEntry(WasmMain::importJfrIntoDuckDB);
    }

    @JS.Coerce
    @JS("globalThis.JFRImporter = { importJfrIntoDuckDB: (bytes, conn) => fn(bytes, conn) };")
    private static native void installEntry(JfrImportFn fn);

    @JS.Coerce
    @JS("return arr.length;")
    private static native int getLength(JSObject arr);

    @JS.Coerce
    @JS("return arr[i];")
    private static native int getByteAt(JSObject arr, int i);

    @JS.Coerce
    @JS("console.log(msg);")
    private static native void log(String msg);
}
