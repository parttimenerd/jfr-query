package me.bechberger.jfr.extended;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lexer for the extended JFR query language
 */
public class Lexer {
    private final String input;
    private int position;
    private int line;
    private int column;

    public Lexer(String input) {
        this.input = input;
        this.position = 0;
        this.line = 1;
        this.column = 1;
    }

    public List<Token> tokenize() {
        List<Token> tokens = new ArrayList<>();

        while (position < input.length()) {
            Token token = nextToken();
            if (token.type() != TokenType.WHITESPACE) {
                tokens.add(token);
            }
        }

        tokens.add(new Token(TokenType.EOF, "", line, column, position));
        return tokens;
    }

    private Token nextToken() {
        if (position >= input.length()) {
            return new Token(TokenType.EOF, "", line, column, position);
        }

        char currentChar = input.charAt(position);

        // Handle whitespace
        if (Character.isWhitespace(currentChar)) {
            return handleWhitespace();
        }

        // Handle single-character tokens
        Token singleChar = handleSingleCharacter(currentChar);
        if (singleChar != null) {
            return singleChar;
        }

        // Handle multi-character operators
        Token operator = handleOperator();
        if (operator != null) {
            return operator;
        }

        // Handle string literals
        if (currentChar == '\'') {
            return handleString();
        }

        // Handle numbers, durations, memory sizes, rates, timestamps
        if (Character.isDigit(currentChar)) {
            return handleNumeric();
        }

        // Handle identifiers and keywords
        if (Character.isLetter(currentChar) || currentChar == '_') {
            return handleIdentifier();
        }

        // Unknown character
        return new Token(TokenType.UNKNOWN, String.valueOf(currentChar), line, column, position++);
    }

