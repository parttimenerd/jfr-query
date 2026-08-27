package me.bechberger.jfr.duckdb.jvmlog;

import java.util.*;

public final class TableSchemaBuilder {

    private TableSchemaBuilder() {}

    public static Map<String, String> buildSchemas(PatternRegistry registry) {
        // tableName -> ordered map of fieldName -> FieldType (first type wins for a given name)
        var tableFieldTypes = new LinkedHashMap<String, LinkedHashMap<String, FieldType>>();
        // tableName -> fieldName -> count of patterns that define this field
        var tableFieldCount = new HashMap<String, Map<String, Integer>>();
        // tableName -> fieldName -> true if ANY pattern marks it explicitly nullable
        var tableFieldExplicitNullable = new HashMap<String, Set<String>>();
        // tableName -> total number of patterns targeting that table
        var tablePatternCount = new HashMap<String, Integer>();

        for (var pattern : registry.patterns()) {
            String tableName = pattern.tableName();
            List<FieldDef> fields = pattern.fields();
            if (tableName == null || fields == null) continue;

            tableFieldTypes.computeIfAbsent(tableName, k -> new LinkedHashMap<>());
            tableFieldCount.computeIfAbsent(tableName, k -> new HashMap<>());
            tableFieldExplicitNullable.computeIfAbsent(tableName, k -> new HashSet<>());
            tablePatternCount.merge(tableName, 1, Integer::sum);

            for (var field : fields) {
                tableFieldTypes.get(tableName).putIfAbsent(field.name(), field.type());
                tableFieldCount.get(tableName).merge(field.name(), 1, Integer::sum);
                if (field.nullable()) {
                    tableFieldExplicitNullable.get(tableName).add(field.name());
                }
            }
        }

        var result = new LinkedHashMap<String, String>();
        for (var entry : tableFieldTypes.entrySet()) {
            String table = entry.getKey();
            int total = tablePatternCount.get(table);
            var sb = new StringBuilder("CREATE TABLE ").append(table).append(" (\n");
            var cols = new ArrayList<String>();
            for (var fieldEntry : entry.getValue().entrySet()) {
                String name = fieldEntry.getKey();
                String duckType = fieldEntry.getValue().duckDbType();
                int seenCount = tableFieldCount.get(table).getOrDefault(name, 0);
                boolean explicitlyNullable = tableFieldExplicitNullable.getOrDefault(table, Set.of()).contains(name);
                boolean nullable = seenCount < total || explicitlyNullable;
                cols.add("    " + name + " " + duckType + (nullable ? "" : " NOT NULL"));
            }
            sb.append(String.join(",\n", cols));
            sb.append("\n)");
            result.put(table, sb.toString());
        }
        return result;
    }
}
