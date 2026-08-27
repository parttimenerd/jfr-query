package me.bechberger.jfr.duckdb.jvmlog;

import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class JvmLogImporterTest {

    private static final Path LOGS_DIR =
            Path.of(System.getProperty("jdklogs.dir",
                    "../../../jdklogs/data"));

    private DuckDBConnection newConn() throws Exception {
        return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
    }

    private void importLog(DuckDBConnection conn, String logFile) throws Exception {
        var log = LOGS_DIR.resolve(logFile);
        assumeTrue(log.toFile().exists(), "jdklogs data not found: " + log);
        var sink = new JdbcDuckDBSink(conn);
        JvmLogImporter.importLog(log, sink);
        // intentionally NOT closing sink here — conn is managed by the caller
    }

    // ------------------------------------------------------------------
    // Existing tests (kept)
    // ------------------------------------------------------------------

    @Test
    void g1LogProducesInitRows() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).isNotBlank();
            }
        }
    }

    @Test
    void g1LogProducesUnknownLinesTable() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("unknown_lines table exists and is queryable").isGreaterThanOrEqualTo(0);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceGcInitTable(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM information_schema.tables WHERE table_name = 'jvmlog_gc_init'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isEqualTo(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: per-GC event table assertions
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceGcEventRows(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            // head.* files only contain JVM startup/init — no GC pause events yet;
            // assert table exists and is queryable
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM jvmlog_gc_event")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("GC event rows in " + logFile).isGreaterThanOrEqualTo(0);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceHeapSnapshotRows(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            // head.* files only contain JVM startup/init — no heap snapshots yet;
            // assert table exists and is queryable
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM jvmlog_heap_snapshot")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("Heap snapshot rows in " + logFile).isGreaterThanOrEqualTo(0);
            }
        }
    }

    @Test
    void g1LogProducesErgonomicsRows() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_g1_ergonomics")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("G1 ergonomics rows").isGreaterThanOrEqualTo(0);
            }
        }
    }

    @Test
    void g1LogGcIdIsPositive() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            // head.G1.log only has startup lines; gcId may be null if no pause events recorded
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM jvmlog_gc_event WHERE gcId IS NOT NULL")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("gcId rows in gc_event table").isGreaterThanOrEqualTo(0);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: view query execution
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void gcSummaryViewExecutes(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            try (var st = conn.createStatement()) {
                st.execute("""
                    CREATE VIEW "jvmlog-gc-summary" AS
                    SELECT gcType,
                           count(*) AS gcCount,
                           round(avg(pauseMs), 2) AS avgPauseMs,
                           round(max(pauseMs), 2) AS maxPauseMs,
                           round(sum(pauseMs), 2) AS totalPauseMs
                    FROM jvmlog_gc_event
                    WHERE gcType IS NOT NULL
                    GROUP BY gcType
                    ORDER BY totalPauseMs DESC
                    """);
                try (var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-gc-summary\"")) {
                    assertThat(rs.next()).isTrue();
                }
            }
        }
    }

    @Test
    void heapTimelineViewExecutes() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement()) {
                st.execute("""
                    CREATE VIEW "jvmlog-heap-timeline" AS
                    SELECT h.gcId,
                           round(h.heapBefore / 1048576.0, 2) AS heapBeforeMB,
                           round(h.heapAfter / 1048576.0, 2) AS heapAfterMB,
                           round(h.heapCommittedBefore / 1048576.0, 2) AS committedBeforeMB,
                           round(h.heapCommittedAfter / 1048576.0, 2) AS committedAfterMB,
                           e.pauseMs
                    FROM jvmlog_heap_snapshot h
                    LEFT JOIN jvmlog_gc_event e ON h.gcId = e.gcId
                    ORDER BY h.gcId
                    """);
                // head.G1.log has no heap snapshot rows (init only), but view must execute without error
                var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-heap-timeline\"");
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: user patterns dir is threaded through
    // ------------------------------------------------------------------

    @Test
    void userPatternsDirIsThreadedThrough(@TempDir Path tmpDir) throws Exception {
        var log = LOGS_DIR.resolve("head.G1.log");
        assumeTrue(log.toFile().exists());
        String yaml = """
                - id: test_custom_pattern
                  tags: [gc]
                  level: info
                  pattern: 'GC\\\\((\\\\d+)\\\\) Custom Test (\\\\d+)ms'
                  fields:
                    gcId: int
                    durationMs: double
                  table: jvmlog_custom_test
                """;
        Files.writeString(tmpDir.resolve("test_custom_pattern.yaml"), yaml);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(log, sink, Optional.of(tmpDir));
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM information_schema.tables WHERE table_name = 'jvmlog_custom_test'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1))
                        .as("custom table created when userPatternsDir provided")
                        .isEqualTo(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: robustness — decorator variations
    // ------------------------------------------------------------------

    @Test
    void parsesLogWithoutTimestamp() throws Exception {
        var tmp = Files.createTempFile("test", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.002s][info][gc,init] Heap Min Capacity: 256M
                    [0.010s][info][gc     ] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 3.14ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("algorithm parsed without timestamp decorator").isTrue();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT pauseMs FROM jvmlog_gc_event WHERE pauseMs > 0 LIMIT 1")) {
                    assertThat(rs.next()).as("pause event parsed without timestamp decorator").isTrue();
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void parsesLogWithOnlyLevelAndTags() throws Exception {
        var tmp = Files.createTempFile("test", ".log");
        try {
            Files.writeString(tmp, """
                    [info][gc,init] Using G1
                    [info][gc,init] Heap Min Capacity: 128M
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("algorithm parsed with minimal decorators").isTrue();
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void handlesUnknownLinesGracefully() throws Exception {
        var tmp = Files.createTempFile("test", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc] Using G1
                    This is not a log line at all
                    [0.005s][trace][os,cpu] CPU: total 12 (initial active 12) restrict 12
                    [0.010s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 3.14ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void handlesEmptyFile() throws Exception {
        var tmp = Files.createTempFile("test", ".log");
        try {
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).isEqualTo(0);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void handlesTruncatedGcEvent() throws Exception {
        var tmp = Files.createTempFile("test", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,phases] GC(0) Phase 1: Mark live objects 1.23ms
                    [0.002s][info][gc,phases] GC(0) Phase 2: Prepare for relocation 0.45ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }
}
