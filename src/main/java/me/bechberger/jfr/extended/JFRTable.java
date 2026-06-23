package me.bechberger.jfr.extended;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * JFR table format with strongly typed cells
 */
public class JFRTable {

    /**
     * Represents a cell value in the JFR table
     */
    public sealed interface Cell permits
        StringCell, NumberCell, DurationCell, TimestampCell,
        MemorySizeCell, RateCell, BooleanCell, FloatingPointCell, NullCell {

        CellType getType();
        Object getValue();
        String getDisplayValue();
    }

    /**
     * Cell types supported by JFR tables
     */
    public enum CellType {
        STRING, NUMBER, DURATION, TIMESTAMP, MEMORY_SIZE, RATE, BOOLEAN, FLOATING_POINT, NULL
    }

    // Cell implementations
    public record StringCell(String value) implements Cell {
        @Override
        public CellType getType() { return CellType.STRING; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return value; }
    }

    public record NumberCell(long value) implements Cell {
        @Override
        public CellType getType() { return CellType.NUMBER; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return String.valueOf(value); }
    }

    public record DurationCell(Duration value) implements Cell {
        @Override
        public CellType getType() { return CellType.DURATION; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return formatDuration(value); }

        private String formatDuration(Duration duration) {
            long nanos = duration.toNanos();
            if (nanos < 1000) return nanos + "ns";
            if (nanos < 1000_000) return (nanos / 1000) + "us";
            if (nanos < 1000_000_000) return (nanos / 1000_000) + "ms";
            return duration.toSeconds() + "s";
        }
    }

    public record TimestampCell(Instant value) implements Cell {
        @Override
        public CellType getType() { return CellType.TIMESTAMP; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return value.toString(); }
    }

    public record MemorySizeCell(long bytes) implements Cell {
        @Override
        public CellType getType() { return CellType.MEMORY_SIZE; }
        @Override
        public Object getValue() { return bytes; }
        @Override
        public String getDisplayValue() { return formatMemorySize(bytes); }

