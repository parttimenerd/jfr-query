import { describe, it, expect } from 'vitest';
import { makeNode, makeHole, walk, cursorNode, findEnclosing, findEnclosingAny, markCursorPath, parseDollar, isBrushRef, isTupleIndexRef, type Node } from '../../components/editor/sql/ast';
import { tokenizeSignificant } from '../../components/editor/sql/tokens';

function leaf(kind: Node['kind'], from: number, to: number, source: string): Node {
    return {
        kind, from, to, text: source.slice(from, to),
        children: [], annotations: {},
    };
}

describe('makeNode', () => {
    it('computes span from first/last token', () => {
        const src = 'SELECT 1';
        const toks = tokenizeSignificant(src).filter(t => t.kind !== 'eof');
        const n = makeNode('query', toks, [], src);
        expect(n.from).toBe(0);
        expect(n.to).toBe(8);
        expect(n.text).toBe('SELECT 1');
    });

    it('falls back to children span when no tokens', () => {
        const src = 'a + b';
        const left = leaf('identifier', 0, 1, src);
        const right = leaf('identifier', 4, 5, src);
        const n = makeNode('binaryExpr', null, [left, right], src);
        expect(n.from).toBe(0);
        expect(n.to).toBe(5);
        expect(n.text).toBe('a + b');
    });

    it('falls back to fallbackPos when no tokens and no children', () => {
        const n = makeNode('hole', null, [], 'foo', 7);
        expect(n.from).toBe(7);
        expect(n.to).toBe(7);
    });

    it('wires parent pointers on children', () => {
        const src = 'a';
        const c = leaf('identifier', 0, 1, src);
        const n = makeNode('projection', null, [c], src);
        expect(c.parent).toBe(n);
    });
});

describe('makeHole', () => {
    it('zero-width with expectedKinds set', () => {
        const h = makeHole(5, ['tableRef'], 'SELECT * FROM');
        expect(h.kind).toBe('hole');
        expect(h.from).toBe(5);
        expect(h.to).toBe(5);
        expect(h.text).toBe('');
        expect(h.annotations.expectedKinds).toEqual(['tableRef']);
    });
});

describe('walk', () => {
    it('visits all nodes pre-order, left-to-right', () => {
        const src = 'a + b * c';
        // a + (b * c)
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 4, 5, src);
        const c = leaf('identifier', 8, 9, src);
        const mul = makeNode('binaryExpr', null, [b, c], src);
        const add = makeNode('binaryExpr', null, [a, mul], src);
        const seen: string[] = [];
        walk(add, n => { seen.push(`${n.kind}@${n.from}-${n.to}`); });
        expect(seen).toEqual([
            'binaryExpr@0-9',
            'identifier@0-1',
            'binaryExpr@4-9',
            'identifier@4-5',
            'identifier@8-9',
        ]);
    });

    it('visitor returning false skips subtree', () => {
        const src = 'a + b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 4, 5, src);
        const sub = makeNode('binaryExpr', null, [a, b], src);
        const root = makeNode('query', null, [sub], src);
        const seen: string[] = [];
        walk(root, n => {
            seen.push(n.kind);
            if (n.kind === 'binaryExpr') return false;
        });
        expect(seen).toEqual(['query', 'binaryExpr']);
    });
});

describe('cursorNode', () => {
    it('finds deepest containing node', () => {
        const src = 'a + b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 4, 5, src);
        const expr = makeNode('binaryExpr', null, [a, b], src);
        const root = makeNode('query', null, [expr], src);

        expect(cursorNode(root, 0).kind).toBe('identifier');
        expect(cursorNode(root, 1).kind).toBe('identifier'); // boundary at end of `a`
        expect(cursorNode(root, 2).kind).toBe('binaryExpr');
        expect(cursorNode(root, 4).kind).toBe('identifier');
    });

    it('returns root if offset outside any child', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const root = makeNode('query', null, [a], src);
        // offset 0 lands in `a`; offset past EOF lands in root if root spans it
        expect(cursorNode(root, 0)).toBe(a);
    });

    it('prefers later sibling on ties (caret at boundary)', () => {
        // [a][b] adjacent: offset=1 should pick `b` (later) per the doc
        const src = 'ab';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 1, 2, src);
        const root = makeNode('query', null, [a, b], src);
        // Both contain offset=1. The walker visits in pre-order; ties are
        // broken toward the rightward sibling because we replace `best` on
        // each equal-or-deeper match.
        expect(cursorNode(root, 1)).toBe(b);
    });
});

describe('markCursorPath', () => {
    it('flags every ancestor of the cursor node', () => {
        const src = 'a + b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 4, 5, src);
        const expr = makeNode('binaryExpr', null, [a, b], src);
        const root = makeNode('query', null, [expr], src);
        const target = markCursorPath(root, 4);
        expect(target).toBe(b);
        expect(b.hasCursor).toBe(true);
        expect(expr.hasCursor).toBe(true);
        expect(root.hasCursor).toBe(true);
        expect(a.hasCursor).toBeUndefined();
    });
});

