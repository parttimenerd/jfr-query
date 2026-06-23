package me.bechberger.jfr.extended;

import me.bechberger.jfr.extended.ast.ASTNodes.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Parser for the extended JFR query language
 */
public class Parser {
    private final List<Token> tokens;
    private int current = 0;

    public Parser(List<Token> tokens) {
        this.tokens = tokens;
    }

    public Program parse() {
        List<Statement> statements = new ArrayList<>();

        while (!isAtEnd()) {
            Statement stmt = parseStatement();
            if (stmt != null) {
                statements.add(stmt);
            }
        }

        return new Program(statements);
    }

    private Statement parseStatement() {
        // Check for assignment
        if (check(TokenType.IDENTIFIER) && peekNext().type() == TokenType.EQUALS) {
            return parseAssignment();
        }

        // Parse query
        return parseQuery();
    }

    private Assignment parseAssignment() {
        String variable = consume(TokenType.IDENTIFIER, "Expected variable name").value();
        consume(TokenType.EQUALS, "Expected '=' after variable name");
        Query query = parseQuery();
        return new Assignment(variable, query);
    }

    private Query parseQuery() {
        if (match(TokenType.AT)) {
            return parseExtendedQuery();
        } else if (match(TokenType.LBRACKET)) {
            return parseLegacyQuery();
        } else if (match(TokenType.SHOW)) {
            return parseShowQuery();
        } else {
            throw new ParseException("Expected query starting with '@', '[', or 'SHOW'", peek());
        }
    }

    private ExtendedQuery parseExtendedQuery() {
        Optional<VariableDeclarations> variables = parseVariableDeclarations();
        Optional<WithClause> withClause = parseWithClause();
        SelectClause selectClause = parseSelectClause();
        FromClause fromClause = parseFromClause();
        Optional<WhereClause> whereClause = parseWhereClause();
        Optional<GroupByClause> groupByClause = parseGroupByClause();
        Optional<OrderByClause> orderByClause = parseOrderByClause();
        Optional<LimitClause> limitClause = parseLimitClause();

        return new ExtendedQuery(variables, withClause, selectClause, fromClause,
                               whereClause, groupByClause, orderByClause, limitClause);
    }

    private LegacyQuery parseLegacyQuery() {
        StringBuilder queryText = new StringBuilder();

        while (!check(TokenType.RBRACKET) && !isAtEnd()) {
            queryText.append(advance().value()).append(" ");
        }

        consume(TokenType.RBRACKET, "Expected ']' to close legacy query");
        return new LegacyQuery(queryText.toString().trim());
    }

    private ShowQuery parseShowQuery() {
        if (match(TokenType.EVENTS)) {
            return new ShowQuery(ShowQuery.ShowType.EVENTS, Optional.empty());
        } else if (match(TokenType.FIELDS)) {
            String eventType = consume(TokenType.IDENTIFIER, "Expected event type after FIELDS").value();
            return new ShowQuery(ShowQuery.ShowType.FIELDS, Optional.of(eventType));
        } else {
            throw new ParseException("Expected 'EVENTS' or 'FIELDS' after SHOW", peek());
        }
    }

    private Optional<VariableDeclarations> parseVariableDeclarations() {
        if (!check(TokenType.WHERE) || !isVariableDeclaration()) {
            return Optional.empty();
        }

        consume(TokenType.WHERE, "Expected WHERE for variable declarations");
        List<VariableDeclaration> declarations = new ArrayList<>();

        do {
            String name = consume(TokenType.IDENTIFIER, "Expected variable name").value();
            consume(TokenType.ASSIGN, "Expected ':=' after variable name");
            Expression value = parseExpression();
            declarations.add(new VariableDeclaration(name, value));
        } while (match(TokenType.COMMA));

        consume(TokenType.SEMICOLON, "Expected ';' after variable declarations");
        return Optional.of(new VariableDeclarations(declarations));
    }

    private boolean isVariableDeclaration() {
        int savePos = current;
        try {
            if (!check(TokenType.IDENTIFIER)) return false;
            advance();
            boolean isAssignment = check(TokenType.ASSIGN);
            current = savePos;
            return isAssignment;
        } catch (Exception e) {
            current = savePos;
            return false;
        }
    }

