package me.bechberger.jfr.duckdb;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.*;

/**
 * Verifies that importing the same recording as JFR and CJFR produces equivalent
 * DuckDB databases: same event-type tables, same column schemas, and comparable
 * row counts for GC tables.
 *
 * CJFR is a compressed format that may combine some events, so exact row-count
 * equality is not required — but schemas must match.
 */
class CjfrJfrEquivalenceTest {

    private Path jfrDb;
    private Path cjfrDb;
    private DuckDBConnection jfrConn;
    private DuckDBConnection cjfrConn;

    @BeforeEach
    void setup() throws Exception {
        jfrDb  = Files.createTempFile("equiv_jfr",  ".db"); Files.deleteIfExists(jfrDb);
        cjfrDb = Files.createTempFile("equiv_cjfr", ".db"); Files.deleteIfExists(cjfrDb);

        jfrConn  = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:" + jfrDb.toAbsolutePath());
        cjfrConn = (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:" + cjfrDb.toAbsolutePath());

        URL jfrUrl = getClass().getClassLoader().getResource("profile.jfr");
        assertThat(jfrUrl).as("profile.jfr test resource").isNotNull();
        new BasicParallelImporter(
                () -> new JdbcDuckDBSink((DuckDBConnection) jfrConn.duplicate()),
                new Options())
                .importRecording(Path.of(jfrUrl.toURI()));

        try (InputStream in = getClass().getClassLoader().getResourceAsStream("profile.cjfr")) {
            assertThat(in).as("profile.cjfr test resource").isNotNull();
            new BasicParallelImporter(
                    () -> new JdbcDuckDBSink((DuckDBConnection) cjfrConn.duplicate()),
                    new Options())
                    .importCjfrRecording(in);
        }
    }

    @AfterEach
    void teardown() throws Exception {
        if (jfrConn  != null) jfrConn.close();
        if (cjfrConn != null) cjfrConn.close();
        Files.deleteIfExists(jfrDb);
        Files.deleteIfExists(cjfrDb);
    }

    private Set<String> tableNames(DuckDBConnection conn) throws SQLException {
        Set<String> names = new TreeSet<>();
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SHOW TABLES")) {
            while (rs.next()) {
                String n = rs.getString(1);
                if (!n.startsWith("jfr$") && !n.equals("Events")
                        && !n.equals("RecordingInfo") && !n.equals("macros")
                        && !n.equals("EventIDs")) {
                    names.add(n);
                }
            }
        }
        return names;
    }

