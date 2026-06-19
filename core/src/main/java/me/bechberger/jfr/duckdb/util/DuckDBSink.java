package me.bechberger.jfr.duckdb.util;

import java.sql.SQLException;

/**
 * Narrow interface over a DuckDB connection covering only the operations
 * {@link me.bechberger.jfr.duckdb.BasicParallelImporter} actually uses.
 *
 * <p>Two implementations:
 * <ul>
 *   <li>{@link JdbcDuckDBSink} wraps a JDBC {@code DuckDBConnection} (CLI/server)
 *   <li>A WASM-side implementation bridges to {@code @duckdb/duckdb-wasm} via {@code @JS} natives;
 *       it returns an INSERT-batching {@link Appender}
 * </ul>
 */
public interface DuckDBSink extends AutoCloseable {

    /** Executes a statement (DDL or DML). */
    void execute(String sql) throws SQLException;

    /** Creates an appender for {@code table} in the default schema. */
    Appender createAppender(String table) throws SQLException;

    /**
     * Returns a sink backed by a separate connection sharing the same database, suitable for use
     * from another thread.
     */
    DuckDBSink duplicate() throws SQLException;

    @Override
    void close();
}
