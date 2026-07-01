package me.bechberger.jfr.duckdb.wasm;

import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import me.bechberger.jfr.duckdb.util.Appender;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSObject;

/**
 * Binary columnar {@link Appender} for DuckDB WASM.
 *
 * <p>Accumulates column values in unboxed primitive arrays (no autoboxing), then on
 * {@link #close()} serializes them as a compact binary blob, base64-encodes it, and hands it off
 * to {@link #loadColumnarData} which uses {@code apache-arrow} to build a typed Arrow table and
 * calls {@code conn.insertArrowTable}.
 *
 * <h3>Hot-path design</h3>
 * Row 0 of each table runs through the schema-discovery path (normal null-checks and growth).
 * After row 0 completes, {@code freezeSchema()} pre-grows all arrays to {@code CHUNK_SIZE} so
 * that rows 1..CHUNK_SIZE-1 never need bounds checks or null checks — only the array store and
 * bitmap update.
 *
 * <h3>Binary format</h3>
 * <pre>
 *   Header:
 *     numCols : int32
 *     numRows : int32
 *     colType[numCols] : int8   (see TYPE_* constants)
 *   Data (per column in column order):
 *     For primitive types: validity bitmap (ceil(n/8) bytes, LSB-first) + packed values
 *     For STRING: validity bitmap + [int32 byteLen or -1 for null][bytes]...
 *     For INT_ARRAY: validity bitmap + [int32 len or -1 for null][int32...]...
 * </pre>
 *
 * <h3>Prerequisites</h3>
 * <p>Before calling the Java importer, the TS caller must set:
 * <pre>
 *   globalThis.__arrow = await import('apache-arrow');
 * </pre>
 * This is done in {@code jfrToWasmLoader.ts}.
 */
final class BinaryAppender implements Appender {

    // Column type codes
    static final int TYPE_BOOL      = 0;
    static final int TYPE_BYTE      = 1;
    static final int TYPE_SHORT     = 2;
    static final int TYPE_INT       = 3;
    static final int TYPE_LONG      = 4;
    static final int TYPE_FLOAT     = 5;
    static final int TYPE_DOUBLE    = 6;
    static final int TYPE_STRING    = 7;
    static final int TYPE_INSTANT   = 8;
    static final int TYPE_INT_ARRAY = 9;
    private static final int TYPE_UNKNOWN = -1;

    // Base64 encode table (used by encodeBase64 — kept for fallback)
    private static final char[] B64 =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    private final JSObject conn;
    private final JSObject db;
    private final String tableName;

    private static final int CHUNK_SIZE = 262_144; // flush every 256K rows
    private static final int INITIAL_CAPACITY = 64;

    // Column names provided by setColumnNames; embedded in every flush so the JS side
    // can skip the PRAGMA table_info round-trip.
    private String[] columnNames = null;

    // Per-column type registry
    private int[] colTypes = new int[16];
    private int numCols = 0;

    // Backing arrays
    private byte[][]   boolData;
    private byte[][]   byteData;
    private short[][]  shortData;
    private int[][]    intData;
    private long[][]   longData;   // TYPE_LONG + TYPE_INSTANT
    private float[][]  floatData;
    private double[][] doubleData;
    private List<?>[]  objData;    // TYPE_STRING -> List<String>, TYPE_INT_ARRAY -> List<int[]>

    private byte[][] nullBitmaps;
    private int      currentCol = -1;
    private int      numRows    = 0;

    // After the first row completes, all arrays are pre-grown to CHUNK_SIZE.
    // Hot-path appenders skip all null/bounds checks after this is set.
    private boolean schemaFrozen = false;

    BinaryAppender(JSObject conn, JSObject db, String tableName) {
        this.conn = conn;
        this.db = db;
        this.tableName = tableName;
    }

    @Override
    public void setColumnNames(String[] names) {
        this.columnNames = names;
    }

    // ── row boundary ──────────────────────────────────────────────────────────

    @Override
    public void beginRow() {
        currentCol = 0;
    }

