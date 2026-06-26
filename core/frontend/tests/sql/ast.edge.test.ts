import { describe, it, expect } from 'vitest';
import {
    makeNode,
    makeHole,
    walk,
    cursorNode,
    findEnclosing,
    findEnclosingAny,
    markCursorPath,
    type Node,
    type NodeKind,
} from '../../components/editor/sql/ast';
import { tokenizeSignificant } from '../../components/editor/sql/tokens';

// A minimal leaf builder for arranging trees without going through the parser.
function leaf(kind: NodeKind, from: number, to: number, source: string): Node {
    return {
        kind, from, to,
        text: source.slice(from, to),
        children: [],
        annotations: {},
    };
}

// Convenience: assert that walk visits `expected` in pre-order.
function preorder(root: Node): string[] {
    const seen: string[] = [];
    walk(root, n => { seen.push(`${n.kind}@${n.from}-${n.to}`); });
    return seen;
}

// =========================================================================
// makeNode
// =========================================================================

describe('makeNode — edge cases', () => {
    it('empty tokens AND empty children AND no fallbackPos defaults to [0,0)', () => {
        const n = makeNode('hole', [], [], 'anything');
        expect(n.from).toBe(0);
        expect(n.to).toBe(0);
        expect(n.text).toBe('');
        expect(n.children).toEqual([]);
        expect(n.annotations).toEqual({});
    });

    it('empty tokens, no children, explicit fallbackPos honored', () => {
        const n = makeNode('hole', null, [], 'SELECT FROM', 7);
        expect(n.from).toBe(7);
        expect(n.to).toBe(7);
    });

    it('null tokens with children: span comes from first/last child', () => {
        const src = 'a b c';
        const a = leaf('identifier', 0, 1, src);
        const c = leaf('identifier', 4, 5, src);
        const n = makeNode('list', null, [a, c], src);
        expect(n.from).toBe(0);
        expect(n.to).toBe(5);
        expect(n.text).toBe('a b c');
    });

    it('children extend the token-derived span to cover their full range', () => {
        // Spec change: when both tokens and children are provided, the node
        // span is the union of (tokens span) and (children span). This lets
        // hole-bearing clauses (e.g. `SELECT  FROM t` — clause has tokens for
        // `SELECT` plus a hole at the FROM position) correctly cover the gap
        // so cursorNode() lands on the clause.
        const src = 'aaa bbb ccc';
        const toks = tokenizeSignificant(src).filter(t => t.kind !== 'eof');
        const headOnly = toks.slice(0, 2);          // covers aaa..bbb
        const farChild = leaf('identifier', 0, 11, src);
        const n = makeNode('list', headOnly, [farChild], src);
        expect(n.from).toBe(0);                     // min(token.from, child.from)
        expect(n.to).toBe(11);                      // max(token.to, child.to)
        expect(n.text).toBe(src);
    });

    it('wires parent pointer for every child', () => {
        const src = 'x y z';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const c = leaf('identifier', 4, 5, src);
        const n = makeNode('list', null, [a, b, c], src);
        expect(a.parent).toBe(n);
        expect(b.parent).toBe(n);
        expect(c.parent).toBe(n);
    });

    it('does not mutate the tokens array', () => {
        const src = 'SELECT 1';
        const toks = tokenizeSignificant(src).filter(t => t.kind !== 'eof');
        const before = toks.slice();
        makeNode('query', toks, [], src);
        expect(toks).toEqual(before);
    });

    it('text is the source slice [from,to), even for zero-width nodes', () => {
        const n = makeNode('hole', null, [], 'hello world', 3);
        expect(n.text).toBe('');
    });

    it('children preserved in declared order', () => {
        const src = 'a b c d';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const c = leaf('identifier', 4, 5, src);
        const d = leaf('identifier', 6, 7, src);
        const n = makeNode('list', null, [a, b, c, d], src);
        expect(n.children).toEqual([a, b, c, d]);
    });

    it('starts with empty annotations object', () => {
        const n = makeNode('query', null, [], 'x');
        expect(n.annotations).toEqual({});
        expect(n.hasCursor).toBeUndefined();
    });
});

// =========================================================================
// makeHole
// =========================================================================

