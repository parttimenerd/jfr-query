package me.bechberger.jfr.duckdb.jvmlog;

import java.util.regex.Pattern;

public enum FieldType {
    INT, LONG, DOUBLE, STRING, BYTES, BOOLEAN;

    private static final Pattern BYTES_PAT = Pattern.compile("^(\\d+)([KMGkmg]?)B?$");

    /** Parse a raw captured string into the appropriate Java type. Returns null on parse failure. */
    public Object parse(String raw) {
        if (raw == null) return null;
        return switch (this) {
            case INT     -> Integer.parseInt(raw.trim());
            case LONG    -> Long.parseLong(raw.trim());
            case DOUBLE  -> Double.parseDouble(raw.trim());
            case STRING  -> raw;
            case BYTES   -> parseBytes(raw.trim());
            case BOOLEAN -> Boolean.parseBoolean(raw.trim());
        };
    }

    private static long parseBytes(String raw) {
        var m = BYTES_PAT.matcher(raw);
        if (!m.matches()) {
            return Long.parseLong(raw);
        }
        long value = Long.parseLong(m.group(1));
        return switch (m.group(2).toUpperCase()) {
            case "K" -> value * 1024L;
            case "M" -> value * 1024L * 1024L;
            case "G" -> value * 1024L * 1024L * 1024L;
            default  -> value;
        };
    }

    /** DuckDB DDL type string */
    public String duckDbType() {
        return switch (this) {
            case INT     -> "INTEGER";
            case LONG, BYTES -> "BIGINT";
            case DOUBLE  -> "DOUBLE";
            case STRING  -> "VARCHAR";
            case BOOLEAN -> "BOOLEAN";
        };
    }

    public static FieldType fromYaml(String s) {
        return switch (s.toLowerCase().trim()) {
            case "int"     -> INT;
            case "long"    -> LONG;
            case "double"  -> DOUBLE;
            case "bytes"   -> BYTES;
            case "boolean" -> BOOLEAN;
            default        -> STRING;
        };
    }
}
