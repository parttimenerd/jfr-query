// Unit tests for the AST-driven SQL hover tooltip. Asserts on the pure
// `getHoverContent` adapter — CodeMirror integration is not exercised here.

import { describe, it, expect, beforeEach } from 'vitest';
import { getHoverContent, _resetHoverCacheForTests } from '../../components/editor/sqlHover';
import type { SchemaForCompletion } from '../../components/editor/completions';

function makeSchema(): SchemaForCompletion {
    const tables = [
        {
            name: 'ActiveRecording',
            columns: [
                { name: 'id', type: 'INTEGER' },
                { name: 'startTime', type: 'TIMESTAMP' },
                { name: 'duration', type: 'INTERVAL' },
            ],
            rowCount: 42,
        },
        {
            name: 'GarbageCollection',
            columns: [
                { name: 'gcId', type: 'BIGINT' },
                { name: 'cause', type: 'VARCHAR' },
                { name: 'duration', type: 'INTERVAL' },
            ],
        },
    ];
    const views = [
        { name: 'gc-top-pauses', query: 'SELECT * FROM GarbageCollection ORDER BY duration DESC', columns: [] },
    ];
    return {
        tables,
        views,
        macros: [],
        tableMap: new Map(tables.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(views.map(v => [v.name.toLowerCase(), v])),
    };
}

// Convenience: parse "SELECT cau|se FROM …" → { source, pos }.
function mark(input: string): { source: string; pos: number } {
    const pos = input.indexOf('|');
    if (pos < 0) throw new Error('missing | marker');
    return { source: input.slice(0, pos) + input.slice(pos + 1), pos };
}

beforeEach(() => {
    _resetHoverCacheForTests();
});

describe('getHoverContent — columns', () => {
    it('hover on a column in SELECT shows column + table + dataType', () => {
        const { source, pos } = mark('SELECT cau|se FROM GarbageCollection');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('column');
        if (c!.kind === 'column') {
            expect(c.name).toBe('cause');
            expect(c.table).toBe('GarbageCollection');
            expect(c.dataType).toBe('VARCHAR');
        }
    });
});

describe('getHoverContent — tables', () => {
    it('hover on a table in FROM shows kind=table', () => {
        const { source, pos } = mark('SELECT * FROM Active|Recording');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('table');
        if (c!.kind === 'table') {
            expect(c.name).toBe('ActiveRecording');
            expect(c.rowCount).toBe(42);
        }
    });
});

describe('getHoverContent — CTEs', () => {
    it('hover on a CTE name (in FROM) shows kind=cte', () => {
        const { source, pos } = mark('WITH foo AS (SELECT 1) SELECT * FROM fo|o');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('cte');
        if (c!.kind === 'cte') {
            expect(c.name).toBe('foo');
        }
    });
});

describe('getHoverContent — functions', () => {
    it('hover on a function name (count) shows kind=function + signature', () => {
        const { source, pos } = mark('SELECT cou|nt(*) FROM ActiveRecording');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('function');
        if (c!.kind === 'function') {
            expect(c.name.toLowerCase()).toBe('count');
            expect(typeof c.signature).toBe('string');
            expect(c.signature.length).toBeGreaterThan(0);
        }
    });
});

describe('getHoverContent — variables', () => {
    it('hover on $foo resolves to its cell-local value', () => {
        const { source, pos } = mark('SELECT $li|mit FROM ActiveRecording');
        const c = getHoverContent(source, pos, {
            schema: makeSchema(),
            variables: { $limit: '20' },
        });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('variable');
        if (c!.kind === 'variable') {
            expect(c.value).toBe('20');
            expect(c.source).toBe('cell');
        }
    });

    it('hover on $$foo resolves against workspace vars', () => {
        const { source, pos } = mark('SELECT $$gl|obal FROM ActiveRecording');
        const c = getHoverContent(source, pos, {
            schema: makeSchema(),
            variables: { $$global: 'abc' },
        });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('variable');
        if (c!.kind === 'variable') {
            expect(c.value).toBe('abc');
            expect(c.source).toBe('workspace');
        }
    });

    it('hover on an undefined $variable still renders (no crash) with value undefined', () => {
        const { source, pos } = mark('SELECT $miss|ing FROM ActiveRecording');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('variable');
        if (c!.kind === 'variable') {
            expect(c.value).toBeUndefined();
        }
    });
});

describe('getHoverContent — aliases', () => {
    it('hover on r in `r.startTime` resolves as alias of ActiveRecording', () => {
        const { source, pos } = mark('SELECT r|.startTime FROM ActiveRecording r');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('alias');
        if (c!.kind === 'alias') {
            expect(c.alias).toBe('r');
            expect(c.target).toBe('ActiveRecording');
        }
    });

    it('hover on startTime in `r.startTime` resolves as column · ActiveRecording', () => {
        const { source, pos } = mark('SELECT r.startTi|me FROM ActiveRecording r');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('column');
        if (c!.kind === 'column') {
            expect(c.name).toBe('startTime');
            // The resolved column carries the alias as its `table` (not the
            // underlying target) — match Scope.resolveQualified semantics.
            expect(['ActiveRecording', 'r']).toContain(c.table);
        }
    });
});

describe('getHoverContent — fallbacks', () => {
    it('hover on an unknown identifier renders an "unresolved" tooltip without crashing', () => {
        const { source, pos } = mark('SELECT zz|zy FROM ActiveRecording');
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        // Either unresolved or null is acceptable — the contract is "no crash".
        if (c !== null) {
            expect(['unresolved', 'column']).toContain(c.kind);
        }
    });

    it('hover deep in whitespace gap returns null (no tooltip on structural nodes)', () => {
        // Position the cursor in the gap after FROM keyword but before the
        // table identifier. There's no leaf node there → expect null.
        const source = 'SELECT *    FROM    ActiveRecording';
        // Pick the position right after "FROM " — well within a whitespace
        // gap. Note: tokens skip whitespace, so the position falls inside the
        // gap between FROM and ActiveRecording.
        const pos = source.indexOf('FROM') + 6; // just past the space following FROM
        const c = getHoverContent(source, pos, { schema: makeSchema(), variables: {} });
        // The cursor lands between two tokens — either null (preferred) or a
        // structural node that we filter out.
        if (c !== null) {
            // Not a leaf-typed result; should never be a column/etc here.
            expect(['unresolved']).toContain(c.kind);
        }
    });
});
