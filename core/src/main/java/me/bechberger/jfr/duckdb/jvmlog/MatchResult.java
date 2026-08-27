package me.bechberger.jfr.duckdb.jvmlog;

import java.util.List;

public record MatchResult(String tableName, List<FieldDef> fields, List<Object> values) {}
