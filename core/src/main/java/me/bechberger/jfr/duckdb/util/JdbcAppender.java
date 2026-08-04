package me.bechberger.jfr.duckdb.util;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import org.duckdb.DuckDBAppender;

/** Adapts a JDBC {@link DuckDBAppender} to the portable {@link Appender} interface. */
public final class JdbcAppender implements Appender {

    private final DuckDBAppender delegate;
    private final Method appendNullMethod;
    private final Field appenderRefField;

    public JdbcAppender(DuckDBAppender delegate) {
        this.delegate = delegate;
        // DuckDB 1.2.x removed the public appendNull() method; call it via reflection.
        Method nullMethod = null;
        Field refField = null;
        try {
            Class<?> nativeClass = Class.forName("org.duckdb.DuckDBNative");
            nullMethod = nativeClass.getDeclaredMethod("duckdb_jdbc_appender_append_null", ByteBuffer.class);
            nullMethod.setAccessible(true);
            refField = DuckDBAppender.class.getDeclaredField("appender_ref");
            refField.setAccessible(true);
        } catch (Exception e) {
            // fall back to append(String) null
        }
        this.appendNullMethod = nullMethod;
        this.appenderRefField = refField;
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
        if (appendNullMethod != null && appenderRefField != null) {
            try {
                ByteBuffer ref = (ByteBuffer) appenderRefField.get(delegate);
                appendNullMethod.invoke(null, ref);
            } catch (Exception e) {
                delegate.append((String) null);
            }
        } else {
            delegate.append((String) null);
        }
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

    // DuckDB TIMESTAMP range: 290309-12-22 (max) / 290308-01-10 (min) in practice DuckDB
    // uses the JDK LocalDate range which bottoms out at approximately year -999999999.
    // In practice CJFR files can contain sentinel Instants with extreme epoch-nanos values
    // (e.g. Instant.ofEpochSecond(0, Long.MIN_VALUE)) that fall outside LocalDate range.
    // Clamp to Instant.MIN / Instant.MAX to avoid DateTimeException from LocalDateTime.ofInstant.
    private static final Instant INSTANT_MIN_SAFE = Instant.parse("0001-01-01T00:00:00Z");
    private static final Instant INSTANT_MAX_SAFE = Instant.parse("9999-12-31T23:59:59Z");

    @Override
    public void append(Instant v) throws SQLException {
        Instant clamped = v.isBefore(INSTANT_MIN_SAFE) ? INSTANT_MIN_SAFE
                        : v.isAfter(INSTANT_MAX_SAFE)  ? INSTANT_MAX_SAFE
                        : v;
        LocalDateTime ldt = LocalDateTime.ofInstant(clamped, ZoneOffset.UTC);
        delegate.appendLocalDateTime(ldt);
    }

    @Override
    public void append(int[] arr) throws SQLException {
        if (arr == null) {
            appendNull();
            return;
        }
        // DuckDB 1.2.x removed append(int[]) — encode as a string literal instead.
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < arr.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(arr[i]);
        }
        sb.append("]");
        delegate.append(sb.toString());
    }

    @Override
    public void close() throws SQLException {
        delegate.close();
    }
}