    private Optional<WithClause> parseWithClause() {
        if (!match(TokenType.WITH)) {
            return Optional.empty();
        }

        List<CommonTableExpression> ctes = new ArrayList<>();

        do {
            String name = consume(TokenType.IDENTIFIER, "Expected CTE name").value();
            consume(TokenType.AS, "Expected 'AS' after CTE name");
            consume(TokenType.LPAREN, "Expected '(' after AS");
            Query query = parseQuery();
            consume(TokenType.RPAREN, "Expected ')' after CTE query");
            ctes.add(new CommonTableExpression(name, query));
        } while (match(TokenType.COMMA));

        return Optional.of(new WithClause(ctes));
    }

    private SelectClause parseSelectClause() {
        consume(TokenType.SELECT, "Expected SELECT");

        if (match(TokenType.MULTIPLY)) {
            return new SelectClause(true, List.of());
        }

        List<SelectItem> items = new ArrayList<>();

        do {
            Expression expr = parseExpression();
            Optional<String> alias = Optional.empty();

            if (match(TokenType.AS)) {
                alias = Optional.of(consume(TokenType.IDENTIFIER, "Expected alias name").value());
            }

            items.add(new SelectItem(expr, alias));
        } while (match(TokenType.COMMA));

        return new SelectClause(false, items);
    }

    private FromClause parseFromClause() {
        consume(TokenType.FROM, "Expected FROM");

        List<TableSource> sources = new ArrayList<>();
        List<JoinClause> joins = new ArrayList<>();

        do {
            String name = consume(TokenType.IDENTIFIER, "Expected table name").value();
            Optional<String> alias = Optional.empty();

            if (match(TokenType.AS)) {
                alias = Optional.of(consume(TokenType.IDENTIFIER, "Expected alias name").value());
            }

            sources.add(new TableSource(name, alias));
        } while (match(TokenType.COMMA));

        // Parse joins
        while (checkJoin()) {
            JoinClause.JoinType joinType = parseJoinType();
            consume(TokenType.JOIN, "Expected JOIN");

            String tableName = consume(TokenType.IDENTIFIER, "Expected table name").value();
            Optional<String> tableAlias = Optional.empty();

            if (match(TokenType.AS)) {
                tableAlias = Optional.of(consume(TokenType.IDENTIFIER, "Expected alias name").value());
            }

            consume(TokenType.ON, "Expected ON after JOIN");
            Expression condition = parseExpression();

            joins.add(new JoinClause(joinType, new TableSource(tableName, tableAlias), condition));
        }

        return new FromClause(sources, joins);
    }

    private boolean checkJoin() {
        return check(TokenType.INNER) || check(TokenType.LEFT) || check(TokenType.RIGHT) ||
               check(TokenType.FULL) || check(TokenType.FUZZY) || check(TokenType.JOIN);
    }

    private JoinClause.JoinType parseJoinType() {
        if (match(TokenType.INNER)) return JoinClause.JoinType.INNER;
        if (match(TokenType.LEFT)) return JoinClause.JoinType.LEFT;
        if (match(TokenType.RIGHT)) return JoinClause.JoinType.RIGHT;
        if (match(TokenType.FULL)) return JoinClause.JoinType.FULL;
        if (match(TokenType.FUZZY)) return JoinClause.JoinType.FUZZY;
        return JoinClause.JoinType.INNER; // Default
    }

    private Optional<WhereClause> parseWhereClause() {
        if (!match(TokenType.WHERE)) {
            return Optional.empty();
        }

        Expression condition = parseExpression();
        return Optional.of(new WhereClause(condition));
    }

    private Optional<GroupByClause> parseGroupByClause() {
        if (!match(TokenType.GROUP)) {
            return Optional.empty();
        }

        consume(TokenType.BY, "Expected BY after GROUP");

        List<Expression> expressions = new ArrayList<>();

        do {
            expressions.add(parseExpression());
        } while (match(TokenType.COMMA));

        return Optional.of(new GroupByClause(expressions));
    }

