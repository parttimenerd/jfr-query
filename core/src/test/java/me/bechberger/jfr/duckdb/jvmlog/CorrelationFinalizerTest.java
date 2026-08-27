package me.bechberger.jfr.duckdb.jvmlog;

import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.sql.Statement;
import static org.assertj.core.api.Assertions.*;

class CorrelationFinalizerTest {

    @Test
    void noOpWhenOnlyJvmlogPresent() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INT, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 3.14, 0.5)");
        }
        CorrelationFinalizer.runIfApplicable(conn);
        // Table should NOT be created since GarbageCollection is absent
        try (Statement s = conn.createStatement()) {
            assertThatThrownBy(() ->
                s.executeQuery("SELECT * FROM jvmlog_jfr_correlation"))
                .hasMessageContaining("jvmlog_jfr_correlation");
        }
        conn.close();
    }

    @Test
    void noOpWhenOnlyJfrPresent() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE GarbageCollection (gcId INT, name VARCHAR, longestPause BIGINT, startTime TIMESTAMP)");
            s.execute("INSERT INTO GarbageCollection VALUES (0, 'G1New', 3140000, '2024-01-01 00:00:00')");
        }
        CorrelationFinalizer.runIfApplicable(conn);
        try (Statement s = conn.createStatement()) {
            assertThatThrownBy(() ->
                s.executeQuery("SELECT * FROM jvmlog_jfr_correlation"))
                .hasMessageContaining("jvmlog_jfr_correlation");
        }
        conn.close();
    }

    @Test
    void createsCorrelationTableWhenBothPresent() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE GarbageCollection (gcId INT, name VARCHAR, longestPause BIGINT, startTime TIMESTAMP)");
            s.execute("INSERT INTO GarbageCollection VALUES (0, 'G1New', 3140000, '2024-01-01 00:00:00')");
            s.execute("INSERT INTO GarbageCollection VALUES (1, 'G1New', 2000000, '2024-01-01 00:00:01')");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INT, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 3.14, 0.5)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 5.00, 2.0)");
        }
        CorrelationFinalizer.runIfApplicable(conn);
        try (Statement s = conn.createStatement();
             var rs = s.executeQuery("SELECT count(*) AS cnt FROM jvmlog_jfr_correlation")) {
            assertThat(rs.next()).isTrue();
            // GC 0: matched; GC 1: jfr-only; GC 2: log-only → 3 rows
            assertThat(rs.getLong("cnt")).isEqualTo(3);
        }
        try (Statement s = conn.createStatement();
             var rs = s.executeQuery("SELECT source, jfrLongestPauseMs, logPauseMs FROM jvmlog_jfr_correlation WHERE gcId = 0")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("source")).isEqualTo("both");
            assertThat(rs.getDouble("jfrLongestPauseMs")).isEqualTo(3.14);
            assertThat(rs.getDouble("logPauseMs")).isEqualTo(3.14);
        }
        try (Statement s = conn.createStatement();
             var rs = s.executeQuery("SELECT source FROM jvmlog_jfr_correlation WHERE gcId = 1")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("source")).isEqualTo("jfr-only");
        }
        try (Statement s = conn.createStatement();
             var rs = s.executeQuery("SELECT source FROM jvmlog_jfr_correlation WHERE gcId = 2")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("source")).isEqualTo("log-only");
        }
        conn.close();
    }

    @Test
    void idempotentWhenCalledTwice() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE GarbageCollection (gcId INT, name VARCHAR, longestPause BIGINT, startTime TIMESTAMP)");
            s.execute("INSERT INTO GarbageCollection VALUES (0, 'G1New', 5000000, '2024-01-01 00:00:00')");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INT, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'GC Cause', 5.0, 1.0)");
        }
        CorrelationFinalizer.runIfApplicable(conn);
        assertThatCode(() -> CorrelationFinalizer.runIfApplicable(conn))
                .as("second call should not throw")
                .doesNotThrowAnyException();
        conn.close();
    }
}