    @Override
    public void endRow() throws SQLException {
        numRows++;
        currentCol = -1;
        if (!schemaFrozen) {
            tryFreezeSchema();
        }
        if (numRows == CHUNK_SIZE) {
            flushChunk();
        }
    }

    // Freeze schema once all columns have real types and allocated storage.
    // This may not happen on the null row (which calls appendNull for most columns),
    // but will happen after the first real data row.
    @SuppressWarnings("unchecked")
    private void tryFreezeSchema() {
        if (numCols == 0) return; // no columns yet
        // Check if any column is still TYPE_UNKNOWN or has missing primitive storage
        for (int c = 0; c < numCols; c++) {
            if (colTypes[c] == TYPE_UNKNOWN) return; // still discovering types
            if (hasMissingStorage(c)) return; // storage not yet allocated
        }
        // All columns typed and allocated — ensure outer arrays cover numCols, then pre-grow inners
        if (nullBitmaps == null || numCols > nullBitmaps.length) {
            growStorage(numCols);
        }
        int bitmapCap = (CHUNK_SIZE + 7) / 8;
        for (int c = 0; c < numCols; c++) {
            // Bitmap
            if (nullBitmaps[c].length < bitmapCap) {
                nullBitmaps[c] = java.util.Arrays.copyOf(nullBitmaps[c], bitmapCap);
            }
            // Primitive arrays
            switch (colTypes[c]) {
                case TYPE_BOOL   -> { if (boolData[c].length   < CHUNK_SIZE) boolData[c]   = java.util.Arrays.copyOf(boolData[c],   CHUNK_SIZE); }
                case TYPE_BYTE   -> { if (byteData[c].length   < CHUNK_SIZE) byteData[c]   = java.util.Arrays.copyOf(byteData[c],   CHUNK_SIZE); }
                case TYPE_SHORT  -> { if (shortData[c].length  < CHUNK_SIZE) shortData[c]  = java.util.Arrays.copyOf(shortData[c],  CHUNK_SIZE); }
                case TYPE_INT    -> { if (intData[c].length    < CHUNK_SIZE) intData[c]    = java.util.Arrays.copyOf(intData[c],    CHUNK_SIZE); }
                case TYPE_LONG, TYPE_INSTANT -> { if (longData[c].length < CHUNK_SIZE) longData[c] = java.util.Arrays.copyOf(longData[c], CHUNK_SIZE); }
                case TYPE_FLOAT  -> { if (floatData[c].length  < CHUNK_SIZE) floatData[c]  = java.util.Arrays.copyOf(floatData[c],  CHUNK_SIZE); }
                case TYPE_DOUBLE -> { if (doubleData[c].length < CHUNK_SIZE) doubleData[c] = java.util.Arrays.copyOf(doubleData[c], CHUNK_SIZE); }
                // Lists grow automatically; ensure they exist
                case TYPE_STRING    -> { if (objData[c] == null) objData[c] = new ArrayList<String>(CHUNK_SIZE); }
                case TYPE_INT_ARRAY -> { if (objData[c] == null) objData[c] = new ArrayList<int[]>(CHUNK_SIZE); }
                default             -> { if (objData[c] == null) objData[c] = new ArrayList<>(CHUNK_SIZE); }
            }
        }
        schemaFrozen = true;
    }

    private boolean hasMissingStorage(int c) {
        if (nullBitmaps == null || c >= nullBitmaps.length || nullBitmaps[c] == null) return true;
        return switch (colTypes[c]) {
            case TYPE_BOOL         -> boolData   == null || c >= boolData.length   || boolData[c]   == null;
            case TYPE_BYTE         -> byteData   == null || c >= byteData.length   || byteData[c]   == null;
            case TYPE_SHORT        -> shortData  == null || c >= shortData.length  || shortData[c]  == null;
            case TYPE_INT          -> intData    == null || c >= intData.length    || intData[c]    == null;
            case TYPE_LONG, TYPE_INSTANT -> longData == null || c >= longData.length || longData[c] == null;
            case TYPE_FLOAT        -> floatData  == null || c >= floatData.length  || floatData[c]  == null;
            case TYPE_DOUBLE       -> doubleData == null || c >= doubleData.length || doubleData[c] == null;
            default -> false; // STRING/INT_ARRAY use objData which can be null (fine — will be created on append)
        };
    }

