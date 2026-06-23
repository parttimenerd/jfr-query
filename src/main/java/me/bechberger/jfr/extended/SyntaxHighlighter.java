package me.bechberger.jfr.extended;

import java.util.List;
import java.util.Map;
import java.util.HashMap;

/**
 * Syntax highlighter for the extended JFR query language
 */
public class SyntaxHighlighter {

    /**
     * Represents a highlighted token with position and syntax type
     */
    public record HighlightedToken(
        int start,
        int end,
        String text,
        String syntaxType,
        TokenType tokenType
    ) {}

    /**
     * Result of syntax highlighting
     */
    public record HighlightResult(
        List<HighlightedToken> tokens,
        List<String> errors
    ) {}

    private static final Map<TokenType, String> TOKEN_TO_SYNTAX_TYPE = Map.of(
        // Keywords
        TokenType.SELECT, "keyword",
        TokenType.FROM, "keyword",
        TokenType.WHERE, "keyword",
        TokenType.GROUP, "keyword",
        TokenType.BY, "keyword",
        TokenType.ORDER, "keyword",
        TokenType.LIMIT, "keyword",
        TokenType.AS, "keyword",
        TokenType.AND, "keyword",
        TokenType.OR, "keyword",
        TokenType.NOT, "keyword",
        TokenType.IN, "keyword",
        TokenType.LIKE, "keyword",
        TokenType.BETWEEN, "keyword",
        TokenType.JOIN, "keyword",
        TokenType.INNER, "keyword",
        TokenType.LEFT, "keyword",
        TokenType.RIGHT, "keyword",
        TokenType.FULL, "keyword",
        TokenType.FUZZY, "keyword",
        TokenType.ON, "keyword",
        TokenType.WITH, "keyword",
        TokenType.SHOW, "keyword",
        TokenType.EVENTS, "keyword",
        TokenType.FIELDS, "keyword",
        TokenType.COLUMN, "keyword",
        TokenType.FORMAT, "keyword",
        TokenType.ASC, "keyword",
        TokenType.DESC, "keyword",
        TokenType.HAVING, "keyword",
        TokenType.FIRST, "keyword",
        TokenType.LAST, "keyword"
    );

    private static final Map<TokenType, String> ADDITIONAL_MAPPINGS = Map.of(
        // Operators
        TokenType.EQUALS, "operator",
        TokenType.NOT_EQUALS, "operator",
        TokenType.LESS_THAN, "operator",
        TokenType.LESS_EQUAL, "operator",
        TokenType.GREATER_THAN, "operator",
        TokenType.GREATER_EQUAL, "operator",
        TokenType.PLUS, "operator",
        TokenType.MINUS, "operator",
        TokenType.MULTIPLY, "operator",
        TokenType.DIVIDE, "operator",
        TokenType.MODULO, "operator",
        TokenType.ASSIGN, "operator",

        // Punctuation
        TokenType.LPAREN, "punctuation",
        TokenType.RPAREN, "punctuation",
        TokenType.LBRACKET, "punctuation",
        TokenType.RBRACKET, "punctuation",
        TokenType.COMMA, "punctuation",
        TokenType.SEMICOLON, "punctuation",
        TokenType.DOT, "punctuation",
        TokenType.AT, "special",

        // Literals
        TokenType.STRING, "string",
        TokenType.NUMBER, "number",
        TokenType.DURATION, "duration",
        TokenType.TIMESTAMP, "timestamp",
        TokenType.MEMORY_SIZE, "memory",
        TokenType.RATE, "rate",
        TokenType.BOOLEAN, "boolean",

        // Special
        TokenType.BEFORE_GC, "special",
        TokenType.AFTER_GC, "special",
        TokenType.IDENTIFIER, "identifier"
    );

    static {
        // Add aggregate functions
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.AVG, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.COUNT, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.DIFF, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.LAST_BATCH, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.LIST, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.MAX, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.MEDIAN, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.MIN, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.P90, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.P95, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.P99, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.P999, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.STDEV, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.SUM, "function");
        TOKEN_TO_SYNTAX_TYPE.put(TokenType.UNIQUE, "function");
    }

    /**
     * Highlights the given query text
     */
    public HighlightResult highlight(String queryText) {
        try {
            Lexer lexer = new Lexer(queryText);
            List<Token> tokens = lexer.tokenize();

            List<HighlightedToken> highlightedTokens = tokens.stream()
                .filter(token -> token.type() != TokenType.EOF)
                .map(this::createHighlightedToken)
                .toList();

            return new HighlightResult(highlightedTokens, List.of());
        } catch (Exception e) {
            return new HighlightResult(List.of(), List.of("Syntax error: " + e.getMessage()));
        }
    }

    private HighlightedToken createHighlightedToken(Token token) {
        String syntaxType = getSyntaxType(token.type());
        int start = token.position();
        int end = start + token.value().length();

        return new HighlightedToken(start, end, token.value(), syntaxType, token.type());
    }

    private String getSyntaxType(TokenType tokenType) {
        String type = TOKEN_TO_SYNTAX_TYPE.get(tokenType);
        if (type != null) {
            return type;
        }

        type = ADDITIONAL_MAPPINGS.get(tokenType);
        if (type != null) {
            return type;
        }

        return switch (tokenType) {
            case WHITESPACE -> "whitespace";
            case NEWLINE -> "newline";
            case UNKNOWN -> "error";
            default -> "text";
        };
    }

    /**
     * Gets available syntax types for documentation
     */
    public static Map<String, String> getSyntaxTypes() {
        return Map.of(
            "keyword", "SQL keywords (SELECT, FROM, WHERE, etc.)",
            "function", "Aggregate functions (COUNT, AVG, P99, etc.)",
            "operator", "Operators (=, <, >, +, -, etc.)",
            "punctuation", "Punctuation (parentheses, commas, etc.)",
            "special", "Special tokens (@, before_gc, after_gc)",
            "string", "String literals ('text')",
            "number", "Numeric literals (123, 45.67)",
            "duration", "Duration literals (10ms, 5s, 2h)",
            "timestamp", "Timestamp literals (12:34:56.789)",
            "memory", "Memory size literals (1MB, 512KB)",
            "rate", "Rate literals (5/s, 10/m)",
            "boolean", "Boolean literals (true, false)",
            "identifier", "Identifiers (table names, field names)",
            "whitespace", "Whitespace characters",
            "newline", "Line breaks",
            "error", "Unknown or invalid tokens"
        );
    }
}