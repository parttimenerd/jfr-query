package me.bechberger.jfr.duckdb.util;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.duckdb.DuckDBConnection;

public class SQLUtil {

    public static Set<String> getTableNames(DuckDBConnection connection) throws SQLException {
        ResultSet rs = connection.createStatement().executeQuery("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE';
                """);
        Set<String> tableNames = new HashSet<>();
        while (rs.next()) {
            tableNames.add(rs.getString(1));
        }
        return tableNames;
    }

    public static void append(Appender appender, Instant value) throws SQLException {
        if (value == null) {
            appender.appendNull();
            return;
        }
        appender.append(value);
    }

    public static void append(Appender appender, Duration value) throws SQLException {
        appender.append(value.toNanos() + "ns");
    }
}
