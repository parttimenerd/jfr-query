package me.bechberger.jfr.duckdb;

import static me.bechberger.jfr.duckdb.util.JFRUtil.*;
import static me.bechberger.jfr.duckdb.util.SQLUtil.append;

import io.jafar.parser.internal_api.metadata.MetadataClass;
import io.jafar.parser.internal_api.metadata.MetadataField;
import java.io.IOException;
import java.nio.file.Path;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
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

    static final Function<Map<String, Object>, Map<String, Object>> IDENTITY_FUNCTION = (o) -> o;

    @FunctionalInterface
    interface AppendFunction {
        /** Appends the value of the field to the Appender. */
        void appendTo(Map<String, Object> object, Appender appender) throws SQLException;
    }

    @FunctionalInterface
    interface AppendDefaultValueFunction {
        void appendDefault(Appender appender) throws SQLException;
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
        private final boolean cache;

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
            createTable(sink);
            this.appender = sink.createAppender(name);
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
                        prefix + name, type, append, appendDefault, referencedTable, description, dataTypes);
            }

            public Column(
                    String name,
                    String type,
                    AppendFunction append,
                    @Nullable AppendDefaultValueFunction appendDefault) {
                this(name, type, append, appendDefault, null, null);
            }

            public Column(
                    String name,
                    String type,
                    AppendFunction append,
                    @Nullable AppendDefaultValueFunction appendDefault,
                    @Nullable String referencedTable) {
                this(name, type, append, appendDefault, referencedTable, null);
            }

            public Column withDataTypes(String... dataTypes) {
                if (dataTypes == null || dataTypes.length == 0) {
                    return this;
                }
                return new Column(name, type, append, appendDefault, referencedTable, description, dataTypes);
            }

            public Column withDescription(String label, String description) {
                String combinedDescription = combineDescription(name, label, description);
                if (combinedDescription == null) {
                    return this;
                }
                return new Column(
                        name, type, append, appendDefault, referencedTable, combinedDescription, dataTypes);
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
        JFRUtil.runUntyped(
                path,
                (type, event) -> {
                    // jafar parses chunks in parallel from a thread pool — guard the importer's
                    // mutable state with a lock to keep semantics identical to the old sequential
                    // forEach loop.
                    synchronized (lock) {
                        Table table = getTableForEventType(type);
                        table.insertInto(event);
                        eventCount.merge(type.getName(), 1, Integer::sum);
                        recordingInfo.processEvent(type, event);
                    }
                });
        finalizeImport();
    }

    private void finalizeImport() {
        writeEventCounts();
        writeEventLabels();
        for (Table table : eventTypeToTable.values()) {
            table.close();
        }
        for (Table table : structTypeToTable.values()) {
            table.close();
        }
        sortEventTablesByStartTime();
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
            Function<Map<String, Object>, Map<String, Object>> getBaseObject) {
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
            Function<Map<String, Object>, Map<String, Object>> getBaseObject) {
        String fieldName = descriptor.getName();
        String typeName = descriptor.getType().getName();
        // String-constant-pool entries (jafar's Symbol/Class.name surface here) — flatten to VARCHAR.
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
            }
            case "long" -> {
                var defaultCol =
                        new Table.Column(
                                fieldName,
                                "BIGINT",
                                (obj, app) ->
                                        app.append(
                                                JafarValues.getLongOr(
                                                        getBaseObject.apply(obj), fieldName, 0L)),
                                (app) -> app.append(0L));
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
                } else {
                    col = defaultCol;
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
     * Reads {@code stackTrace.frames} as an array of frame structs. Each frame struct contains
     * {@code method}, {@code lineNumber}, {@code bytecodeIndex}, {@code type}.
     *
     * <p>The {@code type} field carries a string-constant frame kind (e.g. {@code "Java"}).
     */
    private static List<Map<String, Object>> getFrames(Map<String, Object> stackTrace) {
        Object[] arr = JafarValues.getArray(stackTrace, "frames");
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
            Function<Map<String, Object>, Map<String, Object>> getBaseObject) {
        String fieldName = field.getName();
        List<Table.Column> cols = new ArrayList<>();
        // Ensure the Method table is created first by resolving frames[].method.
        MetadataField framesField = getField(field, "frames");
        MetadataField methodField = getField(framesField, "method");
        getTableForMiscType(methodField);

        BiConsumer<Function<Map<String, Object>, Map<String, Object>>, String> addFrameColumn =
                (frameObtainer, name) -> {
                    cols.add(
                            new Table.Column(
                                    fieldName + "$" + name,
                                    "UINTEGER",
                                    (obj, app) -> {
                                        Map<String, Object> stackTrace =
                                                JafarValues.getStruct(
                                                        getBaseObject.apply(obj), fieldName);
                                        if (stackTrace == null || getFrames(stackTrace).isEmpty()) {
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

        addFrameColumn.accept(stackTrace -> getFrames(stackTrace).getFirst(), "topMethod");
        addFrameColumn.accept(
                stackTrace ->
                        getFrames(stackTrace).stream()
                                .filter(
                                        f -> {
                                            if (!isJavaFrame(f)) return false;
                                            Map<String, Object> method =
                                                    JafarValues.getStruct(f, "method");
                                            if (method == null) return false;
                                            Map<String, Object> type =
                                                    JafarValues.getStruct(method, "type");
                                            if (type == null) return false;
                                            Map<String, Object> classLoader =
                                                    JafarValues.getStruct(type, "classLoader");
                                            // Bootstrap loader sets name="bootstrap"; application
                                            // loaders (URLClassLoader, custom) leave name=null.
                                            // Treat null/missing classLoader as bootstrap too.
                                            if (classLoader == null) return false;
                                            String clName =
                                                    JafarValues.getString(classLoader, "name");
                                            return !"bootstrap".equals(clName);
                                        })
                                .findFirst()
                                .orElse(null),
                "topApplicationMethod");
        addFrameColumn.accept(
                stackTrace ->
                        getFrames(stackTrace).stream()
                                .filter(
                                        f -> {
                                            if (!isJavaFrame(f)) return false;
                                            Map<String, Object> method =
                                                    JafarValues.getStruct(f, "method");
                                            return method != null
                                                    && !"<init>"
                                                            .equals(JafarValues.getString(method, "name"));
                                        })
                                .findFirst()
                                .orElse(null),
                "topNonInitMethod");

        cols.add(
                new Table.Column(
                        fieldName + "$length",
                        "SHORT",
                        (obj, app) -> {
                            Map<String, Object> stackTrace =
                                    JafarValues.getStruct(getBaseObject.apply(obj), fieldName);
                            app.append(stackTrace != null ? (short) getFrames(stackTrace).size() : 0);
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
                            int frameCount = getFrames(stackTrace).size();
                            app.append(
                                    (truncated != null && truncated)
                                            || frameCount > options.getMaxStackTraceDepth());
                        },
                        (app) -> app.append(false)));
        cols.add(
                new Table.Column(
                        fieldName + "$methods",
                        "UINTEGER[" + options.getMaxStackTraceDepth() + "]",
                        (obj, app) -> {
                            Map<String, Object> stackTrace =
                                    JafarValues.getStruct(getBaseObject.apply(obj), fieldName);
                            int[] arr = new int[options.getMaxStackTraceDepth()];
                            List<Map<String, Object>> frames =
                                    stackTrace == null ? List.of() : getFrames(stackTrace);
                            for (int i = 0; i < options.getMaxStackTraceDepth(); i++) {
                                if (i >= frames.size()) {
                                    arr[i] = 0;
                                } else {
                                    Map<String, Object> method =
                                            JafarValues.getStruct(frames.get(i), "method");
                                    if (method == null) {
                                        arr[i] = 0;
                                    } else {
                                        arr[i] =
                                                getTableForMiscType(methodField)
                                                        .assumeCaching()
                                                        .insertInto(method);
                                    }
                                }
                            }
                            app.append(arr);
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
            Function<Map<String, Object>, Map<String, Object>> getBaseObject) {
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
                                    String n = JafarValues.getString(obj, "name");
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
                                    Map<String, Object> type = JafarValues.getStruct(obj, "type");
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
}
