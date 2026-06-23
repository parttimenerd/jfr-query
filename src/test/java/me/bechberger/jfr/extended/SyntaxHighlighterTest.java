package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;

/**
 * Test suite for the syntax highlighter
 */
public class SyntaxHighlighterTest {

    private SyntaxHighlighter highlighter;

    @BeforeEach
    public void setUp() {
        highlighter = new SyntaxHighlighter();
    }

    @Test
    public void testBasicHighlighting() {
        String query = "@ SELECT * FROM GarbageCollection";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        assertFalse(result.tokens().isEmpty());
        assertEquals(0, result.errors().size());

        // Check that keywords are highlighted correctly
        SyntaxHighlighter.HighlightedToken selectToken = result.tokens().get(1);
        assertEquals("SELECT", selectToken.text());
        assertEquals("keyword", selectToken.syntaxType());
        assertEquals(TokenType.SELECT, selectToken.tokenType());
    }

    @Test
    public void testLiteralHighlighting() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10ms AND size > 1MB AND rate = 5/s AND active = true";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        // Find specific literal tokens
        List<SyntaxHighlighter.HighlightedToken> durationTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("duration"))
            .toList();
        assertEquals(1, durationTokens.size());
        assertEquals("10ms", durationTokens.get(0).text());

        List<SyntaxHighlighter.HighlightedToken> memoryTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("memory"))
            .toList();
        assertEquals(1, memoryTokens.size());
        assertEquals("1MB", memoryTokens.get(0).text());

        List<SyntaxHighlighter.HighlightedToken> rateTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("rate"))
            .toList();
        assertEquals(1, rateTokens.size());
        assertEquals("5/s", rateTokens.get(0).text());

        List<SyntaxHighlighter.HighlightedToken> booleanTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("boolean"))
            .toList();
        assertEquals(1, booleanTokens.size());
        assertEquals("true", booleanTokens.get(0).text());
    }

    @Test
    public void testFunctionHighlighting() {
        String query = "@ SELECT COUNT(*), AVG(duration), P99(duration) FROM GarbageCollection";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        List<SyntaxHighlighter.HighlightedToken> functionTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("function"))
            .toList();
        assertEquals(3, functionTokens.size());

        assertEquals("COUNT", functionTokens.get(0).text());
        assertEquals("AVG", functionTokens.get(1).text());
        assertEquals("P99", functionTokens.get(2).text());
    }

    @Test
    public void testOperatorHighlighting() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10ms AND size <= 1MB";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        List<SyntaxHighlighter.HighlightedToken> operatorTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("operator"))
            .toList();
        assertTrue(operatorTokens.size() >= 3); // >, AND, <=

        assertTrue(operatorTokens.stream().anyMatch(t -> t.text().equals(">")));
        assertTrue(operatorTokens.stream().anyMatch(t -> t.text().equals("AND")));
        assertTrue(operatorTokens.stream().anyMatch(t -> t.text().equals("<=")));
    }

    @Test
    public void testSpecialTokenHighlighting() {
        String query = "@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc = 10";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        List<SyntaxHighlighter.HighlightedToken> specialTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("special"))
            .toList();
        assertEquals(1, specialTokens.size()); // @ token
        assertEquals("@", specialTokens.get(0).text());
    }

    @Test
    public void testStringHighlighting() {
        String query = "@ SELECT * FROM GarbageCollection WHERE cause = 'System.gc()'";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        List<SyntaxHighlighter.HighlightedToken> stringTokens = result.tokens().stream()
            .filter(t -> t.syntaxType().equals("string"))
            .toList();
        assertEquals(1, stringTokens.size());
        assertEquals("'System.gc()'", stringTokens.get(0).text());
    }

    @Test
    public void testPositionAccuracy() {
        String query = "@ SELECT * FROM GarbageCollection";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        // Check that positions are accurate
        for (int i = 0; i < result.tokens().size() - 1; i++) {
            SyntaxHighlighter.HighlightedToken current = result.tokens().get(i);
            SyntaxHighlighter.HighlightedToken next = result.tokens().get(i + 1);

            assertTrue(current.end() <= next.start(),
                "Token positions should not overlap: " + current + " vs " + next);
        }
    }

    @Test
    public void testErrorHandling() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10invalid";
        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        // Should still return tokens even with invalid syntax
        assertFalse(result.tokens().isEmpty());
        // May or may not have errors depending on lexer behavior
    }

    @Test
    public void testComplexQuery() {
        String query = """
            @ WHERE gc_threshold := P99(GarbageCollection, duration);
              SELECT * FROM ExecutionSample AS E 
              WHERE E.before_gc IN (SELECT id FROM GarbageCollection WHERE duration > gc_threshold)
              ORDER BY duration DESC
              LIMIT 100
            """;

        SyntaxHighlighter.HighlightResult result = highlighter.highlight(query);

        assertFalse(result.tokens().isEmpty());
        assertEquals(0, result.errors().size());

        // Should contain various token types
        Map<String, Long> tokenCounts = result.tokens().stream()
            .collect(java.util.stream.Collectors.groupingBy(
                SyntaxHighlighter.HighlightedToken::syntaxType,
                java.util.stream.Collectors.counting()
            ));

        assertTrue(tokenCounts.containsKey("keyword"));
        assertTrue(tokenCounts.containsKey("function"));
        assertTrue(tokenCounts.containsKey("operator"));
        assertTrue(tokenCounts.containsKey("identifier"));
        assertTrue(tokenCounts.containsKey("number"));
    }

    @Test
    public void testSyntaxTypesDocumentation() {
        Map<String, String> syntaxTypes = SyntaxHighlighter.getSyntaxTypes();

        assertFalse(syntaxTypes.isEmpty());
        assertTrue(syntaxTypes.containsKey("keyword"));
        assertTrue(syntaxTypes.containsKey("function"));
        assertTrue(syntaxTypes.containsKey("operator"));
        assertTrue(syntaxTypes.containsKey("duration"));
        assertTrue(syntaxTypes.containsKey("memory"));
        assertTrue(syntaxTypes.containsKey("rate"));

        // Check that descriptions are meaningful
        assertTrue(syntaxTypes.get("keyword").contains("keyword"));
        assertTrue(syntaxTypes.get("function").contains("function"));
    }
}