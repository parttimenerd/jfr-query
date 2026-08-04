package me.bechberger.jfr.duckdb;

import static me.bechberger.jfr.duckdb.util.JFRUtil.*;
import static me.bechberger.jfr.duckdb.util.SQLUtil.append;

import io.jafar.parser.impl.LazyMapValueBuilder;
import io.jafar.parser.impl.LazyMapValueBuilder.ArrayPool;
import io.jafar.parser.internal_api.metadata.MetadataClass;
import io.jafar.parser.internal_api.metadata.MetadataField;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.file.Path;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import me.bechberger.cjfr.CJFREvent;
import me.bechberger.cjfr.CJFRFile;
import me.bechberger.cjfr.CJFRFieldType;
import me.bechberger.jfr.duckdb.definitions.MacroCollection;
import me.bechberger.jfr.duckdb.definitions.ViewCollection;
import me.bechberger.jfr.duckdb.util.DuckDBSink;
import me.bechberger.jfr.duckdb.util.JFRUtil;
import me.bechberger.jfr.duckdb.util.JafarValues;
import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import me.bechberger.jfr.duckdb.util.Appender;
import org.duckdb.DuckDBConnection;
import org.jetbrains.annotations.Nullable;

/**
 * Imports a JFR recording into a DuckDB database and creates the database tables.
 *
 * <p>Uses {@code io.btrace:jafar-parser} for JFR parsing — events surface as
 * {@code Map<String,Object>} field maps; struct values are wrapped in {@code ComplexType} (use
 * {@link JafarValues#getStruct(Map, String)} to unwrap), arrays in {@code ArrayType}.
 *
 * <p>Foreign keys are not declared at the schema level; they're documented in table comments.
 */
@SuppressWarnings("CodeBlock2Expr")
public class BasicParallelImporter {

    @SuppressWarnings("unchecked")
    static final Function<Object, Map<String, Object>> IDENTITY_FUNCTION = (o) -> (Map<String, Object>) o;

    @FunctionalInterface
    interface AppendFunction {
        /**
         * Appends the value of the field to the Appender.
         *
         * <p>The {@code object} parameter is typed as {@link Object} rather than {@code
         * Map<String,Object>} so that CJFR event objects (which are {@code CJFREvent} instances,
         * not Maps) can be passed through without a checked cast that fails under GraalVM WASM GC's
         * strict type checking. Callers in the JFR path pass a {@code Map<String,Object>}; callers
         * in the CJFR path pass a {@code CJFREvent}. Each lambda implementation casts {@code object}
         * to the concrete type it expects.
         */
        void appendTo(Object object, Appender appender) throws SQLException;
    }

    @FunctionalInterface
    interface AppendDefaultValueFunction {
        void appendDefault(Appender appender) throws SQLException;
    }

    /**
     * Faster variant of {@link AppendFunction} that receives the pre-extracted raw value directly
     * from the jafar ArrayPool arrays, bypassing {@code LazyEventMap.get()} entirely.
     * Only used for top-level scalar columns; struct/array columns fall back to AppendFunction.
     */
    @FunctionalInterface
    interface AppendDirectFunction {
        void appendDirect(Object rawValue, Appender appender) throws SQLException;
    }

    // ── jafar ArrayPool direct access ─────────────────────────────────────────
    // LazyMapValueBuilder.ARRAY_POOL is a public static ThreadLocal<ArrayPool>.
    // ArrayPool.keys, .values, .size are public fields on the public nested class.
    // We access them directly (no reflection) to iterate the current event's raw
    // key/value arrays in O(M) without allocating a HashMap — the only zero-allocation O(M) path.

    /** Cached reflection fields for ArrayPool — only used during initPoolReflect for validation. */
    private static volatile Field POOL_KEYS_FIELD;
    private static volatile Field POOL_VALUES_FIELD;
    private static volatile Field POOL_SIZE_FIELD;
    /** The jafar ARRAY_POOL ThreadLocal — accessed once and cached. */
    private static volatile ThreadLocal<ArrayPool> ARRAY_POOL_TL;
    private static volatile boolean POOL_REFLECT_INIT = false;

    @SuppressWarnings("unchecked")
    private static void initPoolReflect() {
        if (POOL_REFLECT_INIT) return;
        try {
            // ARRAY_POOL is a public static final field on LazyMapValueBuilder
            java.lang.reflect.Field tlField = LazyMapValueBuilder.class.getField("ARRAY_POOL");
            ARRAY_POOL_TL = (ThreadLocal<ArrayPool>) tlField.get(null);
            // Verify field accessibility on ArrayPool (public fields on a public class)
            ArrayPool probe = ARRAY_POOL_TL.get();
            if (probe != null) {
                // Touch the fields to confirm direct access works
                @SuppressWarnings("unused") String[] k = probe.keys;
                @SuppressWarnings("unused") Object[] v = probe.values;
                @SuppressWarnings("unused") int s = probe.size;
                POOL_KEYS_FIELD = ArrayPool.class.getField("keys"); // keep for canUseFastPath flag
            } else {
                POOL_KEYS_FIELD = ArrayPool.class.getField("keys");
            }
            POOL_VALUES_FIELD = ArrayPool.class.getField("values");
            POOL_SIZE_FIELD   = ArrayPool.class.getField("size");
        } catch (Exception e) {
            // Direct access unavailable — fast path disabled
            POOL_KEYS_FIELD = null;
        }
        POOL_REFLECT_INIT = true;
    }

    /** Represents a table in the database with its columns and an appender to insert data into it. */
    static class Table {
        final String name;
        final List<Column> columns;
        final Appender appender;
        private final AtomicInteger counter = new AtomicInteger(0);
        private @Nullable String description = null;

        // Caching by content: jafar's ComplexType wrappers use identity-based equals, so the same
        // logical struct (e.g. a Method) emitted in different chunks is never .equals() under
        // raw Map.equals. We deep-unwrap to canonical Map/List/primitive form before keying.
        private final HashMap<Object, Integer> objToIndex = new HashMap<>();
        // Identity-based shortcut: if jafar reuses object instances across the same chunk (or
        // across chunks for constant-pool entries), skip deepUnwrap entirely — O(1) no-alloc.
        private final java.util.IdentityHashMap<Object, Integer> identityCache = new java.util.IdentityHashMap<>();
        private final boolean cache;

        /**
         * For each column in order: the index into pool.keys[] where that column's field was found
         * during the first event of this type, or -1 if the column has no directFn or the field
         * wasn't in the pool. Populated lazily on the first call to insertIntoFast; re-used on all
         * subsequent events of the same type (pool key order is stable within a jafar parse run).
         * Null until the first event is processed.
         */
        private volatile @Nullable int[] poolPositions;

        /** Parallel to columns: the directFn for each column, or null if slow path. */
        private final @Nullable AppendDirectFunction[] directFunctions;
        /** True when pool reflection is available and we have at least one direct column. */
        private final boolean canUseFastPath;
        /** Number of columns with a directFn — used to decide if full fast path is possible. */
        private final int directColCount;

        Table(
                String name,
                List<Column> columns,
                DuckDBSink sink,
                boolean cache,
                @Nullable String description)
                throws SQLException {
            this.name = name;
            this.columns = columns;
            this.cache = cache;
            this.description = description;
            // Build direct-dispatch structures for the fast insertion path.
            initPoolReflect();
            if (POOL_KEYS_FIELD != null) {
                AppendDirectFunction[] fns = new AppendDirectFunction[columns.size()];
                int direct = 0;
                for (int i = 0; i < columns.size(); i++) {
                    Column col = columns.get(i);
                    if (col.directFn() != null) {
                        fns[i] = col.directFn();
                        direct++;
                    }
                }
                this.directFunctions = direct > 0 ? fns : null;
                this.directColCount  = direct;
                this.canUseFastPath  = direct > 0;
            } else {
                this.directFunctions = null;
                this.directColCount  = 0;
                this.canUseFastPath  = false;
            }
            this.poolPositions = null;
            createTable(sink);
            this.appender = sink.createAppender(name);
            // Let the appender know column names upfront so it can embed them in the
            // binary payload and skip the PRAGMA table_info round-trip on the JS side.
            String[] colNames;
            if (cache) {
                // caching tables prepend an implicit integer ID column named "_id"
                colNames = new String[columns.size() + 1];
                colNames[0] = "_id";
                for (int i = 0; i < columns.size(); i++) colNames[i + 1] = columns.get(i).name();
            } else {
                colNames = columns.stream().map(Column::name).toArray(String[]::new);
            }
            this.appender.setColumnNames(colNames);
            appendNullRowIfNeeded();
        }

        Table(String name, List<Column> columns, DuckDBSink sink, boolean cache)
                throws SQLException {
            this(name, columns, sink, cache, null);
        }

