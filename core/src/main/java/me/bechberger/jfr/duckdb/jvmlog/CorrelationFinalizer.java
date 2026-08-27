package me.bechberger.jfr.duckdb.jvmlog;

import org.duckdb.DuckDBConnection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Set;

/** Joins JFR GarbageCollection data with jvmlog_gc_event when both are present. */
public final class CorrelationFinalizer {

    private CorrelationFinalizer() {}

    /** Run correlation if both JFR tables and jvmlog_gc_event are present in conn. No-op otherwise. */
    public static void runIfApplicable(DuckDBConnection conn) {
        try {
            Set<String> tables = tableNames(conn);
            if (!tables.contains("jvmlog_gc_event") || !tables.contains("GarbageCollection")) return;

            try (var s = conn.createStatement()) {
                // longestPause in JFR is stored in nanoseconds; convert to ms
                s.execute("""
                    CREATE TABLE IF NOT EXISTS jvmlog_jfr_correlation AS
                    SELECT
                        coalesce(j.gcId, l.gcId) AS gcId,
                        CASE WHEN j.gcId IS NOT NULL AND l.gcId IS NOT NULL THEN 'both'
                             WHEN j.gcId IS NOT NULL THEN 'jfr-only'
                             ELSE 'log-only' END AS source,
                        j.longestPause / 1e6 AS jfrLongestPauseMs,
                        l.pauseMs AS logPauseMs
                    FROM GarbageCollection j
                    FULL OUTER JOIN jvmlog_gc_event l ON j.gcId = l.gcId
                    ORDER BY coalesce(j.gcId, l.gcId)
                    """);
            }
        } catch (SQLException ignored) {}
    }

    private static Set<String> tableNames(DuckDBConnection conn) throws SQLException {
        var names = new java.util.HashSet<String>();
        try (ResultSet rs = conn.createStatement().executeQuery(
                "SELECT table_name FROM information_schema.tables")) {
            while (rs.next()) names.add(rs.getString(1));
        }
        return names;
    }
}
