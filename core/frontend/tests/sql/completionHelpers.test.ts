import { describe, it, expect } from 'vitest';
import { wrap, truncate, clauseAtCursor, clauseAtOffset } from '../../components/editor/sql/completion/helpers';
import type { Node } from '../../components/editor/sql/ast';

// ─── wrap ─────────────────────────────────────────────────────────────────────

describe('wrap', () => {
    it('returns identifier unchanged when force=false and name is bare word', () => {
        expect(wrap('events', false)).toBe('events');
        expect(wrap('my_table', false)).toBe('my_table');
        expect(wrap('_col', false)).toBe('_col');
    });

    it('quotes identifier when force=false and name has special chars', () => {
        expect(wrap('my table', false)).toBe('"my table"');
        expect(wrap('col-name', false)).toBe('"col-name"');
        expect(wrap('123abc', false)).toBe('"123abc"');
    });

    it('always quotes when force=true', () => {
        expect(wrap('events', true)).toBe('"events"');
        expect(wrap('simple', true)).toBe('"simple"');
    });

    it('quotes empty string when force=false', () => {
        expect(wrap('', false)).toBe('""');
    });

    it('handles identifier starting with letter followed by digits', () => {
        expect(wrap('col1', false)).toBe('col1');
    });
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
    it('returns string unchanged when within limit', () => {
        expect(truncate('hello', 10)).toBe('hello');
        expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates and appends ellipsis when over limit', () => {
        const result = truncate('hello world', 5);
        expect(result).toBe('hello…');
        expect(result.length).toBe(6); // 5 chars + ellipsis char
    });

    it('returns empty string unchanged', () => {
        expect(truncate('', 10)).toBe('');
    });

    it('truncates to zero characters + ellipsis when max=0', () => {
        expect(truncate('abc', 0)).toBe('…');
    });
});

// ─── clauseAtCursor ───────────────────────────────────────────────────────────

function leaf(kind: Node['kind'], from: number, to: number): Node {
    return { kind, from, to, text: '', children: [], annotations: {} };
}

function node(kind: Node['kind'], children: Node[]): Node {
    const from = children[0]?.from ?? 0;
    const to = children[children.length - 1]?.to ?? 0;
    const n: Node = { kind, from, to, text: '', children, annotations: {} };
    for (const c of children) c.parent = n;
    return n;
}

describe('clauseAtCursor', () => {
    it('returns null when node has no clause ancestor', () => {
        const id = leaf('identifier', 0, 6);
        expect(clauseAtCursor(id)).toBeNull();
    });

    it('returns "select" for identifier inside selectClause', () => {
        const id = leaf('identifier', 7, 8);
        const sel = node('selectClause', [id]);
        node('query', [sel]);
        expect(clauseAtCursor(id)).toBe('select');
    });

    it('returns "from" for identifier inside fromClause', () => {
        const id = leaf('identifier', 12, 18);
        const from = node('fromClause', [id]);
        node('query', [from]);
        expect(clauseAtCursor(id)).toBe('from');
    });

    it('returns "where" for identifier inside whereClause', () => {
        const id = leaf('identifier', 24, 25);
        const where = node('whereClause', [id]);
        node('query', [where]);
        expect(clauseAtCursor(id)).toBe('where');
    });

    it('returns "groupBy" for identifier inside groupByClause', () => {
        const id = leaf('identifier', 30, 31);
        const grp = node('groupByClause', [id]);
        node('query', [grp]);
        expect(clauseAtCursor(id)).toBe('groupBy');
    });

    it('returns "orderBy" for identifier inside orderByClause', () => {
        const id = leaf('identifier', 40, 41);
        const ord = node('orderByClause', [id]);
        node('query', [ord]);
        expect(clauseAtCursor(id)).toBe('orderBy');
    });

    it('returns "having" for identifier inside havingClause', () => {
        const id = leaf('identifier', 50, 51);
        const hav = node('havingClause', [id]);
        node('query', [hav]);
        expect(clauseAtCursor(id)).toBe('having');
    });

    it('returns "limit" for identifier inside limitClause', () => {
        const id = leaf('identifier', 60, 61);
        const lim = node('limitClause', [id]);
        node('query', [lim]);
        expect(clauseAtCursor(id)).toBe('limit');
    });

    it('returns "join" for identifier inside join node', () => {
        const id = leaf('identifier', 20, 26);
        const j = node('join', [id]);
        node('query', [j]);
        expect(clauseAtCursor(id)).toBe('join');
    });

    it('returns "on" for identifier inside joinCondition', () => {
        const id = leaf('identifier', 30, 31);
        const jc = node('joinCondition', [id]);
        node('query', [jc]);
        expect(clauseAtCursor(id)).toBe('on');
    });

    it('returns "qualify" for identifier inside qualifyClause', () => {
        const id = leaf('identifier', 70, 71);
        const q = node('qualifyClause', [id]);
        node('query', [q]);
        expect(clauseAtCursor(id)).toBe('qualify');
    });

    it('finds nearest clause when deeply nested', () => {
        const id = leaf('identifier', 7, 8);
        const proj = node('projection', [id]);
        const sel = node('selectClause', [proj]);
        node('query', [sel]);
        expect(clauseAtCursor(id)).toBe('select');
    });
});

// ─── clauseAtOffset ───────────────────────────────────────────────────────────

describe('clauseAtOffset', () => {
    it('falls back to rightmost clause by .to when cursor is in trailing space', () => {
        // Simulate: "SELECT a FROM t ORDER BY ts " where cursor is at 28 (after space)
        // The cursor node lands on the query root; AST clause ends at 27.
        const id = leaf('identifier', 22, 24); // 'ts'
        const ord = node('orderByClause', [id]);
        // ord.to = 24; cursor is at 28 (trailing space — not inside any clause)
        const root = node('query', [ord]);

        // Fake the cursor node to be the root (simulating trailing-whitespace case)
        expect(clauseAtOffset(root, root, 28)).toBe('orderBy');
    });

    it('returns the direct clause when cursor is inside one', () => {
        const id = leaf('identifier', 7, 8);
        const sel = node('selectClause', [id]);
        const root = node('query', [sel]);
        expect(clauseAtOffset(root, id, 7)).toBe('select');
    });

    it('returns null when no clauses exist at all', () => {
        const root: Node = { kind: 'query', from: 0, to: 0, text: '', children: [], annotations: {} };
        expect(clauseAtOffset(root, root, 5)).toBeNull();
    });
});
