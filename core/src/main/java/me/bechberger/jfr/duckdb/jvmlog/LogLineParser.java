package me.bechberger.jfr.duckdb.jvmlog;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

public final class LogLineParser {

    private static final Pattern BRACKET = Pattern.compile("^\\[([^\\]]*)](.*)$", Pattern.DOTALL);
    private static final Pattern UPTIME  = Pattern.compile("^(\\d+\\.\\d+)s$");
    private static final Pattern ISO_TS  = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T.*");

    /** Handles both {@code +02:00} and {@code +0200} offset formats used by JVM logs. */
    private static final DateTimeFormatter TIMESTAMP_FMT = new DateTimeFormatterBuilder()
            .append(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
            .optionalStart().appendPattern("XXX").optionalEnd()
            .optionalStart().appendPattern("XX").optionalEnd()
            .toFormatter();

    private LogLineParser() {}

    public static Optional<LogLine> parse(String rawLine) {
        if (rawLine == null || rawLine.isEmpty() || rawLine.charAt(0) != '[') {
            return Optional.empty();
        }

        String remaining = rawLine;
        java.time.Instant timestamp = null;
        Double uptimeSecs = null;
        LogLevel level = null;
        List<String> tags = null;

        while (remaining.startsWith("[")) {
            var m = BRACKET.matcher(remaining);
            if (!m.matches()) break;
            String token = m.group(1).trim();
            remaining = m.group(2);

            if (ISO_TS.matcher(token).matches()) {
                try {
                    timestamp = OffsetDateTime.parse(token, TIMESTAMP_FMT).toInstant();
                } catch (DateTimeParseException ignored) {}
            } else if (UPTIME.matcher(token).matches()) {
                uptimeSecs = Double.parseDouble(token.replace("s", ""));
            } else {
                LogLevel parsed = LogLevel.parse(token);
                if (parsed != null) {
                    level = parsed;
                } else {
                    tags = Arrays.stream(token.split(","))
                            .map(String::trim)
                            .filter(t -> !t.isEmpty())
                            .toList();
                }
            }
        }

        if (tags == null) {
            return Optional.empty();
        }

        String message = remaining.stripLeading();
        return Optional.of(new LogLine(timestamp, uptimeSecs, level, tags, message));
    }
}
