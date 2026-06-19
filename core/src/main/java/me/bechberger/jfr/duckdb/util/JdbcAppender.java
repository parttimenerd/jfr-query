package me.bechberger.jfr.duckdb.util;

import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetTime;
import org.duckdb.DuckDBAppender;

/** Adapts a JDBC {@link DuckDBAppender} to the portable {@link Appender} interface. */
public final class JdbcAppender implements Appender {

    private final DuckDBAppender delegate;

    public JdbcAppender(DuckDBAppender delegate) {
        this.delegate = delegate;
    }

    @Override
    public void beginRow() throws SQLException {
        delegate.beginRow();
    }

    @Override
    public void endRow() throws SQLException {
        delegate.endRow();
    }

    @Override
    public void appendNull() throws SQLException {
        delegate.appendNull();
    }

    @Override
    public void append(boolean v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(byte v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(short v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(int v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(long v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(float v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(double v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(String v) throws SQLException {
        delegate.append(v);
    }

    @Override
    public void append(Instant v) throws SQLException {
        delegate.append(v.atOffset(OffsetTime.now().getOffset()).toLocalDateTime());
    }

    @Override
    public void append(int[] arr) throws SQLException {
        delegate.append(arr);
    }

    @Override
    public void close() throws SQLException {
        delegate.close();
    }
}
