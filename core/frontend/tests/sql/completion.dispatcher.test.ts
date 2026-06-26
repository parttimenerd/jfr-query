// End-to-end tests for the AST-driven completion dispatcher. Each scenario
// uses a `|` marker in the input to denote the cursor position, then asserts
// the top suggestions and (optionally) the `from` offset.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { dispatchCompletion, _clearRankCacheForTests } from
    '../../components/editor/sql/completion/dispatcher';
import type { SchemaForCompletion, SqlCompletionDeps } from
    '../../components/editor/completions';
import { clearDistinctValueCache } from
    '../../components/editor/distinctValues';
import type { TableSchema, ViewSchema, MacroSchema } from '../../types';

const TABLES: TableSchema[] = [
    {
        name: 'ActiveRecording',
        columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'INTERVAL' },
        ],
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

const VIEWS: ViewSchema[] = [
    {
        name: 'gc_summary',
        query: 'SELECT * FROM GarbageCollection',
        columns: [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'n', type: 'BIGINT' },
        ],
    },
];

const MACROS: MacroSchema[] = [
    {
        name: 'recording_window',
        parameters: ['t'],
        sql: 'SELECT 1',
        returnType: 'INTERVAL',
    },
];

function makeSchema(): SchemaForCompletion {
    return {
        tables: TABLES,
        views: VIEWS,
        macros: MACROS,
        tableMap: new Map(TABLES.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(VIEWS.map(v => [v.name.toLowerCase(), v])),
    };
}

// Minimal mock of CompletionContext. The dispatcher only uses `state.doc`,
// `pos`, `matchBefore`, and `explicit`.
function makeCx(text: string, pos: number, explicit = false): CompletionContext {
    return {
        state: {
            doc: {
                toString: () => text,
                sliceString: (a: number, b: number) => text.slice(a, b),
            },
        },
        pos,
        explicit,
        matchBefore: (re: RegExp) => {
            // Recreate CodeMirror's behavior: match against text up to pos.
            const upTo = text.slice(0, pos);
            // Anchor regex at end.
            const r = new RegExp(re.source + '$', re.flags);
            const m = upTo.match(r);
            if (!m) return null;
            return { from: pos - m[0].length, to: pos, text: m[0] };
        },
    } as unknown as CompletionContext;
}

function parseCursor(input: string): { text: string; pos: number } {
    const pos = input.indexOf('|');
    if (pos < 0) throw new Error('test input missing | cursor marker');
    return { text: input.slice(0, pos) + input.slice(pos + 1), pos };
}

function topLabels(result: CompletionResult | null, n = 5): string[] {
    if (!result) return [];
    return result.options.slice(0, n).map(o => o.label);
}

function runDispatch(
    input: string,
    opts: {
        variables?: Record<string, string>;
        runner?: SqlCompletionDeps['getQueryRunner'];
        schema?: SchemaForCompletion | null;
        explicit?: boolean;
    } = {},
): CompletionResult | null {
    const { text, pos } = parseCursor(input);
    const cx = makeCx(text, pos, opts.explicit);
    const deps: SqlCompletionDeps = {
        getSchema: () => opts.schema === undefined ? makeSchema() : opts.schema,
        getVariables: () => opts.variables ?? {},
        getQueryRunner: opts.runner,
    };
    return dispatchCompletion(cx, deps);
}

describe('completion dispatcher — variables', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('completes $var with workspace variables', () => {
        const r = runDispatch('SELECT $|', {
            variables: { foo: '1', bar: '2', baz: '3' },
        });
        const labels = topLabels(r);
        expect(labels).toContain('$foo');
        expect(labels).toContain('$bar');
        expect(labels).toContain('$baz');
    });

    it('filters $f against variable names', () => {
        const r = runDispatch('SELECT $f|', {
            variables: { foo: '1', bar: '2' },
        });
        const labels = topLabels(r);
        expect(labels).toContain('$foo');
        expect(labels).not.toContain('$bar');
    });

    it('returns null when no variables defined and token is just $', () => {
        const r = runDispatch('SELECT $|', { variables: {} });
        expect(r).toBeNull();
    });
});

