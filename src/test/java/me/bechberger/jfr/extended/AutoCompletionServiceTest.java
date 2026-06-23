package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Test suite for the auto-completion service
 */
public class AutoCompletionServiceTest {

    private AutoCompletionService autoCompletionService;

    @BeforeEach
    public void setUp() {
        autoCompletionService = new AutoCompletionService();
    }

    @Test
    public void testBasicKeywordCompletion() {
        String query = "@ SEL";
        int cursorPosition = 5;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertFalse(result.items().isEmpty());
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("SELECT") && item.type().equals("keyword")));
    }

    @Test
    public void testEventTypeCompletion() {
        String query = "@ SELECT * FROM Garb";
        int cursorPosition = 19;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().contains("GarbageCollection") && item.type().equals("event")));
    }

    @Test
    public void testFunctionCompletion() {
        String query = "@ SELECT COU";
        int cursorPosition = 11;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("COUNT") && item.type().equals("function")));
    }

    @Test
    public void testFieldCompletion() {
        String query = "@ SELECT * FROM GarbageCollection WHERE dur";
        int cursorPosition = 43;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("duration") && item.type().equals("field")));
    }

    @Test
    public void testGCFieldCompletion() {
        String query = "@ SELECT * FROM ExecutionSample WHERE before_";
        int cursorPosition = 47;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("before_gc") && item.type().equals("special")));
    }

    @Test
    public void testOperatorCompletion() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration ";
        int cursorPosition = 50;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals(">") && item.type().equals("operator")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("=") && item.type().equals("operator")));
    }

    @Test
    public void testLiteralCompletion() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > ";
        int cursorPosition = 52;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("10ms") && item.type().equals("duration")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("1s") && item.type().equals("duration")));
    }

    @Test
    public void testMemoryLiteralCompletion() {
        String query = "@ SELECT * FROM ObjectAllocation WHERE size > ";
        int cursorPosition = 46;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("1MB") && item.type().equals("memory")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("512KB") && item.type().equals("memory")));
    }

    @Test
    public void testContextualCompletion() {
        String query = "@ SELECT * FROM GarbageCollection ";
        int cursorPosition = 34;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        // Should suggest WHERE, GROUP BY, ORDER BY, etc.
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("WHERE") && item.type().equals("keyword")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("GROUP BY") && item.type().equals("keyword")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("ORDER BY") && item.type().equals("keyword")));
    }

    @Test
    public void testJoinCompletion() {
        String query = "@ SELECT * FROM ExecutionSample ";
        int cursorPosition = 33;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("JOIN") && item.type().equals("keyword")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("INNER") && item.type().equals("keyword")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("FUZZY") && item.type().equals("keyword")));
    }

    @Test
    public void testPriorityOrdering() {
        String query = "@ ";
        int cursorPosition = 2;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        // SELECT should have highest priority in this context
        assertTrue(result.items().size() > 0);
        AutoCompletionService.CompletionItem firstItem = result.items().get(0);
        assertTrue(firstItem.priority() > 50); // Should be high priority
    }

    @Test
    public void testCustomEventTypes() {
        Set<String> customEvents = Set.of("CustomEvent", "MyEvent");
        Map<String, List<String>> customFields = Map.of(
            "CustomEvent", List.of("customField1", "customField2"),
            "MyEvent", List.of("myField1", "myField2")
        );
        Map<String, String> customDescriptions = Map.of(
            "CustomEvent", "Custom event description",
            "MyEvent", "My event description"
        );

        AutoCompletionService customService = new AutoCompletionService(
            customEvents, customFields, customDescriptions);

        String query = "@ SELECT * FROM Cust";
        int cursorPosition = 18;

        AutoCompletionService.CompletionResult result = customService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("CustomEvent") && item.type().equals("event")));
    }

    @Test
    public void testEmptyQuery() {
        String query = "";
        int cursorPosition = 0;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        // Should suggest @ prefix
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("@") && item.type().equals("special")));
    }

    @Test
    public void testComplexQueryCompletion() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10ms AND ";
        int cursorPosition = 62;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        // Should suggest field names from GarbageCollection
        assertTrue(result.items().stream().anyMatch(item ->
            item.type().equals("field")));
    }

    @Test
    public void testShowQueryCompletion() {
        String query = "SHOW ";
        int cursorPosition = 5;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("EVENTS") && item.type().equals("keyword")));
        assertTrue(result.items().stream().anyMatch(item ->
            item.text().equals("FIELDS") && item.type().equals("keyword")));
    }

    @Test
    public void testInsertTextGeneration() {
        String query = "@ SELECT COU";
        int cursorPosition = 11;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        AutoCompletionService.CompletionItem countItem = result.items().stream()
            .filter(item -> item.text().equals("COUNT"))
            .findFirst()
            .orElse(null);

        assertNotNull(countItem);
        assertEquals("COUNT(", countItem.insertText());
    }

    @Test
    public void testDetailInformation() {
        String query = "@ SELECT P99";
        int cursorPosition = 11;

        AutoCompletionService.CompletionResult result = autoCompletionService.getCompletions(query, cursorPosition);

        AutoCompletionService.CompletionItem p99Item = result.items().stream()
            .filter(item -> item.text().equals("P99"))
            .findFirst()
            .orElse(null);

        assertNotNull(p99Item);
        assertTrue(p99Item.detail().isPresent());
        assertTrue(p99Item.detail().get().contains("99th percentile"));
    }
}