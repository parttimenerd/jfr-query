package me.bechberger.jfr.duckdb.jvmlog;

import java.util.Optional;

public interface LogPattern {
    String id();
    boolean matches(LogLine line);
    Optional<MatchResult> extract(LogLine line);
}