    // ── column bootstrapping (slow path: rows 0 only) ────────────────────────

    private void ensureCol(int type) {
        if (currentCol >= numCols) {
            if (numCols >= colTypes.length) {
                colTypes = java.util.Arrays.copyOf(colTypes, colTypes.length * 2);
            }
            colTypes[numCols] = type;
            numCols++;
        } else if (colTypes[currentCol] == TYPE_UNKNOWN && type != TYPE_UNKNOWN) {
            colTypes[currentCol] = type;
        }
    }

    private void ensureStorage() {
        int c = currentCol;
        if (nullBitmaps == null) {
            allocateStorage(Math.max(16, numCols + 1));
        } else if (c >= nullBitmaps.length) {
            growStorage(c + 1);
        }
        if (nullBitmaps[c] == null) {
            int bitmapCap = (INITIAL_CAPACITY + 7) / 8;
            nullBitmaps[c] = new byte[bitmapCap];
        }
        // Grow bitmap if needed
        int row = numRows;
        int bitmapIdx = row >> 3;
        if (bitmapIdx >= nullBitmaps[c].length) {
            nullBitmaps[c] = java.util.Arrays.copyOf(nullBitmaps[c], nullBitmaps[c].length * 2);
        }
        // Ensure primitive/list storage
        ensureColData(c, row);
    }

    @SuppressWarnings("unchecked")
    private void ensureColData(int c, int row) {
        int cap = Math.max(INITIAL_CAPACITY, row + 1);
        switch (colTypes[c]) {
            case TYPE_BOOL -> {
                if (boolData[c] == null) boolData[c] = new byte[cap];
                else if (row >= boolData[c].length) boolData[c] = java.util.Arrays.copyOf(boolData[c], Math.max(boolData[c].length * 2, row + 1));
            }
            case TYPE_BYTE -> {
                if (byteData[c] == null) byteData[c] = new byte[cap];
                else if (row >= byteData[c].length) byteData[c] = java.util.Arrays.copyOf(byteData[c], Math.max(byteData[c].length * 2, row + 1));
            }
            case TYPE_SHORT -> {
                if (shortData[c] == null) shortData[c] = new short[cap];
                else if (row >= shortData[c].length) shortData[c] = java.util.Arrays.copyOf(shortData[c], Math.max(shortData[c].length * 2, row + 1));
            }
            case TYPE_INT -> {
                if (intData[c] == null) intData[c] = new int[cap];
                else if (row >= intData[c].length) intData[c] = java.util.Arrays.copyOf(intData[c], Math.max(intData[c].length * 2, row + 1));
            }
            case TYPE_LONG, TYPE_INSTANT -> {
                if (longData[c] == null) longData[c] = new long[cap];
                else if (row >= longData[c].length) longData[c] = java.util.Arrays.copyOf(longData[c], Math.max(longData[c].length * 2, row + 1));
            }
            case TYPE_FLOAT -> {
                if (floatData[c] == null) floatData[c] = new float[cap];
                else if (row >= floatData[c].length) floatData[c] = java.util.Arrays.copyOf(floatData[c], Math.max(floatData[c].length * 2, row + 1));
            }
            case TYPE_DOUBLE -> {
                if (doubleData[c] == null) doubleData[c] = new double[cap];
                else if (row >= doubleData[c].length) doubleData[c] = java.util.Arrays.copyOf(doubleData[c], Math.max(doubleData[c].length * 2, row + 1));
            }
            case TYPE_STRING -> { if (objData[c] == null) objData[c] = new ArrayList<String>(INITIAL_CAPACITY); }
            case TYPE_INT_ARRAY -> { if (objData[c] == null) objData[c] = new ArrayList<int[]>(INITIAL_CAPACITY); }
            default -> { if (objData[c] == null) objData[c] = new ArrayList<>(INITIAL_CAPACITY); }
        }
    }

