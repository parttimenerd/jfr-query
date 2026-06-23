package me.bechberger.jfr.extended.ast;

import java.util.List;
import java.util.Optional;

/**
 * AST node records for the extended JFR query language
 */
public class ASTNodes {

    // Base visitor interface
    public interface ASTVisitor {
        void visitProgram(Program node);
        void visitAssignment(Assignment node);
        void visitExtendedQuery(ExtendedQuery node);
        void visitLegacyQuery(LegacyQuery node);
        void visitShowQuery(ShowQuery node);
        void visitVariableDeclarations(VariableDeclarations node);
        void visitVariableDeclaration(VariableDeclaration node);
        void visitWithClause(WithClause node);
        void visitCommonTableExpression(CommonTableExpression node);
        void visitSelectClause(SelectClause node);
        void visitSelectItem(SelectItem node);
        void visitFromClause(FromClause node);
        void visitTableSource(TableSource node);
        void visitJoinClause(JoinClause node);
        void visitWhereClause(WhereClause node);
        void visitGroupByClause(GroupByClause node);
        void visitOrderByClause(OrderByClause node);
        void visitOrderByItem(OrderByItem node);
        void visitLimitClause(LimitClause node);
        void visitBinaryExpression(BinaryExpression node);
        void visitUnaryExpression(UnaryExpression node);
        void visitFunctionCall(FunctionCall node);
        void visitFieldAccess(FieldAccess node);
        void visitLiteral(Literal node);
        void visitIdentifier(Identifier node);
        void visitGCField(GCField node);
    }

    // Base AST node
    public sealed interface ASTNode permits
        Statement, Expression, SelectClause, SelectItem, FromClause, TableSource,
        JoinClause, WhereClause, GroupByClause, OrderByClause, OrderByItem,
        LimitClause, VariableDeclarations, VariableDeclaration, WithClause,
        CommonTableExpression {
        void accept(ASTVisitor visitor);
    }

    // Statements
    public sealed interface Statement extends ASTNode permits
        Program, Assignment, Query {
    }

    public record Program(List<Statement> statements) implements Statement {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitProgram(this);
        }
    }

    public record Assignment(String variable, Query query) implements Statement {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitAssignment(this);
        }
    }

    // Queries
    public sealed interface Query extends Statement permits
        ExtendedQuery, LegacyQuery, ShowQuery {
    }

    public record ExtendedQuery(
        Optional<VariableDeclarations> variables,
        Optional<WithClause> withClause,
        SelectClause selectClause,
        FromClause fromClause,
        Optional<WhereClause> whereClause,
        Optional<GroupByClause> groupByClause,
        Optional<OrderByClause> orderByClause,
        Optional<LimitClause> limitClause
    ) implements Query {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitExtendedQuery(this);
        }
    }

    public record LegacyQuery(String queryText) implements Query {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitLegacyQuery(this);
        }
    }

    public record ShowQuery(ShowType showType, Optional<String> eventType) implements Query {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitShowQuery(this);
        }

        public enum ShowType {
            EVENTS, FIELDS
        }
    }

    // Variable declarations
    public record VariableDeclarations(List<VariableDeclaration> declarations) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitVariableDeclarations(this);
        }
    }

    public record VariableDeclaration(String name, Expression value) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitVariableDeclaration(this);
        }
    }

    // WITH clause
    public record WithClause(List<CommonTableExpression> ctes) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitWithClause(this);
        }
    }

    public record CommonTableExpression(String name, Query query) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitCommonTableExpression(this);
        }
    }

    // SQL clauses
    public record SelectClause(boolean selectAll, List<SelectItem> items) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitSelectClause(this);
        }
    }

    public record SelectItem(Expression expression, Optional<String> alias) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitSelectItem(this);
        }
    }

    public record FromClause(List<TableSource> sources, List<JoinClause> joins) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitFromClause(this);
        }
    }

    public record TableSource(String name, Optional<String> alias) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitTableSource(this);
        }
    }

    public record JoinClause(JoinType joinType, TableSource table, Expression condition) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitJoinClause(this);
        }

        public enum JoinType {
            INNER, LEFT, RIGHT, FULL, FUZZY
        }
    }

    public record WhereClause(Expression condition) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitWhereClause(this);
        }
    }

    public record GroupByClause(List<Expression> expressions) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitGroupByClause(this);
        }
    }

    public record OrderByClause(List<OrderByItem> items) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitOrderByClause(this);
        }
    }

    public record OrderByItem(Expression expression, SortOrder sortOrder) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitOrderByItem(this);
        }

        public enum SortOrder {
            ASC, DESC
        }
    }

    public record LimitClause(int limit) implements ASTNode {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitLimitClause(this);
        }
    }

    // Expressions
    public sealed interface Expression extends ASTNode permits
        BinaryExpression, UnaryExpression, FunctionCall, FieldAccess, Literal, Identifier, GCField {
    }

    public record BinaryExpression(Expression left, BinaryOperator operator, Expression right) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitBinaryExpression(this);
        }

        public enum BinaryOperator {
            PLUS, MINUS, MULTIPLY, DIVIDE, MODULO,
            EQUALS, NOT_EQUALS, LESS_THAN, LESS_EQUAL, GREATER_THAN, GREATER_EQUAL,
            AND, OR, LIKE, IN, BETWEEN
        }
    }

    public record UnaryExpression(UnaryOperator operator, Expression operand) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitUnaryExpression(this);
        }

        public enum UnaryOperator {
            NOT, MINUS
        }
    }

    public record FunctionCall(String name, List<Expression> arguments) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitFunctionCall(this);
        }
    }

    public record FieldAccess(Expression object, String field) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitFieldAccess(this);
        }
    }

    public record Literal(LiteralType type, Object value) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitLiteral(this);
        }

        public enum LiteralType {
            STRING, NUMBER, DURATION, TIMESTAMP, MEMORY_SIZE, RATE, BOOLEAN
        }
    }

    public record Identifier(String name) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitIdentifier(this);
        }
    }

    public record GCField(String eventField, GCFieldType gcType) implements Expression {
        @Override
        public void accept(ASTVisitor visitor) {
            visitor.visitGCField(this);
        }

        public enum GCFieldType {
            BEFORE_GC, AFTER_GC
        }
    }
}