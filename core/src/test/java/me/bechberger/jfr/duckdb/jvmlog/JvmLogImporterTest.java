package me.bechberger.jfr.duckdb.jvmlog;

import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.file.Path;
import java.sql.DriverManager;
import static org.assertj.core.api.Assertions.assertThat;

class JvmLogImporterTest {

    private static final Path LOGS_DIR =
            Path.of(System.getProperty("jdklogs.dir",
                    "../../../jdklogs/data"));

    private DuckDBConnection newConn() throws Exception {
        return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
    }

    @Test
    void g1LogProducesInitRows() throws Exception {
        var log = LOGS_DIR.resolve("head.G1.log");
        org.junit.jupiter.api.Assumptions.assumeTrue(log.toFile().exists(),
                "jdklogs data not found at " + LOGS_DIR);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(log, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).isNotBlank();
            }
        }
    }

    @Test
    void g1LogProducesUnknownLinesTable() throws Exception {
        var log = LOGS_DIR.resolve("head.G1.log");
        org.junit.jupiter.api.Assumptions.assumeTrue(log.toFile().exists());
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(log, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceGcInitTable(String logFile) throws Exception {
        var log = LOGS_DIR.resolve(logFile);
        org.junit.jupiter.api.Assumptions.assumeTrue(log.toFile().exists());
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(log, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM information_schema.tables WHERE table_name = 'jvmlog_gc_init'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isEqualTo(1);
            }
        }
    }
}