    private Token handleWhitespace() {
        int startPos = position;
        int startCol = column;
        StringBuilder sb = new StringBuilder();

        while (position < input.length() && Character.isWhitespace(input.charAt(position))) {
            char ch = input.charAt(position);
            sb.append(ch);
            if (ch == '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
            position++;
        }

        return new Token(TokenType.WHITESPACE, sb.toString(), line, startCol, startPos);
    }

    private Token handleSingleCharacter(char ch) {
        TokenType type = switch (ch) {
            case '@' -> TokenType.AT;
            case '(' -> TokenType.LPAREN;
            case ')' -> TokenType.RPAREN;
            case '[' -> TokenType.LBRACKET;
            case ']' -> TokenType.RBRACKET;
            case ',' -> TokenType.COMMA;
            case ';' -> TokenType.SEMICOLON;
            case '.' -> TokenType.DOT;
            case '+' -> TokenType.PLUS;
            case '-' -> TokenType.MINUS;
            case '*' -> TokenType.MULTIPLY;
            case '/' -> TokenType.DIVIDE;
            case '%' -> TokenType.MODULO;
            default -> null;
        };

        if (type != null) {
            int startPos = position;
            int startCol = column;
            position++;
            column++;
            return new Token(type, String.valueOf(ch), line, startCol, startPos);
        }

        return null;
    }

    private Token handleOperator() {
        String twoChar = position + 1 < input.length() ?
                        input.substring(position, position + 2) : "";

        TokenType type = switch (twoChar) {
            case ":=" -> TokenType.ASSIGN;
            case "!=" -> TokenType.NOT_EQUALS;
            case "<=" -> TokenType.LESS_EQUAL;
            case ">=" -> TokenType.GREATER_EQUAL;
            default -> null;
        };

        if (type != null) {
            int startPos = position;
            int startCol = column;
            position += 2;
            column += 2;
            return new Token(type, twoChar, line, startCol, startPos);
        }

        // Single character operators
        char ch = input.charAt(position);
        type = switch (ch) {
            case '=' -> TokenType.EQUALS;
            case '<' -> TokenType.LESS_THAN;
            case '>' -> TokenType.GREATER_THAN;
            default -> null;
        };

        if (type != null) {
            int startPos = position;
            int startCol = column;
            position++;
            column++;
            return new Token(type, String.valueOf(ch), line, startCol, startPos);
        }

        return null;
    }

    private Token handleString() {
        int startPos = position;
        int startCol = column;
        StringBuilder sb = new StringBuilder();

        sb.append(input.charAt(position)); // Include opening quote
        position++; // Skip opening quote
        column++;

        while (position < input.length() && input.charAt(position) != '\'') {
            char ch = input.charAt(position);
            if (ch == '\\' && position + 1 < input.length()) {
                // Handle escape sequences
                sb.append(ch);
                position++;
                column++;
                char escaped = input.charAt(position);
                sb.append(escaped);
            } else {
                sb.append(ch);
            }
            position++;
            column++;
        }

        if (position < input.length()) {
            sb.append(input.charAt(position)); // Include closing quote
            position++; // Skip closing quote
            column++;
        }

        return new Token(TokenType.STRING, sb.toString(), line, startCol, startPos);
    }

    private Token handleNumeric() {
        int startPos = position;
        int startCol = column;
        StringBuilder sb = new StringBuilder();

        // Handle timestamp pattern first (HH:MM:SS.fff)
        if (isTimestampPattern()) {
            return handleTimestamp(startPos, startCol);
        }

        // Read digits and decimal point
        while (position < input.length() &&
               (Character.isDigit(input.charAt(position)) || input.charAt(position) == '.')) {
            sb.append(input.charAt(position));
            position++;
            column++;
        }

        // Check for unit suffixes
        String lookahead = lookAhead(6);

        // Duration units (order matters for proper matching)
        if (lookahead.matches("(ns|us|ms|s|m|h|d)\\b.*")) {
            String unit = extractDurationUnit(lookahead);
            if (!unit.isEmpty()) {
                sb.append(unit);
                position += unit.length();
                column += unit.length();
                return new Token(TokenType.DURATION, sb.toString(), line, startCol, startPos);
            }
        }

        // Memory size units
        if (lookahead.matches("(TB|GB|MB|KB|B)\\b.*")) {
            String unit = extractMemoryUnit(lookahead);
            if (!unit.isEmpty()) {
                sb.append(unit);
                position += unit.length();
                column += unit.length();
                return new Token(TokenType.MEMORY_SIZE, sb.toString(), line, startCol, startPos);
            }
        }

        // Rate units
        if (lookahead.matches("/[smh].*")) {
            String unit = lookahead.substring(0, 2);
            sb.append(unit);
            position += 2;
            column += 2;
            return new Token(TokenType.RATE, sb.toString(), line, startCol, startPos);
        }

        return new Token(TokenType.NUMBER, sb.toString(), line, startCol, startPos);
    }

    private boolean isTimestampPattern() {
        int savePos = position;
        StringBuilder sb = new StringBuilder();

        // Try to match HH:MM:SS.fff pattern
        while (savePos < input.length() &&
               (Character.isDigit(input.charAt(savePos)) ||
                input.charAt(savePos) == ':' ||
                input.charAt(savePos) == '.')) {
            sb.append(input.charAt(savePos));
            savePos++;
        }

        return sb.toString().matches("\\d{1,2}:\\d{2}:\\d{2}(\\.\\d+)?");
    }

    private Token handleTimestamp(int startPos, int startCol) {
        StringBuilder sb = new StringBuilder();

        // Pattern: HH:MM:SS.fff
        while (position < input.length() &&
               (Character.isDigit(input.charAt(position)) ||
                input.charAt(position) == ':' ||
                input.charAt(position) == '.')) {
            sb.append(input.charAt(position));
            position++;
            column++;
        }

        return new Token(TokenType.TIMESTAMP, sb.toString(), line, startCol, startPos);
    }

    private Token handleIdentifier() {
        int startPos = position;
        int startCol = column;
        StringBuilder sb = new StringBuilder();

        while (position < input.length() &&
               (Character.isLetterOrDigit(input.charAt(position)) || input.charAt(position) == '_')) {
            sb.append(input.charAt(position));
            position++;
            column++;
        }

        String value = sb.toString();

        // Check for keywords
        TokenType type = getKeywordType(value);
        if (type != null) {
            return new Token(type, value, line, startCol, startPos);
        }

        // Check for boolean literals
        if ("true".equals(value) || "false".equals(value)) {
            return new Token(TokenType.BOOLEAN, value, line, startCol, startPos);
        }

        return new Token(TokenType.IDENTIFIER, value, line, startCol, startPos);
    }

    private String lookAhead(int length) {
        int end = Math.min(position + length, input.length());
        return input.substring(position, end);
    }

    private String extractDurationUnit(String lookahead) {
        // Order matters - check longer units first
        if (lookahead.startsWith("ns")) return "ns";
        if (lookahead.startsWith("us")) return "us";
        if (lookahead.startsWith("ms")) return "ms";
        if (lookahead.startsWith("s")) return "s";
        if (lookahead.startsWith("m")) return "m";
        if (lookahead.startsWith("h")) return "h";
        if (lookahead.startsWith("d")) return "d";
        return "";
    }

    private String extractMemoryUnit(String lookahead) {
        // Order matters - check longer units first
        if (lookahead.startsWith("TB")) return "TB";
        if (lookahead.startsWith("GB")) return "GB";
        if (lookahead.startsWith("MB")) return "MB";
        if (lookahead.startsWith("KB")) return "KB";
        if (lookahead.startsWith("B")) return "B";
        return "";
    }

    private TokenType getKeywordType(String value) {
        return switch (value.toUpperCase()) {
            case "SELECT" -> TokenType.SELECT;
            case "FROM" -> TokenType.FROM;
            case "WHERE" -> TokenType.WHERE;
            case "GROUP" -> TokenType.GROUP;
            case "BY" -> TokenType.BY;
            case "ORDER" -> TokenType.ORDER;
            case "LIMIT" -> TokenType.LIMIT;
            case "AS" -> TokenType.AS;
            case "AND" -> TokenType.AND;
            case "OR" -> TokenType.OR;
            case "NOT" -> TokenType.NOT;
            case "IN" -> TokenType.IN;
            case "LIKE" -> TokenType.LIKE;
            case "BETWEEN" -> TokenType.BETWEEN;
            case "JOIN" -> TokenType.JOIN;
            case "INNER" -> TokenType.INNER;
            case "LEFT" -> TokenType.LEFT;
            case "RIGHT" -> TokenType.RIGHT;
            case "FULL" -> TokenType.FULL;
            case "FUZZY" -> TokenType.FUZZY;
            case "ON" -> TokenType.ON;
            case "WITH" -> TokenType.WITH;
            case "SHOW" -> TokenType.SHOW;
            case "EVENTS" -> TokenType.EVENTS;
            case "FIELDS" -> TokenType.FIELDS;
            case "COLUMN" -> TokenType.COLUMN;
            case "FORMAT" -> TokenType.FORMAT;
            case "ASC" -> TokenType.ASC;
            case "DESC" -> TokenType.DESC;
            case "HAVING" -> TokenType.HAVING;
            case "FIRST" -> TokenType.FIRST;
            case "LAST" -> TokenType.LAST;
            case "AVG" -> TokenType.AVG;
            case "COUNT" -> TokenType.COUNT;
            case "DIFF" -> TokenType.DIFF;
            case "LAST_BATCH" -> TokenType.LAST_BATCH;
            case "LIST" -> TokenType.LIST;
            case "MAX" -> TokenType.MAX;
            case "MEDIAN" -> TokenType.MEDIAN;
            case "MIN" -> TokenType.MIN;
            case "P90" -> TokenType.P90;
            case "P95" -> TokenType.P95;
            case "P99" -> TokenType.P99;
            case "P999" -> TokenType.P999;
            case "STDEV" -> TokenType.STDEV;
            case "SUM" -> TokenType.SUM;
            case "UNIQUE" -> TokenType.UNIQUE;
            case "BEFORE_GC" -> TokenType.BEFORE_GC;
            case "AFTER_GC" -> TokenType.AFTER_GC;
            default -> null;
        };
    }
}