package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import me.bechberger.jfr.extended.JFRTable.*;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Test suite for JFR table components
 */
public class JFRTableTest {

    @Test
    public void testCellCreation() {
        Cell stringCell = CellFactory.createString("test");
        assertEquals(CellType.STRING, stringCell.getType());
        assertEquals("test", stringCell.getValue());
        assertEquals("test", stringCell.getDisplayValue());

        Cell numberCell = CellFactory.createNumber(42);
        assertEquals(CellType.NUMBER, numberCell.getType());
        assertEquals(42L, numberCell.getValue());
        assertEquals("42", numberCell.getDisplayValue());

        Cell booleanCell = CellFactory.createBoolean(true);
        assertEquals(CellType.BOOLEAN, booleanCell.getType());
        assertEquals(true, booleanCell.getValue());
        assertEquals("true", booleanCell.getDisplayValue());
    }

    @Test
    public void testDurationCell() {
        Duration duration = Duration.ofMillis(1500);
        Cell durationCell = CellFactory.createDuration(duration);

        assertEquals(CellType.DURATION, durationCell.getType());
        assertEquals(duration, durationCell.getValue());
        assertEquals("1500ms", durationCell.getDisplayValue());

        // Test nano duration
        Cell nanoCell = CellFactory.createDurationFromNanos(500);
        assertEquals("500ns", nanoCell.getDisplayValue());

        // Test second duration
        Cell secondCell = CellFactory.createDuration(Duration.ofSeconds(5));
        assertEquals("5s", secondCell.getDisplayValue());
    }

    @Test
    public void testMemorySizeCell() {
        Cell bytesCell = CellFactory.createMemorySize(1024);
        assertEquals(CellType.MEMORY_SIZE, bytesCell.getType());
        assertEquals(1024L, bytesCell.getValue());
        assertEquals("1KB", bytesCell.getDisplayValue());

        Cell mbCell = CellFactory.createMemorySize(1024 * 1024);
        assertEquals("1MB", mbCell.getDisplayValue());

        Cell gbCell = CellFactory.createMemorySize(1024L * 1024 * 1024);
        assertEquals("1GB", gbCell.getDisplayValue());
    }

    @Test
    public void testRateCell() {
        Cell rateCell = CellFactory.createRate(10.5, "s");
        assertEquals(CellType.RATE, rateCell.getType());
        assertEquals(10.5, rateCell.getValue());
        assertEquals("10.5/s", rateCell.getDisplayValue());
    }

    @Test
    public void testTimestampCell() {
        Instant now = Instant.now();
        Cell timestampCell = CellFactory.createTimestamp(now);

        assertEquals(CellType.TIMESTAMP, timestampCell.getType());
        assertEquals(now, timestampCell.getValue());
        assertEquals(now.toString(), timestampCell.getDisplayValue());
    }

    @Test
    public void testNullCell() {
        Cell nullCell = CellFactory.createNull();
        assertEquals(CellType.NULL, nullCell.getType());
        assertNull(nullCell.getValue());
        assertEquals("N/A", nullCell.getDisplayValue());
    }

    @Test
    public void testCreateFromObject() {
        Cell stringCell = CellFactory.createFromObject("test");
        assertEquals(CellType.STRING, stringCell.getType());

        Cell numberCell = CellFactory.createFromObject(42);
        assertEquals(CellType.NUMBER, numberCell.getType());

        Cell floatCell = CellFactory.createFromObject(3.14);
        assertEquals(CellType.FLOATING_POINT, floatCell.getType());

        Cell booleanCell = CellFactory.createFromObject(true);
        assertEquals(CellType.BOOLEAN, booleanCell.getType());

        Cell nullCell = CellFactory.createFromObject(null);
        assertEquals(CellType.NULL, nullCell.getType());
    }

