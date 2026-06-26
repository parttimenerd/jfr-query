import { describe, it, expect } from 'vitest';
import { makeNode, makeHole, walk, cursorNode, findEnclosing, findEnclosingAny, markCursorPath, type Node } from '../../components/editor/sql/ast';
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
