package me.bechberger.jfr.duckdb.jvmlog;

import java.time.Instant;
import java.util.List;
import org.jetbrains.annotations.Nullable;

public record LogLine(
        @Nullable Instant timestamp,
        @Nullable Double uptimeSecs,
        @Nullable LogLevel level,
        List<String> tags,
        String message) {

    public boolean hasTag(String tag) {
        return tags.contains(tag);
    }

    public boolean hasAllTags(List<String> required) {
        return tags.containsAll(required);
    }
}