    @SuppressWarnings("unchecked")
    private void allocateStorage(int cols) {
        nullBitmaps = new byte[cols][];
        boolData    = new byte[cols][];
        byteData    = new byte[cols][];
        shortData   = new short[cols][];
        intData     = new int[cols][];
        longData    = new long[cols][];
        floatData   = new float[cols][];
        doubleData  = new double[cols][];
        objData     = new List[cols];
    }

    @SuppressWarnings("unchecked")
    private void growStorage(int minCols) {
        int newCap = Math.max(nullBitmaps.length * 2, minCols);
        nullBitmaps = java.util.Arrays.copyOf(nullBitmaps, newCap);
        boolData    = java.util.Arrays.copyOf(boolData, newCap);
        byteData    = java.util.Arrays.copyOf(byteData, newCap);
        shortData   = java.util.Arrays.copyOf(shortData, newCap);
        intData     = java.util.Arrays.copyOf(intData, newCap);
        longData    = java.util.Arrays.copyOf(longData, newCap);
        floatData   = java.util.Arrays.copyOf(floatData, newCap);
        doubleData  = java.util.Arrays.copyOf(doubleData, newCap);
        objData     = java.util.Arrays.copyOf(objData, newCap);
    }

    // ── set null bit ─────────────────────────────────────────────────────────

    private void markValid(int c, int row) {
        nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
    }

    // ── typed appenders (fast path after schema frozen; slow path for row 0) ──
    //
    // Hot-path invariant: schemaFrozen guarantees all arrays are pre-grown to CHUNK_SIZE
    // and c < numCols. If a new column appears beyond numCols (should not happen, but
    // guard defensively), fall through to the slow path.

    /** True if c is within the frozen schema bounds and inner array exists for the type. */
    private boolean inHotPathBounds(int c) {
        return c < numCols && nullBitmaps != null && c < nullBitmaps.length;
    }

