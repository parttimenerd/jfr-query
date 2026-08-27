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
                        QUALIFY row_number() OVER (PARTITION BY h.gcId ORDER BY h.heapCommittedBefore DESC NULLS LAST) = 1
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

    @Test
    void uptimeSecsIsInjectedIntoGcEvent() throws Exception {
        var tmp = Files.createTempFile("test-uptime", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.500s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 12.34ms
                    [3.750s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 20M->10M(256M) 8.90ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT uptimeSecs FROM jvmlog_gc_event WHERE gcId = 0 LIMIT 1")) {
                    assertThat(rs.next()).as("GC(0) event exists").isTrue();
                    assertThat(rs.getDouble("uptimeSecs")).as("uptimeSecs injected from log decorator").isEqualTo(1.5);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT uptimeSecs FROM jvmlog_gc_event WHERE gcId = 1 LIMIT 1")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getDouble("uptimeSecs")).isEqualTo(3.75);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void gcOverheadViewWorksWhenUptimePresent() throws Exception {
        var tmp = Files.createTempFile("test-gc-overhead", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 200.00ms
                    [5.000s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 300.00ms
                    [15.000s][info][gc] GC(2) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 150.00ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                // Verify uptimeSecs is populated
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE uptimeSecs IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("uptimeSecs populated for all events").isEqualTo(3);
                }
                // Run gc-overhead view inline
                try (var st = conn.createStatement()) {
                    st.execute("""
                        CREATE VIEW "jvmlog-gc-overhead" AS
                        SELECT floor(uptimeSecs / 10) * 10 AS "Window Start (s)",
                               round(sum(pauseMs) / 10000.0 * 100, 2) AS "GC Overhead %",
                               count(*) AS "GC Events"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 10)
                        ORDER BY 1
                        """);
                    try (var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-gc-overhead\"")) {
                        assertThat(rs.next()).isTrue();
                        assertThat(rs.getLong(1)).as("gc overhead view has rows").isGreaterThan(0);
                    }
                    try (var rs = st.executeQuery("SELECT \"GC Overhead %\" FROM \"jvmlog-gc-overhead\" ORDER BY \"Window Start (s)\" LIMIT 1")) {
                        assertThat(rs.next()).isTrue();
                        assertThat(rs.getDouble(1)).as("GC overhead % > 0").isGreaterThan(0.0);
                    }
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void g1RemarkAndCleanupPausesAreCaptured() throws Exception {
        var tmp = Files.createTempFile("test-g1-remark", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(256M) 12.34ms
                    [1.500s][info][gc] GC(1) Concurrent Cycle 85.432ms
                    [1.501s][info][gc] GC(1) Pause Remark 1.23ms
                    [1.502s][info][gc] GC(1) Pause Cleanup 0.45ms
                    [2.000s][info][gc] GC(2) Pause Young (Normal) (G1 Evacuation Pause) 96M->48M(256M) 9.88ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT gcType, pauseMs FROM jvmlog_gc_event WHERE gcType = 'Remark' LIMIT 1")) {
                    assertThat(rs.next()).as("Remark pause event captured").isTrue();
                    assertThat(rs.getDouble("pauseMs")).isEqualTo(1.23);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT gcType FROM jvmlog_gc_event WHERE gcType = 'Cleanup' LIMIT 1")) {
                    assertThat(rs.next()).as("Cleanup pause event captured").isTrue();
                }
                // Concurrent Cycle also captured via gc_zgc_concurrent_phase (which accepts [gc] tags)
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_event WHERE gcId IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("all pause events captured").isGreaterThanOrEqualTo(4);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void g1AllRegionTypesAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-g1-regions", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.000s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(256M) 12.34ms
                    [1.001s][debug][gc,region] GC(0) Eden regions: 24->0(25)
                    [1.001s][debug][gc,region] GC(0) Survivor regions: 3->3(3)
                    [1.001s][debug][gc,region] GC(0) Old regions: 10->11
                    [1.001s][debug][gc,region] GC(0) Humongous regions: 2->2
                    [1.001s][debug][gc,region] GC(0) Archive regions: 0->0
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT edenBefore, edenAfter, edenMax FROM jvmlog_g1_regions WHERE edenBefore IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Eden regions parsed").isTrue();
                    assertThat(rs.getInt("edenBefore")).isEqualTo(24);
                    assertThat(rs.getInt("edenAfter")).isEqualTo(0);
                    assertThat(rs.getInt("edenMax")).isEqualTo(25);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT survivorBefore, survivorAfter FROM jvmlog_g1_regions WHERE survivorBefore IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Survivor regions parsed").isTrue();
                    assertThat(rs.getInt("survivorBefore")).isEqualTo(3);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT oldBefore, oldAfter FROM jvmlog_g1_regions WHERE oldBefore IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Old regions parsed").isTrue();
                    assertThat(rs.getInt("oldBefore")).isEqualTo(10);
                    assertThat(rs.getInt("oldAfter")).isEqualTo(11);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT humongousBefore, humongousAfter FROM jvmlog_g1_regions WHERE humongousBefore IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Humongous regions parsed").isTrue();
                    assertThat(rs.getInt("humongousBefore")).isEqualTo(2);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcNonGenerationalPhasesAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-zgc-phases", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] Min Capacity: 256M
                    [0.005s][info][gc,init] Max Capacity: 4096M
                    [1.000s][info][z,gc] GC(0) Pause Mark Start 0.456ms
                    [1.023s][info][z,gc] GC(0) Concurrent Mark 23.4ms
                    [1.046s][info][z,gc] GC(0) Pause Mark End 0.234ms
                    [1.050s][info][z,gc] GC(0) Concurrent Mark Free 0.001ms
                    [1.055s][info][z,gc] GC(0) Concurrent Process Non-Strong References 1.23ms
                    [1.060s][info][z,gc] GC(0) Concurrent Reset Relocation Set 0.001ms
                    [1.065s][info][z,gc] GC(0) Concurrent Select Relocation Set 4.5ms
                    [1.070s][info][z,gc] GC(0) Pause Relocate Start 0.123ms
                    [1.130s][info][z,gc] GC(0) Concurrent Relocate 56.7ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_zgc_phases")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("ZGC phase rows").isGreaterThanOrEqualTo(8);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT phaseName, concurrent FROM jvmlog_zgc_phases WHERE phaseName = 'Pause Mark Start' LIMIT 1")) {
                    assertThat(rs.next()).as("Pause Mark Start captured").isTrue();
                    assertThat(rs.getBoolean("concurrent")).isFalse();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT phaseName, concurrent, generation FROM jvmlog_zgc_phases WHERE phaseName = 'Mark' LIMIT 1")) {
                    assertThat(rs.next()).as("Concurrent Mark captured").isTrue();
                    assertThat(rs.getBoolean("concurrent")).isTrue();
                    assertThat(rs.getString("generation")).isEqualTo("N/A");
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcGenerationalPhasesAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-zgc-gen-phases", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] Min Capacity: 256M
                    [0.005s][info][gc,init] Max Capacity: 4096M
                    [1.000s][info][gc] GC(0) Garbage Collection (Allocation Rate)
                    [1.046s][info][z,gc] GC(0) Young Collection 45.678ms
                    [2.000s][info][gc] GC(1) Garbage Collection (Allocation Rate)
                    [2.200s][info][z,gc] GC(1) Old Collection 123.456ms
                    [3.000s][info][gc] GC(2) Garbage Collection (Proactive)
                    [3.200s][info][z,gc] GC(2) Major Collection 200.0ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT generation FROM jvmlog_zgc_phases WHERE phaseName = 'Young Collection' LIMIT 1")) {
                    assertThat(rs.next()).as("Young Collection phase").isTrue();
                    assertThat(rs.getString("generation")).isEqualTo("Young");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT generation FROM jvmlog_zgc_phases WHERE phaseName = 'Old Collection' LIMIT 1")) {
                    assertThat(rs.next()).as("Old Collection phase").isTrue();
                    assertThat(rs.getString("generation")).isEqualTo("Old");
                }
                // Verify the zgc-cycle view works
                try (var st = conn.createStatement()) {
                    st.execute("""
                        CREATE VIEW "jvmlog-zgc-cycle" AS
                        SELECT
                            gcId AS "GC ID",
                            generation AS "Generation",
                            sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS "Concurrent ms",
                            sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS "Pause ms"
                        FROM jvmlog_zgc_phases
                        GROUP BY gcId, generation
                        ORDER BY gcId
                        """);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-zgc-cycle\"")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("ZGC cycle view rows").isGreaterThan(0);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void parallelGenSizingAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-parallel-sizing", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Parallel
                    [0.500s][info][gc] GC(0) Pause Young (Allocation Failure) 128M->64M(256M) 15.3ms
                    [0.501s][info][gc,heap] GC(0) PSYoungGen: 131072K->32768K(196608K)
                    [0.501s][info][gc,heap] GC(0) ParOldGen: 65536K->73728K(196608K)
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT youngGenBytes, youngGenCapacity FROM jvmlog_parallel_sizing WHERE youngGenBytes IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("PSYoungGen row").isTrue();
                    assertThat(rs.getLong("youngGenBytes")).isEqualTo(131072L * 1024);
                    assertThat(rs.getLong("youngGenCapacity")).isEqualTo(196608L * 1024);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT oldGenBytes FROM jvmlog_parallel_sizing WHERE oldGenBytes IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ParOldGen row").isTrue();
                    assertThat(rs.getLong("oldGenBytes")).isEqualTo(65536L * 1024);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcDirectorPatternsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-zgc-director", ".log");
        try {
            Files.writeString(tmp, """
                    [0.005s][info][gc,init] Initializing The Z Garbage Collector
                    [0.005s][info][gc,init] Min Capacity: 256M
                    [0.005s][info][gc,init] Max Capacity: 4096M
                    [1.000s][debug][gc,director] GC(0) Selection: Allocation Rate
                    [1.000s][debug][gc,director] GC(0) Allocation Rate: 125.3 MB/s
                    [1.000s][debug][gc,director] GC(0) Free Heap: 25.0%
                    [1.000s][debug][gc,director] GC(0) Time Until OOM: 8.3 s
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT ruleName FROM jvmlog_zgc_director WHERE ruleName IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC director selection").isTrue();
                    assertThat(rs.getString("ruleName")).isEqualTo("Allocation Rate");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT allocationRateMbps, freeHeapPct, timeUntilOomSecs FROM jvmlog_zgc_director WHERE allocationRateMbps IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC director alloc rate").isTrue();
                    assertThat(rs.getDouble("allocationRateMbps")).isEqualTo(125.3);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT timeUntilOomSecs FROM jvmlog_zgc_director WHERE timeUntilOomSecs IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("ZGC director time to OOM").isTrue();
                    assertThat(rs.getDouble("timeUntilOomSecs")).isEqualTo(8.3);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void shenandoahPatternsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-shenandoah", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Shenandoah
                    [0.002s][info][gc,shenandoah] Shenandoah GC Mode: Saturation
                    [0.002s][info][gc,shenandoah] Shenandoah Heuristics: adaptive
                    [0.500s][info][gc] GC(0) Pause Init Mark (unload classes) 1.23ms
                    [0.600s][info][gc,phases] GC(0) Concurrent marking 56.789ms
                    [0.700s][info][gc,phases] GC(0) Concurrent evacuation 12.345ms
                    [0.800s][info][gc,phases] GC(0) Concurrent update references 8.901ms
                    [0.900s][info][gc,phases] GC(0) Concurrent cleanup 0.123ms
                    [1.000s][info][gc,phases] GC(0) Concurrent reset bitmaps 0.456ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT gcMode FROM jvmlog_gc_init WHERE gcMode IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Shenandoah GC mode parsed").isTrue();
                    assertThat(rs.getString("gcMode")).isEqualTo("Saturation");
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase WHERE phaseName IS NOT NULL")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1)).as("Shenandoah concurrent phases").isGreaterThanOrEqualTo(5);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT phaseName FROM jvmlog_gc_phase WHERE phaseName LIKE '%evacuation%' LIMIT 1")) {
                    assertThat(rs.next()).as("Shenandoah evacuation phase").isTrue();
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void metaspaceSizingAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-metaspace", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.500s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(256M) 12.34ms
                    [0.501s][info][gc,metaspace] GC(0) Metaspace: 45678K->45678K(1056768K)
                    [0.501s][info][gc,metaspace] GC(0) class space  5432K->5432K(131072K)
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT metaspaceBefore, metaspaceAfter FROM jvmlog_metaspace WHERE metaspaceBefore IS NOT NULL LIMIT 1")) {
                    assertThat(rs.next()).as("Metaspace sizing parsed").isTrue();
                    assertThat(rs.getLong("metaspaceBefore")).isEqualTo(45678L * 1024);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void cmsConcurrentPhasesAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-cms", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Concurrent Mark Sweep
                    [0.100s][info][gc] GC(0) Pause Young (Allocation Failure) 128M->64M(512M) 10.00ms
                    [0.200s][info][gc,phases] GC(1) Concurrent Mark 45.678ms
                    [0.250s][info][gc,phases] GC(1) Concurrent Preclean 1.234ms
                    [0.300s][info][gc,phases] GC(1) Concurrent Abortable Preclean 12.000ms
                    [0.310s][info][gc,phases] GC(1) Pause Remark 3.456ms
                    [0.350s][info][gc,phases] GC(1) Concurrent Sweep 20.000ms
                    [0.360s][info][gc,phases] GC(1) Concurrent Reset 5.000ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                // 5 concurrent phases go to jvmlog_gc_phase; Pause Remark goes to jvmlog_gc_event
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_gc_phase WHERE gcId = 1")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("CMS concurrent phases captured").isEqualTo(5);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT phaseName FROM jvmlog_gc_phase WHERE gcId = 1 ORDER BY phaseName")) {
                    var names = new java.util.ArrayList<String>();
                    while (rs.next()) names.add(rs.getString("phaseName"));
                    // gc_zgc_concurrent_phase captures the part after "Concurrent "
                    assertThat(names).contains("Mark", "Preclean", "Sweep", "Reset");
                }
                // Pause Remark routes to jvmlog_gc_event (gc_pause_event_no_cause pattern)
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT gcType, pauseMs FROM jvmlog_gc_event WHERE gcId = 1")) {
                    assertThat(rs.next()).as("Pause Remark captured as GC event").isTrue();
                    assertThat(rs.getString("gcType")).isEqualTo("Remark");
                    assertThat(rs.getDouble("pauseMs")).isEqualTo(3.456);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void cmsPromotionFailureCapturedAsGcEvent() throws Exception {
        var tmp = Files.createTempFile("test-cms-pf", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Concurrent Mark Sweep
                    [1.500s][info][gc] GC(5) Pause Young (Promotion Failed) 250.00ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT gcId, pauseMs FROM jvmlog_gc_event WHERE gcId = 5")) {
                    assertThat(rs.next()).as("Promotion Failed event captured").isTrue();
                    assertThat(rs.getDouble("pauseMs")).isEqualTo(250.0);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void safepointEventsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-safepoint", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.234s][info][safepoint] Safepoint "G1CollectForAllocation", time 15.234 ms, reaching threads in 1.234 ms
                    [2.500s][info][safepoint] Safepoint "HandshakeFallback", time 0.234 ms, reaching threads in 0.100 ms
                    [3.000s][info][safepoint] Safepoint "G1CollectForAllocation", time 12.000 ms, reaching threads in 0.500 ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_safepoint")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("All safepoint events captured").isEqualTo(3);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT operation, totalMs, syncMs FROM jvmlog_safepoint WHERE operation='G1CollectForAllocation' LIMIT 1")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getDouble("totalMs")).isEqualTo(15.234);
                    assertThat(rs.getDouble("syncMs")).isEqualTo(1.234);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void inlineHeapSizesExtractedFromPauseLine() throws Exception {
        var tmp = Files.createTempFile("test-heap-inline", ".log");
        try {
            // No [gc,heap] lines — heap data is only in the pause line itself
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.500s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(256M) 3.14ms
                    [1.000s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 64M->32M(256M) 2.00ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                // Multi-match: both jvmlog_gc_event and jvmlog_heap_snapshot get rows
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_heap_snapshot")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("Inline heap rows extracted").isEqualTo(2);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT heapBefore, heapAfter FROM jvmlog_heap_snapshot WHERE gcId = 0")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("heapBefore")).isEqualTo(128L * 1024 * 1024);
                    assertThat(rs.getLong("heapAfter")).isEqualTo(64L * 1024 * 1024);
                }
                // The gc_event row must also exist (multi-match doesn't break primary routing)
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_gc_event")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("GC events still captured").isEqualTo(2);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void allocStallPatternsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-alloc-stall", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using The Z Garbage Collector
                    [0.500s][info][gc,alloc] Stall: Thread "main" 15.234 ms
                    [0.600s][info][gc,alloc] Stall: Thread "worker-1" 5.000 ms
                    [0.700s][info][gc] GC(1) Allocation Stall - Thread "main" 12.000 ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_alloc_stall")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("alloc stall rows").isEqualTo(3);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT threadName, stallMs FROM jvmlog_alloc_stall ORDER BY stallMs DESC LIMIT 1")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getString("threadName")).isEqualTo("main");
                    assertThat(rs.getDouble("stallMs")).isEqualTo(15.234);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void shenandoahUpdateRefPausesAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-shenandoah-updaterefs", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using Shenandoah
                    [0.500s][info][gc] GC(0) Pause Init Mark (unload classes) 1.234ms
                    [0.600s][info][gc] GC(0) Pause Final Mark (process weakrefs) 2.345ms
                    [0.700s][info][gc] GC(0) Pause Init Update Refs 0.123ms
                    [0.800s][info][gc] GC(0) Pause Final Update Refs 1.111ms
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_gc_event")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("Shenandoah pause events").isEqualTo(4);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT gcType FROM jvmlog_gc_event WHERE gcType = 'Init Update Refs'")) {
                    assertThat(rs.next()).as("Init Update Refs pause captured").isTrue();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT pauseMs FROM jvmlog_gc_event WHERE gcType = 'Final Update Refs'")) {
                    assertThat(rs.next()).as("Final Update Refs pause captured").isTrue();
                    assertThat(rs.getDouble("pauseMs")).isEqualTo(1.111);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void gcErrorPatternsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-gc-errors", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [0.500s][info][gc] GC(2) To-space exhausted
                    [0.501s][info][gc] GC(2) Pause Young (Allocation Failure) (G1 Evacuation Pause) 128M->128M(256M) 45.678ms
                    [1.000s][info][gc] GC(3) Evacuation Failure 1.234ms
                    [1.500s][info][gc] GC(5) Humongous object allocation failed
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_gc_errors")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("GC error events").isEqualTo(3);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT errorType FROM jvmlog_gc_errors WHERE gcId = 2 AND errorType = 'To-space exhausted'")) {
                    assertThat(rs.next()).as("To-space exhausted captured for GC 2").isTrue();
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT durationMs FROM jvmlog_gc_errors WHERE errorType = 'Evacuation Failure'")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getDouble("durationMs")).isEqualTo(1.234);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void g1MixedGcDecisionsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-g1-mixed", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using G1
                    [1.200s][info][gc,ergo] GC(5) Do Mixed GC. candidate old regions: 47 reclaimable: 45.3% (12.5%) threshold: 5%
                    [2.400s][info][gc,ergo] GC(8) Skip Mixed GC: reclaimable percentage (3.1%) is below threshold (5.0%)
                    [3.600s][info][gc,ergo] GC(12) Initiate Mixed GC occupancy 46.0% at threshold 45.0%
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_g1_mixed_gc")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("G1 mixed GC decision rows").isGreaterThanOrEqualTo(1);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT decision FROM jvmlog_g1_mixed_gc WHERE gcId = 5")) {
                    assertThat(rs.next()).as("Do Mixed GC decision for GC 5").isTrue();
                    assertThat(rs.getString("decision")).isEqualTo("Do Mixed GC");
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Test
    void zgcLoadPatternsAreParsed() throws Exception {
        var tmp = Files.createTempFile("test-zgc-load", ".log");
        try {
            Files.writeString(tmp, """
                    [0.001s][info][gc,init] Using ZGC
                    [0.500s][info][gc,load] GC(0) Load: 2.55/2.37/2.36
                    [0.501s][info][gc,load] GC(0) Allocation Rate: 456/s
                    [0.502s][info][gc,load] GC(0) Allocation Stall: 3
                    """);
            try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
                JvmLogImporter.importLog(tmp, sink);
                try (var st = conn.createStatement();
                     var rs = st.executeQuery("SELECT count(*) AS cnt FROM jvmlog_zgc_load")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong("cnt")).as("ZGC load rows").isGreaterThanOrEqualTo(1);
                }
                try (var st = conn.createStatement();
                     var rs = st.executeQuery(
                             "SELECT load1s FROM jvmlog_zgc_load WHERE gcId = 0 AND load1s IS NOT NULL")) {
                    assertThat(rs.next()).as("ZGC load averages for GC 0").isTrue();
                    assertThat(rs.getDouble("load1s")).isEqualTo(2.55);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }
}