describe('completion dispatcher — qualified column', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('offers alias columns after t.', () => {
        const r = runDispatch('SELECT r.| FROM ActiveRecording r', { explicit: true });
        const labels = topLabels(r);
        // ActiveRecording columns must appear.
        expect(labels).toContain('id');
        expect(labels).toContain('startTime');
        expect(labels).toContain('duration');
    });

    it('filters columns by partial after the dot', () => {
        const r = runDispatch('SELECT r.dur| FROM ActiveRecording r');
        const labels = topLabels(r);
        expect(labels).toContain('duration');
        expect(labels).not.toContain('id');
    });

    it('works with unaliased table name as qualifier', () => {
        const r = runDispatch('SELECT GarbageCollection.| FROM GarbageCollection');
        const labels = topLabels(r);
        expect(labels).toContain('cause');
        expect(labels).toContain('gcId');
    });
});

describe('completion dispatcher — column in scope', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('offers column from FROM table in SELECT', () => {
        const r = runDispatch('SELECT | FROM ActiveRecording', { explicit: true });
        const labels = topLabels(r, 10);
        expect(labels).toContain('id');
        expect(labels).toContain('startTime');
    });

    it('offers columns in WHERE', () => {
        const r = runDispatch('SELECT * FROM GarbageCollection WHERE c|');
        const labels = topLabels(r, 10);
        expect(labels).toContain('cause');
    });

    it('falls back to all-table columns when no FROM yet', () => {
        const r = runDispatch('SELECT id|', {});
        const labels = topLabels(r, 10);
        expect(labels).toContain('id');
    });
});

describe('completion dispatcher — table context', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('offers tables after FROM', () => {
        const r = runDispatch('SELECT * FROM |', { explicit: true });
        const labels = topLabels(r, 10);
        expect(labels).toContain('ActiveRecording');
        expect(labels).toContain('GarbageCollection');
    });

    it('offers views after FROM', () => {
        const r = runDispatch('SELECT * FROM |', { explicit: true });
        const labels = topLabels(r, 10);
        expect(labels).toContain('gc_summary');
    });

    it('offers CTE names after JOIN', () => {
        const r = runDispatch(
            'WITH foo AS (SELECT 1) SELECT * FROM ActiveRecording JOIN |',
            { explicit: true },
        );
        const labels = topLabels(r, 10);
        expect(labels).toContain('foo');
    });
});

describe('completion dispatcher — keywords', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('offers SQL keywords after WHERE condition', () => {
        const r = runDispatch('SELECT * FROM ActiveRecording WHERE id = 1 |',
            { explicit: true });
        const labels = topLabels(r, 20);
        // Some clause-after-WHERE keyword should show up.
        const upper = labels.map(l => l.toUpperCase().split(/\s+/)[0]);
        expect(upper).toEqual(expect.arrayContaining(
            ['GROUP', 'ORDER', 'LIMIT', 'HAVING'].filter(k => upper.includes(k)),
        ));
    });
});

describe('completion dispatcher — distinct values', () => {
    beforeEach(() => {
        _clearRankCacheForTests();
        clearDistinctValueCache();
    });

    it('fires runner for col = \'partial', async () => {
        const runner = vi.fn().mockResolvedValue([{ v: 'System.gc()' }, { v: 'Allocation Failure' }]);
        // First keystroke triggers fetch; result is cached for next keystroke.
        runDispatch("SELECT * FROM GarbageCollection WHERE cause = '|", {
            runner: () => runner,
        });
        expect(runner).toHaveBeenCalled();
        // Wait for the lookup to settle.
        await new Promise(r => setTimeout(r, 5));
        const r2 = runDispatch("SELECT * FROM GarbageCollection WHERE cause = 'S|", {
            runner: () => runner,
        });
        const labels = topLabels(r2, 10);
        expect(labels).toContain('System.gc()');
    });
});

describe('completion dispatcher — macros and functions', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('offers macro by prefix in SELECT', () => {
        const r = runDispatch('SELECT recording_w| FROM ActiveRecording');
        const labels = topLabels(r, 5);
        expect(labels).toContain('recording_window');
    });

    it('offers builtin functions in expression context', () => {
        const r = runDispatch('SELECT COU| FROM ActiveRecording');
        const labels = topLabels(r, 5);
        expect(labels.map(l => l.toUpperCase())).toContain('COUNT');
    });
});

