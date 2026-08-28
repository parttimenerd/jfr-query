package me.bechberger.jfr.duckdb.definitions;

import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import static org.assertj.core.api.Assertions.*;

class JvmlogViewsTest {

    private static final Set<String> JVMLOG_VIEW_NAMES = Set.of(
            "jvmlog-gc-summary", "jvmlog-pause-percentiles", "jvmlog-gc-overhead",
            "jvmlog-heap-timeline", "jvmlog-heap-snapshot-raw", "jvmlog-phase-breakdown",
            "jvmlog-phase-timeline", "jvmlog-g1-regions", "jvmlog-zgc-cycle", "jvmlog-jfr-correlation",
            "jvmlog-gc-pause-summary", "jvmlog-gc-pause-by-type", "jvmlog-gc-phase-breakdown",
            "jvmlog-gc-init-summary", "jvmlog-gc-cumulative-pause", "jvmlog-g1-heap-expansion",
            "jvmlog-unknown-summary", "jvmlog-metaspace-timeline",
            "jvmlog-parallel-sizing", "jvmlog-stringdedup-summary", "jvmlog-zgc-director-summary",
            "jvmlog-safepoint-summary", "jvmlog-safepoint-timeline", "jvmlog-alloc-stall-summary",
            "jvmlog-gc-errors", "jvmlog-gc-error-summary", "jvmlog-pause-percentiles-by-cause",
            "jvmlog-combined-timeline", "jvmlog-alloc-stall-timeline", "jvmlog-heap-efficiency",
            "jvmlog-longest-pauses",
            "jvmlog-g1-mixed-gc", "jvmlog-g1-mixed-gc-summary",
            "jvmlog-zgc-load",
            "jvmlog-pause-histogram", "jvmlog-gc-frequency", "jvmlog-gc-pressure-timeline",
            "jvmlog-problematic-gcs", "jvmlog-g1-cycle-detail",
            "jvmlog-zgc-cycle-detail",
            "jvmlog-gc-error-timeline", "jvmlog-metaspace-detail",
            "jvmlog-shenandoah-cycle-detail", "jvmlog-shenandoah-free-timeline",
            "jvmlog-zgc-stats",
            "jvmlog-gc-worker-summary", "jvmlog-gc-worker-timeline",
            "jvmlog-throughput-summary", "jvmlog-gc-interval", "jvmlog-gc-interval-stats",
            "jvmlog-pause-sla", "jvmlog-cause-distribution", "jvmlog-throughput-timeline",
            "jvmlog-heap-growth-trend", "jvmlog-heap-growth-summary",
            "jvmlog-allocation-rate", "jvmlog-gc-type-breakdown", "jvmlog-full-gc-analysis",
            "jvmlog-g1-humongous", "jvmlog-parallel-gc-detail", "jvmlog-gc-health-score",
            "jvmlog-gc-recommendations", "jvmlog-zgc-generational",
            "jvmlog-concurrent-overhead", "jvmlog-gc-log-quality",
            "jvmlog-heap-resize-summary", "jvmlog-allocation-rate-timeline",
            "jvmlog-pause-regression", "jvmlog-zgc-allocation-rate",
            "jvmlog-top-pauses-by-cause", "jvmlog-shenandoah-mode-analysis",
            "jvmlog-phase-top-slow",
            "jvmlog-gc-efficiency-by-cause", "jvmlog-metaspace-growth-trend",
            "jvmlog-oom-risk-estimate", "jvmlog-g1-mark-trend",
            "jvmlog-heap-fragmentation", "jvmlog-heap-reclaim-ratio",
            "jvmlog-throughput-degradation", "jvmlog-g1-old-region-trend"
    );

    @Test
    void allJvmlogViewsAreRegistered() {
        Set<String> registered = ViewCollection.getViews().stream()
                .map(View::name)
                .collect(Collectors.toSet());
        assertThat(registered).containsAll(JVMLOG_VIEW_NAMES);
    }

    @Test
    void viewsDoNotRegisterWhenTablesAbsent() {
        Set<String> empty = Set.of();
        for (View v : ViewCollection.getViews()) {
            if (JVMLOG_VIEW_NAMES.contains(v.name())) {
                assertThat(v.isValid(empty))
                        .as("view %s should NOT be valid with no tables", v.name())
                        .isFalse();
            }
        }
    }