    @Test
    public void testCellParser() {
        // Test string parsing
        Cell stringCell = CellParser.parseCell("hello", CellType.STRING);
        assertEquals(CellType.STRING, stringCell.getType());
        assertEquals("hello", stringCell.getValue());

        // Test number parsing
        Cell numberCell = CellParser.parseCell("42", CellType.NUMBER);
        assertEquals(CellType.NUMBER, numberCell.getType());
        assertEquals(42L, numberCell.getValue());

        // Test duration parsing
        Cell durationCell = CellParser.parseCell("10ms", CellType.DURATION);
        assertEquals(CellType.DURATION, durationCell.getType());
        assertEquals(Duration.ofMillis(10), durationCell.getValue());

        // Test memory size parsing
        Cell memoryCell = CellParser.parseCell("1MB", CellType.MEMORY_SIZE);
        assertEquals(CellType.MEMORY_SIZE, memoryCell.getType());
        assertEquals(1024L * 1024, memoryCell.getValue());

        // Test rate parsing
        Cell rateCell = CellParser.parseCell("5/s", CellType.RATE);
        assertEquals(CellType.RATE, rateCell.getType());
        assertEquals(5.0, ((RateCell) rateCell).value());
        assertEquals("s", ((RateCell) rateCell).unit());

        // Test boolean parsing
        Cell booleanCell = CellParser.parseCell("true", CellType.BOOLEAN);
        assertEquals(CellType.BOOLEAN, booleanCell.getType());
        assertEquals(true, booleanCell.getValue());

        // Test null parsing
        Cell nullCell = CellParser.parseCell("N/A", CellType.STRING);
        assertEquals(CellType.NULL, nullCell.getType());
    }

    @Test
    public void testInvalidParsing() {
        // Invalid number should return null cell
        Cell invalidNumber = CellParser.parseCell("not_a_number", CellType.NUMBER);
        assertEquals(CellType.NULL, invalidNumber.getType());

        // Invalid duration should return null cell
        Cell invalidDuration = CellParser.parseCell("invalid_duration", CellType.DURATION);
        assertEquals(CellType.NULL, invalidDuration.getType());

        // Invalid memory size should return null cell
        Cell invalidMemory = CellParser.parseCell("invalid_memory", CellType.MEMORY_SIZE);
        assertEquals(CellType.NULL, invalidMemory.getType());
    }

    @Test
    public void testTableCreation() {
        List<Column> columns = List.of(
            new Column("id", CellType.NUMBER),
            new Column("name", CellType.STRING),
            new Column("duration", CellType.DURATION, Optional.of("Event duration"))
        );

        List<Row> rows = List.of(
            new Row(List.of(
                CellFactory.createNumber(1),
                CellFactory.createString("GC1"),
                CellFactory.createDuration(Duration.ofMillis(100))
            )),
            new Row(List.of(
                CellFactory.createNumber(2),
                CellFactory.createString("GC2"),
                CellFactory.createDuration(Duration.ofMillis(200))
            ))
        );

        Table table = new TableBuilder("GarbageCollection")
            .columns(columns)
            .rows(rows)
            .description("Garbage collection events")
            .build();

        assertEquals("GarbageCollection", table.name());
        assertEquals(3, table.getColumnCount());
        assertEquals(2, table.getRowCount());
        assertTrue(table.description().isPresent());
        assertEquals("Garbage collection events", table.description().get());
    }

    @Test
    public void testTableQueries() {
        List<Column> columns = List.of(
            new Column("id", CellType.NUMBER),
            new Column("name", CellType.STRING),
            new Column("duration", CellType.DURATION)
        );

        List<Row> rows = List.of(
            new Row(List.of(
                CellFactory.createNumber(1),
                CellFactory.createString("GC1"),
                CellFactory.createDuration(Duration.ofMillis(100))
            )),
            new Row(List.of(
                CellFactory.createNumber(2),
                CellFactory.createString("GC2"),
                CellFactory.createDuration(Duration.ofMillis(200))
            ))
        );

        Table table = new Table("GarbageCollection", columns, rows);

        // Test column lookup
        Optional<Column> idColumn = table.getColumn("id");
        assertTrue(idColumn.isPresent());
        assertEquals("id", idColumn.get().name());
        assertEquals(CellType.NUMBER, idColumn.get().type());

        // Test column values
        List<Cell> idValues = table.getColumnValues("id");
        assertEquals(2, idValues.size());
        assertEquals(1L, idValues.get(0).getValue());
        assertEquals(2L, idValues.get(1).getValue());

        // Test non-existent column
        Optional<Column> nonExistentColumn = table.getColumn("nonexistent");
        assertFalse(nonExistentColumn.isPresent());

        List<Cell> nonExistentValues = table.getColumnValues("nonexistent");
        assertTrue(nonExistentValues.isEmpty());
    }

