package me.bechberger.jfr.duckdb.jvmlog;

public enum LogLevel {
    TRACE, DEBUG, INFO, WARNING, ERROR;

    public static LogLevel parse(String s) {
        return switch (s.trim().toLowerCase()) {
            case "trace"             -> TRACE;
            case "debug"             -> DEBUG;
            case "info"              -> INFO;
            case "warning", "warn"   -> WARNING;
            case "error"             -> ERROR;
            default                  -> null;
        };
    }
}
