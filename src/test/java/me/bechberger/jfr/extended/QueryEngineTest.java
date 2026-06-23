package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import me.bechberger.jfr.extended.ast.ASTNodes.*;
import me.bechberger.jfr.extended.JFRTable.*;
import me.bechberger.jfr.extended.QueryEngine.*;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Test suite for the query engine
 */
public class QueryEngineTest {

    private QueryEngine queryEngine;
    private ExecutionContext context;

    @BeforeEach
    public void setUp() {
        queryEngine = new QueryEngine();

        Set<String> availableEvents = Set.of(
            "jdk.GarbageCollection",
            "jdk.ExecutionSample",
            "jdk.ThreadPark"
        );

        Map<String, List<String>> eventFields = Map.of(
            "jdk.GarbageCollection", List.of("id", "duration", "cause", "startTime"),
            "jdk.ExecutionSample", List.of("thread", "stackTrace", "startTime", "weight"),
            "jdk.ThreadPark", List.of("thread", "blocker", "timeout", "duration")
        );

        context = new ExecutionContext(
            new HashMap<>(),
            new HashMap<>(),
            availableEvents,
            eventFields
        );
    }

    @Test
    public void testSimpleExtendedQuery() {
        String queryText = "@ SELECT * FROM jdk.GarbageCollection";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent(), "Query should execute without error");
        assertNotNull(result.result());
        assertTrue(result.executionTime().toMillis() >= 0);
    }

    @Test
    public void testShowEventsQuery() {
        String queryText = "SHOW EVENTS";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertEquals("events", result.result().name());
        assertEquals(2, result.result().columns().size());
        assertFalse(result.result().rows().isEmpty());

        // Should contain our available events
        List<String> eventNames = result.result().getColumnValues("name").stream()
            .map(cell -> (String) cell.getValue())
            .toList();
        assertTrue(eventNames.contains("jdk.GarbageCollection"));
        assertTrue(eventNames.contains("jdk.ExecutionSample"));
    }

    @Test
    public void testShowFieldsQuery() {
        String queryText = "SHOW FIELDS jdk.GarbageCollection";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertTrue(result.result().name().contains("fields"));
        assertEquals(2, result.result().columns().size());

        // Should contain GC fields
        List<String> fieldNames = result.result().getColumnValues("name").stream()
            .map(cell -> (String) cell.getValue())
            .toList();
        assertTrue(fieldNames.contains("id"));
        assertTrue(fieldNames.contains("duration"));
        assertTrue(fieldNames.contains("cause"));
    }

    @Test
    public void testVariableAssignment() {
        String queryText = """
            slow_gcs = @ SELECT * FROM jdk.GarbageCollection WHERE duration > 100ms
            @ SELECT * FROM slow_gcs
            """;

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertNotNull(result.result());
        assertEquals(2, program.statements().size());
    }

    @Test
    public void testLegacyQuery() {
        String queryText = "[SELECT * FROM jdk.GarbageCollection WHERE cause = 'System.gc()']";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertEquals("legacy_result", result.result().name());
        assertTrue(result.result().getColumnValues("result").get(0).getValue().toString()
                   .contains("jdk.GarbageCollection"));
    }

    @Test
    public void testGCCorrelationService() {
        GCCorrelationService gcService = queryEngine.getGCService();

        // Add some GC events
        Instant base = Instant.now();
        gcService.addGCEvent("recording1", new GCCorrelationService.GCEvent(
            1L, base, base.plusMillis(100), Duration.ofMillis(100)
        ));
        gcService.addGCEvent("recording1", new GCCorrelationService.GCEvent(
            2L, base.plusSeconds(1), base.plusSeconds(1).plusMillis(200), Duration.ofMillis(200)
        ));
        gcService.addGCEvent("recording1", new GCCorrelationService.GCEvent(
            3L, base.plusSeconds(2), base.plusSeconds(2).plusMillis(50), Duration.ofMillis(50)
        ));

        // Test before GC lookup
        Instant eventTime = base.plusMillis(500);
        Optional<Long> beforeGC = gcService.getBeforeGCId("recording1", eventTime);
        assertTrue(beforeGC.isPresent());
        assertEquals(1L, beforeGC.get());

        // Test after GC lookup
        Optional<Long> afterGC = gcService.getAfterGCId("recording1", eventTime);
        assertTrue(afterGC.isPresent());
        assertEquals(2L, afterGC.get());

        // Test percentile GC lookup
        List<Long> p99GCs = gcService.getPercentileGCIds("recording1", 99, "duration");
        assertFalse(p99GCs.isEmpty());
        assertTrue(p99GCs.contains(2L)); // Longest duration
    }

    @Test
    public void testQueryCaching() {
        String queryText = "@ SELECT * FROM jdk.GarbageCollection";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        // Execute query twice
        QueryResult result1 = queryEngine.executeProgram(program, context);
        QueryResult result2 = queryEngine.executeProgram(program, context);

        assertFalse(result1.error().isPresent());
        assertFalse(result2.error().isPresent());

        // Second execution should be faster (cached)
        assertTrue(result2.executionTime().compareTo(result1.executionTime()) <= 0);

        // Check cache stats
        Map<String, Object> cacheStats = queryEngine.getCacheStats();
        assertTrue((Integer) cacheStats.get("size") > 0);
        assertTrue((Long) cacheStats.get("sizeBytes") > 0);
    }

    @Test
    public void testViewManagement() {
        // Create a view
        Table view = new TableBuilder("test_view")
            .columns(List.of(new Column("id", CellType.NUMBER)))
            .rows(List.of(new Row(List.of(CellFactory.createNumber(1)))))
            .build();

        queryEngine.addView("test_view", view);

        // Query the view
        String queryText = "@ SELECT * FROM test_view";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertEquals("test_view_result", result.result().name());
        assertEquals(1, result.result().rows().size());

        // Remove the view
        queryEngine.removeView("test_view");
    }

    @Test
    public void testComplexQuery() {
        String queryText = """
            @ WHERE gc_threshold := 100;
              SELECT * FROM jdk.GarbageCollection 
              WHERE duration > gc_threshold 
              ORDER BY duration DESC 
              LIMIT 10
            """;

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        QueryResult result = queryEngine.executeProgram(program, context);

        assertFalse(result.error().isPresent());
        assertNotNull(result.result());

        // Check metadata
        assertTrue(result.metadata().containsKey("hasVariables"));
        assertTrue(result.metadata().containsKey("hasWhere"));
        assertTrue(result.metadata().containsKey("hasOrderBy"));
        assertTrue(result.metadata().containsKey("hasLimit"));
    }

    @Test
    public void testErrorHandling() {
        String queryText = "@ SELECT FROM"; // Invalid syntax

        try {
            Lexer lexer = new Lexer(queryText);
            Parser parser = new Parser(lexer.tokenize());
            Program program = parser.parse();
            fail("Should have thrown ParseException");
        } catch (Parser.ParseException e) {
            // Expected
            assertTrue(e.getMessage().contains("Expected"));
        }
    }

    @Test
    public void testExecutionError() {
        // Create a program that will cause execution error
        Program program = new Program(List.of(
            new Assignment("invalid", new ExtendedQuery(
                Optional.empty(),
                Optional.empty(),
                new SelectClause(true, List.of()),
                new FromClause(List.of(new TableSource("nonexistent", Optional.empty())), List.of()),
                Optional.empty(),
                Optional.empty(),
                Optional.empty(),
                Optional.empty()
            ))
        ));

        QueryResult result = queryEngine.executeProgram(program, context);

        // Should handle gracefully
        assertNotNull(result);
        assertNotNull(result.result());
        assertTrue(result.executionTime().toMillis() >= 0);
    }

    @Test
    public void testCacheEviction() {
        // Create a small cache engine
        QueryEngine smallCacheEngine = new QueryEngine(1000); // 1KB cache

        // Execute multiple queries to trigger eviction
        for (int i = 0; i < 10; i++) {
            String queryText = "@ SELECT * FROM jdk.GarbageCollection WHERE id = " + i;

            Lexer lexer = new Lexer(queryText);
            Parser parser = new Parser(lexer.tokenize());
            Program program = parser.parse();

            QueryResult result = smallCacheEngine.executeProgram(program, context);
            assertFalse(result.error().isPresent());
        }

        // Cache should have evicted some entries
        Map<String, Object> cacheStats = smallCacheEngine.getCacheStats();
        assertTrue((Long) cacheStats.get("sizeBytes") <= 1000);
    }

    @Test
    public void testCacheClear() {
        String queryText = "@ SELECT * FROM jdk.GarbageCollection";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        queryEngine.executeProgram(program, context);

        Map<String, Object> statsBefore = queryEngine.getCacheStats();
        assertTrue((Integer) statsBefore.get("size") > 0);

        queryEngine.clearCache();

        Map<String, Object> statsAfter = queryEngine.getCacheStats();
        assertEquals(0, (Integer) statsAfter.get("size"));
        assertEquals(0L, (Long) statsAfter.get("sizeBytes"));
    }

    @Test
    public void testPerformance() {
        String queryText = "@ SELECT * FROM jdk.GarbageCollection WHERE duration > 10ms";

        Lexer lexer = new Lexer(queryText);
        Parser parser = new Parser(lexer.tokenize());
        Program program = parser.parse();

        long startTime = System.nanoTime();
        QueryResult result = queryEngine.executeProgram(program, context);
        long endTime = System.nanoTime();

        assertFalse(result.error().isPresent());

        // Should execute reasonably quickly (less than 100ms for mock data)
        Duration executionTime = Duration.ofNanos(endTime - startTime);
        assertTrue(executionTime.toMillis() < 100,
                  "Query took too long: " + executionTime.toMillis() + "ms");
    }
}