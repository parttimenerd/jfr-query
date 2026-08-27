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
            "jvmlog-safepoint-summary", "jvmlog-safepoint-timeline", "jvmlog-alloc-stall-summary"
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
            var rs = s.executeQuery("SELECT algorithm, parallelWorkers, cpuTotal FROM \"jvmlog-gc-init-summary\"");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString("algorithm")).isEqualTo("G1");
            assertThat(rs.getInt("parallelWorkers")).isEqualTo(10);
            assertThat(rs.getInt("cpuTotal")).isEqualTo(12);
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
}