        record Column(
                String name,
                String type,
                AppendFunction append,
                @Nullable AppendDefaultValueFunction appendDefault,
                @Nullable String referencedTable,
                @Nullable String description,
                @Nullable AppendDirectFunction directFn,
                @Nullable String... dataTypes) {

            @Override
            public String toString() {
                return "\"" + name + "\" " + type;
            }

            public @Nullable String extraComment() {
                String prefix = "Column \"" + name + "\": ";
                List<String> parts = new ArrayList<>();
                if (referencedTable != null) {
                    if (type.contains("[")) {
                        parts.add("Array of references to \"" + referencedTable + "\"(_id)");
                    } else {
                        parts.add("references \"" + referencedTable + "\"(_id)");
                    }
                }
                if (dataTypes != null && dataTypes.length > 0) {
                    parts.add(String.join(", ", dataTypes));
                }
                if (description != null && !description.isBlank()) {
                    parts.add(
                            "DESCRIPTION("
                                    + description.replace("(", "\\(").replace(")", "\\)")
                                    + ")");
                }
                if (parts.isEmpty()) {
                    return null;
                }
                return prefix + String.join(" with ", parts);
            }

            public Column prependName(String prefix) {
                return new Column(
                        prefix + name, type, append, appendDefault, referencedTable, description, directFn, dataTypes);
            }

            public Column(
                    String name,
                    String type,
                    AppendFunction append,
                    @Nullable AppendDefaultValueFunction appendDefault) {
                this(name, type, append, appendDefault, null, null, null);
            }

            public Column(
                    String name,
                    String type,
                    AppendFunction append,
                    @Nullable AppendDefaultValueFunction appendDefault,
                    @Nullable String referencedTable) {
                this(name, type, append, appendDefault, referencedTable, null, null);
            }

            public Column withDataTypes(String... dataTypes) {
                if (dataTypes == null || dataTypes.length == 0) {
                    return this;
                }
                return new Column(name, type, append, appendDefault, referencedTable, description, directFn, dataTypes);
            }

            public Column withDescription(String label, String description) {
                String combinedDescription = combineDescription(name, label, description);
                if (combinedDescription == null) {
                    return this;
                }
                return new Column(
                        name, type, append, appendDefault, referencedTable, combinedDescription, directFn, dataTypes);
            }

            public Column withDirect(AppendDirectFunction fn) {
                return new Column(name, type, append, appendDefault, referencedTable, description, fn, dataTypes);
            }
        }

        @Override
        public String toString() {
            String idPrefix = doesUseCaching() ? "_id UINTEGER PRIMARY KEY, " : "";
            return "CREATE TABLE IF NOT EXISTS \""
                    + name
                    + "\" ("
                    + idPrefix
                    + String.join(", ", columns.stream().map(Column::toString).toList())
                    + ");";
        }

        private void createTable(DuckDBSink sink) {
            try {
                sink.execute(this.toString());
                String comment = getComment();
                if (!comment.isBlank()) {
                    // enquote via Statement is JDBC-only; emulate it ourselves.
                    sink.execute(
                            "COMMENT ON TABLE \""
                                    + name
                                    + "\" IS '"
                                    + comment.replace("'", "''")
                                    + "';");
                }
            } catch (Exception e) {
                throw new RuntimeSQLException("Failed to create table " + name, e);
            }
        }

        String getComment() {
            List<String> comments = new ArrayList<>();
            if (description != null && description.contains(" ")) {
                comments.add(
                        "DESCRIPTION("
                                + description.replace("(", "\\(").replace(")", "\\)")
                                + ")");
            }
            columns.stream()
                    .map(Column::extraComment)
                    .filter(Objects::nonNull)
                    .forEach(comments::add);
            return String.join("; ", comments);
        }

        private void appendNullRowIfNeeded() {
            if (doesUseCaching()) {
                try {
                    appender.beginRow();
                    appender.append(0);
                    for (Column column : columns) {
                        if (column.appendDefault == null) {
                            throw new IllegalStateException(
                                    "Column "
                                            + column.name
                                            + " in table "
                                            + name
                                            + " does not have a default value function");
                        }
                        try {
                            column.appendDefault.appendDefault(appender);
                        } catch (SQLException e) {
                            throw new RuntimeSQLException(
                                    "Failed to append default value for column " + column.name, e);
                        }
                    }
                    appender.endRow();
                } catch (SQLException | RuntimeException e) {
                    throw new RuntimeSQLException(
                            "Failed to append null row to table " + name + " with schema " + this,
                            e);
                }
            }
        }

        /**
         * Inserts the given object into the table, using caching if enabled.
         *
         * @return index of the inserted object (or the cached index if already present)
         */
        public int insertInto(Map<String, Object> object) {
            if (cache) {
                // Fast path: identity-based check (no deepUnwrap allocation).
                // Works when jafar reuses the same ComplexType/Map instance for the same
                // logical entry within a chunk (common for constant-pool structs like Method).
                Integer cached = identityCache.get(object);
                if (cached != null) return cached;

                Object key = JafarValues.deepUnwrap(object);
                return objToIndex.computeIfAbsent(
                        key,
                        (obj) -> {
                            int id = counter.incrementAndGet();
                            try {
                                insertIntoWithoutCaching(object);
                            } catch (SQLException e) {
                                throw new RuntimeSQLException(
                                        "Failed to insert into table " + name + " at row " + id,
                                        e);
                            }
                            identityCache.put(object, id);
                            return id;
                        });
            }
            try {
                insertIntoWithoutCaching(object);
            } catch (SQLException e) {
                throw new RuntimeSQLException(
                        "Failed to insert into table " + name + " at row " + counter.get(), e);
            }
            return counter.get();
        }

        public boolean doesUseCaching() {
            return cache;
        }

        public Table assumeCaching() {
            if (!doesUseCaching()) {
                throw new IllegalStateException("Table " + name + " does not use caching");
            }
            return this;
        }

        private void insertIntoWithoutCaching(Map<String, Object> object) throws SQLException {
            if (canUseFastPath) {
                insertIntoFast(object);
                return;
            }
            insertIntoSlow(object);
        }

        /**
         * Fast path: iterate columns in order. For each column with a directFn, look up its raw
         * value from the pool by cached position (or linear scan on first event). No per-event
         * allocation — poolPositions is built once per event type.
         *
         * <p>Column order is preserved (required by BinaryAppender's currentCol counter).
         */
        private void insertIntoFast(Map<String, Object> object) throws SQLException {
            // Build poolPositions lazily on first call for this event type.
            // poolPositions[i] = index into pool.keys[] where column i's field name was found,
            // or -1 if the column has no directFn or the field was not present in the pool.
            int[] pos = poolPositions;
            ArrayPool pool = ARRAY_POOL_TL != null ? ARRAY_POOL_TL.get() : null;
            if (pos == null) {
                int nCols = columns.size();
                pos = new int[nCols];
                if (pool != null) {
                    String[] keys = pool.keys;
                    int size      = pool.size;
                    for (int i = 0; i < nCols; i++) {
                        if (directFunctions[i] == null) { pos[i] = -1; continue; }
                        String colName = columns.get(i).name();
                        pos[i] = -1;
                        for (int j = 0; j < size; j++) {
                            if (colName.equals(keys[j])) { pos[i] = j; break; }
                        }
                    }
                } else {
                    Arrays.fill(pos, -1);
                }
                poolPositions = pos;
            }

            appender.beginRow();
            if (doesUseCaching()) {
                appender.append(counter.get());
            }

            int nCols = columns.size();
            Object[] poolValues = (pool != null) ? pool.values : null;

            for (int i = 0; i < nCols; i++) {
                int pIdx = pos[i];
                if (pIdx >= 0 && poolValues != null) {
                    // Hot path: read value directly from pool array — no map lookup, no boxing.
                    try {
                        directFunctions[i].appendDirect(poolValues[pIdx], appender);
                    } catch (SQLException e) {
                        throw new RuntimeSQLException(
                                "Failed to append column " + columns.get(i).name()
                                        + " for table " + name + " at row " + counter.get(), e);
                    }
                } else {
                    // Slow path: struct / array / missing field — use the regular AppendFunction.
                    try {
                        columns.get(i).append.appendTo(object, appender);
                    } catch (SQLException e) {
                        throw new RuntimeSQLException(
                                "Failed to append column " + columns.get(i).name()
                                        + " for table " + name + " at row " + counter.get(), e);
                    }
                }
            }

            try {
                appender.endRow();
            } catch (SQLException e) {
                throw new RuntimeSQLException(
                        "Failed to end row for table " + name + " at row " + counter.get()
                                + " with schema " + this, e);
            }
        }

        private void insertIntoSlow(Map<String, Object> object) throws SQLException {
            appender.beginRow();
            if (doesUseCaching()) {
                try {
                    appender.append(counter.get());
                } catch (SQLException e) {
                    throw new RuntimeSQLException(
                            "Failed to append ID for table " + name + " at row " + counter.get(),
                            e);
                }
            }
            for (Column column : columns) {
                try {
                    column.append.appendTo(object, appender);
                } catch (SQLException e) {
                    throw new RuntimeSQLException(
                            "Failed to append column "
                                    + column.name
                                    + " for table "
                                    + name
                                    + " at row "
                                    + counter.get(),
                            e);
                }
            }
            try {
                appender.endRow();
            } catch (SQLException e) {
                throw new RuntimeSQLException(
                        "Failed to end row for table "
                                + name
                                + " at row "
                                + counter.get()
                                + " with schema "
                                + this,
                        e);
            }
        }
        public void close() {
            try {
                appender.close();
            } catch (SQLException e) {
                throw new RuntimeSQLException("Failed to close appender for table " + name, e);
            }
        }
    }

    private static class RecordingInfo {
        private int eventCount;
        private Instant firstEvent;
        private Instant lastEvent;
        private String dumpReason;
        private Instant dumpTime;
        private long eventDurationNs;

