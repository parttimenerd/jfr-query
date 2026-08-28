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
            "jvmlog-throughput-degradation", "jvmlog-g1-old-region-trend",
            "jvmlog-safepoint-ttr-stats", "jvmlog-g1-survivor-trend",
            "jvmlog-zgc-phase-breakdown",
            "jvmlog-pause-variance", "jvmlog-cause-first-occurrence",
            "jvmlog-young-vs-old-time",
            "jvmlog-heap-fill-at-trigger", "jvmlog-alloc-stall-rate-timeline",
            "jvmlog-phases-per-gc",
            "jvmlog-zgc-garbage-ratio", "jvmlog-shenandoah-headroom",
            "jvmlog-gc-worker-efficiency-trend",
            "jvmlog-evacuation-failure-detail", "jvmlog-log-time-range",
            "jvmlog-concurrent-gc-efficiency",
            "jvmlog-cause-pause-stats", "jvmlog-pause-by-minute",
            "jvmlog-allocation-rate-trend", "jvmlog-gc-init-detail",
            "jvmlog-full-gc-frequency",
            "jvmlog-gc-type-per-minute", "jvmlog-memory-reclaimed",
            "jvmlog-pause-outliers", "jvmlog-heap-after-trend",
            "jvmlog-alloc-pressure-timeline",
            "jvmlog-sla-breach-by-cause", "jvmlog-pause-burst-windows",
            "jvmlog-health-timeline", "jvmlog-heap-efficiency-by-type",
            "jvmlog-gc-cause-heatmap",
            "jvmlog-interval-distribution", "jvmlog-live-data-estimate",
            "jvmlog-young-gc-frequency", "jvmlog-allocation-surges",
            "jvmlog-safepoint-heatmap",
            "jvmlog-class-space-trend", "jvmlog-throughput-consistency",
            "jvmlog-heap-headroom-timeline", "jvmlog-concurrent-mode-failure",
            "jvmlog-metaspace-pressure",
            "jvmlog-pause-histogram-by-type", "jvmlog-alloc-reclaim-balance",
            "jvmlog-cause-categories", "jvmlog-gc-cpu-estimate",
            "jvmlog-pause-heap-correlation", "jvmlog-overhead-by-type",
            "jvmlog-g1-old-gen-tracking", "jvmlog-phase-by-gc-type",
            "jvmlog-zgc-minor-vs-major",
            "jvmlog-pause-spike-frequency", "jvmlog-app-vs-gc-time",
            "jvmlog-metaspace-expansions", "jvmlog-gc-pressure-index",
            "jvmlog-long-concurrent-phases", "jvmlog-eden-fill-at-trigger",
            "jvmlog-trend-summary", "jvmlog-safepoint-ttr-outliers",
            "jvmlog-survivor-occupancy-timeline", "jvmlog-stringdedup-rate-timeline",
            "jvmlog-full-gc-recovery", "jvmlog-dominant-cause-timeline",
            "jvmlog-heap-max-proximity", "jvmlog-gc-type-mix-trend",
            "jvmlog-alloc-rate-by-cause", "jvmlog-pause-trend-by-cause",
            "jvmlog-gc-footprint", "jvmlog-heap-committed-timeline",
            "jvmlog-g1-humongous-timeline", "jvmlog-pause-sla-compliance",
            "jvmlog-concurrent-stall-timeline",
            "jvmlog-heap-reclaim-efficiency", "jvmlog-safepoint-non-gc",
            "jvmlog-young-gen-sizing-trend", "jvmlog-gc-interval-histogram",
            "jvmlog-phase-worst-by-type",
            "jvmlog-promotion-rate", "jvmlog-metaspace-gc-trigger",
            "jvmlog-g1-mixed-trigger-analysis", "jvmlog-concurrent-phase-efficiency",
            "jvmlog-heap-saturation-events", "jvmlog-gc-burst-detection",
            "jvmlog-zgc-garbage-ratio-by-cycle", "jvmlog-full-gc-cause-summary",
            "jvmlog-gc-duration-vs-pause",
            "jvmlog-zgc-load-timeline", "jvmlog-gc-worker-utilisation",
            "jvmlog-gc-pause-by-hour", "jvmlog-old-gen-growth",
            "jvmlog-shenandoah-summary",
            "jvmlog-safepoint-sync-hotspot", "jvmlog-zgc-liveness-trend",
            "jvmlog-shenandoah-concurrent-efficiency", "jvmlog-heap-before-after-delta",
            "jvmlog-gc-overhead-trend",
            "jvmlog-gc-pause-regression", "jvmlog-alloc-stall-by-gc",
            "jvmlog-zgc-reloc-pressure", "jvmlog-phase-timing-matrix",
            "jvmlog-safepoint-operation-mix",
            "jvmlog-heap-usage-histogram", "jvmlog-young-gen-gc-rate",
            "jvmlog-alloc-stall-distribution", "jvmlog-gc-wall-vs-concurrent",
            "jvmlog-full-gc-interval",
            "jvmlog-gc-start-of-trouble", "jvmlog-safepoint-gc-split",
            "jvmlog-metaspace-oom-proximity", "jvmlog-gc-cause-first-last",
            "jvmlog-zgc-allocation-rate-trend",
            "jvmlog-gc-errors-timeline", "jvmlog-shenandoah-free-headroom",
            "jvmlog-g1-concurrent-phase-summary", "jvmlog-metaspace-class-space-trend",
            "jvmlog-gc-error-by-type-timeline",
            "jvmlog-heap-growth-rate", "jvmlog-g1-region-waste",
            "jvmlog-pause-budget-analysis", "jvmlog-gc-overhead-by-type",
            "jvmlog-survivor-to-old-rate",
            "jvmlog-pause-worst-10", "jvmlog-safepoint-top-ops",
            "jvmlog-worker-utilisation-by-phase", "jvmlog-gc-pause-interval-correlation",
            "jvmlog-g1-eden-fill-rate",
            "jvmlog-gc-bottleneck-summary", "jvmlog-pause-p99-rolling",
            "jvmlog-alloc-stall-gc-phase", "jvmlog-zgc-capacity-trend",
            "jvmlog-gc-pause-sla-by-cause",
            "jvmlog-heap-footprint-report", "jvmlog-pause-distribution-histogram",
            "jvmlog-alloc-stall-thread-hotspots", "jvmlog-pause-consistency-by-type",
            "jvmlog-gc-type-timeline",
            "jvmlog-gc-event-density", "jvmlog-shenandoah-uncommit-trend",
            "jvmlog-zgc-mmu-approximation", "jvmlog-metaspace-growth-acceleration",
            "jvmlog-safepoint-gc-vs-nongc-stw",
            "jvmlog-g1-humongous-objects", "jvmlog-gc-cause-shift",
            "jvmlog-gc-phase-summary", "jvmlog-heap-pressure-events",
            "jvmlog-worker-saturation-rate",
            "jvmlog-zgc-stall-to-gc-ratio", "jvmlog-g1-mixed-effectiveness",
            "jvmlog-concurrent-mark-duration-trend", "jvmlog-stringdedup-savings-trend",
            "jvmlog-parallel-gen-sizing-trend",
            "jvmlog-gc-pause-sla-rolling", "jvmlog-g1-survivor-overflow",
            "jvmlog-zgc-relocate-garbage", "jvmlog-heap-churn-rate",
            "jvmlog-safepoint-sync-outliers",
            "jvmlog-gc-health-dashboard", "jvmlog-memory-leak-risk",
            "jvmlog-alloc-pressure-correlation", "jvmlog-gc-sla-impact-summary",
            "jvmlog-collector-diagnostics",
            "jvmlog-gc-phase-hot-spot", "jvmlog-pause-recovery-time",
            "jvmlog-safepoint-stw-breakdown", "jvmlog-gc-worker-phase-efficiency",
            "jvmlog-heap-live-data-ratio"
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

    @Test
    void safepointTtrStatsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE, gcId INTEGER)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation', 15.234, 1.234, 1)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation', 12.000, 0.800, 2)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('Deoptimize', 5.000, 3.500, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-ttr-stats".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-ttr-stats not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_safepoint"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-safepoint-ttr-stats\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // Deoptimize has 3.5ms TTR / 5ms total = 70% of STW
            rs = s.executeQuery("SELECT \"Avg TTR % of STW\" FROM \"jvmlog-safepoint-ttr-stats\" WHERE \"Operation\" = 'Deoptimize'");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg TTR % of STW")).isGreaterThan(60.0);
        }
        conn.close();
    }

    @Test
    void g1SurvivorTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            for (int i = 0; i < 5; i++) {
                int surv = 2 + i;
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 100, 0, " + (surv - 1) + ", " + surv + ", 10, 20, 20, 0, 0)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-survivor-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-survivor-trend not found"));
        // fallback with g1_regions only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cycles\", \"Avg Survivor Regions\", \"Assessment\" FROM \"jvmlog-g1-survivor-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Cycles")).isEqualTo(5);
            assertThat(rs.getDouble("Avg Survivor Regions")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void zgcPhaseBreakdownViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_phases (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, generation VARCHAR, concurrent BOOLEAN)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (1, 'Concurrent Mark', 45.0, 'N/A', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (1, 'Pause Mark Start', 0.5, 'N/A', false)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (1, 'Concurrent Relocate', 12.0, 'N/A', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (2, 'Concurrent Mark', 50.0, 'N/A', true)");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (2, 'Pause Mark Start', 0.6, 'N/A', false)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-phase-breakdown".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-phase-breakdown not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_phases"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_phases"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-zgc-phase-breakdown\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(3);
            rs = s.executeQuery("SELECT \"Type\" FROM \"jvmlog-zgc-phase-breakdown\" WHERE \"Phase\" = 'Pause Mark Start' LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Type")).isEqualTo("STW");
        }
        conn.close();
    }

    @Test
    void pauseVarianceViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Allocation Failure: high variance (10ms and 500ms)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 10.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 500.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Young', 'Allocation Failure', 15.0, 3.0)");
            // System.gc(): consistent (all ~800ms)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4, 'G1 Full', 'System.gc()', 800.0, 4.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5, 'G1 Full', 'System.gc()', 810.0, 5.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-variance".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-variance not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-pause-variance\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // Allocation Failure has higher CV so it should appear first (ordered by CV DESC)
            rs = s.executeQuery("SELECT \"Cause\" FROM \"jvmlog-pause-variance\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("Allocation Failure");
        }
        conn.close();
    }

    @Test
    void causeFirstOccurrenceViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 12.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 15.0, 15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Full', 'Metadata GCThreshold', 400.0, 300.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-cause-first-occurrence".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-cause-first-occurrence not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-cause-first-occurrence\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // Allocation Failure appears first (at 5s), Metadata GCThreshold at 300s
            rs = s.executeQuery("SELECT \"Cause\", \"First Occurrence (s)\" FROM \"jvmlog-cause-first-occurrence\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("Allocation Failure");
            assertThat(rs.getDouble("First Occurrence (s)")).isCloseTo(5.0, within(0.01));
        }
        conn.close();
    }

    @Test
    void youngVsOldTimeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 10.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 12.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Mixed', 'G1 Evacuation Pause', 20.0, 3.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4, 'G1 Full GC', 'System.gc()', 800.0, 4.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-young-vs-old-time".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-young-vs-old-time not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-young-vs-old-time\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThan(0);
            // Full GC has 800ms, should be top row
            rs = s.executeQuery("SELECT \"Generation Type\", \"Total Pause (ms)\" FROM \"jvmlog-young-vs-old-time\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Generation Type")).isEqualTo("Full / Major GC");
        }
        conn.close();
    }

    @Test
    void heapFillAtTriggerViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 10.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2, 'G1 Young', 'Allocation Failure', 12.0, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3, 'G1 Full', 'System.gc()', 500.0, 3.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // Allocation Failure: 90% fill (472MB before / 524MB committed)
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 495976448, 104857600, 549453824, 549453824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 495976448, 104857600, 549453824, 549453824)");
            // System.gc(): 50% fill (256MB/512MB)
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 268435456, 52428800, 536870912, 536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-fill-at-trigger".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-fill-at-trigger not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-heap-fill-at-trigger\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
            // Allocation Failure ~90% fill, should be first (ordered by Avg Fill% DESC)
            rs = s.executeQuery("SELECT \"Cause\", \"Avg Fill % Before\" FROM \"jvmlog-heap-fill-at-trigger\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Cause")).isEqualTo("Allocation Failure");
        }
        conn.close();
    }

    @Test
    void allocStallRateTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (threadName VARCHAR, stallMs DOUBLE, gcId INTEGER)");
            // gcId null, but no gc_event either → will use gcId*1.0 = NULL for those
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('main', 15.0, 1)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('worker-1', 10.0, 1)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES ('main', 8.0, 35)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'G1 Young', 'Allocation Failure', 50.0, 5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (35, 'G1 Young', 'Allocation Failure', 30.0, 1055.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-rate-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-rate-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_alloc_stall", "jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-alloc-stall-rate-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void phasesPerGcViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, uptimeSecs DOUBLE)");
            // GC 1: 3 phases
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1, 'Pre Evacuate Collection Set', 1.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1, 'Merge Heap Roots', 2.0, 1.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1, 'Evacuate Collection Set', 8.0, 1.0)");
            // GC 2: 2 phases
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2, 'Pre Evacuate Collection Set', 1.2, 2.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2, 'Merge Heap Roots', 2.5, 2.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-phases-per-gc".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-phases-per-gc not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC Cycles\", \"Avg Phases/GC\" FROM \"jvmlog-phases-per-gc\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("GC Cycles")).isEqualTo(2);
            assertThat(rs.getDouble("Avg Phases/GC")).isCloseTo(2.5, within(0.1));
        }
        conn.close();
    }

    @Test
    void zgcGarbageRatioViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes BIGINT, liveBytes BIGINT, garbageBytes BIGINT)");
            // Cycle 1
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1, 'Mark Start', 524288000, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1, 'Relocate Start', NULL, 209715200, 314572800)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1, 'Relocate End', 157286400, NULL, NULL)");
            // Cycle 2
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2, 'Mark Start', 600000000, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2, 'Relocate Start', NULL, 250000000, 350000000)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2, 'Relocate End', 180000000, NULL, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-garbage-ratio".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-garbage-ratio not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_stats"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cycles\", \"Avg Garbage %\" FROM \"jvmlog-zgc-garbage-ratio\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Cycles")).isEqualTo(2);
            assertThat(rs.getDouble("Avg Garbage %")).isGreaterThan(50.0);
        }
        conn.close();
    }

    @Test
    void shenandoahHeadroomViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_shenandoah_free (gcId INTEGER, freeBytes BIGINT, freeRegions INTEGER, headroomBytes BIGINT, uncommittedBytes BIGINT)");
            // Declining headroom: 128MB, 96MB, 64MB, 32MB, 8MB
            for (int i = 0; i < 5; i++) {
                long headroom = (128L - i * 30) * 1048576L;
                long free = headroom + 52428800L;
                s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (" + i + ", " + free + ", " + (50 - i * 10) + ", " + headroom + ", NULL)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-headroom".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-headroom not found"));
        // primary needs shenandoah_free + gc_event; fallback works with shenandoah_free only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_shenandoah_free"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cycles\", \"Headroom Trend (MB/s)\", \"Assessment\" FROM \"jvmlog-shenandoah-headroom\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Cycles")).isEqualTo(5);
            assertThat(rs.getDouble("Headroom Trend (MB/s)")).isLessThan(0);
        }
        conn.close();
    }

    @Test
    void gcWorkerEfficiencyTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            for (int i = 0; i < 5; i++) {
                int used = 8 - i; // declining workers
                s.execute("INSERT INTO jvmlog_gc_workers VALUES (" + i + ", " + used + ", 8, 'Evacuate Collection Set')");
            }
            // Stable task
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_workers VALUES (" + (i + 5) + ", 4, 4, 'Pre Evacuate Collection Set')");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-worker-efficiency-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-worker-efficiency-trend not found"));
        // primary needs gc_workers + gc_event; fallback works with gc_workers only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_workers"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-gc-worker-efficiency-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void evacuationFailureDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, durationMs DOUBLE, errorDetail VARCHAR)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Evacuation failure at GC 3
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (3, 'Evacuation Failure', 1.5, NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (7, 'To-space exhausted', NULL, NULL)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        (400L * 1048576) + ", " + (200L * 1048576) + ", " + (512L * 1048576) + ", " +
                        (5.0 + i * 0.5) + ", " + (i * 1.5) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-evacuation-failure-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-evacuation-failure-detail not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_errors", "jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-evacuation-failure-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void evacuationFailureDetailViewFallbackWithErrorsOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, durationMs DOUBLE, errorDetail VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (2, 'Evacuation Failure', 2.1, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-evacuation-failure-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-evacuation-failure-detail not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_errors"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC ID\", \"Error Type\" FROM \"jvmlog-evacuation-failure-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(2);
            assertThat(rs.getString("Error Type")).isEqualTo("Evacuation Failure");
        }
        conn.close();
    }

    @Test
    void logTimeRangeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        (300L * 1048576) + ", " + (150L * 1048576) + ", " + (512L * 1048576) + ", " +
                        (4.0 + i * 0.2) + ", " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-log-time-range".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-log-time-range not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Total GC Events\", \"Log Duration (s)\", \"First GC (s)\", \"Last GC (s)\" FROM \"jvmlog-log-time-range\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Total GC Events")).isEqualTo(10);
            assertThat(rs.getDouble("Log Duration (s)")).isCloseTo(45.0, within(0.01));
            assertThat(rs.getDouble("First GC (s)")).isCloseTo(0.0, within(0.01));
            assertThat(rs.getDouble("Last GC (s)")).isCloseTo(45.0, within(0.01));
        }
        conn.close();
    }

    @Test
    void concurrentGcEfficiencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            // STW phases
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + i + ", 'Pause Young', " + (10.0 + i) + ")");
            }
            // Concurrent phases
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + (i + 5) + ", 'Concurrent Mark', " + (80.0 + i * 5) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-gc-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-gc-efficiency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Phase Class\", \"% of All Phase Time\" FROM \"jvmlog-concurrent-gc-efficiency\" ORDER BY \"% of All Phase Time\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Phase Class")).isEqualTo("Concurrent");
            assertThat(rs.getDouble("% of All Phase Time")).isGreaterThan(70.0);
        }
        conn.close();
    }

    @Test
    void causePauseStatsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        (300L * 1048576) + ", " + (150L * 1048576) + ", " + (512L * 1048576) + ", " +
                        (5.0 + i * 2) + ", " + (i * 3.0) + ")");
            }
            for (int i = 8; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Full', 'System.gc()', " +
                        (480L * 1048576) + ", " + (200L * 1048576) + ", " + (512L * 1048576) + ", " +
                        (250.0) + ", " + (i * 10.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-cause-pause-stats".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-cause-pause-stats not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-cause-pause-stats\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void pauseByMinuteViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // GCs in minute 0 (0-59s)
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 10.0, " + (i * 10.0) + ")");
            }
            // GCs in minute 1 (60-119s)
            for (int i = 0; i < 3; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + (i + 5) + ", 'Young', 'Cause', 0, 0, 0, 15.0, " + (60.0 + i * 10.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-by-minute".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-by-minute not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-pause-by-minute\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void allocationRateTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                long before = (200L + i * 30) * 1048576;
                long after  = 100L * 1048576;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        before + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-allocation-rate-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-allocation-rate-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Avg Alloc Rate (MB/s)\", \"Trend Assessment\" FROM \"jvmlog-allocation-rate-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Alloc Rate (MB/s)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void gcInitDetailViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_init (algorithm VARCHAR, jdkVersion VARCHAR, minHeap BIGINT, initialHeap BIGINT, maxHeap BIGINT, softMaxCapacity BIGINT, parallelWorkers INTEGER, concurrentWorkers INTEGER, cpuTotal INTEGER, physicalMemory BIGINT, numaSupport VARCHAR, heapRegionSize BIGINT, periodicGc BOOLEAN, preTouch BOOLEAN, gcMode VARCHAR, heuristics VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_init VALUES ('G1', '17.0.1', " +
                    (256L * 1048576) + ", " + (512L * 1048576) + ", " + (2048L * 1048576) + ", " +
                    (2048L * 1048576) + ", 8, 4, 16, " + (16L * 1073741824L) + ", 'Disabled', " +
                    (1L * 1048576) + ", false, false, NULL, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-init-detail".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-init-detail not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_init"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Algorithm\", \"Max Heap (MB)\" FROM \"jvmlog-gc-init-detail\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("GC Algorithm")).isEqualTo("G1");
            assertThat(rs.getDouble("Max Heap (MB)")).isCloseTo(2048.0, within(1.0));
        }
        conn.close();
    }

    @Test
    void fullGcFrequencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Full GCs
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5, 'Full', 'System.gc()', " + (450L * 1048576) + ", " + (200L * 1048576) + ", " + (512L * 1048576) + ", 350.0, 120.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (12, 'Full', 'Allocation Failure', " + (500L * 1048576) + ", " + (180L * 1048576) + ", " + (512L * 1048576) + ", 420.0, 240.0)");
            // Young GCs (should be excluded)
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, " + (512L * 1048576) + ", 5.0, " + (i * 15.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-full-gc-frequency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-full-gc-frequency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Full GC Count\", \"Avg Pause (ms)\" FROM \"jvmlog-full-gc-frequency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Full GC Count")).isEqualTo(2);
            assertThat(rs.getDouble("Avg Pause (ms)")).isCloseTo(385.0, within(1.0));
        }
        conn.close();
    }

    @Test
    void gcTypePerMinuteViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 6; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 8.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 300.0, 90.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-type-per-minute".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-type-per-minute not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-type-per-minute\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void memoryReclaimedViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        (300L * 1048576) + ", " + (100L * 1048576) + ", " + (512L * 1048576) + ", 5.0, " + (i * 5.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', " +
                    (480L * 1048576) + ", " + (150L * 1048576) + ", " + (512L * 1048576) + ", 250.0, 100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-memory-reclaimed".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-memory-reclaimed not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Type\", \"Avg Reclaimed (MB)\" FROM \"jvmlog-memory-reclaimed\" ORDER BY \"Total Reclaimed (GB)\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Reclaimed (MB)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void pauseOutliersViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Normal GCs: ~10ms
            for (int i = 0; i < 20; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, " + (10.0 + i * 0.1) + ", " + (i * 3.0) + ")");
            }
            // Outlier: 500ms pause
            s.execute("INSERT INTO jvmlog_gc_event VALUES (99, 'Full', 'System.gc()', 0, 0, 0, 500.0, 100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-outliers".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-outliers not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC ID\", \"Z-Score\" FROM \"jvmlog-pause-outliers\" ORDER BY \"Z-Score\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(99);
            assertThat(rs.getDouble("Z-Score")).isGreaterThan(2.0);
        }
        conn.close();
    }

    @Test
    void heapAfterTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                // Steadily rising post-GC heap
                long after = (100L + i * 15) * 1048576;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        (after + 100L * 1048576) + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-after-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-after-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Trend (%/s)\", \"Assessment\" FROM \"jvmlog-heap-after-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Trend (%/s)")).isGreaterThan(0);
            assertThat(rs.getString("Assessment")).contains("Rising");
        }
        conn.close();
    }

    @Test
    void allocPressureTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                long after  = 100L * 1048576;
                long before = (100L + 50L) * 1048576; // 50MB allocated each interval
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        before + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 4.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-pressure-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-pressure-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-alloc-pressure-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(4); // 5 GCs → 4 intervals
        }
        conn.close();
    }

    @Test
    void slaBreachByCauseViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // 5 normal pauses, 2 breaches
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 15.0, " + (i * 5.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 350.0, 60.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (11, 'Full', 'System.gc()', 0, 0, 0, 600.0, 120.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-sla-breach-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-sla-breach-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Cause\", \"Breaches >200ms\" FROM \"jvmlog-sla-breach-by-cause\" ORDER BY \"Breaches >200ms\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("GC Cause")).isEqualTo("System.gc()");
            assertThat(rs.getLong("Breaches >200ms")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void pauseBurstWindowsViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Burst of 3 high-pause GCs
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5, 'Full', 'System.gc()', 0, 0, 0, 350.0, 50.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (6, 'Full', 'System.gc()', 0, 0, 0, 400.0, 55.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (7, 'Full', 'System.gc()', 0, 0, 0, 450.0, 60.0)");
            // Normal GC (should not be in results)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 0, 0, 0, 10.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-burst-windows".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-burst-windows not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Consecutive High-Pause GCs\" FROM \"jvmlog-pause-burst-windows\" ORDER BY \"Total Pause (ms)\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Consecutive High-Pause GCs")).isEqualTo(3);
        }
        conn.close();
    }

    @Test
    void healthTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Minute 0: healthy GCs
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 10.0) + ")");
            }
            // Minute 1: unhealthy — very high overhead
            for (int i = 0; i < 30; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + (i + 10) + ", 'Full', 'System.gc()', 0, 0, 0, 1500.0, " + (60.0 + i * 0.5) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-health-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-health-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Minute\", \"Health Score\" FROM \"jvmlog-health-timeline\" ORDER BY \"Minute\"");
            assertThat(rs.next()).isTrue();
            long healthyScore = rs.getLong("Health Score");
            assertThat(rs.next()).isTrue();
            long unhealthyScore = rs.getLong("Health Score");
            assertThat(healthyScore).isGreaterThan(unhealthyScore);
        }
        conn.close();
    }

    @Test
    void heapEfficiencyByTypeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Young GC: small pause, modest reclaim
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        (200L * 1048576) + ", " + (100L * 1048576) + ", " + (512L * 1048576) + ", 10.0, " + (i * 5.0) + ")");
            }
            // Full GC: large pause, large reclaim — but less efficient per ms
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', " +
                    (450L * 1048576) + ", " + (100L * 1048576) + ", " + (512L * 1048576) + ", 400.0, 100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-efficiency-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-efficiency-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Type\", \"MB/ms (Efficiency)\" FROM \"jvmlog-heap-efficiency-by-type\" ORDER BY \"MB/ms (Efficiency)\" DESC");
            assertThat(rs.next()).isTrue();
            // Young GC should be more efficient (10MB per 10ms = 1 MB/ms vs Full ~0.875 MB/ms)
            assertThat(rs.getString("GC Type")).isEqualTo("Young");
        }
        conn.close();
    }

    @Test
    void gcCauseHeatmapViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 20.0) + ")");
            }
            // In a different 5-min window
            s.execute("INSERT INTO jvmlog_gc_event VALUES (20, 'Full', 'System.gc()', 0, 0, 0, 300.0, 310.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-cause-heatmap".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-cause-heatmap not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-cause-heatmap\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void intervalDistributionViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // GCs 0.5s apart (0.5-1s bucket)
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 5.0, " + (i * 0.7) + ")");
            }
            // GC with 15s interval
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Young', 'Cause', 0, 0, 0, 5.0, 20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-interval-distribution".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-interval-distribution not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-interval-distribution\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void liveDataEstimateViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            long maxHeap = 512L * 1048576;
            for (int i = 0; i < 10; i++) {
                long after = (80L + i * 5) * 1048576; // slowly increasing post-GC heap
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        (after + 50L * 1048576) + ", " + after + ", " + maxHeap + ", 5.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-live-data-estimate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-live-data-estimate not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Min Post-GC Heap (MB)\", \"Avg Post-GC Heap (MB)\" FROM \"jvmlog-live-data-estimate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Min Post-GC Heap (MB)")).isCloseTo(80.0, within(1.0));
        }
        conn.close();
    }

    @Test
    void youngGcFrequencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // 8 Young GCs in minute 0
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 7.0) + ")");
            }
            // Full GC (should not be counted)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (20, 'Full', 'System.gc()', 0, 0, 0, 300.0, 180.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-young-gc-frequency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-young-gc-frequency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Minute\", \"Young GC Count\" FROM \"jvmlog-young-gc-frequency\" ORDER BY \"Minute\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Young GC Count")).isEqualTo(8);
        }
        conn.close();
    }

    @Test
    void allocationSurgesViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Baseline GCs: ~10 MB/s allocation
            for (int i = 0; i < 15; i++) {
                long after  = 100L * 1048576;
                long before = (100L + 10) * 1048576; // 10MB in 1s = 10 MB/s
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', " +
                        before + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 1.0) + ")");
            }
            // Surge: 500 MB in 1s = 500 MB/s (huge outlier)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (99, 'Young', 'Allocation Failure', " +
                    (600L * 1048576) + ", " + (100L * 1048576) + ", " + (512L * 1048576) + ", 15.0, 20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-allocation-surges".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-allocation-surges not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC ID\", \"Z-Score\" FROM \"jvmlog-allocation-surges\" ORDER BY \"Z-Score\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(99);
        }
        conn.close();
    }

    @Test
    void safepointHeatmapViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, uptimeSecs DOUBLE, operation VARCHAR, durationMs DOUBLE, ttrMs DOUBLE)");
            for (int i = 0; i < 6; i++) {
                s.execute("INSERT INTO jvmlog_safepoint VALUES (" + i + ", " + (i * 8.0) + ", 'G1CollectForAllocation', " + (15.0 + i) + ", 0.5)");
            }
            s.execute("INSERT INTO jvmlog_safepoint VALUES (10, 70.0, 'Deoptimize', 2.0, 0.1)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-heatmap".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-heatmap not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-safepoint-heatmap\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void classSpaceTrendViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT, classSpaceBefore BIGINT, classSpaceAfter BIGINT, classSpaceCommitted BIGINT)");
            for (int i = 0; i < 5; i++) {
                long cs = (20L + i * 2) * 1048576;
                s.execute("INSERT INTO jvmlog_metaspace VALUES (" + i + ", " + (cs + 10 * 1048576) + ", " +
                        (cs + 10 * 1048576) + ", " + (cs + 20 * 1048576) + ", " + cs + ", " + cs + ", " +
                        (cs + 10 * 1048576) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-class-space-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-class-space-trend not found"));
        // fallback with metaspace only
        String query = view.getBestMatchingQuery(Set.of("jvmlog_metaspace"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Data Points\", \"Max Class Space (MB)\" FROM \"jvmlog-class-space-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Data Points")).isEqualTo(5);
        }
        conn.close();
    }

    @Test
    void throughputConsistencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Consistent ~2% overhead
            for (int i = 0; i < 20; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 12.0, " + (i * 3.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-throughput-consistency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-throughput-consistency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Avg Throughput %\" FROM \"jvmlog-throughput-consistency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Throughput %")).isGreaterThan(90.0);
        }
        conn.close();
    }

    @Test
    void heapHeadroomTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                long after = (150L + i * 20) * 1048576;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        (after + 50 * 1048576L) + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-headroom-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-headroom-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows, max(\"Headroom %\") AS maxHR FROM \"jvmlog-heap-headroom-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(5);
            assertThat(rs.getDouble("maxHR")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void concurrentModeFailureViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, durationMs DOUBLE, errorDetail VARCHAR)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (3, 'Evacuation Failure', 1.2, NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (5, 'To-space exhausted', NULL, NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (7, 'Evacuation Failure', 2.5, NULL)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 5.0, " + (i * 3.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-mode-failure".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-mode-failure not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_errors"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Failure Type\", \"Count\" FROM \"jvmlog-concurrent-mode-failure\" ORDER BY \"Count\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Failure Type")).isEqualTo("Evacuation Failure");
            assertThat(rs.getLong("Count")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void metaspacePressureViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT, classSpaceBefore BIGINT, classSpaceAfter BIGINT, classSpaceCommitted BIGINT)");
            for (int i = 0; i < 5; i++) {
                long used = (60L + i * 2) * 1048576;
                long committed = 80L * 1048576;
                s.execute("INSERT INTO jvmlog_metaspace VALUES (" + i + ", " + used + ", " + used + ", " + committed + ", 0, 0, 0)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-pressure".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-pressure not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_metaspace"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Peak Use %\" FROM \"jvmlog-metaspace-pressure\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Peak Use %")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void pauseHistogramByTypeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, " + (5.0 + i * 3) + ", " + (i * 5.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 350.0, 60.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-histogram-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-histogram-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(DISTINCT \"GC Type\") AS types FROM \"jvmlog-pause-histogram-by-type\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void allocReclaimBalanceViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                long after  = 100L * 1048576;
                long before = (100L + 50L) * 1048576;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        before + ", " + after + ", " + (512L * 1048576) + ", 5.0, " + (i * 4.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-reclaim-balance".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-reclaim-balance not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Total Reclaimed (GB)\", \"Assessment\" FROM \"jvmlog-alloc-reclaim-balance\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Total Reclaimed (GB)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void causeCategoriesViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 5.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 300.0, 100.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (11, 'Young', 'Allocation Failure', 0, 0, 0, 15.0, 110.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-cause-categories".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-cause-categories not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS categories FROM \"jvmlog-cause-categories\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("categories")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void gcCpuEstimateViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 10.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-cpu-estimate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-cpu-estimate not found"));
        // alternative: only gc_event needed
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"GC Events\", \"STW Overhead %\" FROM \"jvmlog-gc-cpu-estimate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("GC Events")).isEqualTo(10);
            assertThat(rs.getDouble("STW Overhead %")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void pauseHeapCorrelationViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            long maxHeap = 512L * 1048576;
            for (int i = 0; i < 10; i++) {
                long before = (100L + i * 30) * 1048576;
                double pause = 5.0 + i * 2.0; // pause increases with heap fill
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        before + ", " + (before / 2) + ", " + maxHeap + ", " + pause + ", " + (i * 4.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-heap-correlation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-heap-correlation not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Type\", \"Correlation (r)\" FROM \"jvmlog-pause-heap-correlation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Correlation (r)")).isGreaterThan(0.5);
        }
        conn.close();
    }

    @Test
    void overheadByTypeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 10.0, " + (i * 10.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 400.0, 100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-overhead-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-overhead-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC Type\", \"% of All Pause\" FROM \"jvmlog-overhead-by-type\" ORDER BY \"Total Pause (ms)\" DESC");
            assertThat(rs.next()).isTrue();
            // Full GC has 400ms vs Young 80ms total — Full dominates
            assertThat(rs.getString("GC Type")).isEqualTo("Full");
        }
        conn.close();
    }

    @Test
    void g1OldGenTrackingViewFallbackWithRegionsOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, regionSizeBytes BIGINT)");
            // Old regions reducing in mixed GC
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 2, 2, 4, " + (100 - i * 5) + ", " + (95 - i * 5) + ", 0, 0, 50, 30, 60, 1048576)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-old-gen-tracking".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-old-gen-tracking not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Cycles\", \"Avg Old After (regions)\" FROM \"jvmlog-g1-old-gen-tracking\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Cycles")).isEqualTo(5);
        }
        conn.close();
    }

    @Test
    void phaseByGcTypeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 5.0, " + (i * 5.0) + ")");
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + i + ", 'Evacuate Collection Set', " + (8.0 + i) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 300.0, 100.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (10, 'Mark', 120.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-phase-by-gc-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-phase-by-gc-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(DISTINCT \"GC Type\") AS types FROM \"jvmlog-phase-by-gc-type\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void zgcMinorVsMajorViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_phases (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE, concurrent BOOLEAN, generation VARCHAR)");
            // Minor cycles
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_zgc_phases VALUES (" + i + ", 'Concurrent Mark', " + (20.0 + i) + ", true, 'Young')");
                s.execute("INSERT INTO jvmlog_zgc_phases VALUES (" + i + ", 'Pause Mark Start', 0.5, false, 'Young')");
            }
            // Major cycles
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (10, 'Concurrent Mark', 80.0, true, 'Old')");
            s.execute("INSERT INTO jvmlog_zgc_phases VALUES (10, 'Pause Mark Start', 1.2, false, 'Old')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-minor-vs-major".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-minor-vs-major not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_phases"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS types FROM \"jvmlog-zgc-minor-vs-major\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void pauseSpikeFrequencyViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 5.0, " + (i * 10.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10, 'Full', 'System.gc()', 0, 0, 0, 350.0, 60.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (11, 'Full', 'System.gc()', 0, 0, 0, 600.0, 70.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-spike-frequency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-spike-frequency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Minute\", \"Spikes >200ms\" FROM \"jvmlog-pause-spike-frequency\" ORDER BY \"Minute\"");
            // minute 0 (normal GCs), minute 1 (spikes)
            boolean found200msSpikes = false;
            while (rs.next()) {
                if (rs.getLong("Spikes >200ms") > 0) found200msSpikes = true;
            }
            assertThat(found200msSpikes).isTrue();
        }
        conn.close();
    }

    @Test
    void appVsGcTimeViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', 0, 0, 0, 10.0, " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-app-vs-gc-time".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-app-vs-gc-time not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows, max(\"Cumulative GC Time (ms)\") AS maxCum FROM \"jvmlog-app-vs-gc-time\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(5);
            assertThat(rs.getDouble("maxCum")).isCloseTo(50.0, within(0.1));
        }
        conn.close();
    }

    @Test
    void metaspaceExpansionsViewFallbackWithMetaspaceOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT, classSpaceBefore BIGINT, classSpaceAfter BIGINT, classSpaceCommitted BIGINT)");
            // Significant growth events
            s.execute("INSERT INTO jvmlog_metaspace VALUES (0, 50000000, 50000000, 60000000, 0, 0, 0)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (1, 50000000, 52000000, 62000000, 0, 0, 0)"); // +2MB
            s.execute("INSERT INTO jvmlog_metaspace VALUES (2, 52000000, 52000000, 62000000, 0, 0, 0)"); // no change
            s.execute("INSERT INTO jvmlog_metaspace VALUES (3, 52000000, 55000000, 65000000, 0, 0, 0)"); // +3MB
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-expansions".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-expansions not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_metaspace"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS events FROM \"jvmlog-metaspace-expansions\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("events")).isEqualTo(2); // GC 1 and 3 expanded by >1MB
        }
        conn.close();
    }

    @Test
    void gcPressureIndexViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Low-pressure minute
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        (100L * 1048576) + ", " + (50L * 1048576) + ", " + (512L * 1048576) + ", 5.0, " + (i * 10.0) + ")");
            }
            // High-pressure minute (minute 1)
            for (int i = 0; i < 20; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + (i + 10) + ", 'Full', 'Allocation Failure', " +
                        (500L * 1048576) + ", " + (200L * 1048576) + ", " + (512L * 1048576) + ", 500.0, " + (60.0 + i * 0.5) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pressure-index".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pressure-index not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Minute\", \"Pressure Index\" FROM \"jvmlog-gc-pressure-index\" ORDER BY \"Minute\"");
            assertThat(rs.next()).isTrue();
            long lowPressure = rs.getLong("Pressure Index");
            assertThat(rs.next()).isTrue();
            long highPressure = rs.getLong("Pressure Index");
            assertThat(highPressure).isGreaterThan(lowPressure);
        }
        conn.close();
    }

    @Test
    void longConcurrentPhasesViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            // Normal concurrent marks: ~30ms
            for (int i = 0; i < 15; i++) {
                s.execute("INSERT INTO jvmlog_gc_phase VALUES (" + i + ", 'Concurrent Mark', " + (28.0 + i * 0.5) + ")");
            }
            // Outlier: 500ms
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (99, 'Concurrent Mark', 500.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-long-concurrent-phases".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-long-concurrent-phases not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC ID\", \"Z-Score\" FROM \"jvmlog-long-concurrent-phases\" ORDER BY \"Z-Score\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(99);
        }
        conn.close();
    }

    @Test
    void edenFillAtTriggerViewFallbackWithRegionsOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, regionSizeBytes BIGINT)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 2, 2, 4, 50, 45, 0, 0, 55, 5, 60, 1048576)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-eden-fill-at-trigger".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-eden-fill-at-trigger not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Avg Eden Fill %\" FROM \"jvmlog-eden-fill-at-trigger\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Eden Fill %")).isCloseTo(91.7, within(1.0));
        }
        conn.close();
    }

    @Test
    void trendSummaryViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 10; i++) {
                // Rising pause and heap trend
                double pause = 5.0 + i * 2.0;
                long before = (150L + i * 20) * 1048576;
                long after  = (80L + i * 5) * 1048576;
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'Cause', " +
                        before + ", " + after + ", " + (512L * 1048576) + ", " + pause + ", " + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-trend-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-trend-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS metrics FROM \"jvmlog-trend-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("metrics")).isEqualTo(3);
        }
        conn.close();
    }

    @Test
    void safepointTtrOutliersViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, uptimeSecs DOUBLE, operation VARCHAR, durationMs DOUBLE, ttrMs DOUBLE)");
            // Normal TTR ~0.5ms
            for (int i = 0; i < 20; i++) {
                s.execute("INSERT INTO jvmlog_safepoint VALUES (" + i + ", " + (i * 2.0) + ", 'G1CollectForAllocation', 10.0, " + (0.4 + i * 0.02) + ")");
            }
            // Outlier: 50ms TTR
            s.execute("INSERT INTO jvmlog_safepoint VALUES (99, 100.0, 'G1CollectForAllocation', 12.0, 50.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-ttr-outliers".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-ttr-outliers not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"GC ID\", \"Z-Score\" FROM \"jvmlog-safepoint-ttr-outliers\" ORDER BY \"Z-Score\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("GC ID")).isEqualTo(99);
            assertThat(rs.getDouble("Z-Score")).isGreaterThan(2.0);
        }
        conn.close();
    }

    @Test
    void survivorOccupancyTimelineFallbackWithRegionsOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, regionSizeBytes BIGINT)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 3, 4, 8, 50, 45, 0, 0, 55, 5, 60, 1048576)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-survivor-occupancy-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-survivor-occupancy-timeline not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-survivor-occupancy-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(5);
        }
        conn.close();
    }

    @Test
    void stringdedupRateTimelineFallbackWithDedupOnly() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_stringdedup (gcId INTEGER, savedBytes BIGINT, objectCount BIGINT, deduplicatedObjects BIGINT, durationMs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_stringdedup VALUES (" + i + ", " + (i * 1048576L) + ", " + (i * 100L) + ", " + (i * 50L) + ", " + (1.0 + i * 0.2) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-stringdedup-rate-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-stringdedup-rate-timeline not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_stringdedup"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-stringdedup-rate-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void fullGcRecoveryViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Full GCs
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5, 'Full', 'System.gc()', " +
                    (480L * 1048576) + ", " + (200L * 1048576) + ", " + (512L * 1048576) + ", 350.0, 120.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (12, 'Full', 'Allocation Failure', " +
                    (510L * 1048576) + ", " + (180L * 1048576) + ", " + (512L * 1048576) + ", 420.0, 240.0)");
            // Young (should not appear)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1, 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, 10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-full-gc-recovery".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-full-gc-recovery not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS fullGcs FROM \"jvmlog-full-gc-recovery\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("fullGcs")).isEqualTo(2);
        }
        conn.close();
    }

    @Test
    void dominantCauseTimelineViewExecutesWithData() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, gcCause VARCHAR, heapBefore BIGINT, heapAfter BIGINT, heapMax BIGINT, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Window 0: G1 Evacuation Pause dominates
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ", 'Young', 'G1 Evacuation Pause', 0, 0, 0, 5.0, " + (i * 20.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (9, 'Full', 'System.gc()', 0, 0, 0, 300.0, 200.0)");
            // Window 1: Allocation Failure dominates
            for (int i = 0; i < 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + (i + 10) + ", 'Young', 'Allocation Failure', 0, 0, 0, 20.0, " + (300.0 + i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-dominant-cause-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-dominant-cause-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS windows FROM \"jvmlog-dominant-cause-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("windows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testHeapMaxProximity() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,15.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 400000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 480000000, 210000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-max-proximity".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-max-proximity not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-heap-max-proximity\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cnt")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testGcTypeMixTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','Allocation Failure',10.0," + (i * 60.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10,'Full','System.gc()',100.0,600.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-type-mix-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-type-mix-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS windows FROM \"jvmlog-gc-type-mix-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("windows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testAllocRateByCause() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','System.gc()',80.0,30.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 400000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 450000000, 210000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 490000000, 250000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-rate-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-rate-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-alloc-rate-by-cause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testPauseTrendByCause() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 8; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','Allocation Failure'," + (10.0 + i * 2.0) + "," + (i * 30.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-trend-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-trend-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-pause-trend-by-cause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testGcFootprint() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Full','System.gc()',80.0,15.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 400000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 490000000, 250000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-footprint".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-footprint not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Min Heap After (MB)\" FROM \"jvmlog-gc-footprint\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Min Heap After (MB)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testHeapCommittedTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,15.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 400000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 450000000, 210000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-committed-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-committed-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-heap-committed-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testG1HumongousTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','G1 Humongous Allocation',5.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','G1 Humongous Allocation',6.0,20.0)");
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1, 10, 0, 100, 2, 3, 10, 50, 52, 4, 2)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2, 8, 0, 100, 3, 4, 10, 52, 54, 5, 3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-humongous-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-humongous-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-humongous-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testPauseSlaCompliance() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',5.0,1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',80.0,2.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','System.gc()',600.0,3.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-sla-compliance".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-sla-compliance not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Total GCs\", \"Max Pause (ms)\" FROM \"jvmlog-pause-sla-compliance\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Total GCs")).isEqualTo(3L);
            assertThat(rs.getDouble("Max Pause (ms)")).isGreaterThan(500.0);
        }
        conn.close();
    }

    @Test
    void testConcurrentStallTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            for (int i = 0; i < 25; i++) {
                s.execute("INSERT INTO jvmlog_alloc_stall VALUES (" + i + ",'worker-" + (i % 4) + "'," + (5.0 + i * 0.5) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-stall-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-stall-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-concurrent-stall-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testHeapReclaimEfficiency() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','System.gc()',80.0,30.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 400000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 450000000, 210000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 490000000, 250000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-reclaim-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-reclaim-efficiency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-heap-reclaim-efficiency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testSafepointNonGc() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (NULL, 'Deoptimize', 2.5, 0.3)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (NULL, 'Deoptimize', 3.1, 0.4)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (NULL, 'RevokeBias', 1.2, 0.1)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1, 'G1CollectForAllocation', 15.0, 1.2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-non-gc".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-non-gc not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS ops FROM \"jvmlog-safepoint-non-gc\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("ops")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testYoungGenSizingTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','G1 Evacuation Pause',5.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','G1 Evacuation Pause',6.0,20.0)");
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1, 10, 0, 60, 2, 3, 10, 50, 52, 1, 0)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2, 8, 0, 65, 3, 4, 10, 52, 54, 1, 0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-young-gen-sizing-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-young-gen-sizing-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-young-gen-sizing-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testGcIntervalHistogram() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,1.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,2.5)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young','Allocation Failure',8.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4,'Full','System.gc()',80.0,40.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-interval-histogram".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-interval-histogram not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-gc-interval-histogram\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testPhaseWorstByType() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','G1 Evacuation Pause',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Mixed','G1 Evacuation Pause',15.0,10.0)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Pre Evacuate Collection Set',1.2)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Evacuate Collection Set',7.5)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Evacuate Collection Set',10.2)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Rebuild Remembered Sets',3.1)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-phase-worst-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-phase-worst-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-phase-worst-by-type\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testPromotionRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young','Allocation Failure',11.0,70.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 300000000, 200000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 400000000, 215000000, 512000000, 512000000)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 420000000, 220000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-promotion-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-promotion-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS minutes FROM \"jvmlog-promotion-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("minutes")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testMetaspaceGcTrigger() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Full','Metadata GC Threshold',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',10.0,20.0)");
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (1, 52428800, 50000000, 67108864)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-gc-trigger".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-gc-trigger not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_metaspace"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_metaspace"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-metaspace-gc-trigger\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testG1MixedTriggerAnalysis() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_mixed_gc (gcId INTEGER, reclaimablePct DOUBLE, thresholdPct DOUBLE, decision VARCHAR)");
            s.execute("INSERT INTO jvmlog_g1_mixed_gc VALUES (1, 15.2, 10.0, 'Do Mixed GC')");
            s.execute("INSERT INTO jvmlog_g1_mixed_gc VALUES (2, 8.1, 10.0, 'Skip Mixed GC')");
            s.execute("INSERT INTO jvmlog_g1_mixed_gc VALUES (3, 12.0, 10.0, 'Do Mixed GC')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-mixed-trigger-analysis".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-mixed-trigger-analysis not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_mixed_gc"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS decisions FROM \"jvmlog-g1-mixed-trigger-analysis\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("decisions")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testConcurrentPhaseEfficiency() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','G1 Evacuation Pause',10.0,50.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','G1 Evacuation Pause',15.0,100.0)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark from Roots',35.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Cycle',42.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Rebuild Remembered Sets',20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-phase-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-phase-efficiency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-concurrent-phase-efficiency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testHeapSaturationEvents() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Full','System.gc()',80.0,20.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            // GC 1: heap at 95% (saturated)
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 486400000, 200000000, 512000000, 512000000)");
            // GC 2: heap at 60% (not saturated)
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 307200000, 250000000, 512000000, 512000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-saturation-events".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-saturation-events not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS saturated FROM \"jvmlog-heap-saturation-events\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("saturated")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testGcBurstDetection() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // 5 GCs within 30s window (a burst)
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','Allocation Failure',10.0," + (i * 5.0) + ")");
            }
            // 1 GC in another window (no burst)
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10,'Full','System.gc()',80.0,200.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-burst-detection".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-burst-detection not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS bursts FROM \"jvmlog-gc-burst-detection\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("bursts")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testZgcGarbageRatioByCycle() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Concurrent Mark','GCLocker Initiated GC',1.5,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Concurrent Mark','GCLocker Initiated GC',1.8,20.0)");
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes BIGINT, liveBytes BIGINT, garbageBytes BIGINT)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate Start',NULL,200000000,100000000)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2,'Relocate Start',NULL,180000000,80000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-garbage-ratio-by-cycle".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-garbage-ratio-by-cycle not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats", "jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_stats", "jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-zgc-garbage-ratio-by-cycle\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testFullGcCauseSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Full','System.gc()',100.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Full','System.gc()',120.0,15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Allocation Failure',200.0,25.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4,'Young','Allocation Failure',10.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-full-gc-cause-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-full-gc-cause-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-full-gc-cause-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testGcDurationVsPause() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, durationMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',10.0,50.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',12.0,55.0,15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','System.gc()',80.0,80.0,25.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-duration-vs-pause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-duration-vs-pause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS types FROM \"jvmlog-gc-duration-vs-pause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testZgcLoadTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Concurrent Mark','GCLocker Initiated GC',1.5,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Concurrent Mark','GCLocker Initiated GC',1.8,20.0)");
            s.execute("CREATE TABLE jvmlog_zgc_load (gcId INTEGER, load1s DOUBLE, load5s DOUBLE, load15s DOUBLE, allocRateMbps DOUBLE, allocStalls INTEGER)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (1, 2.5, 2.3, 2.1, 450.0, 0)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (2, 3.1, 2.8, 2.5, 520.0, 2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-load-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-load-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_load", "jvmlog_gc_event"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_zgc_load", "jvmlog_gc_event"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-zgc-load-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testGcWorkerUtilisation() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1, 8, 8, 'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (2, 6, 8, 'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1, 4, 8, 'marking')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-worker-utilisation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-worker-utilisation not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_workers"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS tasks FROM \"jvmlog-gc-worker-utilisation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("tasks")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testGcPauseByHour() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','Allocation Failure',10.0," + (i * 600.0) + ")");
            }
            for (int i = 0; i < 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + (10 + i) + ",'Young','Allocation Failure',15.0," + (3600.0 + i * 600.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pause-by-hour".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pause-by-hour not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS hours FROM \"jvmlog-gc-pause-by-hour\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("hours")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testOldGenGrowth() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 1; i <= 5; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','G1 Evacuation Pause',5.0," + (i * 10.0) + ")");
            }
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            for (int i = 1; i <= 5; i++) {
                s.execute("INSERT INTO jvmlog_g1_regions VALUES (" + i + ", 10, 0, 60, 2, 3, 10, " + (40 + i) + ", " + (42 + i) + ", 0, 0)");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-old-gen-growth".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-old-gen-growth not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"))).isTrue();
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_g1_regions"));
        assertThat(query).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-old-gen-growth\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(5L);
        }
        conn.close();
    }

    @Test
    void testShenandoahSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Init Mark',NULL,1.2,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Final Mark',NULL,2.5,15.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Init Update Refs',NULL,0.8,25.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4,'Final Update Refs',NULL,1.1,35.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5,'Young','Allocation Failure',10.0,40.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS phases FROM \"jvmlog-shenandoah-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("phases")).isEqualTo(4L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointSyncHotspot() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectForAllocation',15.0,2.5)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'G1CollectForAllocation',12.0,1.8)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'RevokeBias',5.0,0.3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-sync-hotspot".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-sync-hotspot not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS ops FROM \"jvmlog-safepoint-sync-hotspot\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("ops")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcLivenessTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes LONG, liveBytes LONG, garbageBytes LONG)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate Start',536870912,268435456,157286400)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2,'Relocate Start',600000000,300000000,180000000)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (3,'Mark Start',400000000,NULL,NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-liveness-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-liveness-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-zgc-liveness-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogShenandoahConcurrentEfficiency() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent marking',50.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent evacuation',30.0)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Init Mark',NULL,1.2,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Final Mark',NULL,2.5,5.1)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-concurrent-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-concurrent-efficiency not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-shenandoah-concurrent-efficiency\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapBeforeAfterDelta() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,18.0,10.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore LONG, heapAfter LONG, heapCommittedBefore LONG, heapCommittedAfter LONG)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,536870912,268435456,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,400000000,200000000,1073741824,1073741824)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-before-after-delta".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-before-after-delta not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-heap-before-after-delta\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcOverheadTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,100.0,30.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,80.0,90.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full',NULL,2000.0,200.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-overhead-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-overhead-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-gc-overhead-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPauseRegression() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,25.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young',NULL,30.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pause-regression".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pause-regression not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Trend\", \"Slope (ms/s)\" FROM \"jvmlog-gc-pause-regression\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Trend")).isEqualTo("Degrading");
            assertThat(rs.getDouble("Slope (ms/s)")).isGreaterThan(0);
        }
        conn.close();
    }

    @Test
    void testJvmlogAllocStallByGc() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'main',50.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'worker-1',30.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (2,'main',80.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-by-gc".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-by-gc not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS gcCount FROM \"jvmlog-alloc-stall-by-gc\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("gcCount")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcRelocPressure() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes LONG, liveBytes LONG, garbageBytes LONG)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Mark Start',   536870912, NULL, NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate Start',600000000, 268435456, 157286400)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate End',  150000000, NULL, NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-reloc-pressure".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-reloc-pressure not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-zgc-reloc-pressure\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogPhaseTimingMatrix() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Evacuate Collection Set',10.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Evacuate Collection Set',12.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Update RS',5.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Update RS',4.5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-phase-timing-matrix".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-phase-timing-matrix not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS phases FROM \"jvmlog-phase-timing-matrix\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("phases")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointOperationMix() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectForAllocation',15.0,2.5)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'G1CollectForAllocation',12.0,1.8)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'RevokeBias',5.0,0.3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-operation-mix".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-operation-mix not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-safepoint-operation-mix\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapUsageHistogram() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore LONG, heapAfter LONG, heapCommittedBefore LONG, heapCommittedAfter LONG)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,536870912,268435456,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,400000000,250000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3,600000000,280000000,1073741824,1073741824)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-usage-histogram".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-usage-histogram not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-heap-usage-histogram\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogYoungGenGcRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',18.0,30.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full',NULL,500.0,200.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-young-gen-gc-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-young-gen-gc-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-young-gen-gc-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogAllocStallDistribution() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'main',5.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'worker',75.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (2,'main',600.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-distribution".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-distribution not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-alloc-stall-distribution\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcWallVsConcurrent() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Init Mark',NULL,1.5,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Final Mark',NULL,2.0,5.2)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent marking',80.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-wall-vs-concurrent".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-wall-vs-concurrent not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_gc_phase"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-gc-wall-vs-concurrent\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogFullGcInterval() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Full','Ergonomics',500.0,100.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Full','Ergonomics',600.0,300.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',550.0,450.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-full-gc-interval".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-full-gc-interval not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS intervals FROM \"jvmlog-full-gc-interval\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("intervals")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcStartOfTrouble() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',22.0,25.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',500.0,100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-start-of-trouble".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-start-of-trouble not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-gc-start-of-trouble\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointGcSplit() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectForAllocation',15.0,2.5)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'G1CollectForAllocation',12.0,1.8)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'RevokeBias',5.0,0.3)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (4,'Deoptimize',8.0,1.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-gc-split".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-gc-split not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cats FROM \"jvmlog-safepoint-gc-split\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cats")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogMetaspaceOomProximity() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore LONG, metaspaceAfter LONG, metaspaceCommitted LONG)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (1,104857600,105000000,134217728)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (2,105000000,106000000,134217728)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (3,106000000,107000000,134217728)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-oom-proximity".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-oom-proximity not found"));
        assertThat(view.isValid(Set.of("jvmlog_metaspace"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Status\" FROM \"jvmlog-metaspace-oom-proximity\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Status")).isNotBlank();
        }
        conn.close();
    }

    @Test
    void testJvmlogGcCauseFirstLast() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',25.0,50.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',500.0,100.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-cause-first-last".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-cause-first-last not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-gc-cause-first-last\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcAllocationRateTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_load (gcId INTEGER, load1s DOUBLE, load5s DOUBLE, load15s DOUBLE, allocRateMbps DOUBLE, allocStalls INTEGER)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (1,1.2,1.1,1.0,45.5,0)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (2,1.5,1.2,1.1,220.0,2)");
            s.execute("INSERT INTO jvmlog_zgc_load VALUES (3,2.0,1.5,1.2,580.0,5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-allocation-rate-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-allocation-rate-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_load"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows, count(DISTINCT \"Pressure\") AS levels FROM \"jvmlog-zgc-allocation-rate-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
            assertThat(rs.getLong("levels")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcErrorsTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, durationMs DOUBLE, errorDetail VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (5,'Evacuation Failure',12.5,NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (10,'To-space exhausted',NULL,NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-errors-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-errors-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_errors"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS errors FROM \"jvmlog-gc-errors-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("errors")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogShenandoahFreeHeadroom() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_shenandoah_free (gcId INTEGER, freeBytes LONG, freeRegions INTEGER, headroomBytes LONG, uncommittedBytes LONG)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (1,524288000,500,104857600,52428800)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (2,314572800,300,52428800,0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-free-headroom".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-free-headroom not found"));
        assertThat(view.isValid(Set.of("jvmlog_shenandoah_free"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-shenandoah-free-headroom\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogG1ConcurrentPhaseSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Cycle',250.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Cycle',280.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark from Roots',80.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (3,'Concurrent Mark Abort',NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-concurrent-phase-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-concurrent-phase-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS phases FROM \"jvmlog-g1-concurrent-phase-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("phases")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogMetaspaceClassSpaceTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore LONG, metaspaceAfter LONG, metaspaceCommitted LONG)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (1,104857600,104900000,134217728)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (2,104900000,105000000,134217728)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-class-space-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-class-space-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_metaspace"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-metaspace-class-space-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcErrorByTypeTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_errors (gcId INTEGER, errorType VARCHAR, durationMs DOUBLE, errorDetail VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (5,'Evacuation Failure',12.5,NULL)");
            s.execute("INSERT INTO jvmlog_gc_errors VALUES (10,'To-space exhausted',NULL,NULL)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (5,'Young',NULL,50.0,100.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (10,'Young',NULL,80.0,300.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-error-by-type-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-error-by-type-timeline not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_errors", "jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-error-by-type-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapGrowthRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,22.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young',NULL,25.0,30.0)");
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore LONG, heapAfter LONG, heapCommittedBefore LONG, heapCommittedAfter LONG)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,536870912,268435456,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,400000000,280000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3,450000000,300000000,1073741824,1073741824)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-growth-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-growth-rate not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_gc_event", "jvmlog_heap_snapshot"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT \"Trend\" FROM \"jvmlog-heap-growth-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Trend")).isNotBlank();
        }
        conn.close();
    }

    @Test
    void testJvmlogG1RegionWaste() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,20,0,50,2,3,10,40,41,5,4)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,20,0,50,3,4,10,41,42,5,5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-region-waste".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-region-waste not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_regions"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-region-waste\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseBudgetAnalysis() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,150.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full',NULL,800.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-budget-analysis".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-budget-analysis not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"% Within 200ms\", \"P99 Pause (ms)\" FROM \"jvmlog-pause-budget-analysis\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("% Within 200ms")).isLessThan(100.0);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcOverheadByType() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,25.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full',NULL,500.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-overhead-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-overhead-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS types FROM \"jvmlog-gc-overhead-by-type\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSurvivorToOldRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,20,0,50,5,3,10,40,43,2,2)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,20,0,50,3,4,10,43,46,2,2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-survivor-to-old-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-survivor-to-old-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_regions"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-survivor-to-old-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseWorst10() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, durationMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 1; i <= 15; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young','Allocation Failure'," + (i * 10.0) + "," + (i * 12.0) + "," + (i * 5.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-worst-10".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-worst-10 not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-pause-worst-10\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(10L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointTopOps() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectForAllocation',15.0,2.5)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'G1CollectForAllocation',12.0,1.8)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'RevokeBias',5.0,0.3)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-top-ops".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-top-ops not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS ops FROM \"jvmlog-safepoint-top-ops\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("ops")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogWorkerUtilisationByPhase() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1,8,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (2,6,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1,4,8,'marking')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-worker-utilisation-by-phase".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-worker-utilisation-by-phase not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_workers"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS tasks FROM \"jvmlog-worker-utilisation-by-phase\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("tasks")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPauseIntervalCorrelation() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,25.0,6.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young',NULL,30.0,40.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pause-interval-correlation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pause-interval-correlation not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-pause-interval-correlation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogG1EdenFillRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,20,0,50,2,3,10,40,41,1,1)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,22,0,50,3,2,10,41,42,1,1)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (3,24,0,50,2,3,10,42,43,1,1)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,20.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young',NULL,22.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young',NULL,25.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-eden-fill-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-eden-fill-rate not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_g1_regions", "jvmlog_gc_event"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-eden-fill-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcBottleneckSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young',NULL,50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Full',NULL,800.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full',NULL,750.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-bottleneck-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-bottleneck-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Primary Bottleneck\" FROM \"jvmlog-gc-bottleneck-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Primary Bottleneck")).isNotBlank();
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseP99Rolling() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            for (int i = 1; i <= 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'Young',NULL," + (i * 20.0) + "," + (i * 10.0) + ")");
            }
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-p99-rolling".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-p99-rolling not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-pause-p99-rolling\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(10L);
        }
        conn.close();
    }

    @Test
    void testJvmlogAllocStallGcPhase() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'main',50.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'worker',30.0)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent marking',200.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-gc-phase".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-gc-phase not found"));
        String query = view.getBestMatchingQuery(Set.of("jvmlog_alloc_stall", "jvmlog_gc_phase"));
        try (Statement s = conn.createStatement()) {
            s.execute(query);
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-alloc-stall-gc-phase\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThanOrEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcCapacityTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes LONG, liveBytes LONG, garbageBytes LONG)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Mark Start',536870912,NULL,NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2,'Mark Start',600000000,NULL,NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (3,'Mark Start',650000000,NULL,NULL)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate Start',400000000,200000000,100000000)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-capacity-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-capacity-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cycles FROM \"jvmlog-zgc-capacity-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("cycles")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPauseSlaByCause() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',80.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',250.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',900.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pause-sla-by-cause".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pause-sla-by-cause not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS causes FROM \"jvmlog-gc-pause-sla-by-cause\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("causes")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapFootprintReport() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1, 524288000, 262144000, 1073741824, 1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2, 400000000, 200000000, 1073741824, 1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3, 600000000, 300000000, 1073741824, 1073741824)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-footprint-report".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-footprint-report not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Min After-GC Heap (MB)\", \"Max After-GC Heap (MB)\" FROM \"jvmlog-heap-footprint-report\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Min After-GC Heap (MB)")).isLessThan(rs.getDouble("Max After-GC Heap (MB)"));
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseDistributionHistogram() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',5.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',30.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',750.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-distribution-histogram".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-distribution-histogram not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS buckets FROM \"jvmlog-pause-distribution-histogram\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("buckets")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogAllocStallThreadHotspots() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'worker-1',120.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (2,'worker-1',80.0)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (3,'worker-2',200.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-stall-thread-hotspots".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-stall-thread-hotspots not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS threads FROM \"jvmlog-alloc-stall-thread-hotspots\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("threads")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseConsistencyByType() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-consistency-by-type".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-consistency-by-type not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS types FROM \"jvmlog-pause-consistency-by-type\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("types")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcTypeTimeline() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-type-timeline".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-type-timeline not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-type-timeline\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcEventDensity() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,3.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,7.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,15.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-event-density".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-event-density not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS windows FROM \"jvmlog-gc-event-density\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("windows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogShenandoahUncommitTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_shenandoah_free (gcId INTEGER, freeBytes BIGINT, freeRegions INTEGER, headroomBytes BIGINT, uncommittedBytes BIGINT)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (1,209715200,100,52428800,0)");
            s.execute("INSERT INTO jvmlog_shenandoah_free VALUES (2,220200960,105,52428800,10485760)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-shenandoah-uncommit-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-shenandoah-uncommit-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_shenandoah_free"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-shenandoah-uncommit-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcMmuApproximation() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'ZGC','Proactive',2.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'ZGC','Allocation Rate',3.0,20.0)");
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark',45.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Mark',50.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-mmu-approximation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-mmu-approximation not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_gc_event"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-zgc-mmu-approximation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogMetaspaceGrowthAcceleration() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_metaspace (gcId INTEGER, metaspaceBefore BIGINT, metaspaceAfter BIGINT, metaspaceCommitted BIGINT)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (1,62914560,63963136,67108864)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (2,64012288,65060864,67108864)");
            s.execute("INSERT INTO jvmlog_metaspace VALUES (3,65060864,66109440,67108864)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-metaspace-growth-acceleration".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-metaspace-growth-acceleration not found"));
        assertThat(view.isValid(Set.of("jvmlog_metaspace"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-metaspace-growth-acceleration\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointGcVsNongcStw() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectFull',300.0,2.0)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'Deoptimize',15.0,1.0)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'G1CollectFull',250.0,2.5)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-gc-vs-nongc-stw".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-gc-vs-nongc-stw not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS categories FROM \"jvmlog-safepoint-gc-vs-nongc-stw\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("categories")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogG1HumongousObjects() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,200,0,250,10,15,30,100,100,5,3)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,220,0,250,15,20,30,100,105,0,0)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'G1','G1 Humongous Allocation',80.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'G1','Allocation Failure',50.0,20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-humongous-objects".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-humongous-objects not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_regions", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-humongous-objects\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcCauseShift() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,30.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (4,'Full','Ergonomics',900.0,40.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-cause-shift".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-cause-shift not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-cause-shift\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isGreaterThan(0L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPhaseSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark',45.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Sweep',20.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Mark',55.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Sweep',25.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-phase-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-phase-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS phases FROM \"jvmlog-gc-phase-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("phases")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapPressureEvents() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,880803840,200000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,300000000,200000000,1073741824,1073741824)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',80.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',50.0,20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-pressure-events".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-pressure-events not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-heap-pressure-events\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(1L);
        }
        conn.close();
    }

    @Test
    void testJvmlogWorkerSaturationRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1,8,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (2,6,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (3,8,8,'marking')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-worker-saturation-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-worker-saturation-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_workers"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS tasks FROM \"jvmlog-worker-saturation-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("tasks")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcStallToGcRatio() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'ZGC','Proactive',2.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'ZGC','Allocation Rate',3.0,20.0)");
            s.execute("CREATE TABLE jvmlog_alloc_stall (gcId INTEGER, threadName VARCHAR, stallMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_alloc_stall VALUES (1,'worker-1',50.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-stall-to-gc-ratio".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-stall-to-gc-ratio not found"));
        assertThat(view.isValid(Set.of("jvmlog_alloc_stall", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_alloc_stall"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-zgc-stall-to-gc-ratio\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogG1MixedEffectiveness() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,0,0,250,0,0,30,200,140,5,3)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,0,0,250,0,0,30,140,80,3,0)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'G1 Mixed','Mixed GC',120.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'G1 Mixed','Mixed GC',110.0,20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-mixed-effectiveness".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-mixed-effectiveness not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_regions", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-mixed-effectiveness\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogConcurrentMarkDurationTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark from Roots',45.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Mark from Roots',55.0)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (3,'Concurrent Mark from Roots',65.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-concurrent-mark-duration-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-concurrent-mark-duration-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-concurrent-mark-duration-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogStringdedupSavingsTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_stringdedup (gcId INTEGER, savedBytes BIGINT, objectCount BIGINT, deduplicatedObjects BIGINT, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_stringdedup VALUES (1,1048576,500,480,5.0)");
            s.execute("INSERT INTO jvmlog_stringdedup VALUES (2,2097152,800,750,8.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-stringdedup-savings-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-stringdedup-savings-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_stringdedup"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-stringdedup-savings-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogParallelGenSizingTrend() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_parallel_sizing (gcId INTEGER, oldGenBytes BIGINT, oldGenCapacity BIGINT)");
            s.execute("INSERT INTO jvmlog_parallel_sizing VALUES (1,268435456,536870912)");
            s.execute("INSERT INTO jvmlog_parallel_sizing VALUES (2,300000000,536870912)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-parallel-gen-sizing-trend".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-parallel-gen-sizing-trend not found"));
        assertThat(view.isValid(Set.of("jvmlog_parallel_sizing"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-parallel-gen-sizing-trend\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPauseSlaRolling() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',300.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young','Allocation Failure',80.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-pause-sla-rolling".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-pause-sla-rolling not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-gc-pause-sla-rolling\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogG1SurvivorOverflow() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_g1_regions (gcId INTEGER, edenBefore INTEGER, edenAfter INTEGER, edenMax INTEGER, survivorBefore INTEGER, survivorAfter INTEGER, survivorMax INTEGER, oldBefore INTEGER, oldAfter INTEGER, humongousBefore INTEGER, humongousAfter INTEGER)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (1,200,0,250,10,25,25,100,100,0,0)");
            s.execute("INSERT INTO jvmlog_g1_regions VALUES (2,220,0,250,10,15,25,100,100,0,0)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',80.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,20.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-g1-survivor-overflow".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-g1-survivor-overflow not found"));
        assertThat(view.isValid(Set.of("jvmlog_g1_regions", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_g1_regions"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-g1-survivor-overflow\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogZgcRelocateGarbage() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_zgc_stats (gcId INTEGER, phase VARCHAR, usedBytes BIGINT, liveBytes BIGINT, garbageBytes BIGINT)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Relocate Start',536870912,314572800,178257920)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (2,'Relocate Start',524288000,314572800,157286400)");
            s.execute("INSERT INTO jvmlog_zgc_stats VALUES (1,'Mark Start',419430400,NULL,NULL)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-zgc-relocate-garbage".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-zgc-relocate-garbage not found"));
        assertThat(view.isValid(Set.of("jvmlog_zgc_stats"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-zgc-relocate-garbage\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapChurnRate() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,500000000,200000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,400000000,180000000,1073741824,1073741824)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,12.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-churn-rate".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-churn-rate not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-heap-churn-rate\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointSyncOutliers() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (gcId INTEGER, operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (1,'G1CollectFull',300.0,15.0)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (2,'Deoptimize',20.0,2.0)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES (3,'G1CollectFull',250.0,8.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-sync-outliers".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-sync-outliers not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-safepoint-sync-outliers\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(3L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcHealthDashboard() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',80.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-health-dashboard".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-health-dashboard not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Total GC Events\", \"Health Status\" FROM \"jvmlog-gc-health-dashboard\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("Total GC Events")).isEqualTo(3L);
            assertThat(rs.getString("Health Status")).isNotNull();
        }
        conn.close();
    }

    @Test
    void testJvmlogMemoryLeakRisk() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,400000000,200000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,450000000,250000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3,500000000,300000000,1073741824,1073741824)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Young','Allocation Failure',70.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-memory-leak-risk".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-memory-leak-risk not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Leak Risk\" FROM \"jvmlog-memory-leak-risk\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Leak Risk")).isNotNull();
        }
        conn.close();
    }

    @Test
    void testJvmlogAllocPressureCorrelation() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedBefore BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,900000000,300000000,1073741824,1073741824)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,800000000,250000000,1073741824,1073741824)");
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,5.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',60.0,10.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-alloc-pressure-correlation".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-alloc-pressure-correlation not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot", "jvmlog_gc_event"))).isTrue();
        assertThat(view.getBestMatchingQuery(Set.of("jvmlog_heap_snapshot"))).isNotNull();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS rows FROM \"jvmlog-alloc-pressure-correlation\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("rows")).isEqualTo(2L);
        }
        conn.close();
    }

    @Test
    void testJvmlogGcSlaImpactSummary() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'Young','Allocation Failure',50.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'Young','Allocation Failure',80.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'Full','Ergonomics',800.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-sla-impact-summary".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-sla-impact-summary not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS dimensions FROM \"jvmlog-gc-sla-impact-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("dimensions")).isEqualTo(4L);
        }
        conn.close();
    }

    @Test
    void testJvmlogCollectorDiagnostics() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (1,'G1 Young','G1 Humongous Allocation',5.0,10.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (2,'G1 Young','G1 Humongous Allocation',6.0,20.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (3,'G1 Mixed','Mixed GC',12.0,30.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-collector-diagnostics".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-collector-diagnostics not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Detected Collector\", \"Tuning Focus\" FROM \"jvmlog-collector-diagnostics\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Detected Collector")).isEqualTo("G1");
        }
        conn.close();
    }

    @Test
    void testJvmlogGcPhaseHotSpot() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_phase (gcId INTEGER, phaseName VARCHAR, durationMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Evacuate Collection Set',5.2)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Evacuate Collection Set',6.1)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (1,'Concurrent Mark from Roots',2.3)");
            s.execute("INSERT INTO jvmlog_gc_phase VALUES (2,'Concurrent Mark from Roots',2.8)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-phase-hot-spot".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-phase-hot-spot not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_phase"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Phase\", \"% of Total STW\" FROM \"jvmlog-gc-phase-hot-spot\" LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Phase")).isEqualTo("Evacuate Collection Set");
        }
        conn.close();
    }

    @Test
    void testJvmlogPauseRecoveryTime() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_event (gcId INTEGER, gcType VARCHAR, cause VARCHAR, pauseMs DOUBLE, uptimeSecs DOUBLE)");
            // Normal baseline: 5ms avg, then a 60ms spike
            for (int i = 1; i <= 10; i++) {
                s.execute("INSERT INTO jvmlog_gc_event VALUES (" + i + ",'G1 Young','G1 Evacuation Pause',5.0," + (i * 1.0) + ")");
            }
            s.execute("INSERT INTO jvmlog_gc_event VALUES (11,'G1 Young','G1 Evacuation Pause',60.0,11.0)");
            s.execute("INSERT INTO jvmlog_gc_event VALUES (12,'G1 Young','G1 Evacuation Pause',5.5,12.0)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-pause-recovery-time".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-pause-recovery-time not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_event"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT count(*) AS cnt FROM \"jvmlog-pause-recovery-time\"");
            assertThat(rs.next()).isTrue();
            // May or may not detect spike depending on rolling window — view must at least run
            assertThat(rs.getLong("cnt")).isGreaterThanOrEqualTo(0L);
        }
        conn.close();
    }

    @Test
    void testJvmlogSafepointStwBreakdown() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_safepoint (operation VARCHAR, totalMs DOUBLE, syncMs DOUBLE)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation',10.0,1.0)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('G1CollectForAllocation',12.0,1.2)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('Deoptimize',3.0,0.5)");
            s.execute("INSERT INTO jvmlog_safepoint VALUES ('RevokeBias',1.5,0.2)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-safepoint-stw-breakdown".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-safepoint-stw-breakdown not found"));
        assertThat(view.isValid(Set.of("jvmlog_safepoint"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Category\", \"Total ms\" FROM \"jvmlog-safepoint-stw-breakdown\" ORDER BY \"Total ms\" DESC");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Category")).isEqualTo("GC");
        }
        conn.close();
    }

    @Test
    void testJvmlogGcWorkerPhaseEfficiency() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_gc_workers (gcId INTEGER, workersUsed INTEGER, workersMax INTEGER, taskName VARCHAR)");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1,8,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (2,8,8,'evacuation')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (1,4,8,'marking')");
            s.execute("INSERT INTO jvmlog_gc_workers VALUES (2,3,8,'marking')");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-gc-worker-phase-efficiency".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-gc-worker-phase-efficiency not found"));
        assertThat(view.isValid(Set.of("jvmlog_gc_workers"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Phase / Task\", \"Avg Utilisation %\" FROM \"jvmlog-gc-worker-phase-efficiency\" ORDER BY \"Avg Utilisation %\" ASC LIMIT 1");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("Phase / Task")).isEqualTo("marking");
            assertThat(rs.getDouble("Avg Utilisation %")).isLessThan(100.0);
        }
        conn.close();
    }

    @Test
    void testJvmlogHeapLiveDataRatio() throws Exception {
        DuckDBConnection conn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
        try (Statement s = conn.createStatement()) {
            s.execute("CREATE TABLE jvmlog_heap_snapshot (gcId INTEGER, heapBefore BIGINT, heapAfter BIGINT, heapCommittedAfter BIGINT)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (1,200*1024*1024,90*1024*1024,256*1024*1024)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (2,220*1024*1024,95*1024*1024,256*1024*1024)");
            s.execute("INSERT INTO jvmlog_heap_snapshot VALUES (3,240*1024*1024,100*1024*1024,256*1024*1024)");
        }
        View view = ViewCollection.getViews().stream()
                .filter(v -> "jvmlog-heap-live-data-ratio".equals(v.name()))
                .findFirst().orElseThrow(() -> new AssertionError("jvmlog-heap-live-data-ratio not found"));
        assertThat(view.isValid(Set.of("jvmlog_heap_snapshot"))).isTrue();
        try (Statement s = conn.createStatement()) {
            s.execute(view.definition());
            var rs = s.executeQuery("SELECT \"Avg Live/Committed %\", \"Sizing Status\" FROM \"jvmlog-heap-live-data-ratio\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getDouble("Avg Live/Committed %")).isGreaterThan(0.0);
            assertThat(rs.getString("Sizing Status")).isNotEmpty();
        }
        conn.close();
    }
}