describe('makeHole — edge cases', () => {
    it('produces a zero-width node at pos', () => {
        const h = makeHole(0, ['tableRef'], '');
        expect(h.from).toBe(0);
        expect(h.to).toBe(0);
        expect(h.text).toBe('');
    });

    it('stores expectedKinds on annotations', () => {
        const h = makeHole(3, ['identifier', 'literal'], 'abc');
        expect(h.annotations.expectedKinds).toEqual(['identifier', 'literal']);
    });

    it('hole at end of source has from = to = source.length', () => {
        const src = 'SELECT * FROM ';
        const h = makeHole(src.length, ['tableRef'], src);
        expect(h.from).toBe(src.length);
        expect(h.to).toBe(src.length);
    });

    it('empty expectedKinds list is allowed', () => {
        const h = makeHole(0, [], '');
        expect(h.annotations.expectedKinds).toEqual([]);
    });

    it('has no parent and no children', () => {
        const h = makeHole(2, ['identifier'], 'abc');
        expect(h.children).toEqual([]);
        expect(h.parent).toBeUndefined();
    });
});

// =========================================================================
// walk
// =========================================================================

describe('walk — edge cases', () => {
    it('handles a single root with no children', () => {
        const n = makeNode('query', null, [], 'x');
        expect(preorder(n)).toEqual([`query@0-0`]);
    });

    it('descends through a hole leaf when visitor returns nothing', () => {
        const src = 'SELECT FROM';
        const h = makeHole(7, ['tableRef'], src);
        const sel = makeNode('selectClause', null, [h], src);
        // hole is a leaf, walk just visits it.
        expect(preorder(sel)).toEqual([
            'selectClause@7-7',
            'hole@7-7',
        ]);
    });

    it('visitor returning `undefined` still descends (only `false` skips)', () => {
        const src = 'a b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const root = makeNode('list', null, [a, b], src);
        const seen: string[] = [];
        walk(root, n => { seen.push(n.kind); return undefined; });
        expect(seen).toEqual(['list', 'identifier', 'identifier']);
    });

    it('visitor returning `true` descends (only `false` skips)', () => {
        const src = 'a b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const root = makeNode('list', null, [a, b], src);
        const seen: string[] = [];
        walk(root, n => { seen.push(n.kind); return true; });
        expect(seen).toEqual(['list', 'identifier', 'identifier']);
    });

    it('visitor returning `false` skips only that subtree', () => {
        const src = 'a b c';
        const a = leaf('identifier', 0, 1, src);
        const b1 = leaf('identifier', 2, 3, src);
        const b2 = leaf('identifier', 4, 5, src);
        const subList = makeNode('list', null, [b1, b2], src); // sub-list with 2 children
        const root = makeNode('list', null, [a, subList], src);
        const seen: string[] = [];
        walk(root, n => {
            seen.push(`${n.kind}@${n.from}`);
            if (n === subList) return false;
        });
        // Outer list, then a, then subList (no descent), and we should NOT see b1 or b2.
        expect(seen).toEqual([
            'list@0',
            'identifier@0',
            'list@2',
        ]);
    });

    it('visits children left-to-right (pre-order)', () => {
        const src = 'a b c';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const c = leaf('identifier', 4, 5, src);
        const root = makeNode('list', null, [a, b, c], src);
        expect(preorder(root)).toEqual([
            'list@0-5',
            'identifier@0-1',
            'identifier@2-3',
            'identifier@4-5',
        ]);
    });

    it('deeply nested tree is walked correctly', () => {
        const src = '            ';
        let inner: Node = leaf('identifier', 6, 7, src);
        for (let i = 0; i < 5; i++) {
            inner = makeNode('list', null, [inner], src);
        }
        const seen: string[] = [];
        walk(inner, n => { seen.push(n.kind); });
        expect(seen).toEqual(['list', 'list', 'list', 'list', 'list', 'identifier']);
    });
});

// =========================================================================
// cursorNode
// =========================================================================

