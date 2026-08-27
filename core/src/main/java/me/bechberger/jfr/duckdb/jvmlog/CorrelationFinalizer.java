package me.bechberger.jfr.duckdb.jvmlog;

import org.duckdb.DuckDBConnection;

/** Joins JFR GarbageCollection data with jvmlog_gc_event when both are present. */
public final class CorrelationFinalizer {

    private CorrelationFinalizer() {}

    /** Run correlation if both JFR tables and jvmlog_gc_event are present in conn. No-op otherwise. */
    public static void runIfApplicable(DuckDBConnection conn) {
        // Stub: full implementation in Plan D
    }
}
