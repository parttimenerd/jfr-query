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

    // ------------------------------------------------------------------
    // Synthetic logs with actual GC events
    // ------------------------------------------------------------------

    @Test
    void g1NewInitFieldsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-g1-init-fields", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.001s][info][gc,init] CardTable entry size: 512
                    [0.001s][info][gc,init] Heap Region Size: 1M
                    [0.001s][info][gc,init] Concurrent Refinement Workers: 10
                    [0.001s][info][gc,init] Periodic GC: Disabled
                    [0.001s][info][gc,init] Pre-touch: Disabled
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT cardTableEntrySize FROM jvmlog_gc_init WHERE cardTableEntrySize IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("CardTable entry size parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(512);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT heapRegionSize FROM jvmlog_gc_init WHERE heapRegionSize IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Heap Region Size parsed").isTrue();
                    assertThat(rs.getLong(1)).isEqualTo(1024 * 1024L); // 1M
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT refinementWorkers FROM jvmlog_gc_init WHERE refinementWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Concurrent Refinement Workers parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(10);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT periodicGc FROM jvmlog_gc_init WHERE periodicGc IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Periodic GC parsed").isTrue();
                    assertThat(rs.getString(1)).isEqualTo("Disabled");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT preTouch FROM jvmlog_gc_init WHERE preTouch IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Pre-touch parsed").isTrue();
                    assertThat(rs.getString(1)).isEqualTo("Disabled");
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void parallelAlignmentsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-parallel-align", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Parallel
                    [0.001s][info][gc,init] Alignments: Space 512K, Generation 512K, Heap 8M
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT alignSpace, alignGeneration, alignHeap FROM jvmlog_gc_init WHERE alignSpace IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Alignments parsed").isTrue();
                    assertThat(rs.getLong("alignSpace")).isEqualTo(512 * 1024L);
                    assertThat(rs.getLong("alignGeneration")).isEqualTo(512 * 1024L);
                    assertThat(rs.getLong("alignHeap")).isEqualTo(8 * 1024 * 1024L);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcAddressSpaceFieldsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-zgc-addr", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] Address Space Size: unlimited
                    [0.005s][info][gc,init] Reserved Space Size: 4G
                    [0.005s][info][gc,init] Uncommit: Implicitly Disabled (-Xms equals -Xmx)
                    [0.005s][info][gc,init] Page Size Medium: Range [2M, 8M]
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT reservedSpaceSize FROM jvmlog_gc_init WHERE reservedSpaceSize IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Reserved Space Size parsed").isTrue();
                    assertThat(rs.getLong(1)).isEqualTo(4L * 1024 * 1024 * 1024);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT addressSpaceSize FROM jvmlog_gc_init WHERE addressSpaceSize IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Address Space Size parsed").isTrue();
                    assertThat(rs.getString(1)).isEqualTo("unlimited");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT uncommitPolicy FROM jvmlog_gc_init WHERE uncommitPolicy IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Uncommit policy parsed").isTrue();
                    assertThat(rs.getString(1)).contains("Disabled");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT pageSizeMedium FROM jvmlog_gc_init WHERE pageSizeMedium IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Page Size Medium parsed").isTrue();
                    assertThat(rs.getString(1)).contains("2M");
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void g1SyntheticLogProducesGcEvents() throws Exception {
        var tmp = Files.createTempFile("test-g1-events", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.002s][info][gc,init] Version: 25.0.3-graal (release)
                    [0.003s][info][gc,init] Heap Min Capacity: 256M
                    [0.003s][info][gc,init] Heap Initial Capacity: 256M
                    [0.003s][info][gc,init] Heap Max Capacity: 256M
                    [0.004s][debug][gc] ConcGCThreads: 3 offset 22
                    [0.004s][debug][gc] ParallelGCThreads: 10
                    [0.004s][debug][gc,heap] Minimum heap 268435456  Initial heap 268435456  Maximum heap 268435456
                    [1.234s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(256M) 12.34ms
                    [1.235s][info][gc,phases] GC(0)   Pre Evacuate Collection Set: 0.01ms
                    [1.235s][info][gc,phases] GC(0)   Merge Heap Roots: 0.12ms
                    [1.235s][info][gc,phases] GC(0)   Evacuate Collection Set: 10.23ms
                    [1.235s][info][gc,phases] GC(0)   Post Evacuate Collection Set: 1.44ms
                    [1.235s][info][gc,heap] GC(0) Heap: 128M(256M)->64M(256M)
                    [2.456s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 96M->48M(256M) 8.21ms
                    [2.456s][info][gc,heap] GC(1) Heap: 96M(256M)->48M(256M)
                    [3.789s][info][gc] GC(2) Pause Young (Concurrent Start) (Metadata GC Threshold) 192M->96M(256M) 15.67ms
                    [4.100s][info][gc] GC(3) Pause Full (System.gc()) 200M->50M(256M) 145.23ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE pauseMs > 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("G1 pause events parsed").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_heap_snapshot WHERE heapBefore > 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("G1 heap snapshots parsed").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase WHERE durationMs > 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("G1 phase timings parsed").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("G1 algorithm init row").isTrue();
                    assertThat(rs.getString(1)).isEqualTo("G1");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT parallelWorkers FROM jvmlog_gc_init WHERE parallelWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ParallelGCThreads debug line parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(10);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void g1HeapDebugLineProducesInitRow() throws Exception {
        var tmp = Files.createTempFile("test-g1-heap-debug", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][debug][gc,heap] Minimum heap 268435456  Initial heap 268435456  Maximum heap 536870912
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT minHeap, initialHeap, maxHeap FROM jvmlog_gc_init WHERE maxHeap IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("heap debug line parsed").isTrue();
                    assertThat(rs.getLong("minHeap")).as("minHeap").isEqualTo(268435456L);
                    assertThat(rs.getLong("maxHeap")).as("maxHeap").isEqualTo(536870912L);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void parallelSyntheticLogProducesGcEvents() throws Exception {
        var tmp = Files.createTempFile("test-parallel-events", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Parallel
                    [0.002s][info][gc,init] Heap Min Capacity: 128M
                    [0.002s][info][gc,init] Heap Initial Capacity: 512M
                    [0.002s][info][gc,init] Heap Max Capacity: 512M
                    [0.002s][info][gc,init] Parallel Workers: 8
                    [1.100s][info][gc] GC(0) Pause Young (Normal) (Allocation Failure) 256M->128M(512M) 55.12ms
                    [1.101s][info][gc,heap] GC(0) Heap: 256M(512M)->128M(512M)
                    [2.200s][info][gc] GC(1) Pause Young (Normal) (Allocation Failure) 384M->192M(512M) 62.44ms
                    [2.201s][info][gc,heap] GC(1) Heap: 384M(512M)->192M(512M)
                    [3.300s][info][gc] GC(2) Pause Full (System.gc()) 400M->100M(512M) 420.77ms
                    [3.301s][info][gc,heap] GC(2) Heap: 400M(512M)->100M(512M)
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE cause = 'Allocation Failure'")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("Parallel Allocation Failure events").isEqualTo(2);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT max(pauseMs) FROM jvmlog_gc_event")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getDouble(1)).as("Full GC pause").isGreaterThan(400.0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT parallelWorkers FROM jvmlog_gc_init WHERE parallelWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Parallel workers parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(8);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void serialSyntheticLogProducesGcEvents() throws Exception {
        var tmp = Files.createTempFile("test-serial-events", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Serial
                    [0.002s][info][gc,init] Heap Min Capacity: 64M
                    [0.002s][info][gc,init] Heap Max Capacity: 256M
                    [1.001s][info][gc] GC(0) Pause Young (Normal) (Allocation Failure) 32M->16M(256M) 8.33ms
                    [1.001s][info][gc,heap] GC(0) Heap: 32M(256M)->16M(256M)
                    [2.001s][info][gc] GC(1) Pause Young (Normal) (Allocation Failure) 64M->32M(256M) 9.11ms
                    [3.001s][info][gc] GC(2) Pause Full (Heap Inspection Initiated GC) 200M->40M(256M) 310.55ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE pauseMs > 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("Serial GC events parsed").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT algorithm FROM jvmlog_gc_init WHERE algorithm = 'Serial' LIMIT 1")) {
                    assertThat(rs.next()).as("Serial algorithm parsed").isTrue();
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcSyntheticLogProducesInitRows() throws Exception {
        var tmp = Files.createTempFile("test-zgc-init", ".log");
        try {
            Files.writeString(tmp, """
                    [0.004s][debug][gc,heap] Minimum heap 268435456  Initial heap 268435456  Maximum heap 268435456
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] NUMA Support: Disabled
                    [0.005s][info][gc,init] CPUs: 12 total, 12 available
                    [0.005s][info][gc,init] Memory: 49152M
                    [0.005s][info][gc,init] Large Page Support: Disabled
                    [0.005s][info][gc,init] Soft Max Capacity: 256M
                    [0.005s][info][gc,init] Min Capacity: 256M
                    [0.005s][info][gc,init] Initial Capacity: 256M
                    [0.005s][info][gc,init] Max Capacity: 256M
                    [0.005s][info][gc,init] GC Workers for Old Generation: 2 (dynamic)
                    [0.005s][info][gc,init] GC Workers for Young Generation: 2 (dynamic)
                    [0.005s][info][gc,init] GC Workers Max: 2 (dynamic)
                    [0.005s][info][gc,init] Runtime Workers: 2
                    [0.006s][info][gc,metaspace] Compressed class space mapped at: 0x00000fc000000000-0x00000fc040000000, reserved size: 1073741824
                    [0.006s][info][gc,metaspace] UseCompressedClassPointers 1, UseCompactObjectHeaders 0
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT algorithm FROM jvmlog_gc_init WHERE algorithm = 'ZGC' LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC algorithm from Initializing line").isTrue();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT numaSupport FROM jvmlog_gc_init WHERE numaSupport IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("NUMA support parsed").isTrue();
                    assertThat(rs.getString(1)).isEqualTo("Disabled");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT cpuTotal, cpuAvailable FROM jvmlog_gc_init WHERE cpuTotal IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("CPUs parsed").isTrue();
                    assertThat(rs.getInt("cpuTotal")).isEqualTo(12);
                    assertThat(rs.getInt("cpuAvailable")).isEqualTo(12);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT physicalMemory FROM jvmlog_gc_init WHERE physicalMemory IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Memory parsed").isTrue();
                    // 49152M in bytes
                    assertThat(rs.getLong(1)).isEqualTo(49152L * 1024 * 1024);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT workersOldGen FROM jvmlog_gc_init WHERE workersOldGen IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC old gen workers parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(2);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT runtimeWorkers FROM jvmlog_gc_init WHERE runtimeWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Runtime workers parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(2);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT useCompressedClassPointers FROM jvmlog_gc_init WHERE useCompressedClassPointers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("gc,metaspace flags parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(1);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcSyntheticLogProducesGcEvents() throws Exception {
        var tmp = Files.createTempFile("test-zgc-events", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] Min Capacity: 256M
                    [0.005s][info][gc,init] Max Capacity: 4096M
                    [1.200s][info][gc] GC(0) Garbage Collection (Allocation Rate) 512M(12%)->256M(6%)
                    [1.201s][info][gc] GC(0) Concurrent Mark 45.123ms
                    [1.201s][info][gc] GC(0) Concurrent Select Relocation Set 2.456ms
                    [1.202s][info][gc] GC(0) Concurrent Relocate 12.789ms
                    [2.400s][info][gc] GC(1) Garbage Collection (Allocation Rate) 1024M(24%)->512M(12%)
                    [2.401s][info][gc] GC(1) Concurrent Mark 55.678ms
                    [2.401s][info][gc] GC(1) Concurrent Relocate 18.234ms
                    [3.600s][info][gc] GC(2) Garbage Collection (Proactive) 768M(18%)->384M(9%)
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE gcType = 'Garbage Collection'")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("ZGC collection events").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase WHERE phaseName IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("ZGC concurrent phase rows").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT cause FROM jvmlog_gc_event WHERE cause = 'Allocation Rate' LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC cause 'Allocation Rate' parsed").isTrue();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT cause FROM jvmlog_gc_event WHERE cause = 'Proactive' LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC cause 'Proactive' parsed").isTrue();
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcGenerationalSyntheticLogProducesMinorMajorEvents() throws Exception {
        var tmp = Files.createTempFile("test-zgc-gen", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Using The Z Garbage Collector
                    [0.005s][info][gc,init] GC Workers for Old Generation: 2 (dynamic)
                    [0.005s][info][gc,init] GC Workers for Young Generation: 4 (dynamic)
                    [1.100s][info][gc] GC(0) Minor Collection (Allocation Rate) 128M(12%)->64M(6%)
                    [1.101s][info][gc] GC(0) Concurrent Mark Young 10.123ms
                    [1.101s][info][gc] GC(0) Concurrent Select Relocation Set Young 1.234ms
                    [1.101s][info][gc] GC(0) Concurrent Relocate Young 5.678ms
                    [5.200s][info][gc] GC(1) Major Collection (Proactive) 800M(75%)->400M(37%)
                    [5.201s][info][gc] GC(1) Concurrent Mark 95.432ms
                    [5.201s][info][gc] GC(1) Concurrent Relocate 45.678ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                // Both Minor/Major Collection lines should land in gc_event or gc_phase
                // The ZGC concurrent phase pattern handles "GC(N) Concurrent ..." lines
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase WHERE phaseName IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("ZGC Gen concurrent phase rows").isGreaterThan(0);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT workersOldGen FROM jvmlog_gc_init WHERE workersOldGen IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC Gen old workers parsed").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(2);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void mixedGcLogWithHeapAndPhases() throws Exception {
        var tmp = Files.createTempFile("test-mixed-gc", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.002s][info][gc,init] Heap Max Capacity: 1G
                    [0.002s][info][gc,init] Parallel Workers: 12
                    [0.002s][info][gc,init] Concurrent Workers: 3
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 256M->128M(1024M) 15.22ms
                    [1.001s][info][gc,phases] GC(0)   Pre Evacuate Collection Set: 0.02ms
                    [1.001s][info][gc,phases] GC(0)   Merge Heap Roots: 0.15ms
                    [1.001s][info][gc,phases] GC(0)   Evacuate Collection Set: 12.34ms
                    [1.001s][info][gc,phases] GC(0)   Post Evacuate Collection Set: 2.01ms
                    [1.001s][info][gc,phases] GC(0)   Other: 0.70ms
                    [1.001s][info][gc,heap] GC(0) Heap: 256M(1024M)->128M(1024M)
                    [1.001s][debug][gc,region] GC(0) Eden regions: 100->0(150)
                    [2.000s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 384M->192M(1024M) 22.10ms
                    [2.001s][info][gc,heap] GC(1) Heap: 384M(1024M)->192M(1024M)
                    [2.001s][debug][gc,region] GC(1) Eden regions: 150->0(200)
                    [2.002s][debug][gc,ergo,heap] Expand the heap. requested expansion amount: 104857600B expansion amount: 104857600B
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                // gc_event
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE gcId IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("GC events with gcId").isEqualTo(2);
                }
                // gc_phase
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase WHERE gcId = 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("G1 phases for GC(0)").isEqualTo(5);
                }
                // heap_snapshot
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT heapAfter FROM jvmlog_heap_snapshot WHERE gcId = 0 LIMIT 1")) {
                    assertThat(rs.next()).as("Heap snapshot for GC(0)").isTrue();
                    assertThat(rs.getLong(1)).as("heapAfter GC(0)").isEqualTo(128L * 1024 * 1024);
                }
                // g1_regions
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT edenBefore, edenAfter FROM jvmlog_g1_regions WHERE gcId = 0 LIMIT 1")) {
                    assertThat(rs.next()).as("G1 regions for GC(0)").isTrue();
                    assertThat(rs.getInt("edenBefore")).isEqualTo(100);
                    assertThat(rs.getInt("edenAfter")).isEqualTo(0);
                }
                // g1_ergonomics
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT actualExpansionBytes FROM jvmlog_g1_ergonomics WHERE decision = 'expand' LIMIT 1")) {
                    assertThat(rs.next()).as("G1 ergonomics expand row").isTrue();
                    assertThat(rs.getLong(1)).isEqualTo(104857600L);
                }
                // gc_init workers
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT parallelWorkers FROM jvmlog_gc_init WHERE parallelWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("parallel workers").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(12);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT concurrentWorkers FROM jvmlog_gc_init WHERE concurrentWorkers IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("concurrent workers").isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(3);
                }
                // max heap = 1G = 1073741824 bytes
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT maxHeap FROM jvmlog_gc_init WHERE maxHeap IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("max heap").isTrue();
                    assertThat(rs.getLong(1)).isEqualTo(1073741824L);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void gcSummaryViewOnSyntheticLog() throws Exception {
        var tmp = Files.createTempFile("test-view-query", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 12.34ms
                    [2.000s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 20M->10M(256M) 15.67ms
                    [3.000s][info][gc] GC(2) Pause Young (Normal) (Metadata GC Threshold) 30M->15M(256M) 9.11ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
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
                    try (var rs = st.executeQuery("SELECT gcCount, avgPauseMs FROM \"jvmlog-gc-summary\" LIMIT 1")) {
                        assertThat(rs.next()).isTrue();
                        assertThat(rs.getLong("gcCount")).as("GC summary count").isEqualTo(3);
                        assertThat(rs.getDouble("avgPauseMs")).as("average pause").isGreaterThan(0.0);
                    }
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void heapTimelineViewOnSyntheticLog() throws Exception {
        var tmp = Files.createTempFile("test-heap-timeline", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 12.34ms
                    [1.001s][info][gc,heap] GC(0) Heap: 128M(256M)->64M(256M)
                    [2.000s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 20M->10M(256M) 8.90ms
                    [2.001s][info][gc,heap] GC(1) Heap: 192M(256M)->96M(256M)
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement()) {
                    st.execute("""
                        CREATE VIEW "jvmlog-heap-timeline" AS
                        SELECT h.gcId,
                               round(h.heapBefore / 1048576.0, 2) AS heapBeforeMB,
                               round(h.heapAfter / 1048576.0, 2) AS heapAfterMB,
                               e.pauseMs
                        FROM jvmlog_heap_snapshot h
                        LEFT JOIN jvmlog_gc_event e ON h.gcId = e.gcId
                        ORDER BY h.gcId
                        """);
                    try (var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-heap-timeline\"")) {
                        assertThat(rs.next()).isTrue();
                        assertThat(rs.getLong(1)).as("heap timeline rows").isEqualTo(2);
                    }
                    try (var rs = st.executeQuery("SELECT heapBeforeMB, pauseMs FROM \"jvmlog-heap-timeline\" WHERE gcId = 0 LIMIT 1")) {
                        assertThat(rs.next()).as("timeline row for GC(0)").isTrue();
                        assertThat(rs.getDouble("heapBeforeMB")).as("heap before in MB").isEqualTo(128.0);
                        assertThat(rs.getDouble("pauseMs")).as("pauseMs from join").isGreaterThan(0.0);
                    }
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }
}
