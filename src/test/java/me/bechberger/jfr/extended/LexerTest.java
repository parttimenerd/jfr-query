package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;

/**
 * Comprehensive test suite for the JFR extended query language lexer
 */
public class LexerTest {

    private Lexer lexer;

    @Test
    public void testBasicTokens() {
        lexer = new Lexer("@ SELECT * FROM GarbageCollection");
        List<Token> tokens = lexer.tokenize();

        assertEquals(5, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.AT, tokens.get(0).type());
        assertEquals(TokenType.SELECT, tokens.get(1).type());
        assertEquals(TokenType.MULTIPLY, tokens.get(2).type());
        assertEquals(TokenType.FROM, tokens.get(3).type());
        assertEquals(TokenType.IDENTIFIER, tokens.get(4).type());
        assertEquals("GarbageCollection", tokens.get(4).value());
    }

    @Test
    public void testStringLiterals() {
        lexer = new Lexer("'hello world' 'escaped\\'quote'");
        List<Token> tokens = lexer.tokenize();

        assertEquals(2, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.STRING, tokens.get(0).type());
        assertEquals("'hello world'", tokens.get(0).value());
        assertEquals(TokenType.STRING, tokens.get(1).type());
        assertEquals("'escaped\\'quote'", tokens.get(1).value());
    }

    @Test
    public void testDurationLiterals() {
        lexer = new Lexer("10ms 5s 2h 1d 500ns 100us");
        List<Token> tokens = lexer.tokenize();

        assertEquals(6, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.DURATION, tokens.get(0).type());
        assertEquals("10ms", tokens.get(0).value());
        assertEquals(TokenType.DURATION, tokens.get(1).type());
        assertEquals("5s", tokens.get(1).value());
        assertEquals(TokenType.DURATION, tokens.get(2).type());
        assertEquals("2h", tokens.get(2).value());
        assertEquals(TokenType.DURATION, tokens.get(3).type());
        assertEquals("1d", tokens.get(3).value());
        assertEquals(TokenType.DURATION, tokens.get(4).type());
        assertEquals("500ns", tokens.get(4).value());
        assertEquals(TokenType.DURATION, tokens.get(5).type());
        assertEquals("100us", tokens.get(5).value());
    }

    @Test
    public void testMemorySizeLiterals() {
        lexer = new Lexer("1MB 512KB 1GB 2TB 1024B");
        List<Token> tokens = lexer.tokenize();

        assertEquals(5, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.MEMORY_SIZE, tokens.get(0).type());
        assertEquals("1MB", tokens.get(0).value());
        assertEquals(TokenType.MEMORY_SIZE, tokens.get(1).type());
        assertEquals("512KB", tokens.get(1).value());
        assertEquals(TokenType.MEMORY_SIZE, tokens.get(2).type());
        assertEquals("1GB", tokens.get(2).value());
        assertEquals(TokenType.MEMORY_SIZE, tokens.get(3).type());
        assertEquals("2TB", tokens.get(3).value());
        assertEquals(TokenType.MEMORY_SIZE, tokens.get(4).type());
        assertEquals("1024B", tokens.get(4).value());
    }

    @Test
    public void testRateLiterals() {
        lexer = new Lexer("10/s 5/m 2/h");
        List<Token> tokens = lexer.tokenize();

        assertEquals(3, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.RATE, tokens.get(0).type());
        assertEquals("10/s", tokens.get(0).value());
        assertEquals(TokenType.RATE, tokens.get(1).type());
        assertEquals("5/m", tokens.get(1).value());
        assertEquals(TokenType.RATE, tokens.get(2).type());
        assertEquals("2/h", tokens.get(2).value());
    }

