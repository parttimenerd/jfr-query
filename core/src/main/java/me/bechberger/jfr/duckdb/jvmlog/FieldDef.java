package me.bechberger.jfr.duckdb.jvmlog;

import org.jetbrains.annotations.Nullable;

public record FieldDef(
        String name,
        FieldType type,
        boolean nullable,
        @Nullable Object constantValue) {

    public static FieldDef of(String name, FieldType type) {
        return new FieldDef(name, type, false, null);
    }

    public static FieldDef nullable(String name, FieldType type) {
        return new FieldDef(name, type, true, null);
    }

    public static FieldDef constant(String name, FieldType type, Object value) {
        return new FieldDef(name, type, false, value);
    }
}
