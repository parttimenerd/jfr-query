package me.bechberger.jfr.extended;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import me.bechberger.jfr.extended.ast.ASTNodes.*;
import java.util.List;

/**
 * Comprehensive test suite for the JFR extended query language parser
 */
public class ParserTest {

    private Parser parser;

    @Test
    public void testSimpleExtendedQuery() {
        String query = "@ SELECT * FROM GarbageCollection";
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(1, program.statements().size());

        Statement stmt = program.statements().get(0);
        assertTrue(stmt instanceof ExtendedQuery);

        ExtendedQuery extQuery = (ExtendedQuery) stmt;
        assertTrue(extQuery.selectClause().selectAll());
        assertEquals(1, extQuery.fromClause().sources().size());
        assertEquals("GarbageCollection", extQuery.fromClause().sources().get(0).name());
    }

    @Test
    public void testSelectWithFields() {
        String query = "@ SELECT id, duration, cause FROM GarbageCollection";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertFalse(extQuery.selectClause().selectAll());
        assertEquals(3, extQuery.selectClause().items().size());

        SelectItem firstItem = extQuery.selectClause().items().get(0);
        assertTrue(firstItem.expression() instanceof Identifier);
        assertEquals("id", ((Identifier) firstItem.expression()).name());
    }

    @Test
    public void testWhereClause() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10ms";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.whereClause().isPresent());
        WhereClause whereClause = extQuery.whereClause().get();