    @Test
    public void testTimestampLiterals() {
        lexer = new Lexer("12:34:56 09:15:30.123");
        List<Token> tokens = lexer.tokenize();

        assertEquals(2, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.TIMESTAMP, tokens.get(0).type());
        assertEquals("12:34:56", tokens.get(0).value());
        assertEquals(TokenType.TIMESTAMP, tokens.get(1).type());
        assertEquals("09:15:30.123", tokens.get(1).value());
    }

    @Test
    public void testOperators() {
        lexer = new Lexer("= != < <= > >= + - * / % :=");
        List<Token> tokens = lexer.tokenize();

        assertEquals(12, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.EQUALS, tokens.get(0).type());
        assertEquals(TokenType.NOT_EQUALS, tokens.get(1).type());
        assertEquals(TokenType.LESS_THAN, tokens.get(2).type());
        assertEquals(TokenType.LESS_EQUAL, tokens.get(3).type());
        assertEquals(TokenType.GREATER_THAN, tokens.get(4).type());
        assertEquals(TokenType.GREATER_EQUAL, tokens.get(5).type());
        assertEquals(TokenType.PLUS, tokens.get(6).type());
        assertEquals(TokenType.MINUS, tokens.get(7).type());
        assertEquals(TokenType.MULTIPLY, tokens.get(8).type());
        assertEquals(TokenType.DIVIDE, tokens.get(9).type());
        assertEquals(TokenType.MODULO, tokens.get(10).type());
        assertEquals(TokenType.ASSIGN, tokens.get(11).type());
    }

    @Test
    public void testKeywords() {
        lexer = new Lexer("SELECT FROM WHERE GROUP BY ORDER LIMIT");
        List<Token> tokens = lexer.tokenize();

        assertEquals(7, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.SELECT, tokens.get(0).type());
        assertEquals(TokenType.FROM, tokens.get(1).type());
        assertEquals(TokenType.WHERE, tokens.get(2).type());
        assertEquals(TokenType.GROUP, tokens.get(3).type());
        assertEquals(TokenType.BY, tokens.get(4).type());
        assertEquals(TokenType.ORDER, tokens.get(5).type());
        assertEquals(TokenType.LIMIT, tokens.get(6).type());
    }

    @Test
    public void testAggregateFunctions() {
        lexer = new Lexer("AVG COUNT MAX MIN P99 SUM");
        List<Token> tokens = lexer.tokenize();

        assertEquals(6, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.AVG, tokens.get(0).type());
        assertEquals(TokenType.COUNT, tokens.get(1).type());
        assertEquals(TokenType.MAX, tokens.get(2).type());
        assertEquals(TokenType.MIN, tokens.get(3).type());
        assertEquals(TokenType.P99, tokens.get(4).type());
        assertEquals(TokenType.SUM, tokens.get(5).type());
    }

    @Test
    public void testComplexQuery() {
        String query = "@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc IN P99(GarbageCollection, id, duration) AND E.duration > 10ms";
        lexer = new Lexer(query);
        List<Token> tokens = lexer.tokenize();

        assertTrue(tokens.size() > 15); // Should have many tokens
        assertEquals(TokenType.AT, tokens.get(0).type());
        assertEquals(TokenType.SELECT, tokens.get(1).type());
        assertEquals(TokenType.MULTIPLY, tokens.get(2).type());
        assertEquals(TokenType.FROM, tokens.get(3).type());
        assertEquals(TokenType.IDENTIFIER, tokens.get(4).type());
        assertEquals("ExecutionSample", tokens.get(4).value());
    }

    @Test
    public void testLegacyQuery() {
        lexer = new Lexer("[SELECT * FROM jdk.GarbageCollection WHERE cause = 'System.gc()']");
        List<Token> tokens = lexer.tokenize();

        assertEquals(TokenType.LBRACKET, tokens.get(0).type());
        assertEquals(TokenType.RBRACKET, tokens.get(tokens.size() - 2).type()); // Before EOF
    }

