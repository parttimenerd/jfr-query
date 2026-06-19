package me.bechberger.jfr.duckdb.util;

import java.sql.SQLException;
import java.time.Instant;

/**
 * Narrow appender API mirroring the subset of {@link org.duckdb.DuckDBAppender} that
 * {@link me.bechberger.jfr.duckdb.BasicParallelImporter} actually uses.
 *
 * <p>The JDBC-backed implementation ({@link JdbcAppender}) delegates straight to the DuckDB JDBC
 * driver. The WASM-backed implementation buffers values into an INSERT batch and flushes via JS.
 */
public interface Appender extends AutoCloseable {

    void beginRow() throws SQLException;

    void endRow() throws SQLException;

    void appendNull() throws SQLException;

    void append(boolean v) throws SQLException;

    void append(byte v) throws SQLException;

    void append(short v) throws SQLException;

    void append(int v) throws SQLException;

    void append(long v) throws SQLException;

    void append(float v) throws SQLException;

    void append(double v) throws SQLException;

    void append(String v) throws SQLException;

    void append(Instant v) throws SQLException;

    /** Append an array column (DuckDB array of integer). */
    void append(int[] arr) throws SQLException;

    @Override
    void close() throws SQLException;
}