    @Test
    public void testRowAccess() {
        List<Column> columns = List.of(
            new Column("id", CellType.NUMBER),
            new Column("name", CellType.STRING)
        );

        Row row = new Row(List.of(
            CellFactory.createNumber(1),
            CellFactory.createString("test")
        ));

        // Test direct cell access
        Cell idCell = row.getCell(0);
        assertEquals(CellType.NUMBER, idCell.getType());
        assertEquals(1L, idCell.getValue());

        // Test cell access by name
        Optional<Cell> nameCell = row.getCellByName("name", columns);
        assertTrue(nameCell.isPresent());
        assertEquals(CellType.STRING, nameCell.get().getType());
        assertEquals("test", nameCell.get().getValue());

        // Test non-existent column
        Optional<Cell> nonExistentCell = row.getCellByName("nonexistent", columns);
        assertFalse(nonExistentCell.isPresent());
    }

    @Test
    public void testComplexDurationParsing() {
        // Test various duration formats
        Cell nsCell = CellParser.parseCell("500ns", CellType.DURATION);
        assertEquals(Duration.ofNanos(500), nsCell.getValue());

        Cell usCell = CellParser.parseCell("100us", CellType.DURATION);
        assertEquals(Duration.ofNanos(100_000), usCell.getValue());

        Cell msCell = CellParser.parseCell("50ms", CellType.DURATION);
        assertEquals(Duration.ofMillis(50), msCell.getValue());

        Cell sCell = CellParser.parseCell("5s", CellType.DURATION);
        assertEquals(Duration.ofSeconds(5), sCell.getValue());

        Cell mCell = CellParser.parseCell("2m", CellType.DURATION);
        assertEquals(Duration.ofMinutes(2), mCell.getValue());

        Cell hCell = CellParser.parseCell("1h", CellType.DURATION);
        assertEquals(Duration.ofHours(1), hCell.getValue());

        Cell dCell = CellParser.parseCell("3d", CellType.DURATION);
        assertEquals(Duration.ofDays(3), dCell.getValue());
    }

    @Test
    public void testComplexMemoryParsing() {
        // Test various memory size formats
        Cell bCell = CellParser.parseCell("1024B", CellType.MEMORY_SIZE);
        assertEquals(1024L, bCell.getValue());

        Cell kbCell = CellParser.parseCell("512KB", CellType.MEMORY_SIZE);
        assertEquals(512L * 1024, bCell.getValue());

        Cell mbCell = CellParser.parseCell("256MB", CellType.MEMORY_SIZE);
        assertEquals(256L * 1024 * 1024, mbCell.getValue());

        Cell gbCell = CellParser.parseCell("4GB", CellType.MEMORY_SIZE);
        assertEquals(4L * 1024 * 1024 * 1024, gbCell.getValue());

        Cell tbCell = CellParser.parseCell("2TB", CellType.MEMORY_SIZE);
        assertEquals(2L * 1024 * 1024 * 1024 * 1024, tbCell.getValue());
    }

    @Test
    public void testTableWithMetadata() {
        Map<String, Object> metadata = Map.of(
            "source", "JFR Recording",
            "timestamp", Instant.now().toString(),
            "recordCount", 1000
        );

        Table table = new TableBuilder("TestTable")
            .columns(List.of(new Column("id", CellType.NUMBER)))
            .rows(List.of(new Row(List.of(CellFactory.createNumber(1)))))
            .metadata(metadata)
            .build();

        assertEquals("JFR Recording", table.metadata().get("source"));
        assertEquals(1000, table.metadata().get("recordCount"));
    }
}