    @Test
    void gcSummaryViewRegistersWhenTablePresent() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId BIGINT, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
        }
        View summaryView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-summary not found"));
        assertThat(summaryView.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = summaryView.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            assertThatCode(() -> s.execute(query)).doesNotThrowAnyException();
        }
        conn.close();
    }

    @Test
    void gcInitSummaryViewExecutesWithNewColumns() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        // Create gc_init table with all columns the view references
        try (Statement s = conn.createStatement()) {
            s.execute("""
                CREATE TABLE jvmlog_gc_init (
                    algorithm VARCHAR,
                    jdkVersion VARCHAR,
                    minHeap BIGINT,
                    initialHeap BIGINT,
                    maxHeap BIGINT,
                    softMaxCapacity BIGINT,
                    parallelWorkers INT,
                    concurrentWorkers INT,
                    workersOldGen INT,
                    workersYoungGen INT,
                    runtimeWorkers INT,
                    refinementWorkers INT,
                    cpuTotal INT,
                    physicalMemory BIGINT,
                    numaSupport VARCHAR,
                    heapRegionSize BIGINT,
                    periodicGc VARCHAR,
                    preTouch VARCHAR
                )
                """);
            s.execute("""
                INSERT INTO jvmlog_gc_init (algorithm, jdkVersion, minHeap, maxHeap,
                    parallelWorkers, cpuTotal, numaSupport, periodicGc, preTouch)
                VALUES ('G1', '25.0.3', 268435456, 268435456, 10, 12, 'Disabled', 'Disabled', 'Disabled')
                """);
        }
        View initView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-init-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-init-summary not found"));
        assertThat(initView.isValid(Set.of("jvmlog_gc_init"))).isTrue();
        String query = initView.getBestMatchingQuery(Set.of("jvmlog_gc_init"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query); // CREATE VIEW
            var rs = s.executeQuery("SELECT \"Algorithm\", \"Parallel Workers\", \"CPUs\" FROM \"jvmlog-gc-init-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Algorithm")).isEqualTo("G1");
            assertThat(rs.getInt("Parallel Workers")).isEqualTo(10);
            assertThat(rs.getInt("CPUs")).isEqualTo(12);
        }
        conn.close();
    }

    @Test
    void zgcCycleViewExecutesWithPhaseData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("""
                CREATE TABLE jvmlog_zgc_phases (
                    gcId INTEGER,
                    durationMs DOUBLE,
                    phaseName VARCHAR,
                    generation VARCHAR,
                    concurrent BOOLEAN
                )
                """);
            s.execute("""
                INSERT INTO jvmlog_zgc_phases VALUES
                    (0, 45.6, 'Young Collection', 'Young', true),
                    (0, 0.5, 'Pause Mark Start',  'N/A',   false),
                    (0, 23.4, 'Mark',              'N/A',   true),
                    (1, 120.0, 'Old Collection',   'Old',   true)
                """);
        }
        View cycleView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-cycle".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-cycle not found"));
        assertThat(cycleView.isValid(Set.of("jvmlog_zgc_phases"))).isTrue();
        String query = cycleView.getBestMatchingQuery(Set.of("jvmlog_zgc_phases"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT * FROM \"jvmlog-zgc-cycle\" ORDER BY \"GC ID\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("GC ID")).isEqualTo(0);
            // GC 0, N/A generation: 23.4ms concurrent (Mark), 0.5ms pause
            // GC 0, Young generation: 45.6ms concurrent
            long rowsForGc0 = 0;
            do {
                if (rs.getLong("GC ID") == 0) rowsForGc0++;
            } while (rs.next());
            assertThat(rowsForGc0).as("GC 0 has two generations (Young + N/A)").isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void parallelSizingViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_parallel_sizing (gcId INTEGER, youngGenBytes BIGINT, youngGenCapacity BIGINT, oldGenBytes BIGINT, oldGenCapacity BIGINT, throughputPct DOUBLE)");
            s.execute("INSERT INTO jvmlog_parallel_sizing VALUES (0, 134217728, 268435456, 67108864, 536870912, 98.5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-parallel-sizing".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-parallel-sizing not found"));
        assertThat(view.isValid(Set.of("jvmlog_parallel_sizing"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_parallel_sizing"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Throughput %\" FROM \"jvmlog-parallel-sizing\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Throughput %")).isEqualTo(98.5);
        }
        conn.close();
    }

    @Test
    void stringdedupViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_stringdedup (gcId INTEGER, savedBytes BIGINT, objectCount BIGINT, deduplicatedObjects BIGINT, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_stringdedup VALUES (3, 12345, 678, 100, 1.23)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-stringdedup-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-stringdedup-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_stringdedup"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_stringdedup"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Bytes Saved\" FROM \"jvmlog-stringdedup-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(3);
            assertThat(rs.getLong("Bytes Saved")).isEqualTo(12345);
        }
        conn.close();
    }

    @Test
    void zgcDirectorViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_director (gcId INTEGER, ruleName VARCHAR, allocationRateMbps DOUBLE, freeHeapPct DOUBLE, timeUntilOomSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_zgc_director VALUES (0, 'Allocation Rate', 125.3, 25.0, 8.3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-director-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-director-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_director"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_director"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Rule\" FROM \"jvmlog-zgc-director-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getString("Rule")).isEqualTo("Allocation Rate");
        }
        conn.close();
    }

    @Test
    void safepointViewsExecuteWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE, gcId INTEGER)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation', 15.234, 1.234, NULL)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation', 12.000, 0.500, NULL)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('HandshakeFallback', 0.234, 0.100, NULL)");
        }
        View summaryView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-summary not found"));
        assertThat(summaryView.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        String query = summaryView.getBestMatchingQuery(Set.of("jvmlog_safepoint"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Operation\", \"Count\" FROM \"jvmlog-safepoint-summary\" ORDER BY \"Total (ms)\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Operation")).isEqualTo("G1CollectForAllocation");
            assertThat(rs.getLong("Count")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void allocStallViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (threadName VARCHAR, stallMs DOUBLE, gcId INTEGER)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('main', 15.234, NULL)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('main', 12.000, NULL)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('worker-1', 5.000, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_alloc_stall"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Thread\", \"Stalls\" FROM \"jvmlog-alloc-stall-summary\" ORDER BY \"Total Stall (ms)\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Thread")).isEqualTo("main");
            assertThat(rs.getLong("Stalls")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void gcErrorViewsExecuteWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, errorDetail VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (2, 'To-space exhausted', NULL, NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (2, 'Evacuation Failure', NULL, 1.23)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (5, 'To-space exhausted', NULL, NULL)");
        }
        View errView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-errors".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-errors not found"));
        assertThat(errView.isValid(Set.of("jvmlog_gc_errors"))).isTrue();
        String query = errView.getBestMatchingQuery(Set.of("jvmlog_gc_errors"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-gc-errors\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(3);
        }

        View summaryView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-error-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-error-summary not found"));
        assertThat(summaryView.isValid(Set.of("jvmlog_gc_errors"))).isTrue();
        String summaryQuery = summaryView.getBestMatchingQuery(Set.of("jvmlog_gc_errors"));
        try (Statement s = conn.createStatement()) {
            s.execute(summaryQuery);
            var rs = s.executeQuery("SELECT \"Error Type\", \"Count\" FROM \"jvmlog-gc-error-summary\" ORDER BY \"Count\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Error Type")).isEqualTo("To-space exhausted");
            assertThat(rs.getLong("Count")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void pausePercentilesViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " + (i + 1.0) + ", " + i + ".0)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-percentiles-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-percentiles-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cause\", \"Count\", \"P95 (ms)\" FROM \"jvmlog-pause-percentiles-by-cause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("G1 Evacuation Pause");
            assertThat(rs.getLong("Count")).isEqualTo(10);
            assertThat(rs.getDouble("P95 (ms)")).isGreaterThan(8.0);
        }
        conn.close();
    }

    @Test
    void heapEfficiencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 268435456, 134217728, 268435456, 268435456)");  // 256MB -> 128MB
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 200000000, 100000000, 268435456, 268435456)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-efficiency not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Reclaim %\" FROM \"jvmlog-heap-efficiency\" WHERE \"GC ID\" = 0");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Reclaim %")).isEqualTo(50.0);
        }
        conn.close();
    }

    @Test
    void allocStallTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (threadName VARCHAR, stallMs DOUBLE, gcId INTEGER)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('main', 10.0, 1)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('worker-1', 5.0, 2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_alloc_stall"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-alloc-stall-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void combinedTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 3.14, 0.5)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 134217728, 67108864, 268435456, 268435456)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-combined-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-combined-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Heap Before (MB)\", \"Pause (ms)\" FROM \"jvmlog-combined-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Heap Before (MB)")).isEqualTo(128.0);
            assertThat(rs.getDouble("Pause (ms)")).isEqualTo(3.14);
        }
        conn.close();
    }

    @Test
    void pauseHistogramViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'GCLocker Initiated GC', 0.5, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 3.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full', 'System.gc()', 150.0, 3.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-histogram".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-histogram not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-pause-histogram\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThanOrEqualTo(1);
        }
        conn.close();
    }

    @Test
    void gcFrequencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 3.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 2.5, 7.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 4.0, 15.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-frequency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-frequency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT sum(\"GC Count\") AS total FROM \"jvmlog-gc-frequency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("total")).isEqualTo(3);
        }
        conn.close();
    }

    @Test
    void g1MixedGcViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_mixed_gc (gcId INTEGER, decision VARCHAR, reclaimablePct DOUBLE, thresholdPct DOUBLE, candidateOldRegions INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_mixed_gc VALUES (5, 'Do Mixed GC', 45.2, 5.0, 47)");
            s.execute("INSERT INTO jvmlog_g1_mixed_gc VALUES (8, 'Skip Mixed GC', 3.1, 5.0, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-mixed-gc-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-mixed-gc-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_mixed_gc"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_mixed_gc"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-g1-mixed-gc-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void zgcLoadViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_load (gcId INTEGER, load1s DOUBLE, load5s DOUBLE, load15s DOUBLE, allocRateMbps DOUBLE, allocStalls INTEGER)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (0, 2.55, 2.37, 2.36, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (0, NULL, NULL, NULL, 456.0, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (0, NULL, NULL, NULL, NULL, 3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-load".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-load not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_load"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_load"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Load 1s\", \"Alloc Stalls\" FROM \"jvmlog-zgc-load\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Load 1s")).isEqualTo(2.55);
            assertThat(rs.getInt("Alloc Stalls")).isEqualTo(3);
        }
        conn.close();
    }

    @Test
    void gcPressureTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 3.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 268435456, 134217728, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pressure-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pressure-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Heap Before (MB)\", \"Pause (ms)\" FROM \"jvmlog-gc-pressure-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Heap Before (MB)")).isEqualTo(256.0);
        }
        conn.close();
    }

    @Test
    void problematicGcsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Full', 'System.gc()', 500.0, 5.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 268435456, 255000000, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 268435456, 134217728, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-problematic-gcs".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-problematic-gcs not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-problematic-gcs\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThanOrEqualTo(1);
        }
        conn.close();
    }

    @Test
    void g1CycleDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 3.5, 1.0)");
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER, archiveBefore INTEGER, archiveAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (0, 10, 0, 20, 1, 2, 5, 5, 5, 0, 0, 0, 0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-cycle-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-cycle-detail not found"));
        Set<String> tables = Set.of("jvmlog_gc_event", "jvmlog_g1_regions");
        // isValid checks primary definition only; getBestMatchingQuery also considers alternatives
        String query = view.getBestMatchingQuery(tables);
        assertThat(query).as("g1-cycle-detail should resolve with 2 tables via alternative").isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Eden Before\", \"Pause (ms)\" FROM \"jvmlog-g1-cycle-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getInt("Eden Before")).isEqualTo(10);
            assertThat(rs.getDouble("Pause (ms)")).isEqualTo(3.5);
        }
        conn.close();
    }

    @Test
    void zgcCycleDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'N/A', 'Allocation Rate', 0.456, 1.0)");
            s.execute("CREATE TABLE jvmlog_zgc_phases (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, generation VARCHAR, concurrent BOOLEAN)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (0, 'Concurrent Mark', 45.6, 'N/A', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (0, 'Pause Mark Start', 0.456, 'N/A', false)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-cycle-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-cycle-detail not found"));
        Set<String> tables = Set.of("jvmlog_gc_event", "jvmlog_zgc_phases");
        // primary requires 4 tables; fallback to alternative that uses 2
        String query = view.getBestMatchingQuery(tables);
        assertThat(query).as("zgc-cycle-detail should resolve via 2-table alternative").isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Concurrent (ms)\", \"STW (ms)\" FROM \"jvmlog-zgc-cycle-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Concurrent (ms)")).isEqualTo(45.6);
        }
        conn.close();
    }

    @Test
    void gcErrorTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, errorDetail VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (2, 'To-space exhausted', NULL, NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (5, 'Evacuation Failure', NULL, 1.23)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 450.0, 12.5)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5, 'Full', 'G1 Evacuation Pause', 300.0, 30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-error-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-error-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_errors", "jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_errors", "jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Error Type\", \"Uptime (s)\" FROM \"jvmlog-gc-error-timeline\" ORDER BY \"GC ID\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(2);
            assertThat(rs.getString("Error Type")).isEqualTo("To-space exhausted");
            assertThat(rs.getDouble("Uptime (s)")).isEqualTo(12.5);
        }
        conn.close();
    }

    @Test
    void metaspaceDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT, classSpaceBefore BIGINT, classSpaceAfter BIGINT, classSpaceCommitted BIGINT)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (0, 52428800, 52428800, 67108864, 6291456, 6291456, 8388608)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-detail not found"));
        assertThat(view.isValid(Set.of("jvmlog_metaspace"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_metaspace"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Metaspace After (MB)\" FROM \"jvmlog-metaspace-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Metaspace After (MB)")).isEqualTo(50.0);
        }
        conn.close();
    }

    @Test
    void shenandoahCycleDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Init Mark', 'Allocation Failure', 0.5, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Final Mark', 'Allocation Failure', 1.2, 1.5)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Init Update Refs', 'Allocation Failure', 0.3, 1.8)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Final Update Refs', 'Allocation Failure', 0.4, 2.1)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-cycle-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-cycle-detail not found"));
        Set<String> tables = Set.of("jvmlog_gc_event");
        String query = view.getBestMatchingQuery(tables);
        assertThat(query).as("shenandoah-cycle-detail should resolve via minimal alternative").isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Init Mark (ms)\", \"Total STW (ms)\" FROM \"jvmlog-shenandoah-cycle-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Init Mark (ms)")).isEqualTo(0.5);
            assertThat(rs.getDouble("Total STW (ms)")).isCloseTo(2.4, within(0.01));
        }
        conn.close();
    }

    @Test
    void shenandoahFreeTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_shenandoah_free (gcId INTEGER, freeBytes BIGINT, freeRegions INTEGER, headroomBytes BIGINT, uncommittedBytes BIGINT)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (0, 268435456, 256, 134217728, NULL)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (1, 201326592, 192, 100663296, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-free-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-free-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_shenandoah_free"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_shenandoah_free"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Free (MB)\", \"Free Regions\" FROM \"jvmlog-shenandoah-free-timeline\" ORDER BY \"GC ID\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Free (MB)")).isEqualTo(256.0);
            assertThat(rs.getInt("Free Regions")).isEqualTo(256);
        }
        conn.close();
    }

    @Test
    void zgcStatsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes BIGINT, liveBytes BIGINT, garbageBytes BIGINT)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (0, 'Mark Start', 536870912, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (0, 'Mark End', 482344960, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (0, 'Relocate Start', NULL, 245366784, 181403648)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (0, 'Relocate End', 142606336, NULL, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-stats".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-stats not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_stats"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Live (MB)\", \"Garbage (MB)\" FROM \"jvmlog-zgc-stats\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Live (MB)")).isGreaterThan(230.0);
        }
        conn.close();
    }

    @Test
    void gcWorkerViewsExecuteWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (0, 8, 8, 'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (0, 8, 8, 'marking')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1, 4, 8, 'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1, 8, 8, 'marking')");
        }
        View summaryView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-worker-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-worker-summary not found"));
        assertThat(summaryView.isValid(Set.of("jvmlog_gc_workers"))).isTrue();
        String query = summaryView.getBestMatchingQuery(Set.of("jvmlog_gc_workers"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Task\", \"Utilisation %\" FROM \"jvmlog-gc-worker-summary\" WHERE \"Task\" = 'evacuation'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Utilisation %")).isCloseTo(75.0, within(0.1));
        }

        View timelineView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-worker-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-worker-timeline not found"));
        String tlQuery = timelineView.getBestMatchingQuery(Set.of("jvmlog_gc_workers"));
        try (Statement s = conn.createStatement()) {
            s.execute(tlQuery);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-gc-worker-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(4);
        }
        conn.close();
    }

    @Test
    void throughputSummaryViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 10.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 5.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 20.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-throughput-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-throughput-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Throughput %\" FROM \"jvmlog-throughput-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Throughput %")).isGreaterThan(99.0); // 35ms GC in 9s = ~99.6%
        }
        conn.close();
    }

    @Test
    void gcIntervalViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 3.5)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 6.0, 7.0)");
        }
        // Test jvmlog-gc-interval
        View intervalView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-interval".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-interval not found"));
        assertThat(intervalView.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = intervalView.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Interval (s)\" FROM \"jvmlog-gc-interval\" ORDER BY \"Uptime (s)\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getObject("Interval (s)")).isNull(); // first row has no previous
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Interval (s)")).isCloseTo(2.5, within(0.001));
        }
        // Test jvmlog-gc-interval-stats
        View statsView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-interval-stats".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-interval-stats not found"));
        assertThat(statsView.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String statsQuery = statsView.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(statsQuery);
            var rs = s.executeQuery("SELECT \"Min Interval (s)\", \"Max Interval (s)\" FROM \"jvmlog-gc-interval-stats\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Min Interval (s)")).isCloseTo(2.5, within(0.01));
            assertThat(rs.getDouble("Max Interval (s)")).isCloseTo(3.5, within(0.01));
        }
        conn.close();
    }

    @Test
    void pauseSlaViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 0.5, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 3.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full', 'System.gc()', 150.0, 3.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-sla".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-sla not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            // 8 thresholds should produce 8 rows
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-pause-sla\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(8);
            // 1ms threshold: only 0.5ms pause qualifies → 33.3%
            rs = s.executeQuery("SELECT \"Pauses Within (count)\", \"Pauses Within (%)\" FROM \"jvmlog-pause-sla\" WHERE \"SLA Threshold (ms)\" = 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Pauses Within (count)")).isEqualTo(1);
            // 100ms threshold: 0.5 and 3.0 qualify → 2 of 3 = 66.7%
            rs = s.executeQuery("SELECT \"Pauses Within (count)\" FROM \"jvmlog-pause-sla\" WHERE \"SLA Threshold (ms)\" = 100");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Pauses Within (count)")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void causeDistributionViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full', 'System.gc()', 100.0, 3.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-cause-distribution".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-cause-distribution not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cause\", \"Count\", \"% of Events\" FROM \"jvmlog-cause-distribution\" ORDER BY \"Count\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("G1 Evacuation Pause");
            assertThat(rs.getLong("Count")).isEqualTo(2);
            assertThat(rs.getDouble("% of Events")).isCloseTo(66.7, within(0.1));
        }
        conn.close();
    }

    @Test
    void throughputTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 50.0, 3.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 30.0, 7.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 20.0, 15.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-throughput-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-throughput-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            // Two windows: [0,10) with 80ms GC → 99.2% throughput; [10,20) with 20ms GC → 99.8%
            var rs = s.executeQuery("SELECT \"Window Start (s)\", \"Throughput %\", \"GC Count\" FROM \"jvmlog-throughput-timeline\" ORDER BY \"Window Start (s)\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Window Start (s)")).isEqualTo(0.0);
            assertThat(rs.getLong("GC Count")).isEqualTo(2);
            assertThat(rs.getDouble("Throughput %")).isGreaterThan(99.0);
        }
        conn.close();
    }

    @Test
    void heapGrowthViewsExecuteWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 11.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 6.0, 21.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // Simulating growing heap after GC: 100MB, 110MB, 120MB
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 157286400, 104857600, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 167772160, 115343360, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 178257920, 125829120, 536870912, 536870912)");
        }
        Set<String> tables = Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot");

        // Test jvmlog-heap-growth-trend
        View trendView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-growth-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-growth-trend not found"));
        assertThat(trendView.isValid(tables)).isTrue();
        String trendQuery = trendView.getBestMatchingQuery(tables);
        try (Statement s = conn.createStatement()) {
            s.execute(trendQuery);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-heap-growth-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThanOrEqualTo(1);
            // Heap trend should be positive (growing heap)
            rs = s.executeQuery("SELECT \"Heap Trend (MB/s)\" FROM \"jvmlog-heap-growth-trend\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Heap Trend (MB/s)")).isGreaterThan(0);
        }

        // Test jvmlog-heap-growth-summary
        View summaryView = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-growth-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-growth-summary not found"));
        assertThat(summaryView.isValid(tables)).isTrue();
        String summaryQuery = summaryView.getBestMatchingQuery(tables);
        try (Statement s = conn.createStatement()) {
            s.execute(summaryQuery);
            var rs = s.executeQuery("SELECT \"Growth Rate (MB/s)\", \"R² (fit quality)\", \"Est. Time to OOM (s)\" FROM \"jvmlog-heap-growth-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Growth Rate (MB/s)")).isGreaterThan(0); // positive growth
            assertThat(rs.getObject("Est. Time to OOM (s)")).isNotNull(); // slope > 0 so OOM estimate present
        }

        // Test heap-growth-summary alternative (heap_snapshot only)
        String altQuery = summaryView.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"));
        assertThat(altQuery).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute("DROP VIEW IF EXISTS \"jvmlog-heap-growth-summary\"");
            s.execute(altQuery);
            var rs = s.executeQuery("SELECT \"Min Heap After (MB)\", \"Max Heap After (MB)\" FROM \"jvmlog-heap-growth-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Min Heap After (MB)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void allocationRateViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 4.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 6.0, 7.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // heapBefore growing: 100MB, 110MB, 120MB — heapAfter: 50MB, 60MB, 70MB
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 104857600, 52428800, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 115343360, 62914560, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 125829120, 73400320, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-allocation-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-allocation-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Allocation Rate (MB/s)\", \"Allocated Since Last GC (MB)\" FROM \"jvmlog-allocation-rate\" ORDER BY \"Uptime (s)\"");
            assertThat(rs.next()).isTrue();
            // first row with non-null allocation: GC 1 — allocated 110 - 50 = 60MB over 2s = 30 MB/s
            assertThat(rs.getInt("GC ID")).isEqualTo(1);
            assertThat(rs.getDouble("Allocated Since Last GC (MB)")).isCloseTo(60.0, within(0.5));
            assertThat(rs.getDouble("Allocation Rate (MB/s)")).isCloseTo(30.0, within(0.5));
        }
        conn.close();
    }

    @Test
    void gcTypeBreakdownViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full GC', 'System.gc()', 200.0, 5.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-type-breakdown".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-type-breakdown not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC Category\", \"Count\", \"% of Pause Time\" FROM \"jvmlog-gc-type-breakdown\" ORDER BY \"Count\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("GC Category")).isEqualTo("Young GC");
            assertThat(rs.getLong("Count")).isEqualTo(2);
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("GC Category")).isEqualTo("Full GC");
            // Full GC has 200ms of 209ms total: ~95%
            assertThat(rs.getDouble("% of Pause Time")).isGreaterThan(90.0);
        }
        conn.close();
    }

    @Test
    void fullGcAnalysisViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Full GC', 'Ergonomics', 300.0, 4.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full GC', 'System.gc()', 150.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-full-gc-analysis".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-full-gc-analysis not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Pause (ms)\", \"Cause\" FROM \"jvmlog-full-gc-analysis\"");
            assertThat(rs.next()).isTrue();
            // Sorted by pauseMs DESC: gcId=1 (300ms) should be first
            assertThat(rs.getDouble("Pause (ms)")).isEqualTo(300.0);
            assertThat(rs.getString("Cause")).isEqualTo("Ergonomics");
        }
        conn.close();
    }

    @Test
    void g1HumongousViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Humongous Allocation', 3.5, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 2.0)");
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER, archiveBefore INTEGER, archiveAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (0, 10, 0, 20, 1, 2, 5, 5, 5, 3, 3, 0, 0)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1, 10, 0, 20, 1, 2, 5, 5, 5, 0, 0, 0, 0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-humongous".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-humongous not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-g1-humongous\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(1);
            rs = s.executeQuery("SELECT \"GC ID\", \"Humongous Before\" FROM \"jvmlog-g1-humongous\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getInt("Humongous Before")).isEqualTo(3);
        }
        conn.close();
    }

    @Test
    void parallelGcDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'Allocation Failure', 12.0, 1.0)");
            s.execute("CREATE TABLE jvmlog_parallel_sizing (gcId INTEGER, youngGenBytes BIGINT, youngGenCapacity BIGINT, oldGenBytes BIGINT, oldGenCapacity BIGINT, throughputPct DOUBLE)");
            s.execute("INSERT INTO jvmlog_parallel_sizing VALUES (0, 52428800, 134217728, 209715200, 536870912, 98.5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-parallel-gc-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-parallel-gc-detail not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_parallel_sizing"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_parallel_sizing"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Young Gen (MB)\", \"Throughput %\" FROM \"jvmlog-parallel-gc-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Young Gen (MB)")).isCloseTo(50.0, within(0.1));
            assertThat(rs.getDouble("Throughput %")).isEqualTo(98.5);
        }
        conn.close();
    }

    @Test
    void gcHealthScoreViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Healthy scenario: small pauses, no full GC, high throughput
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 8.0, 3.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 3.0, 6.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'Young', 'G1 Evacuation Pause', 4.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-health-score".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-health-score not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Throughput %\", \"Full GC Count\", \"Health\", \"Primary Concern\" FROM \"jvmlog-gc-health-score\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Throughput %")).isGreaterThan(99.0);
            assertThat(rs.getLong("Full GC Count")).isEqualTo(0);
            assertThat(rs.getString("Health")).isEqualTo("Good");
        }

        // Critical scenario with Full GC
        DuckDBConnection conn2 = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn2.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Full GC', 'Ergonomics', 2000.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Full GC', 'System.gc()', 1800.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full GC', 'Ergonomics', 2200.0, 9.0)");
        }
        View view2 = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-health-score".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-health-score not found"));
        String query2 = view2.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn2.createStatement()) {
            s.execute(query2);
            var rs = s.executeQuery("SELECT \"Health\" FROM \"jvmlog-gc-health-score\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Health")).isEqualTo("Critical");
        }
        conn.close();
        conn2.close();
    }

    @Test
    void gcRecommendationsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Scenario: frequent allocation failures, one System.gc(), low throughput
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'Allocation Failure', 15.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'Allocation Failure', 20.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Full GC', 'System.gc()', 500.0, 3.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-recommendations".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-recommendations not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            // Should have 6 recommendation rows
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-gc-recommendations\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(6);
            // System.gc() should appear as Warning
            rs = s.executeQuery("SELECT \"Severity\" FROM \"jvmlog-gc-recommendations\" WHERE \"Category\" = 'System.gc() Calls'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Severity")).isEqualTo("Warning");
            // Full GC should appear as Warning or Critical
            rs = s.executeQuery("SELECT \"Severity\" FROM \"jvmlog-gc-recommendations\" WHERE \"Category\" = 'Full GC Events'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Severity")).isIn("Warning", "Critical");
        }
        conn.close();
    }

    @Test
    void zgcGenerationalViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_phases (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, generation VARCHAR, concurrent BOOLEAN)");
            // Young collection cycles: 3 concurrent, 3 STW
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (0, 'Young Collection', 45.6, 'Young', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (0, 'Pause Mark Start', 0.2, 'Young', false)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (1, 'Young Collection', 38.2, 'Young', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (1, 'Pause Mark Start', 0.3, 'Young', false)");
            // Old collection cycle
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (2, 'Old Collection', 120.0, 'Old', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (2, 'Pause Mark Start', 0.5, 'Old', false)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-generational".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-generational not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_phases"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_phases"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Generation\", \"Cycles\", \"Total Concurrent (ms)\", \"Avg Pause (ms)\" FROM \"jvmlog-zgc-generational\" ORDER BY \"Generation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Generation")).isEqualTo("Old");
            assertThat(rs.getLong("Cycles")).isEqualTo(1);
            assertThat(rs.getDouble("Avg Pause (ms)")).isCloseTo(0.5, within(0.01));
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Generation")).isEqualTo("Young");
            assertThat(rs.getLong("Cycles")).isEqualTo(2);
            assertThat(rs.getDouble("Total Concurrent (ms)")).isCloseTo(83.8, within(0.1));
        }
        conn.close();
    }

    @Test
    void concurrentOverheadViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 11.0)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (0, 'Concurrent Cycle', 100.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1, 'Concurrent Cycle', 90.0, 11.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-overhead".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-overhead not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_gc_phase"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_gc_phase"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Total Concurrent Phase Time (ms)\", \"Concurrent Overhead %\", \"Cycles with Phase Data\" FROM \"jvmlog-concurrent-overhead\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Total Concurrent Phase Time (ms)")).isCloseTo(190.0, within(0.1));
            assertThat(rs.getLong("Cycles with Phase Data")).isEqualTo(2);
            assertThat(rs.getDouble("Concurrent Overhead %")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void gcLogQualityViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 3.0)");
            // GC ID 2 is missing — gap of 1
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'Young', 'G1 Evacuation Pause', 6.0, 7.0)");
            s.execute("CREATE TABLE jvmlog_unknown_lines (tags VARCHAR, level VARCHAR, messagePrefix VARCHAR, count BIGINT)");
            s.execute("INSERT INTO jvmlog_unknown_lines VALUES ('[gc,unknown]', 'info', 'Some unexpected line', 5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-log-quality".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-log-quality not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_unknown_lines"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_unknown_lines"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Total GC Events\", \"Missing GC IDs\", \"Unmatched Lines\", \"Log Duration (s)\" FROM \"jvmlog-gc-log-quality\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Total GC Events")).isEqualTo(3);
            assertThat(rs.getLong("Missing GC IDs")).isEqualTo(1); // GC ID 2 is missing
            assertThat(rs.getLong("Unmatched Lines")).isEqualTo(5);
            assertThat(rs.getDouble("Log Duration (s)")).isCloseTo(6.0, within(0.1));
        }
        conn.close();
    }

    @Test
    void heapResizeSummaryViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_ergonomics (requestedExpansionBytes BIGINT, actualExpansionBytes BIGINT, decision VARCHAR)");
            s.execute("INSERT INTO jvmlog_g1_ergonomics VALUES (268435456, 268435456, 'expand')");
            s.execute("INSERT INTO jvmlog_g1_ergonomics VALUES (134217728, 134217728, 'expand')");
            s.execute("INSERT INTO jvmlog_g1_ergonomics VALUES (134217728, 67108864, 'shrink')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-resize-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-resize-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_ergonomics"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_ergonomics"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Decision\", \"Count\", \"Total (MB)\" FROM \"jvmlog-heap-resize-summary\" ORDER BY \"Count\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Decision")).isEqualTo("expand");
            assertThat(rs.getLong("Count")).isEqualTo(2);
            assertThat(rs.getDouble("Total (MB)")).isCloseTo(384.0, within(0.1));
        }
        conn.close();
    }

    @Test
    void allocationRateTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 4.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 6.0, 15.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // GC 0: 100MB before, 50MB after; GC 1: 110MB before (allocated 60MB in 3s), 55MB after; GC 2: 80MB before, 40MB after
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (0, 104857600, 52428800, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 115343360, 57671680, 536870912, 536870912)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 83886080, 41943040, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-allocation-rate-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-allocation-rate-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-allocation-rate-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThanOrEqualTo(1);
            rs = s.executeQuery("SELECT \"Avg Alloc Rate (MB/s)\" FROM \"jvmlog-allocation-rate-timeline\" ORDER BY \"Window Start (s)\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Alloc Rate (MB/s)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void pauseRegressionViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // First window [0-30s]: small pauses
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Young', 'G1 Evacuation Pause', 5.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 8.0, 15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Young', 'G1 Evacuation Pause', 6.0, 25.0)");
            // Second window [30-60s]: larger pauses — regression
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'Young', 'G1 Evacuation Pause', 50.0, 35.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4, 'Young', 'G1 Evacuation Pause', 80.0, 50.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-regression".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-regression not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Window Start (s)\", \"P99 Pause (ms)\", \"GC Count\" FROM \"jvmlog-pause-regression\" ORDER BY \"Window Start (s)\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Window Start (s)")).isEqualTo(0.0);
            assertThat(rs.getLong("GC Count")).isEqualTo(3);
            double firstWindowP99 = rs.getDouble("P99 Pause (ms)");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Window Start (s)")).isEqualTo(30.0);
            // Second window has higher P99 — regression
            assertThat(rs.getDouble("P99 Pause (ms)")).isGreaterThan(firstWindowP99);
        }
        conn.close();
    }

    @Test
    void zgcAllocationRateViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_load (gcId INTEGER, load1s DOUBLE, load5s DOUBLE, load15s DOUBLE, allocRateMbps DOUBLE, allocStalls INTEGER)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (0, 2.5, 2.3, 2.1, 512.0, 0)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (1, 3.1, 2.8, 2.5, 768.0, 2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-allocation-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-allocation-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_load"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_load"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Alloc Rate (MB/s)\", \"Alloc Stalls\" FROM \"jvmlog-zgc-allocation-rate\" ORDER BY \"GC ID\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(0);
            assertThat(rs.getDouble("Alloc Rate (MB/s)")).isEqualTo(512.0);
            assertThat(rs.getLong("Alloc Stalls")).isEqualTo(0);
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(1);
            assertThat(rs.getLong("Alloc Stalls")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void topPausesByCauseViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 15; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " + (i * 2.0 + 1.0) + ", " + i + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (15, 'Full', 'System.gc()', 500.0, 15.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-top-pauses-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-top-pauses-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            // 15 G1 Evacuation Pause events: top 10 returned per cause
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-top-pauses-by-cause\" WHERE \"Cause\" = 'G1 Evacuation Pause'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(10); // top 10 per cause
            // System.gc() has 1 event — all 1 returned
            rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-top-pauses-by-cause\" WHERE \"Cause\" = 'System.gc()'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(1);
        }
        conn.close();
    }

    @Test
    void shenandoahModeAnalysisViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (0, 'Init Mark', 'Metadata GC Threshold', 3.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Final Mark', 'Metadata GC Threshold', 2.5, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'Degenerated GC', 'Allocation Failure', 150.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'Full GC', 'Allocation Failure', 800.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-mode-analysis".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-mode-analysis not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Mode\", \"Events\" FROM \"jvmlog-shenandoah-mode-analysis\" ORDER BY \"Total Pause (ms)\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Mode")).isEqualTo("Full GC");
            assertThat(rs.getLong("Events")).isEqualTo(1);
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Mode")).isEqualTo("Degenerated GC");
        }
        conn.close();
    }

    @Test
    void phaseTopSlowViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + i + ", 'Pre Evacuate Collection Set', " + (i * 0.5 + 0.1) + ", " + i + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (8, 'Merge Heap Roots', 5.0, 8.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-phase-top-slow".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-phase-top-slow not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            // 8 Pre Evacuate events: top 5 returned
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-phase-top-slow\" WHERE \"Phase\" = 'Pre Evacuate Collection Set'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(5);
            // First row (slowest) should be the last inserted event (index 7, duration=3.6ms)
            rs = s.executeQuery("SELECT \"Duration (ms)\" FROM \"jvmlog-phase-top-slow\" WHERE \"Phase\" = 'Pre Evacuate Collection Set' LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Duration (ms)")).isCloseTo(3.6, within(0.01));
        }
        conn.close();
    }

    @Test
    void gcEfficiencyByCauseViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 12.5, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 15.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Full', 'System.gc()', 800.0, 3.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 209715200, 104857600, 268435456, 268435456)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 209715200, 104857600, 268435456, 268435456)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 524288000, 52428800, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-efficiency-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-efficiency-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-gc-efficiency-by-cause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // System.gc() reclaims 457 MB in 800ms vs Allocation Failure 100MB in 27.5ms
            // System.gc() MB/ms ≈ 0.571, Allocation Failure ≈ 3.636 → ordered desc
            rs = s.executeQuery("SELECT \"Cause\" FROM \"jvmlog-gc-efficiency-by-cause\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("Allocation Failure");
        }
        conn.close();
    }

    @Test
    void metaspaceGrowthTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT, classSpaceBefore BIGINT, classSpaceAfter BIGINT, classSpaceCommitted BIGINT)");
            for (int i = 0; i < 5; i++) {
                long meta = (50 + i * 2) * 1048576L;
                long cls  = (6 + i) * 1048576L;
                s.execute("INSERT INTO jvmlog_metaspace VALUES (" + i + ", " + meta + ", " + meta + ", " + (meta + 16777216) + ", " + cls + ", " + cls + ", " + (cls + 2097152) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-growth-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-growth-trend not found"));
        // primary needs both metaspace + gc_event; fallback works with metaspace only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_metaspace"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Samples\", \"Metaspace Growth (MB/s)\", \"Assessment\" FROM \"jvmlog-metaspace-growth-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Samples")).isEqualTo(5);
            assertThat(rs.getDouble("Metaspace Growth (MB/s)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void oomRiskEstimateViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            for (int i = 0; i < 6; i++) {
                long after     = (100 + i * 20) * 1048576L;
                long committed = 1024 * 1048576L;
                s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (" + i + ", " + (after + 10485760) + ", " + after + ", " + committed + ", " + committed + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-oom-risk-estimate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-oom-risk-estimate not found"));
        // primary needs both heap_snapshot + gc_event; fallback works with heap_snapshot only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Samples\", \"Risk Level\" FROM \"jvmlog-oom-risk-estimate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Samples")).isEqualTo(6);
            assertThat(rs.getString("Risk Level")).isNotNull();
        }
        conn.close();
    }

    @Test
    void g1MarkTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 6; i++) {
                double dur = 50.0 + i * 5.0;
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + i + ", 'Concurrent Mark from Roots', " + dur + ", " + (i * 10.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (6, 'Pre Evacuate Collection Set', 3.0, 60.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-mark-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-mark-trend not found"));
        // primary needs both gc_phase + gc_event; fallback works with gc_phase only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Mark Events\", \"Trend (ms/s)\", \"Trend Assessment\" FROM \"jvmlog-g1-mark-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Mark Events")).isEqualTo(6);
            assertThat(rs.getDouble("Trend (ms/s)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void heapFragmentationViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // 256 MB used, 512 MB committed = 50% unused
            for (int i = 0; i < 4; i++) {
                s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (" + i + ", 314572800, 268435456, 536870912, 536870912)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-fragmentation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-fragmentation not found"));
        // fallback with heap_snapshot only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Samples\", \"Avg Unused %\", \"Assessment\" FROM \"jvmlog-heap-fragmentation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Samples")).isEqualTo(4);
            assertThat(rs.getDouble("Avg Unused %")).isGreaterThan(40.0);
        }
        conn.close();
    }

    @Test
    void heapReclaimRatioViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 10.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 12.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Full', 'System.gc()', 500.0, 3.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 209715200, 104857600, 268435456, 268435456)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 209715200, 104857600, 268435456, 268435456)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 524288000, 52428800, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-reclaim-ratio".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-reclaim-ratio not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-heap-reclaim-ratio\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // System.gc() reclaims more: (500-50)/500 = 90% vs Alloc Failure (200-100)/200 = 50%
            rs = s.executeQuery("SELECT \"Cause\", \"Avg Reclaim %\" FROM \"jvmlog-heap-reclaim-ratio\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("System.gc()");
        }
        conn.close();
    }

    @Test
    void throughputDegradationViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // 6 windows of 30s: pause increases over time to show degradation
            for (int i = 0; i < 6; i++) {
                double pause = 1000.0 + i * 2000.0;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'G1 Young', 'Allocation Failure', " + pause + ", " + (i * 30.0 + 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-throughput-degradation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-throughput-degradation not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Windows\", \"Trend Assessment\" FROM \"jvmlog-throughput-degradation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Windows")).isEqualTo(6);
            assertThat(rs.getString("Trend Assessment")).isNotNull();
        }
        conn.close();
    }

    @Test
    void g1OldRegionTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            for (int i = 0; i < 6; i++) {
                int old = 10 + i * 3;
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 100, 0, 5, 5, " + old + ", " + old + ", 0, 0)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-old-region-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-old-region-trend not found"));
        // primary needs g1_regions + gc_event; fallback works with g1_regions only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cycles\", \"Trend (regions/s)\", \"Trend Assessment\" FROM \"jvmlog-g1-old-region-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Cycles")).isEqualTo(6);
            assertThat(rs.getDouble("Trend (regions/s)")).isGreaterThan(0);
        }
        conn.close();
    }
}