        assertTrue(whereClause.condition() instanceof BinaryExpression);
        BinaryExpression binExpr = (BinaryExpression) whereClause.condition();
        assertEquals(BinaryExpression.BinaryOperator.GREATER_THAN, binExpr.operator());
    }

    @Test
    public void testGroupByClause() {
        String query = "@ SELECT thread, COUNT(*) FROM ExecutionSample GROUP BY thread";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.groupByClause().isPresent());
        GroupByClause groupBy = extQuery.groupByClause().get();
        assertEquals(1, groupBy.expressions().size());

        assertTrue(groupBy.expressions().get(0) instanceof Identifier);
        assertEquals("thread", ((Identifier) groupBy.expressions().get(0)).name());
    }

    @Test
    public void testOrderByClause() {
        String query = "@ SELECT * FROM GarbageCollection ORDER BY duration DESC, id ASC";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.orderByClause().isPresent());
        OrderByClause orderBy = extQuery.orderByClause().get();
        assertEquals(2, orderBy.items().size());

        assertEquals(OrderByItem.SortOrder.DESC, orderBy.items().get(0).sortOrder());
        assertEquals(OrderByItem.SortOrder.ASC, orderBy.items().get(1).sortOrder());
    }

    @Test
    public void testLimitClause() {
        String query = "@ SELECT * FROM GarbageCollection LIMIT 100";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.limitClause().isPresent());
        assertEquals(100, extQuery.limitClause().get().limit());
    }

    @Test
    public void testFunctionCall() {
        String query = "@ SELECT COUNT(*), AVG(duration) FROM GarbageCollection";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertEquals(2, extQuery.selectClause().items().size());

        SelectItem firstItem = extQuery.selectClause().items().get(0);
        assertTrue(firstItem.expression() instanceof FunctionCall);
        FunctionCall countCall = (FunctionCall) firstItem.expression();
        assertEquals("COUNT", countCall.name());
        assertEquals(1, countCall.arguments().size());

        SelectItem secondItem = extQuery.selectClause().items().get(1);
        assertTrue(secondItem.expression() instanceof FunctionCall);
        FunctionCall avgCall = (FunctionCall) secondItem.expression();
        assertEquals("AVG", avgCall.name());
        assertEquals(1, avgCall.arguments().size());
    }

    @Test
    public void testGCFields() {
        String query = "@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc = 10";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.whereClause().isPresent());
        BinaryExpression binExpr = (BinaryExpression) extQuery.whereClause().get().condition();

        assertTrue(binExpr.left() instanceof GCField);
        GCField gcField = (GCField) binExpr.left();
        assertEquals("E", gcField.eventField());
        assertEquals(GCField.GCFieldType.BEFORE_GC, gcField.gcType());
    }

    @Test
    public void testComplexGCQuery() {
        String query = "@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc IN P99(GarbageCollection, id, duration)";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.whereClause().isPresent());
        BinaryExpression binExpr = (BinaryExpression) extQuery.whereClause().get().condition();

        assertEquals(BinaryExpression.BinaryOperator.IN, binExpr.operator());
        assertTrue(binExpr.left() instanceof GCField);
        assertTrue(binExpr.right() instanceof FunctionCall);

        FunctionCall p99Call = (FunctionCall) binExpr.right();
        assertEquals("P99", p99Call.name());
        assertEquals(3, p99Call.arguments().size());
    }

    @Test
    public void testVariableDeclarations() {
        String query = "@ WHERE gc_threshold := P99(GarbageCollection, duration); SELECT * FROM ExecutionSample WHERE duration > gc_threshold";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.variables().isPresent());
        VariableDeclarations vars = extQuery.variables().get();
        assertEquals(1, vars.declarations().size());

        VariableDeclaration varDecl = vars.declarations().get(0);
        assertEquals("gc_threshold", varDecl.name());
        assertTrue(varDecl.value() instanceof FunctionCall);
    }

    @Test
    public void testWithClause() {
        String query = "@ WITH slow_gcs AS (@ SELECT * FROM GarbageCollection WHERE duration > 100ms) SELECT * FROM slow_gcs";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.withClause().isPresent());
        WithClause withClause = extQuery.withClause().get();
        assertEquals(1, withClause.ctes().size());

        CommonTableExpression cte = withClause.ctes().get(0);
        assertEquals("slow_gcs", cte.name());
        assertTrue(cte.query() instanceof ExtendedQuery);
    }

    @Test
    public void testJoinClause() {
        String query = "@ SELECT * FROM ExecutionSample e INNER JOIN ThreadPark p ON e.thread = p.thread";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertEquals(1, extQuery.fromClause().joins().size());
        JoinClause join = extQuery.fromClause().joins().get(0);
        assertEquals(JoinClause.JoinType.INNER, join.joinType());
        assertEquals("ThreadPark", join.table().name());
        assertTrue(join.table().alias().isPresent());
        assertEquals("p", join.table().alias().get());
    }

    @Test
    public void testFuzzyJoin() {
        String query = "@ SELECT * FROM ExecutionSample e FUZZY JOIN ThreadPark p ON e.thread = p.thread";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertEquals(1, extQuery.fromClause().joins().size());
        JoinClause join = extQuery.fromClause().joins().get(0);
        assertEquals(JoinClause.JoinType.FUZZY, join.joinType());
    }

    @Test
    public void testAssignment() {
        String query = "slow_gcs = @ SELECT * FROM GarbageCollection WHERE duration > 100ms";
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(1, program.statements().size());

        Statement stmt = program.statements().get(0);
        assertTrue(stmt instanceof Assignment);

        Assignment assignment = (Assignment) stmt;
        assertEquals("slow_gcs", assignment.variable());
        assertTrue(assignment.query() instanceof ExtendedQuery);
    }

    @Test
    public void testLegacyQuery() {
        String query = "[SELECT * FROM jdk.GarbageCollection WHERE cause = 'System.gc()']";
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(1, program.statements().size());

        Statement stmt = program.statements().get(0);
        assertTrue(stmt instanceof LegacyQuery);

        LegacyQuery legacyQuery = (LegacyQuery) stmt;
        assertTrue(legacyQuery.queryText().contains("jdk.GarbageCollection"));
    }

    @Test
    public void testShowEvents() {
        String query = "SHOW EVENTS";
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(1, program.statements().size());

        Statement stmt = program.statements().get(0);
        assertTrue(stmt instanceof ShowQuery);

        ShowQuery showQuery = (ShowQuery) stmt;
        assertEquals(ShowQuery.ShowType.EVENTS, showQuery.showType());
        assertTrue(showQuery.eventType().isEmpty());
    }

    @Test
    public void testShowFields() {
        String query = "SHOW FIELDS GarbageCollection";
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(1, program.statements().size());

        Statement stmt = program.statements().get(0);
        assertTrue(stmt instanceof ShowQuery);

        ShowQuery showQuery = (ShowQuery) stmt;
        assertEquals(ShowQuery.ShowType.FIELDS, showQuery.showType());
        assertTrue(showQuery.eventType().isPresent());
        assertEquals("GarbageCollection", showQuery.eventType().get());
    }

    @Test
    public void testLiterals() {
        String query = "@ SELECT * FROM GarbageCollection WHERE duration > 10ms AND allocationSize < 1MB AND rate = 5/s AND active = true";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.whereClause().isPresent());
        // The condition should be a complex boolean expression with literals
        Expression condition = extQuery.whereClause().get().condition();
        assertTrue(condition instanceof BinaryExpression);
    }

    @Test
    public void testMultipleStatements() {
        String query = """
            slow_gcs = @ SELECT * FROM GarbageCollection WHERE duration > 100ms
            @ SELECT * FROM ExecutionSample WHERE before_gc IN (SELECT id FROM slow_gcs)
            """;
        parser = createParser(query);

        Program program = parser.parse();
        assertEquals(2, program.statements().size());

        assertTrue(program.statements().get(0) instanceof Assignment);
        assertTrue(program.statements().get(1) instanceof ExtendedQuery);
    }

    @Test
    public void testParseError() {
        String query = "@ SELECT FROM"; // Missing fields and table
        parser = createParser(query);

        assertThrows(Parser.ParseException.class, () -> {
            parser.parse();
        });
    }

    @Test
    public void testComplexExpression() {
        String query = "@ SELECT * FROM GarbageCollection WHERE (duration > 10ms AND cause = 'System.gc()') OR (allocationSize > 1MB)";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertTrue(extQuery.whereClause().isPresent());
        Expression condition = extQuery.whereClause().get().condition();
        assertTrue(condition instanceof BinaryExpression);

        BinaryExpression binExpr = (BinaryExpression) condition;
        assertEquals(BinaryExpression.BinaryOperator.OR, binExpr.operator());
    }

    @Test
    public void testFieldAccess() {
        String query = "@ SELECT stackTrace.topFrame FROM ExecutionSample";
        parser = createParser(query);

        Program program = parser.parse();
        ExtendedQuery extQuery = (ExtendedQuery) program.statements().get(0);

        assertEquals(1, extQuery.selectClause().items().size());
        SelectItem item = extQuery.selectClause().items().get(0);
        assertTrue(item.expression() instanceof FieldAccess);

        FieldAccess fieldAccess = (FieldAccess) item.expression();
        assertEquals("topFrame", fieldAccess.field());
        assertTrue(fieldAccess.object() instanceof Identifier);
        assertEquals("stackTrace", ((Identifier) fieldAccess.object()).name());
    }

    private Parser createParser(String query) {
        Lexer lexer = new Lexer(query);
        List<Token> tokens = lexer.tokenize();
        return new Parser(tokens);
    }
}