        private String formatMemorySize(long bytes) {
            if (bytes < 1024) return bytes + "B";
            if (bytes < 1024 * 1024) return (bytes / 1024) + "KB";
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)) + "MB";
            return (bytes / (1024 * 1024 * 1024)) + "GB";
        }
    }

    public record RateCell(double value, String unit) implements Cell {
        @Override
        public CellType getType() { return CellType.RATE; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return value + "/" + unit; }
    }

    public record BooleanCell(boolean value) implements Cell {
        @Override
        public CellType getType() { return CellType.BOOLEAN; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return String.valueOf(value); }
    }

    public record FloatingPointCell(double value) implements Cell {
        @Override
        public CellType getType() { return CellType.FLOATING_POINT; }
        @Override
        public Object getValue() { return value; }
        @Override
        public String getDisplayValue() { return String.valueOf(value); }
    }

    public record NullCell() implements Cell {
        @Override
        public CellType getType() { return CellType.NULL; }
        @Override
        public Object getValue() { return null; }
        @Override
        public String getDisplayValue() { return "N/A"; }
    }

    /**
     * Represents a column in the JFR table
     */
    public record Column(String name, CellType type, Optional<String> description) {
        public Column(String name, CellType type) {
            this(name, type, Optional.empty());
        }
    }

    /**
     * Represents a row in the JFR table
     */
    public record Row(List<Cell> cells) {
        public Cell getCell(int index) {
            return cells.get(index);
        }

        public Optional<Cell> getCellByName(String columnName, List<Column> columns) {
            for (int i = 0; i < columns.size(); i++) {
                if (columns.get(i).name().equals(columnName)) {
                    return Optional.of(cells.get(i));
                }
            }
            return Optional.empty();
        }
    }

    /**
     * The JFR table with metadata
     */
    public record Table(
        String name,
        List<Column> columns,
        List<Row> rows,
        Optional<String> description,
        Map<String, Object> metadata
    ) {
        public Table(String name, List<Column> columns, List<Row> rows) {
            this(name, columns, rows, Optional.empty(), Map.of());
        }

        public int getColumnCount() {
            return columns.size();
        }

        public int getRowCount() {
            return rows.size();
        }

        public Optional<Column> getColumn(String name) {
            return columns.stream()
                .filter(col -> col.name().equals(name))
                .findFirst();
        }

        public List<Cell> getColumnValues(String columnName) {
            Optional<Column> column = getColumn(columnName);
            if (column.isEmpty()) {
                return List.of();
            }

            int columnIndex = columns.indexOf(column.get());
            return rows.stream()
                .map(row -> row.getCell(columnIndex))
                .toList();
        }
    }

    /**
     * Builder for creating JFR tables
     */
    public static class TableBuilder {
        private String name;
        private List<Column> columns;
        private List<Row> rows;
        private Optional<String> description = Optional.empty();
        private Map<String, Object> metadata = Map.of();

        public TableBuilder(String name) {
            this.name = name;
            this.columns = List.of();
            this.rows = List.of();
        }

        public TableBuilder columns(List<Column> columns) {
            this.columns = columns;
            return this;
        }

        public TableBuilder rows(List<Row> rows) {
            this.rows = rows;
            return this;
        }

        public TableBuilder description(String description) {
            this.description = Optional.of(description);
            return this;
        }

        public TableBuilder metadata(Map<String, Object> metadata) {
            this.metadata = metadata;
            return this;
        }

        public Table build() {
            return new Table(name, columns, rows, description, metadata);
        }
    }

    /**
     * Utility methods for creating cells
     */
    public static class CellFactory {
        public static Cell createString(String value) {
            return new StringCell(value);
        }

        public static Cell createNumber(long value) {
            return new NumberCell(value);
        }

        public static Cell createDuration(Duration value) {
            return new DurationCell(value);
        }

        public static Cell createDurationFromNanos(long nanos) {
            return new DurationCell(Duration.ofNanos(nanos));
        }

        public static Cell createTimestamp(Instant value) {
            return new TimestampCell(value);
        }

        public static Cell createMemorySize(long bytes) {
            return new MemorySizeCell(bytes);
        }

        public static Cell createRate(double value, String unit) {
            return new RateCell(value, unit);
        }

        public static Cell createBoolean(boolean value) {
            return new BooleanCell(value);
        }

        public static Cell createFloatingPoint(double value) {
            return new FloatingPointCell(value);
        }

        public static Cell createNull() {
            return new NullCell();
        }

        public static Cell createFromObject(Object value) {
            if (value == null) return createNull();

            return switch (value) {
                case String s -> createString(s);
                case Long l -> createNumber(l);
                case Integer i -> createNumber(i.longValue());
                case Double d -> createFloatingPoint(d);
                case Float f -> createFloatingPoint(f.doubleValue());
                case Boolean b -> createBoolean(b);
                case Duration dur -> createDuration(dur);
                case Instant inst -> createTimestamp(inst);
                default -> createString(value.toString());
            };
        }
    }

    /**
     * Parser for converting string values to typed cells
     */
    public static class CellParser {
        public static Cell parseCell(String value, CellType expectedType) {
            if (value == null || value.trim().isEmpty() || "N/A".equals(value)) {
                return new NullCell();
            }

            return switch (expectedType) {
                case STRING -> new StringCell(value);
                case NUMBER -> parseNumber(value);
                case DURATION -> parseDuration(value);
                case TIMESTAMP -> parseTimestamp(value);
                case MEMORY_SIZE -> parseMemorySize(value);
                case RATE -> parseRate(value);
                case BOOLEAN -> parseBoolean(value);
                case FLOATING_POINT -> parseFloatingPoint(value);
                case NULL -> new NullCell();
            };
        }

        private static Cell parseNumber(String value) {
            try {
                return new NumberCell(Long.parseLong(value));
            } catch (NumberFormatException e) {
                return new NullCell();
            }
        }

        private static Cell parseDuration(String value) {
            try {
                // Parse duration strings like "10ms", "5s", "2h"
                if (value.endsWith("ns")) {
                    long nanos = Long.parseLong(value.substring(0, value.length() - 2));
                    return new DurationCell(Duration.ofNanos(nanos));
                } else if (value.endsWith("us")) {
                    long micros = Long.parseLong(value.substring(0, value.length() - 2));
                    return new DurationCell(Duration.ofNanos(micros * 1000));
                } else if (value.endsWith("ms")) {
                    long millis = Long.parseLong(value.substring(0, value.length() - 2));
                    return new DurationCell(Duration.ofMillis(millis));
                } else if (value.endsWith("s")) {
                    long seconds = Long.parseLong(value.substring(0, value.length() - 1));
                    return new DurationCell(Duration.ofSeconds(seconds));
                } else if (value.endsWith("m")) {
                    long minutes = Long.parseLong(value.substring(0, value.length() - 1));
                    return new DurationCell(Duration.ofMinutes(minutes));
                } else if (value.endsWith("h")) {
                    long hours = Long.parseLong(value.substring(0, value.length() - 1));
                    return new DurationCell(Duration.ofHours(hours));
                } else if (value.endsWith("d")) {
                    long days = Long.parseLong(value.substring(0, value.length() - 1));
                    return new DurationCell(Duration.ofDays(days));
                }
            } catch (NumberFormatException e) {
                // Fall through to null
            }
            return new NullCell();
        }

        private static Cell parseTimestamp(String value) {
            try {
                return new TimestampCell(Instant.parse(value));
            } catch (Exception e) {
                return new NullCell();
            }
        }

        private static Cell parseMemorySize(String value) {
            try {
                if (value.endsWith("B")) {
                    long bytes = Long.parseLong(value.substring(0, value.length() - 1));
                    return new MemorySizeCell(bytes);
                } else if (value.endsWith("KB")) {
                    long kb = Long.parseLong(value.substring(0, value.length() - 2));
                    return new MemorySizeCell(kb * 1024);
                } else if (value.endsWith("MB")) {
                    long mb = Long.parseLong(value.substring(0, value.length() - 2));
                    return new MemorySizeCell(mb * 1024 * 1024);
                } else if (value.endsWith("GB")) {
                    long gb = Long.parseLong(value.substring(0, value.length() - 2));
                    return new MemorySizeCell(gb * 1024 * 1024 * 1024);
                } else if (value.endsWith("TB")) {
                    long tb = Long.parseLong(value.substring(0, value.length() - 2));
                    return new MemorySizeCell(tb * 1024 * 1024 * 1024 * 1024);
                }
            } catch (NumberFormatException e) {
                // Fall through to null
            }
            return new NullCell();
        }

        private static Cell parseRate(String value) {
            try {
                if (value.contains("/")) {
                    String[] parts = value.split("/");
                    if (parts.length == 2) {
                        double rate = Double.parseDouble(parts[0]);
                        String unit = parts[1];
                        return new RateCell(rate, unit);
                    }
                }
            } catch (NumberFormatException e) {
                // Fall through to null
            }
            return new NullCell();
        }

        private static Cell parseBoolean(String value) {
            if ("true".equalsIgnoreCase(value)) {
                return new BooleanCell(true);
            } else if ("false".equalsIgnoreCase(value)) {
                return new BooleanCell(false);
            }
            return new NullCell();
        }

        private static Cell parseFloatingPoint(String value) {
            try {
                return new FloatingPointCell(Double.parseDouble(value));
            } catch (NumberFormatException e) {
                return new NullCell();
            }
        }
    }
}