        void processEvent(MetadataClass type, Map<String, Object> event) {
            eventCount++;
            Long startNanos = JafarValues.getLong(event, "startTime");
            if (startNanos != null) {
                Instant startTime = Instant.ofEpochSecond(0, startNanos);
                if (firstEvent == null || startTime.isBefore(firstEvent)) {
                    firstEvent = startTime;
                }
                if (lastEvent == null || startTime.isAfter(lastEvent)) {
                    lastEvent = startTime;
                }
                if ("jdk.Shutdown".equals(type.getName())
                        && (dumpTime == null || startTime.isAfter(dumpTime))) {
                    dumpReason = JafarValues.getString(event, "reason");
                    dumpTime = startTime;
                }
            }
            Long durationNanos = JafarValues.getLong(event, "duration");
            if (durationNanos != null) {
                eventDurationNs += durationNanos;
            }
        }

        void store(DuckDBSink sink) throws SQLException {
            Table table =
                    new Table(
                            "RecordingInfo",
                            List.of(
                                    new Table.Column("eventCount", "INTEGER", null, null),
                                    new Table.Column("firstEvent", "TIMESTAMP", null, null),
                                    new Table.Column("lastEvent", "TIMESTAMP", null, null),
                                    new Table.Column("eventDurationSeconds", "DOUBLE", null, null),
                                    new Table.Column("dumpReason", "VARCHAR", null, null)),
                            sink,
                            false);
            table.appender.beginRow();
            table.appender.append(eventCount);
            append(table.appender, firstEvent);
            append(table.appender, lastEvent);
            table.appender.append(eventDurationNs / 1_000_000_000.0);
            table.appender.append(dumpReason);
            table.appender.endRow();
            table.close();
        }
    }

    private final SinkSupplier sinkSupplier;
    private final Options options;
    /** Keyed by event-type name (jafar's MetadataClass equality is identity-ish; name is stable). */
    private final Map<String, Table> eventTypeToTable = new HashMap<>();
    /** Latest MetadataClass seen per event-type name — for label/category lookups. */
    private final Map<String, MetadataClass> eventTypeMeta = new HashMap<>();
    private final Map<String, Table> structTypeToTable = new HashMap<>();
    private final Map<String, Integer> eventCount = new HashMap<>();
    private final RecordingInfo recordingInfo = new RecordingInfo();

    @FunctionalInterface
    public interface SinkSupplier {
        DuckDBSink get() throws SQLException;
    }

    public BasicParallelImporter(SinkSupplier sinkSupplier, Options options) {
        this.sinkSupplier = sinkSupplier;
        this.options = options;
    }

    public final void importRecording(Path path) throws IOException {
        Object lock = new Object();
        // [0]=parseStart [1]=parseEnd [2]=insertTotal [3]=eventCount [4]=fastCount [5]=slowCount
        // [6]=tableCreateTotal [7]=recordingInfoTotal [8]=eventCountMergeTotal [9]=flushTotal
        long[] times = new long[10];
        times[0] = System.nanoTime();
        JFRUtil.runUntyped(
                path,
                (type, event) -> {
                    synchronized (lock) {
                        long t0 = System.nanoTime();
                        Table table = getTableForEventType(type);
                        long t1 = System.nanoTime();
                        if (table.canUseFastPath) times[4]++; else times[5]++;
                        table.insertInto(event);
                        long t2 = System.nanoTime();
                        eventCount.merge(type.getName(), 1, Integer::sum);
                        long t3 = System.nanoTime();
                        recordingInfo.processEvent(type, event);
                        long t4 = System.nanoTime();
                        times[2] += t4 - t0;
                        times[3]++;
                        times[6] += t1 - t0;
                        times[7] += t4 - t3;
                        times[8] += t3 - t2;
                    }
                });
        times[1] = System.nanoTime();
        System.out.printf("[jfr-timing] parse+insert wall: %dms | insert-only: %dms | events: %d | fast: %d | slow: %d%n" +
                          "[jfr-timing] tableCreate: %dms | insertInto: %dms | eventCountMerge: %dms | recordingInfo: %dms%n",
                (times[1] - times[0]) / 1_000_000,
                times[2] / 1_000_000,
                times[3], times[4], times[5],
                times[6] / 1_000_000,
                (times[2] - times[6] - times[7] - times[8]) / 1_000_000,
                times[8] / 1_000_000,
                times[7] / 1_000_000);
        finalizeImport();
    }

    /**
     * Imports a CJFR (condensed JFR) recording from an {@link InputStream} using the
     * {@code condensed-data-reader} library.
     *
     * <p>Reads events via {@link CJFRFile} without reconstitution (no JMC dependency). Field
     * metadata is recovered from {@link CJFRFieldType#typeName()} and the encoded description
     * string (which embeds annotation type names including Timestamp/Timespan).
     *
     * <p>Value conversion mirrors the jafar path:
     * <ul>
     *   <li>{@code long} with {@code @Timestamp} → {@link java.sql.Timestamp} (TIMESTAMP column)
     *   <li>{@code long} with {@code @Timespan} → {@code double} seconds (DOUBLE column)
     *   <li>{@link Instant} fields → TIMESTAMP via epoch-nanos
     *   <li>{@link Duration} fields → DOUBLE seconds
     *   <li>Nested structs → flattened as "{@code fieldName$innerField}" columns (one level deep)
     *   <li>Arrays and deep structs → skipped (VARCHAR null column as placeholder)
     * </ul>
     */
    public final void importCjfrRecording(InputStream input) throws IOException {
        // Map from event-type name → Table (created lazily on first event of that type)
        Map<String, Table> cjfrTables = new HashMap<>();
        // Separate RecordingInfo accumulator that works with CJFREvent
        CjfrRecordingInfo cjfrInfo = new CjfrRecordingInfo();

        try (CJFRFile file = CJFRFile.open(input, me.bechberger.cjfr.Options.defaults())) {
            CJFREvent event;
            while ((event = file.readEvent()) != null) {
                final CJFREvent ev = event;
                String typeName = ev.getEventType().getName();
                Table table = cjfrTables.computeIfAbsent(typeName,
                        k -> createCjfrTable(ev.getEventType()));
                if (table == null) continue;
                insertCjfrEvent(table, ev);
                eventCount.merge(typeName, 1, Integer::sum);
                cjfrInfo.processEvent(ev);
            }
        }

        // Flush all CJFR tables and then run the shared finalizer (writeEventCounts, sortByTime…)
        for (Table t : cjfrTables.values()) {
            t.close();
        }
        // Put them in eventTypeToTable AFTER closing so writeEventCounts/sortEventTables can see
        // them, but finalizeImport's close loop won't double-close (we set appenders as already
        // closed by overwriting eventTypeToTable with already-closed Table objects — they are
        // already closed above, so finalizeImport's close loop is a no-op for them).
        eventTypeToTable.putAll(cjfrTables);

        writeEventCounts();
        // writeEventLabels is skipped for CJFR: eventTypeMeta is empty (no jafar MetadataClass).
        sortEventTablesByStartTime();
        try {
            cjfrInfo.store(sinkSupplier.get());
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to store CJFR recording info", e);
        }
        try {
            addMacrosAndViews(sinkSupplier.get());
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to get a connection for macros/views for CJFR", e);
        }
    }

    /** Lightweight recording-info accumulator for the CJFR import path. */
    private static class CjfrRecordingInfo {
        int eventCount;
        Instant firstEvent;
        Instant lastEvent;
        String dumpReason;
        Instant dumpTime;
        long eventDurationNs;

        void processEvent(CJFREvent ev) {
            eventCount++;
            Instant startTime = ev.getStartTime();
            if (startTime != null) {
                if (firstEvent == null || startTime.isBefore(firstEvent)) firstEvent = startTime;
                if (lastEvent  == null || startTime.isAfter(lastEvent))  lastEvent  = startTime;
                if ("jdk.Shutdown".equals(ev.getEventType().getName())
                        && (dumpTime == null || startTime.isAfter(dumpTime))) {
                    Object reason = ev.getValue("reason");
                    dumpReason = reason != null ? reason.toString() : null;
                    dumpTime = startTime;
                }
            }
            Duration dur = ev.getDuration();
            if (dur != null) {
                double ns = durationToSeconds(dur) * 1_000_000_000.0;
                if (Double.isFinite(ns) && ns >= 0 && ns < 1e18) {
                    try {
                        eventDurationNs = Math.addExact(eventDurationNs, (long) ns);
                    } catch (ArithmeticException ignored) {
                        // saturate on overflow
                        eventDurationNs = Long.MAX_VALUE;
                    }
                }
            }
        }

        void store(DuckDBSink sink) throws SQLException {
            Table t = new Table("RecordingInfo",
                    List.of(new Table.Column("eventCount",           "INTEGER",   null, null),
                            new Table.Column("firstEvent",            "TIMESTAMP", null, null),
                            new Table.Column("lastEvent",             "TIMESTAMP", null, null),
                            new Table.Column("eventDurationSeconds",  "DOUBLE",    null, null),
                            new Table.Column("dumpReason",            "VARCHAR",   null, null)),
                    sink, false);
            t.appender.beginRow();
            t.appender.append(eventCount);
            append(t.appender, firstEvent);
            append(t.appender, lastEvent);
            t.appender.append(eventDurationNs / 1_000_000_000.0);
            t.appender.append(dumpReason);
            t.appender.endRow();
            t.close();
        }
    }

    /**
     * Creates a DuckDB {@link Table} for a CJFR event type by decoding field metadata from the
     * encoded description strings.
     */
    private @Nullable Table createCjfrTable(me.bechberger.cjfr.CJFREventType eventType) {
        List<Table.Column> columns = new ArrayList<>();
        for (CJFRFieldType field : eventType.getFields()) {
            List<Table.Column> cols = createCjfrColumns(field);
            if (cols != null) columns.addAll(cols);
        }
        if (columns.isEmpty()) return null;
        String tableName = normalizeTableName(eventType.getName());
        try {
            return new Table(tableName, columns, sinkSupplier.get(), false);
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to create CJFR table " + tableName, e);
        }
    }

