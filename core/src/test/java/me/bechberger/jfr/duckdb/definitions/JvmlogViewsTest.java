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
            "jvmlog-g1-regions", "jvmlog-zgc-cycle", "jvmlog-jfr-correlation",
            "jvmlog-gc-pause-summary", "jvmlog-gc-pause-by-type", "jvmlog-gc-phase-breakdown",
            "jvmlog-gc-init-summary", "jvmlog-gc-cumulative-pause", "jvmlog-g1-heap-expansion",
            "jvmlog-unknown-summary", "jvmlog-metaspace-timeline"
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
}