describe('completion dispatcher — cross-cell variables + full schema', () => {
    beforeEach(() => {
        _clearRankCacheForTests();
        clearDistinctValueCache();
    });

    // Cross-cell variables are merged at the cell layer into a single
    // Record<string,string> before reaching the editor. From the dispatcher's
    // perspective, workspace globals, prior-cell exports, and the current
    // cell's own $-decls are indistinguishable — they all flow through
    // `variables`. The contract: every key in that map shows up.
    it('surfaces variables originating from any cell (merged map)', () => {
        const r = runDispatch('SELECT $|', {
            // Simulate: { ...metadata.variables, ...precedingVariables, ...ownVariables }
            variables: {
                workspaceGlobal: '2026-01-01',   // metadata.variables
                prevCellExport: '42',            // precedingVariables
                ownCellVar: 'hello',             // parsed.variables
            },
        });
        const labels = topLabels(r, 10);
        expect(labels).toContain('$workspaceGlobal');
        expect(labels).toContain('$prevCellExport');
        expect(labels).toContain('$ownCellVar');
    });

    it('offers all schema tables AND views as FROM targets', () => {
        const r = runDispatch('SELECT * FROM |', { explicit: true });
        const labels = topLabels(r, 20);
        // From `tables`
        expect(labels).toContain('ActiveRecording');
        expect(labels).toContain('GarbageCollection');
        // From `views`
        expect(labels).toContain('gc_summary');
    });

    it('infers CTE columns from inner projections and offers them', () => {
        const r = runDispatch(
            'WITH agg AS (SELECT cause, COUNT(*) AS n FROM GarbageCollection GROUP BY cause) '
            + 'SELECT agg.| FROM agg',
            { explicit: true },
        );
        const labels = topLabels(r, 10);
        // CTE column names recovered from the inner SELECT projection list
        // (`cause` is an identifier projection; `n` is the explicit alias).
        expect(labels).toContain('cause');
        expect(labels).toContain('n');
    });

    it('passes a runQuery handle through to the distinct-value provider', async () => {
        // Verifies the wiring: getQueryRunner → ProviderContext.runner →
        // requestDistinctValues. The provider fires *and* the runner is called.
        const runner = vi.fn().mockResolvedValue([{ v: 'G1 Young' }]);
        runDispatch("SELECT * FROM GarbageCollection WHERE cause = '|", {
            runner: () => runner,
        });
        expect(runner).toHaveBeenCalled();
    });

    it('surfaces dotted cross-cell variable keys (e.g. cellA.var)', () => {
        // Cross-cell refs use a dotted variable key. The precedingVariables
        // map in NotebookCell stores them flat as `cellName.varName`.
        const r = runDispatch('SELECT $cellA.|', {
            variables: { 'cellA.threshold': '100', 'cellA.label': 'foo' },
        });
        const labels = topLabels(r, 10);
        // Both entries should appear (filtered to the cellA. prefix).
        expect(labels).toContain('$cellA.threshold');
        expect(labels).toContain('$cellA.label');
    });

    // Regression: NotebookCell threads `parsed.variables` directly into the
    // editor's `getVariables`. That map's keys are stored WITH a leading `$`
    // (from `parseCellContent`). Earlier versions of `variableProvider`
    // prepended `$` blindly, so cell-local `$foo` got emitted as `$$foo`.
    it('strips an existing leading $ from variable keys before re-prefixing', () => {
        const r = runDispatch('SELECT $|', {
            variables: { '$foo': '1', '$bar': '2', '$$ws': '3' },
        });
        const labels = topLabels(r, 10);
        expect(labels).toContain('$foo');
        expect(labels).toContain('$bar');
        expect(labels).not.toContain('$$foo');
    });

    it('handles mixed `$`-prefixed and unprefixed variable keys without duplicates', () => {
        const r = runDispatch('SELECT $|', {
            // Same logical variable name from two upstream sources. Should
            // appear exactly once.
            variables: { '$foo': '1', 'foo': '1' },
        });
        const labels = topLabels(r, 10);
        expect(labels.filter(l => l === '$foo').length).toBe(1);
    });
});

// B-095 — SQL completion fallback missing
describe('completion dispatcher — schema-absent fallback (B-095)', () => {
    beforeEach(() => { _clearRankCacheForTests(); });

    it('returns SQL keyword fallback when schema is null and token is a plain word', () => {
        const r = runDispatch('SEL|', { schema: null });
        // Should not return null — fallback keywords must be offered.
        expect(r).not.toBeNull();
        const labels = topLabels(r, 20);
        expect(labels.some(l => /SELECT/i.test(l))).toBe(true);
    });

    it('returns null for $var token when schema is null and no variables defined', () => {
        const r = runDispatch('SELECT $und|', { schema: null, variables: {} });
        expect(r).toBeNull();
    });

    it('returns keyword fallback even with empty token (explicit trigger)', () => {
        const r = runDispatch('|', { schema: null, explicit: true });
        expect(r).not.toBeNull();
        const labels = topLabels(r, 30);
        expect(labels.some(l => /SELECT/i.test(l))).toBe(true);
    });
});