    /**
     * Extracts the underlying Java primitive type from the CJFR field description JSON.
     * The description is a JSON array: [underlyingType, contentAnnotation, annotations, ...].
     * Returns null if the description is missing or not parseable.
     */
    private static @Nullable String cjfrUnderlyingType(@Nullable String desc) {
        if (desc == null || !desc.startsWith("[\"")) return null;
        // Fast path: grab the first JSON string value — it is the underlying Java type name.
        int start = 1; // skip leading '['
        if (desc.charAt(start) != '"') return null;
        int end = desc.indexOf('"', start + 1);
        if (end < 0) return null;
        return desc.substring(start + 1, end);
    }

    /** Creates DuckDB columns for a single CJFR field using its type name and description. */
    private @Nullable List<Table.Column> createCjfrColumns(CJFRFieldType field) {
        String fieldName = field.name();
        String typeName = field.typeName();
        String desc = field.description(); // compact JSON, may contain annotation type names
        boolean isTimestamp = desc != null && desc.contains("jdk.jfr.Timestamp");
        boolean isTimespan  = desc != null && desc.contains("jdk.jfr.Timespan");
        String label = field.getLabel();

        // For CJFR "compound" type names (e.g. "memory varint BYTES", "percentage",
        // "jdk.jfr.Frequency") the description JSON encodes the real underlying primitive.
        // For reference types (java.lang.Thread, java.lang.Class, jdk.types.*) the value
        // stored by CJFR is the integer constant-pool ID — equivalent to JFR's UINTEGER.
        String underlying = cjfrUnderlyingType(desc);

        Table.Column col;
        switch (typeName) {
            // ── Primitive scalar types ──────────────────────────────────────────────
            case "java.lang.String" -> col = new Table.Column(fieldName, "VARCHAR",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getString(fieldName)),
                    Appender::appendNull);
            case "long" -> {
                if (isTimestamp) {
                    col = new Table.Column(fieldName, "TIMESTAMP",
                            (obj, app) -> {
                                Instant ins = ((CJFREvent) (Object) obj).getInstant(fieldName);
                                append(app, ins != null ? ins : Instant.EPOCH);
                            }, (app) -> append(app, Instant.EPOCH));
                } else if (isTimespan) {
                    col = new Table.Column(fieldName, "DOUBLE",
                            (obj, app) -> {
                                Duration d = ((CJFREvent) (Object) obj).getDuration(fieldName);
                                if (d == null) { app.append(0.0); return; }
                                double secs = durationToSeconds(d);
                                app.append(secs > 24L * 365 * 10 * 3600 ? Double.POSITIVE_INFINITY : secs);
                            }, (app) -> app.append(0.0));
                } else {
                    col = new Table.Column(fieldName, "BIGINT",
                            (obj, app) -> app.append(((CJFREvent) (Object) obj).getLong(fieldName)),
                            (app) -> app.append(0L));
                }
            }
            case "int", "jdk.jfr.Unsigned" -> col = new Table.Column(fieldName, "INTEGER",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getInt(fieldName)),
                    (app) -> app.append(0));
            case "short" -> col = new Table.Column(fieldName, "SMALLINT",
                    (obj, app) -> app.append((short) ((CJFREvent) (Object) obj).getInt(fieldName)),
                    (app) -> app.append((short) 0));
            case "byte" -> col = new Table.Column(fieldName, "TINYINT",
                    (obj, app) -> app.append((byte) ((CJFREvent) (Object) obj).getInt(fieldName)),
                    (app) -> app.append((byte) 0));
            case "boolean" -> col = new Table.Column(fieldName, "BOOLEAN",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getBoolean(fieldName)),
                    (app) -> app.append(false));
            case "double", "float" -> col = new Table.Column(fieldName, "DOUBLE",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getDouble(fieldName)),
                    (app) -> app.append(0.0));

            // ── CJFR compound numeric types ────────────────────────────────────────
            // "memory varint BYTES" → unsigned long (byte amounts)
            // "uint1" → unsigned byte
            // "jdk.jfr.Frequency" → long (Hz counts)
            // "jdk.jfr.DataAmount" → double (rates) or long (sizes)
            // "percentage" → float
            // "event type name" → long (constant-pool ID)
            case "memory varint BYTES", "jdk.jfr.Frequency", "event type name" ->
                col = new Table.Column(fieldName, "BIGINT",
                    (obj, app) -> app.append(cjfrSafeLong((CJFREvent) (Object) obj, fieldName)),
                    (app) -> app.append(0L));
            case "uint1" -> col = new Table.Column(fieldName, "TINYINT",
                    (obj, app) -> app.append((byte) cjfrSafeInt((CJFREvent) (Object) obj, fieldName)),
                    (app) -> app.append((byte) 0));
            case "percentage" -> col = new Table.Column(fieldName, "FLOAT",
                    (obj, app) -> app.append((float) cjfrSafeDouble((CJFREvent) (Object) obj, fieldName)),
                    (app) -> app.append(0.0f));
            case "jdk.jfr.DataAmount" -> {
                // DataAmount can be a double (rate in bytes/second) or long (byte size).
                // Use the underlying primitive from the description to decide.
                if ("double".equals(underlying)) {
                    col = new Table.Column(fieldName, "DOUBLE",
                            (obj, app) -> app.append(cjfrSafeDouble((CJFREvent) (Object) obj, fieldName)),
                            (app) -> app.append(0.0));
                } else {
                    col = new Table.Column(fieldName, "BIGINT",
                            (obj, app) -> app.append(cjfrSafeLong((CJFREvent) (Object) obj, fieldName)),
                            (app) -> app.append(0L));
                }
            }

            // ── JFR reference/pointer types ────────────────────────────────────────
            // In JFR these are constant-pool IDs (UINTEGER). In CJFR they are stored as
            // full structs. We keep them as VARCHAR (stringified struct) since we cannot
            // store a struct as an integer — exact type match with JFR is not possible here.
            case "java.lang.Thread", "java.lang.Class",
                 "jdk.types.Method", "jdk.types.ClassLoader", "jdk.types.Package",
                 "jdk.types.Module", "jdk.types.OldObject", "jdk.types.OldObjectGcRoot" -> {
                col = new Table.Column(fieldName, "VARCHAR",
                    (obj, app) -> {
                        CJFREvent nested = ((CJFREvent) (Object) obj).getStruct(fieldName);
                        if (nested == null) { app.appendNull(); return; }
                        List<String> names = nested.getFieldNames();
                        // Try to extract a meaningful single-value representation
                        if (names.size() == 1) {
                            app.append(nested.getString(names.get(0)));
                        } else if (names.contains("javaName")) {
                            app.append(nested.getString("javaName"));
                        } else if (names.contains("name")) {
                            app.append(nested.getString("name"));
                        } else {
                            app.append(nested.toString());
                        }
                    }, Appender::appendNull);
            }

            default -> {
                // If typeName starts with "array<" it is a combined/aggregated CJFR field.
                // Peek at the underlying primitive from the description to decide storage type.
                if (typeName.startsWith("array<")) {
                    col = buildCjfrArrayColumn(fieldName, underlying);
                } else if (isTimestamp) {
                    col = new Table.Column(fieldName, "TIMESTAMP",
                            (obj, app) -> {
                                Instant ins = ((CJFREvent) (Object) obj).getInstant(fieldName);
                                append(app, ins != null ? ins : Instant.EPOCH);
                            }, (app) -> append(app, Instant.EPOCH));
                } else if (isTimespan) {
                    col = new Table.Column(fieldName, "DOUBLE",
                            (obj, app) -> {
                                Duration d = ((CJFREvent) (Object) obj).getDuration(fieldName);
                                if (d == null) { app.append(0.0); return; }
                                double secs = durationToSeconds(d);
                                app.append(secs > 24L * 365 * 10 * 3600 ? Double.POSITIVE_INFINITY : secs);
                            }, (app) -> app.append(0.0));
                } else {
                    // Struct: flatten single-field structs (GCCause, GCName) to VARCHAR
                    col = new Table.Column(fieldName, "VARCHAR",
                            (obj, app) -> {
                                Object raw = ((CJFREvent) (Object) obj).getValue(fieldName);
                                if (raw == null) { app.appendNull(); return; }
                                if (!(raw instanceof me.bechberger.condensed.ReadStruct)) {
                                    app.append(raw.toString());
                                    return;
                                }
                                CJFREvent nested = ((CJFREvent) (Object) obj).getStruct(fieldName);
                                if (nested == null) { app.appendNull(); return; }
                                List<String> names = nested.getFieldNames();
                                if (names.size() == 1) {
                                    app.append(nested.getString(names.get(0)));
                                } else {
                                    app.appendNull();
                                }
                            }, Appender::appendNull);
                }
            }
        }
        return List.of(col.withDescription(label, null));
    }

    /**
     * Builds a DuckDB column for a CJFR "array<...>" aggregated field. These fields combine
     * many original JFR events into a single aggregated value; the actual stored value is
     * numeric. We use the underlying primitive from the description to pick the SQL type.
     */
    private static Table.Column buildCjfrArrayColumn(String fieldName, @Nullable String underlying) {
        return switch (underlying == null ? "" : underlying) {
            case "double", "float" -> new Table.Column(fieldName, "DOUBLE",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getDouble(fieldName)),
                    (app) -> app.append(0.0));
            case "long" -> new Table.Column(fieldName, "BIGINT",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getLong(fieldName)),
                    (app) -> app.append(0L));
            case "int" -> new Table.Column(fieldName, "INTEGER",
                    (obj, app) -> app.append(((CJFREvent) (Object) obj).getInt(fieldName)),
                    (app) -> app.append(0));
            // Reference types in array columns are structs — stringify them
            case "java.lang.Thread", "java.lang.Class", "jdk.types.Method" ->
                    new Table.Column(fieldName, "VARCHAR",
                            (obj, app) -> {
                                CJFREvent nested = ((CJFREvent) (Object) obj).getStruct(fieldName);
                                app.append(nested != null ? nested.toString() : null);
                            }, Appender::appendNull);
            default -> new Table.Column(fieldName, "VARCHAR",
                    (obj, app) -> {
                        Object raw = ((CJFREvent) (Object) obj).getValue(fieldName);
                        app.append(raw != null ? raw.toString() : null);
                    }, Appender::appendNull);
        };
    }

    /** Inserts a single CJFR event into its corresponding DuckDB table. */
    @SuppressWarnings("unchecked")
    private static void insertCjfrEvent(Table table, CJFREvent event) {
        try {
            table.appender.beginRow();
            for (Table.Column col : table.columns) {
                // AppendFunction.appendTo now takes Object so CJFREvent can be passed directly;
                // the CJFR column lambdas cast it back to CJFREvent.
                col.append.appendTo(event, table.appender);
            }
            table.appender.endRow();
        } catch (SQLException e) {
            // Soft-fail on individual row errors (malformed values)
            System.err.println("[cjfr-import] row insert failed for " + event.getEventType().getName() + ": " + e.getMessage());
        }
    }

    private static long cjfrSafeLong(CJFREvent ev, String field) {
        Object v = ev.getValue(field);
        if (v instanceof Number n) return n.longValue();
        return 0L;
    }

    private static int cjfrSafeInt(CJFREvent ev, String field) {
        Object v = ev.getValue(field);
        if (v instanceof Number n) return n.intValue();
        return 0;
    }

    private static double cjfrSafeDouble(CJFREvent ev, String field) {
        Object v = ev.getValue(field);
        if (v instanceof Number n) return n.doubleValue();
        return 0.0;
    }

    private void finalizeImport() {
        long t0 = System.nanoTime();
        writeEventCounts();
        writeEventLabels();
        long t1 = System.nanoTime();
        for (Table table : eventTypeToTable.values()) {
            table.close();
        }
        for (Table table : structTypeToTable.values()) {
            table.close();
        }
        long t2 = System.nanoTime();
        sortEventTablesByStartTime();
        long t3 = System.nanoTime();
        try {
            recordingInfo.store(sinkSupplier.get());
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to store recording info", e);
        }
        try {
            addMacrosAndViews(sinkSupplier.get());
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to get a connection for macros/views", e);
        }
        long t4 = System.nanoTime();
        System.out.printf("[jfr-finalize] writeLabels: %dms | closeTables: %dms | sortByStartTime: %dms | macros/views: %dms%n",
                (t1 - t0) / 1_000_000, (t2 - t1) / 1_000_000,
                (t3 - t2) / 1_000_000, (t4 - t3) / 1_000_000);
    }

    /**
     * jafar parses chunks in parallel, so events land in the appender in nondeterministic
     * order. Many views use bare {@code LAST(x)}/{@code FIRST(x)} which depend on row order.
     * Re-sort each event table by {@code startTime} so those queries become deterministic.
     */
    private void sortEventTablesByStartTime() {
        try {
            DuckDBSink sink = sinkSupplier.get();
            for (Table table : eventTypeToTable.values()) {
                boolean hasStartTime =
                        table.columns.stream().anyMatch(c -> "startTime".equals(c.name));
                if (!hasStartTime) continue;
                String quoted = table.name.replace("\"", "\"\"");
                sink.execute(
                        "CREATE OR REPLACE TABLE \""
                                + quoted
                                + "\" AS SELECT * FROM \""
                                + quoted
                                + "\" ORDER BY startTime");
                // CREATE OR REPLACE drops the table comment — reapply it.
                String comment = table.getComment();
                if (!comment.isBlank()) {
                    sink.execute(
                            "COMMENT ON TABLE \""
                                    + quoted
                                    + "\" IS '"
                                    + comment.replace("'", "''")
                                    + "';");
                }
            }
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to sort event tables by startTime", e);
        }
    }

    public String normalizeTableName(String name) {
        return name.replaceAll("^(java|jfr|jdk)(\\.[a-z]+)*\\.", "");
    }

    private Table getTableForEventType(MetadataClass eventType) {
        String key = eventType.getName();
        eventTypeMeta.put(key, eventType);
        return eventTypeToTable.computeIfAbsent(key, k -> createTableForEventType(eventType));
    }

    private final Set<String> warned = new HashSet<>();

    private boolean isNumericField(MetadataField field) {
        return switch (field.getType().getName()) {
            case "long", "byte", "short", "char", "int", "boolean", "double", "float" -> true;
            default -> false;
        };
    }

    private List<Table.Column> createColumnsForType(
            MetadataField descriptor,
            Function<Object, Map<String, Object>> getBaseObject) {
        if (JafarValues.isArray(descriptor)) {
            throw new IllegalStateException("Array types not supported");
        }
        return createColumnsForTypeIgnoringArrays(descriptor, getBaseObject);
    }

    /** ContentType annotations to exclude from the dataTypes display string. */
    private static final Set<String> ignoredContentAnnotations =
            Set.of(
                    "jdk.jfr.Unsigned",
                    "jdk.jfr.BooleanFlag",
                    "jdk.jfr.Timestamp",
                    "jdk.jfr.Timespan");

    private @Nullable String[] parseContentTypeAnnotations(MetadataField field) {
        if (field.getAnnotations() == null) return new String[0];
        return field.getAnnotations().stream()
                .filter(
                        a -> {
                            MetadataClass at = a.getType();
                            if (at == null) return false;
                            // ContentType is itself an annotation on the annotation type
                            return JafarValues.findAnnotation(at, "jdk.jfr.ContentType") != null;
                        })
                .filter(a -> !ignoredContentAnnotations.contains(a.getType().getName()))
                .map(this::formatContentTypeAnnotation)
                .toArray(String[]::new);
    }

    private String formatContentTypeAnnotation(
            io.jafar.parser.internal_api.metadata.MetadataAnnotation annotation) {
        String typeName = annotation.getType().getName();
        switch (typeName) {
            case "jdk.jfr.Timestamp":
                return "Timestamp";
            case "jdk.jfr.Timespan":
                return "Timespan";
            default: {
                String label = JafarValues.getAnnotationValue(annotation.getType(), LABEL_ANNOTATION);
                if (label == null) label = typeName;
                String formattedLabel =
                        label.substring(label.lastIndexOf('.') + 1).replace(" ", "");
                String value = annotation.getValue();
                if (value == null || value.isBlank()) {
                    return formattedLabel;
                }
                return formattedLabel + "(" + value + ")";
            }
        }
    }

    private boolean hasContentType(MetadataField field, String contentTypeName) {
        return JafarValues.findAnnotation(field, contentTypeName) != null;
    }

    /**
     * Convert a JFR {@code @Timestamp}/{@code @Timespan} unit annotation value to a
     * nanoseconds-per-unit factor. {@code null} or unrecognized values default to nanoseconds
     * (1), which matches the JFR default of "ticks resolved to nanoseconds".
     */
    private static long nanosPerTimeUnit(String unit) {
        if (unit == null) return 1L;
        return switch (unit) {
            case "SECONDS" -> 1_000_000_000L;
            case "MILLISECONDS", "MILLISECONDS_SINCE_EPOCH" -> 1_000_000L;
            case "MICROSECONDS" -> 1_000L;
            case "NANOSECONDS", "TICKS" -> 1L;
            default -> 1L;
        };
    }

    /**
     * jafar models JFR's string-constant-pool entries as a struct with a single
     * {@code java.lang.String} field. Examples: {@code Symbol{string:..}},
     * {@code GCWhen{when:..}}, {@code GCName{name:..}}, {@code GCCause{cause:..}},
     * {@code G1YCType{type:..}}. These should surface as VARCHAR columns, not inlined
     * {@code field$inner} columns — the original {@code RecordedObject.getString}
     * auto-unwrapped them.
     */
    private static boolean isStringConstant(MetadataField field) {
        MetadataClass type = field.getType();
        List<MetadataField> fields = type.getFields();
        if (fields.size() != 1) return false;
        MetadataField inner = fields.get(0);
        return "java.lang.String".equals(inner.getType().getName());
    }

    @SuppressWarnings("RedundantLabeledSwitchRuleCodeBlock")
    private List<Table.Column> createColumnsForTypeIgnoringArrays(
            MetadataField descriptor,
            Function<Object, Map<String, Object>> getBaseObject) {
        String fieldName = descriptor.getName();
        String typeName = descriptor.getType().getName();
        // String-constant-pool entries (jafar's Symbol/Class.name surface here) — flatten to VARCHAR.
        final boolean isTopLevel = (getBaseObject == IDENTITY_FUNCTION);
        if (isStringConstant(descriptor) && !"java.lang.String".equals(typeName)) {
            Table.Column scol;
            if (fieldName.equals("descriptor") && !options.useComplexDescriptors()) {
                scol =
                        new Table.Column(
                                fieldName,
                                "VARCHAR",
                                (obj, app) -> {
                                    String d =
                                            JafarValues.getString(getBaseObject.apply(obj), fieldName);
                                    app.append(JFRUtil.simplifyDescriptor(d));
                                },
                                Appender::appendNull);
                if (isTopLevel) scol = scol.withDirect((raw, app) ->
                        app.append(JFRUtil.simplifyDescriptor(JafarValues.getStringDirect(raw))));
            } else {
                scol =
                        new Table.Column(
                                fieldName,
                                "VARCHAR",
                                (obj, app) ->
                                        app.append(
                                                JafarValues.getString(
                                                        getBaseObject.apply(obj), fieldName)),
                                Appender::appendNull);
                if (isTopLevel) scol = scol.withDirect((raw, app) ->
                        app.append(JafarValues.getStringDirect(raw)));
            }
            String slabel = JafarValues.getAnnotationValue(descriptor, LABEL_ANNOTATION);
            String sdesc = JafarValues.getAnnotationValue(descriptor, DESCRIPTION_ANNOTATION);
            return List.of(
                    scol.withDataTypes(parseContentTypeAnnotations(descriptor))
                            .withDescription(slabel, sdesc));
        }
        Table.Column col;
        switch (typeName) {
            case "java.lang.String" -> {
                if (fieldName.equals("descriptor") && !options.useComplexDescriptors()) {
                    col =
                            new Table.Column(
                                    fieldName,
                                    "VARCHAR",
                                    (obj, app) -> {
                                        String d =
                                                JafarValues.getString(
                                                        getBaseObject.apply(obj), fieldName);
                                        app.append(JFRUtil.simplifyDescriptor(d));
                                    },
                                    Appender::appendNull);
                    if (isTopLevel) col = col.withDirect((raw, app) ->
                            app.append(JFRUtil.simplifyDescriptor(JafarValues.getStringDirect(raw))));
                    break;
                }
                col =
                        new Table.Column(
                                fieldName,
                                "VARCHAR",
                                (obj, app) ->
                                        app.append(
                                                JafarValues.getString(
                                                        getBaseObject.apply(obj), fieldName)),
                                Appender::appendNull);
                if (isTopLevel) col = col.withDirect((raw, app) ->
                        app.append(JafarValues.getStringDirect(raw)));
            }
            case "long" -> {
                boolean isTimestamp = hasContentType(descriptor, "jdk.jfr.Timestamp");
                boolean isTimespan = hasContentType(descriptor, "jdk.jfr.Timespan");
                if (isTimestamp) {
                    final long tsNanosPerUnit = nanosPerTimeUnit(
                            JafarValues.getAnnotationValue(descriptor, "jdk.jfr.Timestamp"));
                    col =
                            new Table.Column(
                                    fieldName,
                                    "TIMESTAMP",
                                    (obj, app) -> {
                                        Long raw =
                                                JafarValues.getLong(
                                                        getBaseObject.apply(obj), fieldName);
                                        if (raw == null || raw < 0) {
                                            append(app, Instant.EPOCH);
                                            return;
                                        }
                                        long nanos = raw * tsNanosPerUnit;
                                        append(app, Instant.ofEpochSecond(0, nanos));
                                    },
                                    (app) -> append(app, Instant.EPOCH));
                    if (isTopLevel) col = col.withDirect((rawVal, app) -> {
                        Long raw = JafarValues.getLongDirect(rawVal);
                        if (raw == null || raw < 0) { append(app, Instant.EPOCH); return; }
                        append(app, Instant.ofEpochSecond(0, raw * tsNanosPerUnit));
                    });
                } else if (isTimespan) {
                    final long tsNanosPerUnit = nanosPerTimeUnit(
                            JafarValues.getAnnotationValue(descriptor, "jdk.jfr.Timespan"));
                    col =
                            new Table.Column(
                                    fieldName,
                                    "DOUBLE",
                                    (obj, app) -> {
                                        Long raw =
                                                JafarValues.getLong(
                                                        getBaseObject.apply(obj), fieldName);
                                        if (raw == null) {
                                            app.append(0.0);
                                            return;
                                        }
                                        if (raw == Long.MAX_VALUE) {
                                            app.append(Double.POSITIVE_INFINITY);
                                            return;
                                        }
                                        long nanos = raw * tsNanosPerUnit;
                                        // mirror old overflow guard: > 10 years' worth of hours
                                        double seconds = nanos / 1_000_000_000.0;
                                        if (seconds > 24L * 365 * 10 * 3600) {
                                            app.append(Double.POSITIVE_INFINITY);
                                            return;
                                        }
                                        app.append(seconds);
                                    },
                                    (app) -> app.append(Double.POSITIVE_INFINITY));
                    if (isTopLevel) col = col.withDirect((rawVal, app) -> {
                        Long raw = JafarValues.getLongDirect(rawVal);
                        if (raw == null) { app.append(0.0); return; }
                        if (raw == Long.MAX_VALUE) { app.append(Double.POSITIVE_INFINITY); return; }
                        double seconds = (raw * tsNanosPerUnit) / 1_000_000_000.0;
                        app.append(seconds > 24L * 365 * 10 * 3600 ? Double.POSITIVE_INFINITY : seconds);
                    });
                } else {
                    col =
                            new Table.Column(
                                    fieldName,
                                    "BIGINT",
                                    (obj, app) ->
                                            app.append(
                                                    JafarValues.getLongOr(
                                                            getBaseObject.apply(obj), fieldName, 0L)),
                                    (app) -> app.append(0L));
                    if (isTopLevel) col = col.withDirect((raw, app) -> {
                        Long v = JafarValues.getLongDirect(raw); app.append(v != null ? v : 0L); });
                }
            }
            case "byte" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "TINYINT",
                                (obj, app) -> {
                                    Long v =
                                            JafarValues.getLong(getBaseObject.apply(obj), fieldName);
                                    app.append(v != null ? (byte) v.longValue() : (byte) 0);
                                },
                                (app) -> app.append((byte) 0));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Long v = JafarValues.getLongDirect(raw); app.append(v != null ? (byte)v.longValue() : (byte)0); });
            }
            case "short" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "SMALLINT",
                                (obj, app) -> {
                                    Long v =
                                            JafarValues.getLong(getBaseObject.apply(obj), fieldName);
                                    app.append(v != null ? (short) v.longValue() : (short) 0);
                                },
                                (app) -> app.append((short) 0));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Long v = JafarValues.getLongDirect(raw); app.append(v != null ? (short)v.longValue() : (short)0); });
            }
            case "char" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "SMALLINT",
                                (obj, app) -> {
                                    Character c =
                                            JafarValues.getCharacter(
                                                    getBaseObject.apply(obj), fieldName);
                                    app.append(c != null ? (short) (int) c : (short) 0);
                                },
                                (app) -> app.append(0));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Character c = JafarValues.getCharacterDirect(raw); app.append(c != null ? (short)(int)c : (short)0); });
            }
            case "int" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "INTEGER",
                                (obj, app) -> {
                                    Integer v =
                                            JafarValues.getInteger(
                                                    getBaseObject.apply(obj), fieldName);
                                    app.append(v != null ? v.intValue() : 0);
                                },
                                (app) -> app.append(0));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Integer v = JafarValues.getIntegerDirect(raw); app.append(v != null ? v.intValue() : 0); });
            }
            case "boolean" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "BOOLEAN",
                                (obj, app) -> {
                                    Boolean v =
                                            JafarValues.getBoolean(
                                                    getBaseObject.apply(obj), fieldName);
                                    app.append(v != null && v);
                                },
                                (app) -> app.append(false));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Boolean v = JafarValues.getBooleanDirect(raw); app.append(v != null && v); });
            }
            case "double" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "DOUBLE",
                                (obj, app) -> {
                                    Double v =
                                            JafarValues.getDouble(
                                                    getBaseObject.apply(obj), fieldName);
                                    app.append(v != null ? v.doubleValue() : 0.0);
                                },
                                (app) -> app.append(0.0));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Double v = JafarValues.getDoubleDirect(raw); app.append(v != null ? v.doubleValue() : 0.0); });
            }
            case "float" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "FLOAT",
                                (obj, app) -> {
                                    Float v =
                                            JafarValues.getFloat(
                                                    getBaseObject.apply(obj), fieldName);
                                    app.append(v != null ? v.floatValue() : 0.0f);
                                },
                                (app) -> app.append(0.0f));
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Float v = JafarValues.getFloatDirect(raw); app.append(v != null ? v.floatValue() : 0.0f); });
            }
            case "jdk.types.Timestamp" -> {
                col =
                        new Table.Column(
                                fieldName,
                                "TIMESTAMP",
                                (obj, app) -> {
                                    Long nanos =
                                            JafarValues.getLong(
                                                    getBaseObject.apply(obj), fieldName);
                                    if (nanos == null) {
                                        app.appendNull();
                                    } else {
                                        app.append(Instant.ofEpochSecond(0, nanos).toString());
                                    }
                                },
                                Appender::appendNull);
                if (isTopLevel) col = col.withDirect((raw, app) -> {
                    Long nanos = JafarValues.getLongDirect(raw);
                    if (nanos == null) app.appendNull(); else app.append(Instant.ofEpochSecond(0, nanos).toString());
                });
            }
            case "jdk.types.StackTrace" -> {
                return createStackTraceColumns(descriptor, getBaseObject);
            }
            case "java.lang.ThreadGroup", "jdk.types.Module", "jdk.types.ClassLoader" -> {
                return createStructColumns(descriptor, getBaseObject);
            }
            case "jdk.types.Package" -> {
                if (options.isExcluded(Options.ExcludableItems.PACKAGE_HIERARCHY)) {
                    return List.of(
                            new Table.Column(
                                    fieldName,
                                    "VARCHAR",
                                    (obj, app) -> {
                                        Map<String, Object> pkg =
                                                JafarValues.getStruct(
                                                        getBaseObject.apply(obj), fieldName);
                                        app.append(
                                                pkg != null
                                                        ? JafarValues.getString(pkg, "name")
                                                        : null);
                                    },
                                    Appender::appendNull));
                }
                return createStructColumns(descriptor, getBaseObject);
            }
            default -> {
                if (!descriptor.getType().getFields().isEmpty()) {
                    return createStructColumns(descriptor, getBaseObject);
                }
                if (warned.add(typeName)) {
                    System.out.println(
                            "Unknown type " + typeName + " first seen in field " + descriptor.getName());
                }
                return null;
            }
        }
        String label = JafarValues.getAnnotationValue(descriptor, LABEL_ANNOTATION);
        String desc = JafarValues.getAnnotationValue(descriptor, DESCRIPTION_ANNOTATION);
        return List.of(col.withDataTypes(parseContentTypeAnnotations(descriptor)).withDescription(label, desc));
    }

    private MetadataField getField(MetadataField descriptor, String fieldName) {
        return descriptor.getType().getFields().stream()
                .filter(f -> f.getName().equals(fieldName))
                .findFirst()
                .orElseThrow(
                        () ->
                                new IllegalArgumentException(
                                        "Field "
                                                + fieldName
                                                + " not found in descriptor "
                                                + descriptor.getName()));
    }

    private MetadataField getFieldFromClass(MetadataClass cls, String fieldName) {
        return cls.getFields().stream()
                .filter(f -> f.getName().equals(fieldName))
                .findFirst()
                .orElseThrow(
                        () ->
                                new IllegalArgumentException(
                                        "Field " + fieldName + " not found in class " + cls.getName()));
    }

    /**
     * Per-event cache for stack frame arrays. Each stack trace column calls getFramesRaw with the
     * same stackTrace object; caching by identity avoids 5 redundant jafar array-pool lookups per
     * event on the WASM hot path (WasmGC array allocation is expensive).
     */
    private static Object lastFramesKey = null;
    private static Object[] lastFramesVal = null;

    private static Object[] getFramesCached(Map<String, Object> stackTrace) {
        if (stackTrace == lastFramesKey) return lastFramesVal;
        Object[] arr = JafarValues.getArray(stackTrace, "frames");
        lastFramesKey = stackTrace;
        lastFramesVal = arr;
        return arr;
    }

    /** @deprecated use {@link #getFramesCached} to avoid ArrayList allocation */
    private static List<Map<String, Object>> getFrames(Map<String, Object> stackTrace) {
        Object[] arr = getFramesCached(stackTrace);
        if (arr == null) return List.of();
        List<Map<String, Object>> out = new ArrayList<>(arr.length);
        for (Object e : arr) {
            Map<String, Object> frame = JafarValues.unwrapStruct(e);
            if (frame != null) out.add(frame);
        }
        return out;
    }

    private static boolean isJavaFrame(Map<String, Object> frame) {
        // jafar's frame.type is the FrameType string-constant. Java-language frames are
        // Interpreted, JIT compiled, or Inlined; Native/Cpp/Kernel are excluded.
        String type = JafarValues.getString(frame, "type");
        return "Interpreted".equals(type) || "JIT compiled".equals(type) || "Inlined".equals(type);
    }

    /**
     * Map a stack trace field to columns:
     *
     * <ul>
     *   <li>{@code fieldname$topMethod}, {@code $topApplicationMethod}, {@code $topNonInitMethod} —
     *       UINTEGER references into Method
     *   <li>{@code fieldname$length} — SMALLINT
     *   <li>{@code fieldname$truncated} — BOOLEAN
     *   <li>{@code fieldname$methods} — UINTEGER[N]
     * </ul>
     */
    private List<Table.Column> createStackTraceColumns(
            MetadataField field,
            Function<Object, Map<String, Object>> getBaseObject) {
        String fieldName = field.getName();
        List<Table.Column> cols = new ArrayList<>();
        // Ensure the Method table is created first by resolving frames[].method.
        MetadataField framesField = getField(field, "frames");
        MetadataField methodField = getField(framesField, "method");
        getTableForMiscType(methodField);

        BiConsumer<Function<Object, Map<String, Object>>, String> addFrameColumn =
                (frameObtainer, name) -> {
                    cols.add(
                            new Table.Column(
                                    fieldName + "$" + name,
                                    "UINTEGER",
                                    (obj, app) -> {
                                        Map<String, Object> stackTrace =
                                                JafarValues.getStruct(
                                                        getBaseObject.apply(obj), fieldName);
                                        if (stackTrace == null) {
                                            app.append(0);
                                            return;
                                        }
                                        Object[] arr = getFramesCached(stackTrace);
                                        if (arr == null || arr.length == 0) {
                                            app.append(0);
                                            return;
                                        }
                                        Map<String, Object> frame = frameObtainer.apply(stackTrace);
                                        if (frame == null) {
                                            app.append(0);
                                            return;
                                        }
                                        Map<String, Object> method =
                                                JafarValues.getStruct(frame, "method");
                                        if (method == null) {
                                            app.append(0);
                                            return;
                                        }
                                        int id =
                                                getTableForMiscType(methodField)
                                                        .assumeCaching()
                                                        .insertInto(method);
                                        app.append(id);
                                    },
                                    (app) -> app.append(0),
                                    "Method"));
                };

        addFrameColumn.accept(stackTrace -> {
            Object[] arr = getFramesCached((Map<String, Object>) stackTrace);
            return (arr != null && arr.length > 0) ? JafarValues.unwrapStruct(arr[0]) : null;
        }, "topMethod");
        addFrameColumn.accept(
                stackTrace -> {
                    Object[] arr = getFramesCached((Map<String, Object>) stackTrace);
                    if (arr == null) return null;
                    for (Object e : arr) {
                        Map<String, Object> f = JafarValues.unwrapStruct(e);
                        if (f == null || !isJavaFrame(f)) continue;
                        Map<String, Object> method = JafarValues.getStruct(f, "method");
                        if (method == null) continue;
                        Map<String, Object> type = JafarValues.getStruct(method, "type");
                        if (type == null) continue;
                        Map<String, Object> classLoader = JafarValues.getStruct(type, "classLoader");
                        if (classLoader == null) continue;
                        String clName = JafarValues.getString(classLoader, "name");
                        if (!"bootstrap".equals(clName)) return f;
                    }
                    return null;
                },
                "topApplicationMethod");
        addFrameColumn.accept(
                stackTrace -> {
                    Object[] arr = getFramesCached((Map<String, Object>) stackTrace);
                    if (arr == null) return null;
                    for (Object e : arr) {
                        Map<String, Object> f = JafarValues.unwrapStruct(e);
                        if (f == null || !isJavaFrame(f)) continue;
                        Map<String, Object> method = JafarValues.getStruct(f, "method");
                        if (method != null && !"<init>".equals(JafarValues.getString(method, "name"))) return f;
                    }
                    return null;
                },
                "topNonInitMethod");

        cols.add(
                new Table.Column(
                        fieldName + "$length",
                        "SHORT",
                        (obj, app) -> {
                            Map<String, Object> stackTrace =
                                    JafarValues.getStruct(getBaseObject.apply(obj), fieldName);
                            if (stackTrace == null) { app.append((short) 0); return; }
                            Object[] arr = getFramesCached(stackTrace);
                            app.append(arr != null ? (short) arr.length : (short) 0);
                        },
                        (app) -> app.append(0)));
        cols.add(
                new Table.Column(
                        fieldName + "$truncated",
                        "BOOLEAN",
                        (obj, app) -> {
                            Map<String, Object> stackTrace =
                                    JafarValues.getStruct(getBaseObject.apply(obj), fieldName);
                            if (stackTrace == null) {
                                app.append(false);
                                return;
                            }
                            Boolean truncated = JafarValues.getBoolean(stackTrace, "truncated");
                            Object[] arr = getFramesCached(stackTrace);
                            int frameCount = arr != null ? arr.length : 0;
                            app.append(
                                    (truncated != null && truncated)
                                            || frameCount > options.getMaxStackTraceDepth());
                        },
                        (app) -> app.append(false)));
        final int maxDepth = options.getMaxStackTraceDepth();
        // Reuse a single int[] per thread instead of allocating one per event (256K events/flush).
        final ThreadLocal<int[]> scratchTL = ThreadLocal.withInitial(() -> new int[maxDepth]);
        cols.add(
                new Table.Column(
                        fieldName + "$methods",
                        "UINTEGER[" + maxDepth + "]",
                        (obj, app) -> {
                            Map<String, Object> stackTrace =
                                    JafarValues.getStruct(getBaseObject.apply(obj), fieldName);
                            int[] out = scratchTL.get();
                            java.util.Arrays.fill(out, 0);
                            if (stackTrace != null) {
                                Object[] frames = getFramesCached(stackTrace);
                                if (frames != null) {
                                    int n = Math.min(frames.length, maxDepth);
                                    Table methodTable = getTableForMiscType(methodField).assumeCaching();
                                    for (int i = 0; i < n; i++) {
                                        Map<String, Object> method =
                                                JafarValues.getStruct(
                                                        JafarValues.unwrapStruct(frames[i]), "method");
                                        if (method != null) out[i] = methodTable.insertInto(method);
                                    }
                                }
                            }
                            app.append(out);
                        },
                        (app) -> app.append(0),
                        "Method"));
        return cols;
    }

    /**
     * Rules: If the struct only consists of numeric values then inline the struct into columns.
     * This is also true if the struct only has one field. Else: create a separate table for the
     * struct and reference it by ID (caching).
     */
    private List<Table.Column> createStructColumns(
            MetadataField descriptor,
            Function<Object, Map<String, Object>> getBaseObject) {
        List<MetadataField> structFields = descriptor.getType().getFields();
        boolean isObjectReference =
                (structFields.size() > 1 && !structFields.stream().allMatch(this::isNumericField));
        if (isObjectReference) {
            Table table = getTableForMiscType(descriptor);
            if (table == null) {
                return List.of();
            }
            return List.of(
                    new Table.Column(
                            descriptor.getName(),
                            "UINTEGER",
                            (obj, app) -> {
                                Map<String, Object> struct =
                                        JafarValues.getStruct(
                                                getBaseObject.apply(obj), descriptor.getName());
                                if (struct == null) {
                                    app.appendNull();
                                } else {
                                    app.append(table.insertInto(struct));
                                }
                            },
                            Appender::appendNull,
                            table.name));
        }
        return structFields.stream()
                .flatMap(
                        f ->
                                createColumnsForType(
                                                f,
                                                (o) -> {
                                                    Map<String, Object> inner =
                                                            JafarValues.getStruct(
                                                                    getBaseObject.apply(o),
                                                                    descriptor.getName());
                                                    return inner != null ? inner : Map.of();
                                                })
                                        .stream())
                .map(c -> c.prependName(descriptor.getName() + "$"))
                .toList();
    }

    private Table getTableForMiscType(MetadataField descriptor) {
        String typeName = descriptor.getType().getName();
        if (typeName.contains("StackFrame")) {
            throw new IllegalArgumentException("StackFrame types should be handled separately");
        }
        if (!structTypeToTable.containsKey(typeName)) {
            structTypeToTable.put(typeName, null);
            structTypeToTable.put(
                    typeName,
                    createTable(
                            typeName,
                            descriptor.getType().getFields(),
                            true,
                            JFRUtil.getCombinedTypeDescription(descriptor.getType())));
        }
        return structTypeToTable.get(typeName);
    }

    private List<Table.Column> additionalColumns(String name, List<MetadataField> fields) {
        switch (name) {
            case "java.lang.Class" -> {
                return List.of(
                        new Table.Column(
                                "javaName",
                                "VARCHAR",
                                (obj, app) -> {
                                    String n = JafarValues.getString((Map<String, Object>) obj, "name");
                                    app.append(decodeBytecodeClassName(n));
                                },
                                Appender::appendNull));
            }
            case "jdk.types.ClassLoader" -> {
                return List.of(
                        new Table.Column(
                                "javaName",
                                "VARCHAR",
                                (obj, app) -> {
                                    Map<String, Object> type = JafarValues.getStruct((Map<String, Object>) obj, "type");
                                    if (type != null) {
                                        String n = JafarValues.getString(type, "name");
                                        app.append(
                                                n != null
                                                        ? decodeBytecodeClassName(n)
                                                        : "null-bootstrap");
                                    } else {
                                        app.append("null-bootstrap");
                                    }
                                },
                                Appender::appendNull));
            }
            default -> {
                return List.of();
            }
        }
    }

    private Table createTable(
            String name, List<MetadataField> fields, boolean cache, @Nullable String description) {
        List<Table.Column> columns =
                Stream.concat(
                                fields.stream()
                                        .flatMap(
                                                f -> {
                                                    List<Table.Column> cols =
                                                            createColumnsForType(f, IDENTITY_FUNCTION);
                                                    return cols == null ? Stream.empty() : cols.stream();
                                                }),
                                additionalColumns(name, fields).stream())
                        .toList();
        if (columns.isEmpty()) {
            throw new IllegalArgumentException(
                    "Type " + name + " has no mappable fields, cannot create table");
        }
        String tableName = normalizeTableName(name);
        try {
            return new Table(tableName, columns, sinkSupplier.get(), cache, description);
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to create table for type " + name, e);
        }
    }

    private Table createTableForEventType(MetadataClass eventType) {
        String tableName =
                eventType.getName().startsWith("jdk.")
                        ? eventType.getName().substring(4)
                        : eventType.getName();
        String label = JafarValues.getAnnotationValue(eventType, LABEL_ANNOTATION);
        String description = JafarValues.getAnnotationValue(eventType, DESCRIPTION_ANNOTATION);
        return createTable(
                tableName,
                eventType.getFields(),
                false,
                combineDescription(eventType.getName(), label, description));
    }

    private void writeEventCounts() {
        try {
            DuckDBSink sink = sinkSupplier.get();
            Table table =
                    new Table(
                            "Events",
                            List.of(
                                    new Table.Column("name", "VARCHAR", null, null),
                                    new Table.Column("count", "INTEGER", null, null)),
                            sink,
                            false);
            for (Map.Entry<String, Integer> entry :
                    eventCount.entrySet().stream()
                            .sorted(Comparator.comparing(e -> -e.getValue()))
                            .toList()) {
                table.appender.beginRow();
                table.appender.append(normalizeTableName(entry.getKey()));
                table.appender.append(entry.getValue());
                table.appender.endRow();
            }
            table.close();
            DuckDBSink sink2 = sinkSupplier.get();
            Table eventIdTable =
                    new Table(
                            "EventIDs",
                            List.of(
                                    new Table.Column("name", "VARCHAR", null, null),
                                    new Table.Column("id", "LONG", null, null)),
                            sink2,
                            false);
            for (Map.Entry<String, MetadataClass> entry : eventTypeMeta.entrySet()) {
                eventIdTable.appender.beginRow();
                eventIdTable.appender.append(normalizeTableName(entry.getKey()));
                eventIdTable.appender.append(entry.getValue().getId());
                eventIdTable.appender.endRow();
            }
            eventIdTable.close();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private void writeEventLabels() {
        try {
            DuckDBSink sink = sinkSupplier.get();
            Table table =
                    new Table(
                            "EventLabels",
                            List.of(
                                    new Table.Column("name", "VARCHAR", null, null),
                                    new Table.Column("label", "VARCHAR", null, null)),
                            sink,
                            false);
            for (Map.Entry<String, MetadataClass> entry : eventTypeMeta.entrySet()) {
                String label =
                        JafarValues.getAnnotationValue(entry.getValue(), LABEL_ANNOTATION);
                table.appender.beginRow();
                table.appender.append(normalizeTableName(entry.getKey()));
                table.appender.append(label);
                table.appender.endRow();
            }
            table.close();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public static void createFile(Path jfrFile, Path dbFile, Options options)
            throws IOException, SQLException {
        List<DuckDBConnection> conns = new ArrayList<>();
        var importer =
                new BasicParallelImporter(
                        () -> {
                            try {
                                DuckDBConnection duckDBConnection =
                                        (DuckDBConnection)
                                                java.sql.DriverManager.getConnection(
                                                        "jdbc:duckdb:" + dbFile);
                                conns.add(duckDBConnection);
                                return new JdbcDuckDBSink(duckDBConnection);
                            } catch (Exception e) {
                                throw new RuntimeException(e);
                            }
                        },
                        options);
        importer.importRecording(jfrFile);
        for (DuckDBConnection duckDBConnection : conns) {
            duckDBConnection.close();
        }
    }

    public static void importIntoConnection(
            Path jfrFile, DuckDBConnection connection, Options options)
            throws IOException, SQLException {
        List<DuckDBConnection> conns = new ArrayList<>();
        var importer =
                new BasicParallelImporter(
                        () -> {
                            try {
                                DuckDBConnection duckDBConnection =
                                        (DuckDBConnection) connection.duplicate();
                                conns.add(duckDBConnection);
                                return new JdbcDuckDBSink(duckDBConnection);
                            } catch (Exception e) {
                                throw new RuntimeException(e);
                            }
                        },
                        options);
        importer.importRecording(jfrFile);
        for (DuckDBConnection duckDBConnection : conns) {
            duckDBConnection.close();
        }
    }

    public static void addMacrosAndViews(DuckDBSink sink) {
        // Macros and views currently use JDBC-only APIs (queries that read tableNames + drop
        // existing macros). For non-JDBC sinks (e.g. the WASM bridge) we skip silently — the
        // resulting database is fully usable, just without the convenience macros/views layered
        // on top. The browser UI can register macros/views client-side if needed.
        if (!(sink instanceof JdbcDuckDBSink jdbc)) {
            return;
        }
        addMacrosAndViews(jdbc.unwrap());
    }

    public static void addMacrosAndViews(DuckDBConnection connection) {
        try {
            MacroCollection.addToDatabase(connection);
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to add macros to database", e);
        }
        try {
            ViewCollection.addToDatabase(connection);
        } catch (SQLException e) {
            throw new RuntimeSQLException("Failed to add views to database", e);
        }
    }

    /**
     * Converts a {@link Duration} to seconds as a {@code double} without calling
     * {@link Duration#toNanos()}, which throws {@link ArithmeticException} on overflow for very
     * large/small durations (e.g. sentinel values like {@code Long.MAX_VALUE} nanoseconds).
     * <p>Uses {@link Duration#getSeconds()} + {@link Duration#getNano()} decomposition.
     */
    static double durationToSeconds(Duration d) {
        if (d == null) return 0.0;
        return d.getSeconds() + d.getNano() / 1_000_000_000.0;
    }
}
