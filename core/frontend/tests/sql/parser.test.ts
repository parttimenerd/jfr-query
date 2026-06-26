import { describe, it, expect } from 'vitest';
import { parse } from '../../components/editor/sql/parser';
import { cursorNode, walk, findEnclosing, type Node, type NodeKind } from '../../components/editor/sql/ast';

// Helper: collect node kinds in pre-order. Use for compact shape assertions.
function shape(n: Node): string {
    const parts: string[] = [];
    walk(n, (x) => { parts.push(x.kind); });
    return parts.join('>');
}

// Helper: count nodes of a given kind anywhere under root.
function countKind(root: Node, kind: NodeKind): number {
    let n = 0;
    walk(root, (x) => { if (x.kind === kind) n++; });
    return n;
}

// Find first descendant of `kind`.
function find(root: Node, kind: NodeKind): Node | undefined {
    let found: Node | undefined;
    walk(root, (x) => { if (!found && x.kind === kind) found = x; });
    return found;
}

describe('parser — well-formed SELECT', () => {
    it('parses `SELECT 1` to a query with a selectClause', () => {
        const { root } = parse('SELECT 1');
        const q = find(root, 'query')!;
        expect(q).toBeDefined();
        expect(find(q, 'selectClause')).toBeDefined();
        expect(find(q, 'literal')).toBeDefined();
        // The literal text is `1`.
        expect(find(q, 'literal')!.text).toBe('1');
    });

    it('parses SELECT with WHERE', () => {
        const { root } = parse('SELECT a FROM t WHERE x = 1');
        expect(find(root, 'fromClause')).toBeDefined();
        expect(find(root, 'whereClause')).toBeDefined();
        const cmp = find(root, 'binaryExpr');
        expect(cmp).toBeDefined();
    });

    it('parses GROUP BY / HAVING / ORDER BY / LIMIT', () => {
        const { root } = parse(
            'SELECT cat, count(*) FROM t GROUP BY cat HAVING count(*) > 1 ORDER BY cat LIMIT 10'
        );
        expect(find(root, 'groupByClause')).toBeDefined();
        expect(find(root, 'havingClause')).toBeDefined();
        expect(find(root, 'orderByClause')).toBeDefined();
        expect(find(root, 'limitClause')).toBeDefined();
    });

    it('clause annotations are populated', () => {
        const { root } = parse('SELECT a FROM t WHERE b = 1');
        expect(find(root, 'selectClause')!.annotations.clause).toBe('select');
        expect(find(root, 'fromClause')!.annotations.clause).toBe('from');
        expect(find(root, 'whereClause')!.annotations.clause).toBe('where');
    });
});

describe('parser — joins', () => {
    it('parses INNER JOIN with ON', () => {
        const { root } = parse('SELECT * FROM a JOIN b ON a.x = b.y');
        const join = find(root, 'join');
        expect(join).toBeDefined();
        expect(find(join!, 'joinCondition')).toBeDefined();
    });

    it('parses LEFT JOIN', () => {
        const { root } = parse('SELECT * FROM a LEFT JOIN b ON a.x = b.y');
        expect(find(root, 'join')).toBeDefined();
    });

    it('parses comma-joined FROM list', () => {
        const { root } = parse('SELECT * FROM a, b WHERE a.x = b.y');
        const from = find(root, 'fromClause')!;
        const tableRefs = from.children.filter(c => c.kind === 'tableRef');
        expect(tableRefs.length).toBe(2);
    });
});

describe('parser — CTEs', () => {
    it('parses WITH foo AS (SELECT ...)', () => {
        const { root } = parse('WITH foo AS (SELECT 1) SELECT * FROM foo');
        expect(find(root, 'with')).toBeDefined();
        expect(find(root, 'cte')).toBeDefined();
        // Inner query is nested under the cte
        const cte = find(root, 'cte')!;
        expect(find(cte, 'query')).toBeDefined();
    });

    it('parses WITH RECURSIVE', () => {
        const { root } = parse('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT * FROM r');
        expect(find(root, 'with')).toBeDefined();
        expect(find(root, 'setOp')).toBeDefined();
    });

    it('parses multiple CTEs', () => {
        const { root } = parse('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b');
        expect(countKind(root, 'cte')).toBe(2);
    });
});