    @Test
    public void testShowQueries() {
        lexer = new Lexer("SHOW EVENTS");
        List<Token> tokens = lexer.tokenize();

        assertEquals(2, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.SHOW, tokens.get(0).type());
        assertEquals(TokenType.EVENTS, tokens.get(1).type());

        lexer = new Lexer("SHOW FIELDS GarbageCollection");
        tokens = lexer.tokenize();

        assertEquals(3, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.SHOW, tokens.get(0).type());
        assertEquals(TokenType.FIELDS, tokens.get(1).type());
        assertEquals(TokenType.IDENTIFIER, tokens.get(2).type());
    }

    @Test
    public void testBooleanLiterals() {
        lexer = new Lexer("true false");
        List<Token> tokens = lexer.tokenize();

        assertEquals(2, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.BOOLEAN, tokens.get(0).type());
        assertEquals("true", tokens.get(0).value());
        assertEquals(TokenType.BOOLEAN, tokens.get(1).type());
        assertEquals("false", tokens.get(1).value());
    }

    @Test
    public void testNumbers() {
        lexer = new Lexer("123 45.67 0 0.5");
        List<Token> tokens = lexer.tokenize();

        assertEquals(4, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.NUMBER, tokens.get(0).type());
        assertEquals("123", tokens.get(0).value());
        assertEquals(TokenType.NUMBER, tokens.get(1).type());
        assertEquals("45.67", tokens.get(1).value());
        assertEquals(TokenType.NUMBER, tokens.get(2).type());
        assertEquals("0", tokens.get(2).value());
        assertEquals(TokenType.NUMBER, tokens.get(3).type());
        assertEquals("0.5", tokens.get(3).value());
    }

    @Test
    public void testPositionTracking() {
        lexer = new Lexer("SELECT\n  *\n  FROM");
        List<Token> tokens = lexer.tokenize();

        assertEquals(1, tokens.get(0).line());
        assertEquals(1, tokens.get(0).column());
        assertEquals(2, tokens.get(1).line());
        assertEquals(3, tokens.get(1).column());
        assertEquals(3, tokens.get(2).line());
        assertEquals(3, tokens.get(2).column());
    }

    @Test
    public void testWhitespaceHandling() {
        lexer = new Lexer("  SELECT   *  ");
        List<Token> tokens = lexer.tokenize();

        // Should skip whitespace tokens
        assertEquals(2, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.SELECT, tokens.get(0).type());
        assertEquals(TokenType.MULTIPLY, tokens.get(1).type());
    }

    @Test
    public void testVariableAssignment() {
        lexer = new Lexer("x := 10 + 5");
        List<Token> tokens = lexer.tokenize();

        assertEquals(5, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.IDENTIFIER, tokens.get(0).type());
        assertEquals("x", tokens.get(0).value());
        assertEquals(TokenType.ASSIGN, tokens.get(1).type());
        assertEquals(TokenType.NUMBER, tokens.get(2).type());
        assertEquals(TokenType.PLUS, tokens.get(3).type());
        assertEquals(TokenType.NUMBER, tokens.get(4).type());
    }

    @Test
    public void testGCFields() {
        lexer = new Lexer("E.before_gc E.after_gc");
        List<Token> tokens = lexer.tokenize();

        assertEquals(6, tokens.size() - 1); // Excluding EOF
        assertEquals(TokenType.IDENTIFIER, tokens.get(0).type());
        assertEquals("E", tokens.get(0).value());
        assertEquals(TokenType.DOT, tokens.get(1).type());
        assertEquals(TokenType.IDENTIFIER, tokens.get(2).type());
        assertEquals("before_gc", tokens.get(2).value());
        assertEquals(TokenType.IDENTIFIER, tokens.get(3).type());
        assertEquals("E", tokens.get(3).value());
        assertEquals(TokenType.DOT, tokens.get(4).type());
        assertEquals(TokenType.IDENTIFIER, tokens.get(5).type());
        assertEquals("after_gc", tokens.get(5).value());
    }
}