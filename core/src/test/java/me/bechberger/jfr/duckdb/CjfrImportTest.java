package me.bechberger.jfr.duckdb;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.*;

/**
 * Integration test: import a pre-built CJFR recording via
 * {@link BasicParallelImporter#importCjfrRecording(InputStream)}.
 *
 * The test resource {@code recording.cjfr} is a small real CJFR file
 * (copied from condensed-data project). No JFR→CJFR conversion is needed.
 */
class CjfrImportTest {

    private Path tmpDbFile;

    @BeforeEach
    void setup() throws IOException {
        tmpDbFile = Files.createTempFile("cjfr_test", ".db");
        Files.deleteIfExists(tmpDbFile);
    }

    @AfterEach
    void teardown() throws IOException {
        if (tmpDbFile != null) Files.deleteIfExists(tmpDbFile);
    }

    private InputStream cjfrStream() {
        InputStream is = getClass().getClassLoader().getResourceAsStream("test.cjfr");
        assertThat(is).as("test.cjfr must be on the test classpath").isNotNull();
        return is;
    }

    @Test
    void importCjfrPopulatesEventsTable() throws IOException, SQLException {
        DuckDBConnection conn = (DuckDBConnection)
                DriverManager.getConnection("jdbc:duckdb:" + tmpDbFile.toAbsolutePath());

        try (InputStream in = cjfrStream()) {
            new BasicParallelImporter(
                    () -> new JdbcDuckDBSink((DuckDBConnection) conn.duplicate()),
                    new Options())
                    .importCjfrRecording(in);
        }

        // Events meta-table must exist and have at least one row
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT sum(count) FROM Events")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong(1)).isGreaterThan(0L);
        }

        conn.close();
    }

    @Test
    void importCjfrRecordingInfoIsStored() throws IOException, SQLException {
        DuckDBConnection conn = (DuckDBConnection)
                DriverManager.getConnection("jdbc:duckdb:" + tmpDbFile.toAbsolutePath());

        try (InputStream in = cjfrStream()) {
            new BasicParallelImporter(
                    () -> new JdbcDuckDBSink((DuckDBConnection) conn.duplicate()),
                    new Options())
                    .importCjfrRecording(in);
        }

        // recording_start() macro must return a non-null timestamp
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT recording_start() IS NOT NULL")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1)).isTrue();
        }

        conn.close();
    }
}