    @Override
    @SuppressWarnings("unchecked")
    public void appendNull() throws SQLException {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol;
            int type = colTypes[c];
            if (type == TYPE_STRING || type == TYPE_INT_ARRAY || type == TYPE_UNKNOWN) {
                ((List<Object>) objData[c]).add(null);
            }
            currentCol++;
            return;
        }
        int type = (currentCol < numCols) ? colTypes[currentCol] : TYPE_UNKNOWN;
        ensureCol(type);
        ensureStorage();
        int c = currentCol;
        if (colTypes[c] == TYPE_STRING || colTypes[c] == TYPE_INT_ARRAY || colTypes[c] == TYPE_UNKNOWN) {
            ((List<Object>) objData[c]).add(null);
        }
        currentCol++;
    }

    @Override
    public void append(boolean v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            boolData[c][row] = v ? (byte)1 : 0;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_BOOL); ensureStorage();
        int c = currentCol; int row = numRows;
        boolData[c][row] = v ? (byte)1 : 0;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(byte v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            byteData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_BYTE); ensureStorage();
        int c = currentCol; int row = numRows;
        byteData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(short v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            shortData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_SHORT); ensureStorage();
        int c = currentCol; int row = numRows;
        shortData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(int v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            intData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_INT); ensureStorage();
        int c = currentCol; int row = numRows;
        intData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(long v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            longData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_LONG); ensureStorage();
        int c = currentCol; int row = numRows;
        longData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(float v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            floatData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_FLOAT); ensureStorage();
        int c = currentCol; int row = numRows;
        floatData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(double v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            doubleData[c][row] = v;
            nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_DOUBLE); ensureStorage();
        int c = currentCol; int row = numRows;
        doubleData[c][row] = v;
        markValid(c, row);
        currentCol++;
    }

    @SuppressWarnings("unchecked")
    @Override
    public void append(String v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            ((List<String>) objData[c]).add(v);
            if (v != null) nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_STRING); ensureStorage();
        int c = currentCol; int row = numRows;
        ((List<String>) objData[c]).add(v);
        if (v != null) markValid(c, row);
        currentCol++;
    }

    @SuppressWarnings("unchecked")
    @Override
    public void append(int[] v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            ((List<int[]>) objData[c]).add(v);
            if (v != null) nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            currentCol++;
            return;
        }
        ensureCol(TYPE_INT_ARRAY); ensureStorage();
        int c = currentCol; int row = numRows;
        ((List<int[]>) objData[c]).add(v);
        if (v != null) markValid(c, row);
        currentCol++;
    }

    @Override
    public void append(Instant v) {
        if (schemaFrozen && inHotPathBounds(currentCol)) {
            int c = currentCol; int row = numRows;
            if (v != null) {
                longData[c][row] = v.getEpochSecond() * 1_000_000L + v.getNano() / 1_000L;
                nullBitmaps[c][row >> 3] |= (byte)(1 << (row & 7));
            }
            currentCol++;
            return;
        }
        ensureCol(TYPE_INSTANT); ensureStorage();
        int c = currentCol; int row = numRows;
        if (v != null) {
            longData[c][row] = v.getEpochSecond() * 1_000_000L + v.getNano() / 1_000L;
            markValid(c, row);
        }
        currentCol++;
    }

    // ── serialization ─────────────────────────────────────────────────────────

    /**
     * Minimal grow-only byte buffer. Writing directly to a byte[] avoids all the
     * method-dispatch overhead of DataOutputStream → FilterOutputStream → ByteArrayOutputStream.
     */
    private static final class Buf {
        byte[] b;
        int pos;

        Buf(int cap) { b = new byte[cap]; }

        void ensureCap(int extra) {
            int need = pos + extra;
            if (need > b.length) {
                int newLen = Math.max(b.length * 2, need);
                b = java.util.Arrays.copyOf(b, newLen);
            }
        }

        void writeByte(int v)  { ensureCap(1); b[pos++] = (byte) v; }
        void writeShort(int v) { ensureCap(2); b[pos] = (byte)(v >> 8); b[pos+1] = (byte)v; pos += 2; }
        void writeInt(int v)   { ensureCap(4); b[pos]=(byte)(v>>24); b[pos+1]=(byte)(v>>16); b[pos+2]=(byte)(v>>8); b[pos+3]=(byte)v; pos += 4; }
        void writeLong(long v) { ensureCap(8); writeInt((int)(v>>32)); writeInt((int)v); }
        void writeFloat(float v)   { writeInt(Float.floatToRawIntBits(v)); }
        void writeDouble(double v) { writeLong(Double.doubleToRawLongBits(v)); }
        void writeBytes(byte[] src, int off, int len) { ensureCap(len); System.arraycopy(src, off, b, pos, len); pos += len; }
    }

    @Override
    public void close() throws SQLException {
        if (numRows > 0) {
            if (!schemaFrozen) {
                // All-null table or single-typed row never triggered freeze — fix types now
                for (int c = 0; c < numCols; c++) {
                    if (colTypes[c] == TYPE_UNKNOWN) colTypes[c] = TYPE_STRING;
                }
            }
            flushChunk();
        }
    }

    private static long totalSerializeNs = 0;
    private static long totalTransferNs = 0;
    private static long totalJsCallNs = 0;
    private static int flushCount = 0;

    @SuppressWarnings("unchecked")
    private void flushChunk() throws SQLException {
        int n = numRows;
        int estimatedBytes = 8 + numCols + n * numCols * 4;
        Buf buf = new Buf(estimatedBytes);

        buf.writeInt(numCols);
        buf.writeInt(n);
        for (int i = 0; i < numCols; i++) buf.writeByte(colTypes[i]);

        // Embed column names so the JS side can skip the PRAGMA table_info round-trip.
        // Format: for each column — int16 byte-length, then UTF-8 bytes. -1 if no names.
        if (columnNames != null && columnNames.length == numCols) {
            for (int i = 0; i < numCols; i++) {
                byte[] nameBytes = columnNames[i].getBytes(java.nio.charset.StandardCharsets.UTF_8);
                buf.writeShort(nameBytes.length);
                buf.writeBytes(nameBytes, 0, nameBytes.length);
            }
        } else {
            // sentinel: write int16 = -1 to signal names absent
            buf.writeShort(-1);
        }

        long t0 = System.nanoTime();
        for (int c = 0; c < numCols; c++) {
            writeColumn(buf, c, n);
        }
        long t1 = System.nanoTime();

        String b64 = encodeBase64(buf.b, buf.pos);
        long t2 = System.nanoTime();

        loadColumnarData(conn, db, tableName, b64);
        long t3 = System.nanoTime();

        totalSerializeNs += t1 - t0;
        totalTransferNs  += t2 - t1;
        totalJsCallNs    += t3 - t2;
        flushCount++;

        // Store timing in a JS-readable global so it survives the opaque console bridge.
        String line = "flush#" + flushCount + " rows=" + n + " cols=" + numCols
                + " bytes=" + buf.pos
                + " ser=" + (t1-t0)/1_000_000 + "ms"
                + " b64=" + (t2-t1)/1_000_000 + "ms"
                + " jsCall=" + (t3-t2)/1_000_000 + "ms"
                + " | cumSer=" + totalSerializeNs/1_000_000 + "ms"
                + " cumB64=" + totalTransferNs/1_000_000 + "ms"
                + " cumJsCall=" + totalJsCallNs/1_000_000 + "ms";
        appendFlushLog(line);

        resetChunk();
    }

    @JS.Coerce
    @JS("if (!globalThis._jfrFlushLog) globalThis._jfrFlushLog = []; globalThis._jfrFlushLog.push(line);")
    private static native void appendFlushLog(String line);

    @SuppressWarnings("unchecked")
    private void resetChunk() {
        numRows = 0;
        if (nullBitmaps == null) return;
        int bitmapBytes = (CHUNK_SIZE + 7) / 8;
        for (int c = 0; c < numCols; c++) {
            if (nullBitmaps[c] != null) {
                java.util.Arrays.fill(nullBitmaps[c], 0, Math.min(bitmapBytes, nullBitmaps[c].length), (byte) 0);
            }
            if (objData != null && objData[c] != null) {
                ((List<?>) objData[c]).clear();
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void writeColumn(Buf buf, int c, int n) {
        int type = colTypes[c];

        // Validity bitmap
        int bitmapBytes = (n + 7) / 8;
        buf.writeBytes(nullBitmaps[c], 0, bitmapBytes);

        switch (type) {
            case TYPE_BOOL, TYPE_BYTE -> {
                byte[] d = (type == TYPE_BOOL) ? boolData[c] : byteData[c];
                buf.writeBytes(d, 0, n);
            }
            case TYPE_SHORT -> {
                short[] d = shortData[c];
                buf.ensureCap(n * 2);
                for (int i = 0; i < n; i++) buf.writeShort(d[i]);
            }
            case TYPE_INT -> {
                int[] d = intData[c];
                buf.ensureCap(n * 4);
                for (int i = 0; i < n; i++) buf.writeInt(d[i]);
            }
            case TYPE_LONG, TYPE_INSTANT -> {
                long[] d = longData[c];
                buf.ensureCap(n * 8);
                for (int i = 0; i < n; i++) buf.writeLong(d[i]);
            }
            case TYPE_FLOAT -> {
                float[] d = floatData[c];
                buf.ensureCap(n * 4);
                for (int i = 0; i < n; i++) buf.writeFloat(d[i]);
            }
            case TYPE_DOUBLE -> {
                double[] d = doubleData[c];
                buf.ensureCap(n * 8);
                for (int i = 0; i < n; i++) buf.writeDouble(d[i]);
            }
            case TYPE_STRING -> {
                List<String> d = (List<String>) objData[c];
                for (int i = 0; i < n; i++) {
                    String s = d.get(i);
                    if (s == null) {
                        buf.writeInt(-1);
                    } else {
                        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
                        buf.writeInt(bytes.length);
                        buf.writeBytes(bytes, 0, bytes.length);
                    }
                }
            }
            case TYPE_INT_ARRAY -> {
                List<int[]> d = (List<int[]>) objData[c];
                for (int i = 0; i < n; i++) {
                    int[] arr = d.get(i);
                    if (arr == null) {
                        buf.writeInt(-1);
                    } else {
                        buf.writeInt(arr.length);
                        buf.ensureCap(arr.length * 4);
                        for (int x : arr) buf.writeInt(x);
                    }
                }
            }
        }
    }

    private static String encodeBase64(byte[] data, int len) {
        return encodeBase64(data, 0, len);
    }

    private static String encodeBase64(byte[] data, int off, int len) {
        int outLen = ((len + 2) / 3) * 4;
        char[] out = new char[outLen];
        int oi = 0;
        int end = off + len;
        for (int i = off; i < end; ) {
            int b0 = data[i++] & 0xFF;
            int b1 = i < end ? data[i++] & 0xFF : 0;
            int b2 = i < end ? data[i++] & 0xFF : 0;
            out[oi++] = B64[b0 >> 2];
            out[oi++] = B64[((b0 & 3) << 4) | (b1 >> 4)];
            out[oi++] = B64[((b1 & 0xF) << 2) | (b2 >> 6)];
            out[oi++] = B64[b2 & 0x3F];
        }
        int pad = (3 - (len % 3)) % 3;
        for (int i = 0; i < pad; i++) out[outLen - 1 - i] = '=';
        return new String(out);
    }

    @JS.Coerce
    @JS("""
        if (!globalThis._jfrCsvPending) globalThis._jfrCsvPending = 0;
        globalThis._jfrCsvPending++;

        (async () => {
            try {
                const { tableFromArrays, makeVector, vectorFromArray,
                        Bool, Int8, Int16, Int32, Int64, Float32, Float64, Utf8,
                        List, Field, TimestampMicrosecond } = globalThis.__arrow;
                if (!tableFromArrays) throw new Error('globalThis.__arrow not set');

                // Decode base64 to raw bytes
                const binaryStr = atob(b64);
                const byteLen = binaryStr.length;
                const raw = new Uint8Array(byteLen);
                for (let i = 0; i < byteLen; i++) raw[i] = binaryStr.charCodeAt(i);

                const dv = new DataView(raw.buffer);
                let off = 0;

                const TYPE_BOOL=0,TYPE_BYTE=1,TYPE_SHORT=2,TYPE_INT=3,TYPE_LONG=4,
                      TYPE_FLOAT=5,TYPE_DOUBLE=6,TYPE_STRING=7,TYPE_INSTANT=8,TYPE_INT_ARRAY=9;

                const numCols = dv.getInt32(off, false); off += 4;
                const numRows = dv.getInt32(off, false); off += 4;
                const colTypes = [];
                for (let c = 0; c < numCols; c++) { colTypes.push(dv.getInt8(off)); off++; }

                // Read embedded column names (avoids PRAGMA table_info round-trip).
                // Sentinel: if first int16 == -1, names are absent (fall back to PRAGMA).
                const td2 = new TextDecoder();
                let colNames = null;
                const firstNameLen = dv.getInt16(off, false);
                if (firstNameLen >= 0) {
                    colNames = [];
                    let tmpOff = off;
                    for (let c = 0; c < numCols; c++) {
                        const len = dv.getInt16(tmpOff, false); tmpOff += 2;
                        colNames.push(td2.decode(raw.subarray(tmpOff, tmpOff + len))); tmpOff += len;
                    }
                    off = tmpOff;
                } else {
                    off += 2; // skip sentinel
                }

                const arrowVectors = [];
                for (let c = 0; c < numCols; c++) {
                    const t = colTypes[c];
                    const bitmapBytes = (numRows + 7) >> 3;
                    const nullBitmap = raw.slice(off, off + bitmapBytes); off += bitmapBytes;
                    const isValid = (i) => !!(nullBitmap[i >> 3] & (1 << (i & 7)));

                    if (t === TYPE_BOOL) {
                        const arr = new Array(numRows);
                        for (let r = 0; r < numRows; r++) {
                            arr[r] = isValid(r) ? (dv.getUint8(off) !== 0) : null; off++;
                        }
                        arrowVectors.push(vectorFromArray(arr, new Bool()));
                    } else if (t === TYPE_BYTE) {
                        const data = raw.slice(off, off + numRows).buffer; off += numRows;
                        arrowVectors.push(makeVector({ data: new Int8Array(data), nullBitmap, type: new Int8() }));
                    } else if (t === TYPE_SHORT) {
                        const data = new Int16Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getInt16(off, false); off += 2; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new Int16() }));
                    } else if (t === TYPE_INT) {
                        const data = new Int32Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getInt32(off, false); off += 4; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new Int32() }));
                    } else if (t === TYPE_LONG) {
                        const data = new BigInt64Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getBigInt64(off, false); off += 8; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new Int64() }));
                    } else if (t === TYPE_INSTANT) {
                        const data = new BigInt64Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getBigInt64(off, false); off += 8; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new TimestampMicrosecond() }));
                    } else if (t === TYPE_FLOAT) {
                        const data = new Float32Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getFloat32(off, false); off += 4; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new Float32() }));
                    } else if (t === TYPE_DOUBLE) {
                        const data = new Float64Array(numRows);
                        for (let r = 0; r < numRows; r++) { data[r] = dv.getFloat64(off, false); off += 8; }
                        arrowVectors.push(makeVector({ data, nullBitmap, type: new Float64() }));
                    } else if (t === TYPE_STRING) {
                        const arr = new Array(numRows);
                        const td = new TextDecoder();
                        for (let r = 0; r < numRows; r++) {
                            const len = dv.getInt32(off, false); off += 4;
                            if (len < 0) arr[r] = null;
                            else { arr[r] = td.decode(raw.subarray(off, off + len)); off += len; }
                        }
                        arrowVectors.push(vectorFromArray(arr, new Utf8()));
                    } else if (t === TYPE_INT_ARRAY) {
                        const arr = new Array(numRows);
                        for (let r = 0; r < numRows; r++) {
                            const len = dv.getInt32(off, false); off += 4;
                            if (len < 0) { arr[r] = null; }
                            else {
                                const sub = [];
                                for (let i = 0; i < len; i++) { sub.push(dv.getInt32(off, false)); off += 4; }
                                arr[r] = sub;
                            }
                        }
                        arrowVectors.push(vectorFromArray(arr, new List(Field.new('item', new Int32()))));
                    } else {
                        arrowVectors.push(vectorFromArray(new Array(numRows).fill(null), new Utf8()));
                    }
                }

                // Use embedded names; fall back to PRAGMA only if names were absent.
                if (!colNames) {
                    const infoResult = await conn.query('PRAGMA table_info("' + tableName.replace(/"/g, '""') + '")');
                    colNames = infoResult.toArray().map(r => r.name);
                }

                const namedCols = {};
                for (let c = 0; c < numCols && c < colNames.length; c++) {
                    namedCols[colNames[c]] = arrowVectors[c];
                }
                const arrowTable = tableFromArrays(namedCols);
                await conn.insertArrowTable(arrowTable, { name: tableName, create: false });
            } catch(e) {
                console.error('[binary-insert] ' + tableName + ': ' + e);
            } finally {
                globalThis._jfrCsvPending--;
            }
        })();
        """)
    static native void loadColumnarData(JSObject conn, JSObject db, String tableName, String b64);
}
