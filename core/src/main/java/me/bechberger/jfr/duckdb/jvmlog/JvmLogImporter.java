package me.bechberger.jfr.duckdb.jvmlog;

import me.bechberger.jfr.duckdb.util.Appender;
import me.bechberger.jfr.duckdb.util.DuckDBSink;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;

public final class JvmLogImporter {

    private JvmLogImporter() {}

    public static void importLog(Path logFile, DuckDBSink sink) throws IOException, SQLException {
        importLog(logFile, sink, Optional.empty());
    }

    public static void importLog(Path logFile, DuckDBSink sink, Optional<Path> userPatternsDir)
            throws IOException, SQLException {
        var registry = BuiltinPatterns.createRegistry(userPatternsDir);
        var schemas = TableSchemaBuilder.buildSchemas(registry);

        sink.execute("""
            CREATE TABLE IF NOT EXISTS jvmlog_unknown_lines (
                tags VARCHAR,
                level VARCHAR,
                messagePrefix VARCHAR,
                count BIGINT
            )""");

        for (var ddl : schemas.values()) {
            sink.execute(ddl);
        }

        // Build a per-table ordered column list (same order as DDL) for full-row appending
        var tableColumns = buildTableColumns(registry);

        var appenders = new HashMap<String, Appender>();
        try {
            for (var tableName : schemas.keySet()) {
                appenders.put(tableName, sink.createAppender(tableName));
            }

            var unknownLines = new LinkedHashMap<String, long[]>();
            var accumulator = new GcEventAccumulator(result -> {
                var appender = appenders.get(result.tableName());
                if (appender == null) return;
                List<FieldDef> allCols = tableColumns.getOrDefault(result.tableName(), List.of());
                var valueMap = new HashMap<String, Object>();
                for (int i = 0; i < result.fields().size(); i++) {
                    valueMap.put(result.fields().get(i).name(), result.values().get(i));
                }
                try {
                    appender.beginRow();
                    for (FieldDef col : allCols) {
                        Object val = valueMap.get(col.name());
                        appendValue(appender, col.type(), val);
                    }
                    appender.endRow();
                } catch (SQLException e) {
                    throw new RuntimeException(e);
                }
            });

            try (var lines = Files.lines(logFile)) {
                lines.forEach(rawLine -> {
                    var parsed = LogLineParser.parse(rawLine);
                    if (parsed.isEmpty()) return;
                    var line = parsed.get();
                    var match = registry.match(line);
                    if (match.isPresent()) {
                        accumulator.accumulate(match.get());
                    } else {
                        String prefix = normalizePrefix(line.message());
                        String tagsStr = String.join(",", line.tags());
                        String levelStr = line.level() != null ? line.level().name().toLowerCase() : "";
                        String key = tagsStr + "|" + levelStr + "|" + prefix;
                        unknownLines.computeIfAbsent(key, k -> new long[]{0})[0]++;
                    }
                });
            }

            accumulator.flushAll();
            for (var appender : appenders.values()) {
                appender.close();
            }
            appenders.clear();

            try (var unknownAppender = sink.createAppender("jvmlog_unknown_lines")) {
                for (var entry : unknownLines.entrySet()) {
                    String[] parts = entry.getKey().split("\\|", 3);
                    unknownAppender.beginRow();
                    unknownAppender.append(parts.length > 0 ? parts[0] : "");
                    unknownAppender.append(parts.length > 1 ? parts[1] : "");
                    unknownAppender.append(parts.length > 2 ? parts[2] : "");
                    unknownAppender.append(entry.getValue()[0]);
                    unknownAppender.endRow();
                }
            }
        } finally {
            for (var appender : appenders.values()) {
                try { appender.close(); } catch (SQLException ignored) {}
            }
        }
    }

    private static void appendValue(Appender appender, FieldType type, Object val)
            throws SQLException {
        if (val == null) {
            appender.appendNull();
            return;
        }
        switch (type) {
            case INT    -> appender.append((Integer) val);
            case LONG, BYTES -> appender.append(val instanceof Long l ? l : ((Integer) val).longValue());
            case DOUBLE -> appender.append((Double) val);
            case STRING -> appender.append((String) val);
        }
    }

    private static String normalizePrefix(String message) {
        String normalized = message.replaceAll("0x[0-9a-fA-F]+", "?")
                                   .replaceAll("\\d+", "?");
        return normalized.substring(0, Math.min(normalized.length(), 80));
    }

    /**
     * Build a per-table ordered list of FieldDef (union of all fields across patterns, in
     * insertion order — mirrors the DDL column order produced by {@link TableSchemaBuilder}).
     */
    private static HashMap<String, List<FieldDef>> buildTableColumns(PatternRegistry registry) {
        // Use LinkedHashMap per table to preserve first-seen order and deduplicate by name
        var tableFieldMap = new LinkedHashMap<String, LinkedHashMap<String, FieldDef>>();
        for (var pattern : registry.patterns()) {
            String tableName = pattern.tableName();
            if (tableName == null || pattern.fields() == null) continue;
            var fieldMap = tableFieldMap.computeIfAbsent(tableName, k -> new LinkedHashMap<>());
            for (var field : pattern.fields()) {
                fieldMap.putIfAbsent(field.name(), field);
            }
        }
        var result = new HashMap<String, List<FieldDef>>();
        for (var entry : tableFieldMap.entrySet()) {
            result.put(entry.getKey(), new ArrayList<>(entry.getValue().values()));
        }
        return result;
    }
}