describe('parser — expressions', () => {
    it('respects precedence: a + b * c', () => {
        const { root } = parse('SELECT a + b * c');
        // Top binary is +, right child is binary (*)
        // Walk the projection's expression
        const sel = find(root, 'selectClause')!;
        const proj = sel.children[0];
        const top = proj.children[0]; // first binaryExpr
        expect(top.kind).toBe('binaryExpr');
        const rhs = top.children[1];
        expect(rhs.kind).toBe('binaryExpr');
    });

    it('parses cast operator ::', () => {
        const { root } = parse('SELECT x::INTEGER');
        expect(find(root, 'castExpr')).toBeDefined();
    });

    it('parses CAST(x AS type)', () => {
        const { root } = parse('SELECT CAST(x AS DOUBLE)');
        expect(find(root, 'castExpr')).toBeDefined();
    });

    it('parses CASE WHEN', () => {
        const { root } = parse("SELECT CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END");
        expect(find(root, 'caseExpr')).toBeDefined();
    });

    it('parses function call', () => {
        const { root } = parse('SELECT count(*)');
        expect(find(root, 'functionCall')).toBeDefined();
    });

    it('parses count(distinct col)', () => {
        const { root } = parse('SELECT count(DISTINCT cause) FROM gc');
        expect(find(root, 'functionCall')).toBeDefined();
    });

    it('parses FILTER clause on aggregate', () => {
        const { root } = parse('SELECT count(*) FILTER (WHERE x > 0) FROM t');
        expect(find(root, 'filterClause')).toBeDefined();
    });

    it('parses OVER clause', () => {
        const { root } = parse('SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM t');
        expect(find(root, 'overClause')).toBeDefined();
    });

    it('parses COLUMNS(regex)', () => {
        const { root } = parse("SELECT COLUMNS('amount.*') FROM t");
        expect(find(root, 'columnsExpr')).toBeDefined();
    });

    it('parses lambda expression', () => {
        const { root } = parse('SELECT list_transform([1,2,3], x -> x * 2)');
        expect(find(root, 'lambdaExpr')).toBeDefined();
    });

    it('parses IN list', () => {
        const { root } = parse("SELECT * FROM t WHERE cause IN ('a', 'b', 'c')");
        expect(find(root, 'list')).toBeDefined();
    });

    it('parses BETWEEN', () => {
        const { root } = parse('SELECT * FROM t WHERE x BETWEEN 1 AND 10');
        const where = find(root, 'whereClause')!;
        expect(find(where, 'binaryExpr')).toBeDefined();
    });
});

describe('parser — star and projections', () => {
    it('parses * projection', () => {
        const { root } = parse('SELECT * FROM t');
        expect(find(root, 'starExpr')).toBeDefined();
    });

    it('parses t.* projection', () => {
        const { root } = parse('SELECT t.* FROM t');
        expect(find(root, 'starExpr')).toBeDefined();
    });

    it('parses * EXCLUDE (col)', () => {
        const { root } = parse('SELECT * EXCLUDE (timestamp) FROM t');
        expect(find(root, 'starExpr')).toBeDefined();
    });

    it('parses aliased projection (AS form)', () => {
        const { root } = parse('SELECT a AS alpha FROM t');
        const proj = find(root, 'projection')!;
        // Two identifier children: the expression and the alias
        expect(proj.children.length).toBeGreaterThanOrEqual(2);
    });

    it('parses aliased projection (bare-ident form)', () => {
        const { root } = parse('SELECT a alpha FROM t');
        const proj = find(root, 'projection')!;
        expect(proj.children.length).toBeGreaterThanOrEqual(2);
    });
});

describe('parser — dollar refs', () => {
    it('parses $var as variableRef', () => {
        const { root } = parse('SELECT $threshold');
        expect(find(root, 'variableRef')).toBeDefined();
    });

    it('parses $$var as doubleDollarRef', () => {
        const { root } = parse('SELECT $$global');
        expect(find(root, 'doubleDollarRef')).toBeDefined();
    });

    it('parses $cell.var as crossCellRef', () => {
        const { root } = parse('SELECT * FROM t WHERE x = $gcCell.threshold');
        expect(find(root, 'crossCellRef')).toBeDefined();
    });

    it('parses $plot.brush as crossCellRef in WHERE', () => {
        const { root } = parse('SELECT * FROM t WHERE ts IN $gc.brush');
        expect(find(root, 'crossCellRef')).toBeDefined();
    });

    it('parses $cell.var.0 tuple index', () => {
        const { root } = parse('SELECT $cell.range.0 AS lo, $cell.range.1 AS hi');
        const refs: Node[] = [];
        walk(root, (n) => { if (n.kind === 'crossCellRef') refs.push(n); });
        expect(refs.length).toBe(2);
    });
});