describe('findEnclosing', () => {
    it('walks up to first matching kind', () => {
        const src = 'SELECT a FROM t';
        const id = leaf('identifier', 7, 8, src);
        const proj = makeNode('projection', null, [id], src);
        const sel = makeNode('selectClause', null, [proj], src);
        const q = makeNode('query', null, [sel], src);

        expect(findEnclosing(id, 'projection')).toBe(proj);
        expect(findEnclosing(id, 'selectClause')).toBe(sel);
        expect(findEnclosing(id, 'query')).toBe(q);
        expect(findEnclosing(id, 'fromClause')).toBeUndefined();
    });

    it('findEnclosingAny matches first of several kinds', () => {
        const src = 'WHERE a > 1';
        const id = leaf('identifier', 6, 7, src);
        const where = makeNode('whereClause', null, [id], src);
        const q = makeNode('query', null, [where], src);
        expect(findEnclosingAny(id, ['fromClause', 'whereClause'])).toBe(where);
        expect(findEnclosingAny(id, ['groupByClause', 'query'])).toBe(q);
    });
});

// ─── parseDollar ──────────────────────────────────────────────────────────────

describe('parseDollar', () => {
    it('classifies a simple $name as variableRef', () => {
        const r = parseDollar('$limit');
        expect(r.kind).toBe('variableRef');
        expect(r.name).toBe('limit');
        expect(r.path).toEqual([]);
        expect(r.raw).toBe('$limit');
    });

    it('classifies $$ as doubleDollarRef with empty name', () => {
        const r = parseDollar('$$');
        expect(r.kind).toBe('doubleDollarRef');
        expect(r.name).toBe('');
    });

    it('classifies $$name as doubleDollarRef', () => {
        const r = parseDollar('$$threshold_ms');
        expect(r.kind).toBe('doubleDollarRef');
        expect(r.name).toBe('threshold_ms');
        expect(r.path).toEqual([]);
    });

    it('strips trailing dot from $$name.', () => {
        const r = parseDollar('$$foo.');
        expect(r.kind).toBe('doubleDollarRef');
        expect(r.name).toBe('foo');
    });

    it('classifies $cell.brush as crossCellRef', () => {
        const r = parseDollar('$plot.brush');
        expect(r.kind).toBe('crossCellRef');
        expect(r.name).toBe('plot');
        expect(r.path).toEqual(['brush']);
    });

    it('classifies multi-segment path', () => {
        const r = parseDollar('$gc.range.0');
        expect(r.kind).toBe('crossCellRef');
        expect(r.name).toBe('gc');
        expect(r.path).toEqual(['range', '0']);
    });

    it('classifies $name.bar as crossCellRef', () => {
        const r = parseDollar('$Overview.start');
        expect(r.kind).toBe('crossCellRef');
        expect(r.name).toBe('Overview');
        expect(r.path).toEqual(['start']);
    });

    it('handles just $ (bare dollar)', () => {
        const r = parseDollar('$');
        expect(r.kind).toBe('variableRef');
        expect(r.name).toBe('');
    });

    it('handles $name. (trailing dot, no path)', () => {
        const r = parseDollar('$foo.');
        // dot present → crossCellRef with empty path filtered out
        expect(r.kind).toBe('crossCellRef');
        expect(r.name).toBe('foo');
        expect(r.path).toEqual([]);
    });

    it('non-dollar string is treated as variableRef with name=raw', () => {
        const r = parseDollar('plain');
        expect(r.kind).toBe('variableRef');
        expect(r.name).toBe('plain');
    });
});

// ─── isBrushRef ───────────────────────────────────────────────────────────────

describe('isBrushRef', () => {
    it('returns true for $plot.brush', () => {
        expect(isBrushRef(parseDollar('$plot.brush'))).toBe(true);
    });

    it('returns true for multi-segment path starting with brush', () => {
        expect(isBrushRef(parseDollar('$plot.brush.lo'))).toBe(true);
    });

    it('returns false for $limit (variableRef)', () => {
        expect(isBrushRef(parseDollar('$limit'))).toBe(false);
    });

    it('returns false for $cell.start (not brush)', () => {
        expect(isBrushRef(parseDollar('$cell.start'))).toBe(false);
    });

    it('returns false for $$brushy (doubleDollarRef)', () => {
        expect(isBrushRef(parseDollar('$$brush'))).toBe(false);
    });
});

// ─── isTupleIndexRef ──────────────────────────────────────────────────────────

describe('isTupleIndexRef', () => {
    it('returns true when last path segment is a digit', () => {
        expect(isTupleIndexRef(parseDollar('$gc.range.0'))).toBe(true);
    });

    it('returns true for multi-digit index', () => {
        expect(isTupleIndexRef(parseDollar('$gc.range.12'))).toBe(true);
    });

    it('returns false when last segment is not numeric', () => {
        expect(isTupleIndexRef(parseDollar('$plot.brush'))).toBe(false);
    });

    it('returns false for variableRef', () => {
        expect(isTupleIndexRef(parseDollar('$limit'))).toBe(false);
    });

    it('returns false for doubleDollarRef', () => {
        expect(isTupleIndexRef(parseDollar('$$x'))).toBe(false);
    });

    it('returns false for crossCellRef with no path', () => {
        expect(isTupleIndexRef(parseDollar('$foo.'))).toBe(false);
    });
});
