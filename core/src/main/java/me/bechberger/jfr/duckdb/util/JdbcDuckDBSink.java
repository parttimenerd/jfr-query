package me.bechberger.jfr.duckdb.util;

import java.sql.SQLException;
import java.sql.Statement;
import org.duckdb.DuckDBConnection;

/** JDBC-backed {@link DuckDBSink} — wraps a {@link DuckDBConnection}. */
public final class JdbcDuckDBSink implements DuckDBSink {

    private final DuckDBConnection connection;

    public JdbcDuckDBSink(DuckDBConnection connection) {
        this.connection = connection;
    }

    public DuckDBConnection unwrap() {
        return connection;
    }

    @Override
    public void execute(String sql) throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute(sql);
        }
    }

    @Override
    public Appender createAppender(String table) throws SQLException {
        return new JdbcAppender(connection.createAppender(table));
    }

    @Override
    public DuckDBSink duplicate() throws SQLException {
        return new JdbcDuckDBSink((DuckDBConnection) connection.duplicate());
    }

    @Override
    public void close() {
        try {
            connection.close();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