    private Optional<OrderByClause> parseOrderByClause() {
        if (!match(TokenType.ORDER)) {
            return Optional.empty();
        }

        consume(TokenType.BY, "Expected BY after ORDER");

        List<OrderByItem> items = new ArrayList<>();

        do {
            Expression expr = parseExpression();
            OrderByItem.SortOrder sortOrder = OrderByItem.SortOrder.ASC;

            if (match(TokenType.ASC)) {
                sortOrder = OrderByItem.SortOrder.ASC;
            } else if (match(TokenType.DESC)) {
                sortOrder = OrderByItem.SortOrder.DESC;
            }

            items.add(new OrderByItem(expr, sortOrder));
        } while (match(TokenType.COMMA));

        return Optional.of(new OrderByClause(items));
    }

    private Optional<LimitClause> parseLimitClause() {
        if (!match(TokenType.LIMIT)) {
            return Optional.empty();
        }

        Token limitToken = consume(TokenType.NUMBER, "Expected number after LIMIT");
        int limit = Integer.parseInt(limitToken.value());
        return Optional.of(new LimitClause(limit));
    }

    private Expression parseExpression() {
        return parseOrExpression();
    }

    private Expression parseOrExpression() {
        Expression expr = parseAndExpression();

        while (match(TokenType.OR)) {
            Expression right = parseAndExpression();
            expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.OR, right);
        }