describe('parser — set ops', () => {
    it('UNION ALL', () => {
        const { root } = parse('SELECT 1 UNION ALL SELECT 2');
        expect(find(root, 'setOp')).toBeDefined();
    });

    it('INTERSECT', () => {
        const { root } = parse('SELECT 1 INTERSECT SELECT 2');
        expect(find(root, 'setOp')).toBeDefined();
    });

    it('EXCEPT', () => {
        const { root } = parse('SELECT 1 EXCEPT SELECT 2');
        expect(find(root, 'setOp')).toBeDefined();
    });
});

describe('parser — never throws on broken input', () => {
    const broken = [
        '',
        'SELECT',
        'SELECT ',
        'SELECT FROM',
        'SELECT * FROM',
        'SELECT * FROM t WHERE',
        'SELECT * FROM t WHERE x =',
        'SELECT count(',
        'SELECT count(distinct',
        'WITH foo AS (',
        'WITH foo AS (SELECT',
        'SELECT * FROM t JOIN',
        'SELECT * FROM t JOIN b ON',
        'SELECT CASE WHEN',
        'SELECT $',
        'SELECT $$',
        'SELECT $plot.',
        'SELECT a, , b FROM t',
        ')((SELECT',
        '/* comment */',
    ];

    for (const s of broken) {
        it(`survives: ${JSON.stringify(s)}`, () => {
            const { root } = parse(s);
            // Always produces a script root.
            expect(root.kind).toBe('script');
            // Span covers the entire input.
            expect(root.from).toBe(0);
            expect(root.to).toBeLessThanOrEqual(s.length);
        });
    }
});

describe('parser — hole nodes with expectedKinds', () => {
    it('SELECT FROM emits hole expecting an expression', () => {
        const { root } = parse('SELECT FROM t');
        const sel = find(root, 'selectClause')!;
        const hole = find(sel, 'hole');
        expect(hole).toBeDefined();
        expect(hole!.annotations.expectedKinds).toContain('identifier');
    });

    it('SELECT * FROM (no table) emits hole expecting tableRef', () => {
        const { root } = parse('SELECT * FROM');
        const from = find(root, 'fromClause')!;
        const hole = find(from, 'hole');
        expect(hole).toBeDefined();
        expect(hole!.annotations.expectedKinds).toContain('tableRef');
    });
});

describe('parser — cursor positioning', () => {
    it('cursor at SELECT | lands on selectClause or its hole', () => {
        const src = 'SELECT  FROM t';
        const { root } = parse(src);
        const node = cursorNode(root, 7); // between SELECT and FROM
        const sel = findEnclosing(node, 'selectClause');
        expect(sel).toBeDefined();
    });

    it('cursor inside count( | lands inside functionCall', () => {
        const src = 'SELECT count() FROM t';
        const { root } = parse(src);
        // Position right after `count(` is offset 13
        const node = cursorNode(root, 13);
        expect(findEnclosing(node, 'functionCall')).toBeDefined();
    });

    it('cursor in WHERE clause is inside whereClause', () => {
        const src = 'SELECT * FROM t WHERE x = 1';
        const { root } = parse(src);
        // The literal `1` is at offset 26
        const node = cursorNode(root, 26);
        expect(findEnclosing(node, 'whereClause')).toBeDefined();
    });
});

describe('parser — span coverage invariant', () => {
    const samples = [
        'SELECT 1',
        'SELECT * FROM t',
        'SELECT a, b, c FROM t WHERE x = 1 GROUP BY a HAVING count(*) > 1 ORDER BY a LIMIT 10',
        "WITH r AS (SELECT * FROM t) SELECT * FROM r",
        "SELECT count(*) FILTER (WHERE x > 0) OVER (PARTITION BY y) FROM t",
        "SELECT CASE WHEN x > 0 THEN 'pos' WHEN x < 0 THEN 'neg' ELSE 'zero' END FROM t",
        "SELECT x::INTEGER + y::DOUBLE FROM t",
        "SELECT list_transform([1,2,3], x -> x * 2)",
        "SELECT $a, $$b, $cell.v.0 FROM t",
    ];
    for (const s of samples) {
        it(`every node's text equals source.slice(from,to): ${s.slice(0, 40)}`, () => {
            const { root } = parse(s);
            walk(root, (n) => {
                expect(s.slice(n.from, n.to)).toBe(n.text);
                // span is within input bounds
                expect(n.from).toBeGreaterThanOrEqual(0);
                expect(n.to).toBeLessThanOrEqual(s.length);
                expect(n.from).toBeLessThanOrEqual(n.to);
            });
        });
    }
});