    private Map<String, String> columnTypes(DuckDBConnection conn, String table) throws SQLException {
        Map<String, String> cols = new LinkedHashMap<>();
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, table, "%")) {
            while (rs.next()) {
                cols.put(rs.getString("COLUMN_NAME"), rs.getString("TYPE_NAME"));
            }
        }
        return cols;
    }

    private long rowCount(DuckDBConnection conn, String table) throws SQLException {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT count(*) FROM \"" + table + "\"")) {
            return rs.next() ? rs.getLong(1) : 0;
        }
    }

    @Test
    void bothHaveGarbageCollectionTable() throws SQLException {
        assertThat(tableNames(jfrConn)).contains("GarbageCollection");
        assertThat(tableNames(cjfrConn)).contains("GarbageCollection");
    }

    @Test
    void garbageCollectionGcIdIsInteger() throws SQLException {
        for (DuckDBConnection conn : List.of(jfrConn, cjfrConn)) {
            String type = columnTypes(conn, "GarbageCollection").get("gcId");
            assertThat(type).as("gcId column type must be numeric, was: " + type)
                    .isIn("INTEGER", "INT32", "INT", "BIGINT", "INT64", "UINTEGER", "INT4");
        }
    }

    @Test
    void garbageCollectionColumnNamesMatch() throws SQLException {
        Set<String> jfrCols  = columnTypes(jfrConn,  "GarbageCollection").keySet();
        Set<String> cjfrCols = columnTypes(cjfrConn, "GarbageCollection").keySet();
        assertThat(cjfrCols)
                .as("CJFR GarbageCollection columns must match JFR")
                .containsExactlyInAnyOrderElementsOf(jfrCols);
    }

    @Test
    void garbageCollectionRowCountsAreComparable() throws SQLException {
        long jfrCount  = rowCount(jfrConn,  "GarbageCollection");
        long cjfrCount = rowCount(cjfrConn, "GarbageCollection");
        assertThat(jfrCount).as("JFR GC rows").isGreaterThan(0);
        assertThat(cjfrCount).as("CJFR GC rows").isGreaterThan(0);
        double ratio = (double) Math.max(jfrCount, cjfrCount) / Math.min(jfrCount, cjfrCount);
        assertThat(ratio)
                .as("GC row count ratio (JFR=%d, CJFR=%d) must be within 10%%", jfrCount, cjfrCount)
                .isLessThanOrEqualTo(1.1);
    }

    @Test
    void cjfrTablesAreSubsetOfJfrTables() throws SQLException {
        Set<String> jfrTables  = tableNames(jfrConn);
        Set<String> cjfrTables = tableNames(cjfrConn);
        assertThat(jfrTables)
                .as("Every CJFR table must also exist in the JFR import")
                .containsAll(cjfrTables);
    }

    @Test
    void commonTableColumnSchemasMatch() throws SQLException {
        Set<String> common = new TreeSet<>(tableNames(cjfrConn));
        common.retainAll(tableNames(jfrConn));

        // JFR expands nested structs to flat columns (e.g. stackTrace → stackTrace$length,
        // stackTrace$methods, …). CJFR keeps them as a single struct column. This means CJFR
        // may have a column "foo" where JFR has "foo$bar", "foo$baz", etc. We verify that every
        // CJFR column either exists verbatim in JFR columns, or is the struct-prefix of at least
        // one JFR "$"-expanded column — and that there are no truly unknown CJFR columns.
        List<String> unexplained = new ArrayList<>();
        for (String table : common) {
            Set<String> jfrCols  = columnTypes(jfrConn,  table).keySet();
            Set<String> cjfrCols = columnTypes(cjfrConn, table).keySet();
            for (String c : cjfrCols) {
                if (!jfrCols.contains(c)) {
                    // acceptable if JFR has at least one column with this prefix + "$"
                    boolean isStructPrefix = jfrCols.stream().anyMatch(j -> j.startsWith(c + "$"));
                    if (!isStructPrefix) {
                        unexplained.add(table + "." + c
                                + " (CJFR-only, not a known JFR struct prefix)");
                    }
                }
            }
        }
        assertThat(unexplained).as("CJFR columns with no corresponding JFR column or struct prefix")
                .isEmpty();
    }

    @Test
    void recordingStartMacroWorks() throws SQLException {
        for (DuckDBConnection conn : List.of(jfrConn, cjfrConn)) {
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery("SELECT recording_start() IS NOT NULL")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean(1)).isTrue();
            }
        }
    }

    // ── Numeric type parity tests ────────────────────────────────────────────────

    private static final Set<String> BIGINT_ALIASES =
            Set.of("BIGINT", "INT64", "LONG", "HUGEINT");
    private static final Set<String> INTEGER_ALIASES =
            Set.of("INTEGER", "INT32", "INT", "INT4");
    private static final Set<String> SMALLINT_ALIASES =
            Set.of("SMALLINT", "INT16", "SHORT", "INT2");

    /** jdk.UnsignedLongFlag.value — underlying long with @Unsigned → must be BIGINT in both. */
    @Test
    void unsignedLongFlagValueIsBigint() throws SQLException {
        Map<String, String> jfrCols  = columnTypes(jfrConn,  "UnsignedLongFlag");
        Map<String, String> cjfrCols = columnTypes(cjfrConn, "UnsignedLongFlag");
        assertThat(BIGINT_ALIASES).as("JFR UnsignedLongFlag.value must be BIGINT-class")
                .contains(jfrCols.get("value"));
        assertThat(BIGINT_ALIASES).as("CJFR UnsignedLongFlag.value must be BIGINT-class")
                .contains(cjfrCols.get("value"));
    }

    /** jdk.GCReferenceStatistics.count — underlying long with @Unsigned → must be BIGINT in both. */
    @Test
    void gcReferenceStatisticsCountIsBigint() throws SQLException {
        Map<String, String> jfrCols  = columnTypes(jfrConn,  "GCReferenceStatistics");
        Map<String, String> cjfrCols = columnTypes(cjfrConn, "GCReferenceStatistics");
        assertThat(BIGINT_ALIASES).as("JFR GCReferenceStatistics.count must be BIGINT-class")
                .contains(jfrCols.get("count"));
        assertThat(BIGINT_ALIASES).as("CJFR GCReferenceStatistics.count must be BIGINT-class")
                .contains(cjfrCols.get("count"));
    }

    /** jdk.MetaspaceChunkFreeListSummary chunk-count fields — underlying long → BIGINT in both. */
    @Test
    void metaspaceChunkCountsAreBigint() throws SQLException {
        Map<String, String> jfrCols  = columnTypes(jfrConn,  "MetaspaceChunkFreeListSummary");
        Map<String, String> cjfrCols = columnTypes(cjfrConn, "MetaspaceChunkFreeListSummary");
        for (String col : List.of("specializedChunks", "smallChunks", "mediumChunks", "humongousChunks")) {
            assertThat(BIGINT_ALIASES).as("JFR MetaspaceChunkFreeListSummary." + col + " must be BIGINT-class")
                    .contains(jfrCols.get(col));
            assertThat(BIGINT_ALIASES).as("CJFR MetaspaceChunkFreeListSummary." + col + " must be BIGINT-class")
                    .contains(cjfrCols.get(col));
        }
    }

    /** jdk.Compilation.compileLevel — underlying short with @Unsigned → must be SMALLINT in both. */
    @Test
    void compilationCompileLevelIsSmallint() throws SQLException {
        Map<String, String> jfrCols  = columnTypes(jfrConn,  "Compilation");
        Map<String, String> cjfrCols = columnTypes(cjfrConn, "Compilation");
        assertThat(SMALLINT_ALIASES).as("JFR Compilation.compileLevel must be SMALLINT-class")
                .contains(jfrCols.get("compileLevel"));
        assertThat(SMALLINT_ALIASES).as("CJFR Compilation.compileLevel must be SMALLINT-class")
                .contains(cjfrCols.get("compileLevel"));
    }

    /** jdk.ExecuteVMOperation.safepointId — underlying long with @Unsigned → BIGINT in both. */
    @Test
    void executeVMOperationSafepointIdIsBigint() throws SQLException {
        Map<String, String> jfrCols  = columnTypes(jfrConn,  "ExecuteVMOperation");
        Map<String, String> cjfrCols = columnTypes(cjfrConn, "ExecuteVMOperation");
        assertThat(BIGINT_ALIASES).as("JFR ExecuteVMOperation.safepointId must be BIGINT-class")
                .contains(jfrCols.get("safepointId"));
        assertThat(BIGINT_ALIASES).as("CJFR ExecuteVMOperation.safepointId must be BIGINT-class")
                .contains(cjfrCols.get("safepointId"));
    }
}