        return expr;
    }

    private Expression parseAndExpression() {
        Expression expr = parseEqualityExpression();

        while (match(TokenType.AND)) {
            Expression right = parseEqualityExpression();
            expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.AND, right);
        }

        return expr;
    }

    private Expression parseEqualityExpression() {
        Expression expr = parseComparisonExpression();

        while (true) {
            if (match(TokenType.EQUALS)) {
                Expression right = parseComparisonExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.EQUALS, right);
            } else if (match(TokenType.NOT_EQUALS)) {
                Expression right = parseComparisonExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.NOT_EQUALS, right);
            } else if (match(TokenType.LIKE)) {
                Expression right = parseComparisonExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.LIKE, right);
            } else if (match(TokenType.IN)) {
                Expression right = parseComparisonExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.IN, right);
            } else {
                break;
            }
        }

        return expr;
    }

    private Expression parseComparisonExpression() {
        Expression expr = parseArithmeticExpression();

        while (true) {
            if (match(TokenType.LESS_THAN)) {
                Expression right = parseArithmeticExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.LESS_THAN, right);
            } else if (match(TokenType.LESS_EQUAL)) {
                Expression right = parseArithmeticExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.LESS_EQUAL, right);
            } else if (match(TokenType.GREATER_THAN)) {
                Expression right = parseArithmeticExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.GREATER_THAN, right);
            } else if (match(TokenType.GREATER_EQUAL)) {
                Expression right = parseArithmeticExpression();
                expr = new BinaryExpression(expr, BinaryExpression.BinaryOperator.GREATER_EQUAL, right);
            } else {
                break;
            }
        }

        return expr;
    }

    private Expression parseArithmeticExpression() {
        Expression expr = parseTermExpression();

        while (match(TokenType.PLUS, TokenType.MINUS)) {
            Token operator = previous();
            Expression right = parseTermExpression();
            BinaryExpression.BinaryOperator op = operator.type() == TokenType.PLUS ?
                BinaryExpression.BinaryOperator.PLUS : BinaryExpression.BinaryOperator.MINUS;
            expr = new BinaryExpression(expr, op, right);
        }

        return expr;
    }

    private Expression parseTermExpression() {
        Expression expr = parseUnaryExpression();

        while (match(TokenType.MULTIPLY, TokenType.DIVIDE, TokenType.MODULO)) {
            Token operator = previous();
            Expression right = parseUnaryExpression();
            BinaryExpression.BinaryOperator op = switch (operator.type()) {
                case MULTIPLY -> BinaryExpression.BinaryOperator.MULTIPLY;
                case DIVIDE -> BinaryExpression.BinaryOperator.DIVIDE;
                case MODULO -> BinaryExpression.BinaryOperator.MODULO;
                default -> throw new ParseException("Unexpected operator: " + operator.type(), operator);
            };
            expr = new BinaryExpression(expr, op, right);
        }

        return expr;
    }

    private Expression parseUnaryExpression() {
        if (match(TokenType.NOT)) {
            Expression operand = parseUnaryExpression();
            return new UnaryExpression(UnaryExpression.UnaryOperator.NOT, operand);
        }

        if (match(TokenType.MINUS)) {
            Expression operand = parseUnaryExpression();
            return new UnaryExpression(UnaryExpression.UnaryOperator.MINUS, operand);
        }

        return parsePrimaryExpression();
    }

    private Expression parsePrimaryExpression() {
        if (match(TokenType.STRING)) {
            String value = previous().value();
            // Remove quotes
            value = value.substring(1, value.length() - 1);
            return new Literal(Literal.LiteralType.STRING, value);
        }

        if (match(TokenType.NUMBER)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.NUMBER, Double.parseDouble(value));
        }

        if (match(TokenType.DURATION)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.DURATION, value);
        }

        if (match(TokenType.TIMESTAMP)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.TIMESTAMP, value);
        }

        if (match(TokenType.MEMORY_SIZE)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.MEMORY_SIZE, value);
        }

        if (match(TokenType.RATE)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.RATE, value);
        }

        if (match(TokenType.BOOLEAN)) {
            String value = previous().value();
            return new Literal(Literal.LiteralType.BOOLEAN, Boolean.parseBoolean(value));
        }

        if (match(TokenType.IDENTIFIER)) {
            String name = previous().value();

            // Check for function call
            if (match(TokenType.LPAREN)) {
                List<Expression> arguments = new ArrayList<>();

                if (!check(TokenType.RPAREN)) {
                    do {
                        arguments.add(parseExpression());
                    } while (match(TokenType.COMMA));
                }

                consume(TokenType.RPAREN, "Expected ')' after function arguments");
                return new FunctionCall(name, arguments);
            }

            // Check for field access
            if (match(TokenType.DOT)) {
                String field = consume(TokenType.IDENTIFIER, "Expected field name after '.'").value();

                // Check for GC fields
                if ("before_gc".equals(field)) {
                    return new GCField(name, GCField.GCFieldType.BEFORE_GC);
                } else if ("after_gc".equals(field)) {
                    return new GCField(name, GCField.GCFieldType.AFTER_GC);
                } else {
                    return new FieldAccess(new Identifier(name), field);
                }
            }

            return new Identifier(name);
        }

        if (match(TokenType.LPAREN)) {
            Expression expr = parseExpression();
            consume(TokenType.RPAREN, "Expected ')' after expression");
            return expr;
        }

        throw new ParseException("Unexpected token: " + peek().type(), peek());
    }

    // Utility methods
    private boolean match(TokenType... types) {
        for (TokenType type : types) {
            if (check(type)) {
                advance();
                return true;
            }
        }
        return false;
    }

    private boolean check(TokenType type) {
        if (isAtEnd()) return false;
        return peek().type() == type;
    }

    private Token advance() {
        if (!isAtEnd()) current++;
        return previous();
    }

    private boolean isAtEnd() {
        return peek().type() == TokenType.EOF;
    }

    private Token peek() {
        return tokens.get(current);
    }

    private Token peekNext() {
        if (current + 1 >= tokens.size()) {
            return tokens.get(tokens.size() - 1);
        }
        return tokens.get(current + 1);
    }

    private Token previous() {
        return tokens.get(current - 1);
    }

    private Token consume(TokenType type, String message) {
        if (check(type)) return advance();
        throw new ParseException(message, peek());
    }

    public static class ParseException extends RuntimeException {
        private final Token token;

        public ParseException(String message, Token token) {
            super(message + " at line " + token.line() + ", column " + token.column());
            this.token = token;
        }

        public Token getToken() {
            return token;
        }
    }
}