describe('cursorNode — edge cases', () => {
    it('with just root (no children), returns root for any in-range offset', () => {
        const src = 'x';
        const root = makeNode('query', null, [], src, 0);
        // zero-width root contains 0 (since offset <= to and offset >= from)
        expect(cursorNode(root, 0)).toBe(root);
    });

    it('offset === 0 picks the leftmost containing child', () => {
        const src = 'ab';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 1, 2, src);
        const root = makeNode('list', null, [a, b], src);
        // Only `a` contains offset 0 (b.from = 1, so offset>=b.from is true; but
        // walker visits a first and its width equals b's width, so the rightward
        // sibling wins on ties. However, only `a` contains 0 strictly (0 < b.from).
        // Wait: b.from = 1, offset = 0 means 0 < b.from, so b does NOT contain 0.
        expect(cursorNode(root, 0)).toBe(a);
    });

    it('offset === source.length picks the rightmost child', () => {
        const src = 'ab';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 1, 2, src);
        const root = makeNode('list', null, [a, b], src);
        // a.to = 1 < 2, so a does NOT contain offset=2. Only b contains it.
        expect(cursorNode(root, src.length)).toBe(b);
    });

    it('three adjacent siblings — caret at the boundary picks the rightward sibling', () => {
        const src = 'abc';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 1, 2, src);
        const c = leaf('identifier', 2, 3, src);
        const root = makeNode('list', null, [a, b, c], src);
        // Boundary at offset=1: both a (ends at 1) and b (starts at 1) contain it.
        // Tie-break prefers later sibling -> b.
        expect(cursorNode(root, 1)).toBe(b);
        // Boundary at offset=2: both b (ends at 2) and c (starts at 2) contain it.
        expect(cursorNode(root, 2)).toBe(c);
    });

    it('finds a zero-width hole at its position', () => {
        const src = 'SELECT FROM';
        const hole = makeHole(7, ['tableRef'], src);
        const root = makeNode('query', null, [hole], src);
        expect(cursorNode(root, 7)).toBe(hole);
    });

    it('hole at end of source is found when offset === source.length', () => {
        const src = 'SELECT * FROM ';
        const hole = makeHole(src.length, ['tableRef'], src);
        // The root needs to contain this offset too — give it a wider span via fallback.
        const root = makeNode('query', [], [hole], src, 0);
        // root spans [0, src.length] (since first/last child = hole at src.length)? Actually
        // when tokens is empty and children non-empty, span = [first.from, last.to] = [14, 14].
        // So root won't contain offset 14 the way we want. Construct explicitly.
        const wider = makeNode('query', null, [hole], src, 0);
        // Even wider: replicate the real shape — root should span 0..14.
        // Easier: stub a root with from=0, to=14 manually.
        const realRoot: Node = {
            kind: 'query',
            from: 0,
            to: src.length,
            text: src,
            children: [hole],
            annotations: {},
        };
        hole.parent = realRoot;
        expect(cursorNode(realRoot, src.length)).toBe(hole);
        // (the intermediate `wider` is just to exercise the construction path)
        expect(wider.children[0]).toBe(hole);
    });

    it('offset outside the root falls back to root', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const root = makeNode('query', null, [a], src);
        // root spans [0,1]; offset 5 is outside everything. cursorNode returns root.
        const got = cursorNode(root, 5);
        expect(got).toBe(root);
    });

    it('deepest containment wins over breadth', () => {
        const src = 'a';
        const inner = leaf('identifier', 0, 1, src);
        const mid = makeNode('projection', null, [inner], src);
        const outer = makeNode('selectClause', null, [mid], src);
        const root = makeNode('query', null, [outer], src);
        // Offset 0 is contained by all four nodes; deepest wins.
        expect(cursorNode(root, 0)).toBe(inner);
    });

    it('two children with same width: later (rightward) child wins on tie', () => {
        // Three siblings of width 2 each. Pick the one whose [from,to] contains
        // the offset; if multiple, tie-break right.
        const src = 'aabbcc';
        const a = leaf('identifier', 0, 2, src);
        const b = leaf('identifier', 2, 4, src);
        const c = leaf('identifier', 4, 6, src);
        const root = makeNode('list', null, [a, b, c], src);
        // offset 2: a.to=2 contains, b.from=2 contains. Same width. Right wins -> b.
        expect(cursorNode(root, 2)).toBe(b);
        // offset 4: b.to=4 contains, c.from=4 contains. Right wins -> c.
        expect(cursorNode(root, 4)).toBe(c);
        // offset 3: only b contains it.
        expect(cursorNode(root, 3)).toBe(b);
    });
});

// =========================================================================
// markCursorPath
// =========================================================================

describe('markCursorPath — edge cases', () => {
    it('flags only path from root to target, not siblings', () => {
        const src = 'a b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const root = makeNode('list', null, [a, b], src);
        markCursorPath(root, 2);
        // The cursor target is `b` (boundary tie-breaks rightward, or just contains 2).
        expect(b.hasCursor).toBe(true);
        expect(root.hasCursor).toBe(true);
        expect(a.hasCursor).toBeUndefined();
    });

    it('returns the cursor target (deepest containing node)', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const root = makeNode('query', null, [a], src);
        const target = markCursorPath(root, 0);
        expect(target).toBe(a);
    });

    it('marks root only when target IS the root', () => {
        const src = 'x';
        const root = makeNode('query', null, [], src, 0);
        const target = markCursorPath(root, 0);
        expect(target).toBe(root);
        expect(root.hasCursor).toBe(true);
    });

    it('does not propagate hasCursor through unrelated siblings in deep trees', () => {
        const src = 'a b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        const inner = makeNode('list', null, [a, b], src);
        const outer = makeNode('query', null, [inner], src);
        markCursorPath(outer, 0);
        // path: a -> inner -> outer
        expect(a.hasCursor).toBe(true);
        expect(inner.hasCursor).toBe(true);
        expect(outer.hasCursor).toBe(true);
        expect(b.hasCursor).toBeUndefined();
    });
});

