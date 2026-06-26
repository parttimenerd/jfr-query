package me.bechberger.jfr.duckdb.templates;

import java.util.List;

public record TemplateMeta(
        String name,
        String title,
        String description,
        List<String> tags,
        String source,
        String license) {
}