// =========================================================================
// findEnclosing / findEnclosingAny
// =========================================================================

describe('findEnclosing — edge cases', () => {
    it('returns the node itself when its kind matches', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        expect(findEnclosing(a, 'identifier')).toBe(a);
    });

    it('returns root when called on root and root.kind matches', () => {
        const src = 'a';
        const root = makeNode('query', null, [], src);
        expect(findEnclosing(root, 'query')).toBe(root);
    });

    it('returns undefined when the node has no parent and kind does not match', () => {
        const src = 'a';
        const orphan = leaf('identifier', 0, 1, src);
        // No parent linked.
        expect(findEnclosing(orphan, 'query')).toBeUndefined();
    });

    it('walks up multiple levels', () => {
        const src = 'SELECT a FROM t';
        const id = leaf('identifier', 7, 8, src);
        const proj = makeNode('projection', null, [id], src);
        const sel = makeNode('selectClause', null, [proj], src);
        const q = makeNode('query', null, [sel], src);
        const scr = makeNode('script', null, [q], src);
        expect(findEnclosing(id, 'script')).toBe(scr);
    });

    it('does not see siblings of any ancestor', () => {
        const src = 'a b';
        const a = leaf('identifier', 0, 1, src);
        const b = leaf('identifier', 2, 3, src);
        // b is a sibling but b's parent is the same list as a's
        const list = makeNode('list', null, [a, b], src);
        // a never has b in its enclosing chain — findEnclosing only walks upward.
        // Look for kind 'literal' which doesn't exist; should return undefined.
        expect(findEnclosing(a, 'literal')).toBeUndefined();
        // sanity
        expect(findEnclosing(a, 'list')).toBe(list);
    });
});

describe('findEnclosingAny — edge cases', () => {
    it('matches the node itself if its kind is in the set', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        expect(findEnclosingAny(a, ['literal', 'identifier'])).toBe(a);
    });

    it('returns undefined when no ancestor matches any kind', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const root = makeNode('query', null, [a], src);
        expect(findEnclosingAny(a, ['fromClause', 'whereClause'])).toBeUndefined();
        // Suppress unused var warning
        expect(root.children).toContain(a);
    });

    it('empty kinds list always returns undefined', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const root = makeNode('query', null, [a], src);
        expect(findEnclosingAny(a, [])).toBeUndefined();
        expect(root.children).toContain(a);
    });

    it('returns the FIRST matching ancestor, regardless of order in kinds list', () => {
        const src = 'a';
        const a = leaf('identifier', 0, 1, src);
        const sel = makeNode('selectClause', null, [a], src);
        const q = makeNode('query', null, [sel], src);
        // The list says 'query' first, but selectClause is encountered first walking up.
        expect(findEnclosingAny(a, ['query', 'selectClause'])).toBe(sel);
    });
});

// =========================================================================
// Integration: cursor + markCursorPath + findEnclosing
// =========================================================================

describe('integration — cursor flows', () => {
    it('finds enclosing clause for a cursor offset inside a projection', () => {
        const src = 'SELECT a FROM t';
        const id = leaf('identifier', 7, 8, src);
        const proj = makeNode('projection', null, [id], src);
        const sel = makeNode('selectClause', null, [proj], src);
        const q = makeNode('query', null, [sel], src);

        const target = markCursorPath(q, 7);
        expect(target).toBe(id);
        const clause = findEnclosingAny(target, ['selectClause', 'fromClause', 'whereClause']);
        expect(clause).toBe(sel);
    });

    it('cursor inside a hole reports the hole as deepest', () => {
        const src = 'SELECT FROM';
        const hole = makeHole(7, ['tableRef'], src);
        const from = makeNode('fromClause', null, [hole], src);
        const q = makeNode('query', null, [from], src);

        const target = cursorNode(q, 7);
        expect(target).toBe(hole);
        expect(findEnclosing(target, 'fromClause')).toBe(from);
        expect(target.annotations.expectedKinds).toEqual(['tableRef']);
    });
});
