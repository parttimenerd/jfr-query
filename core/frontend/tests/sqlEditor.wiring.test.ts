// Integration test for the SQL editor's production completion wiring.
// Editor.tsx swapped from the legacy regex `sqlCompletionSource` to the
// AST-aware `dispatchCompletion` — this test exercises the SAME deps
// shape Editor.tsx constructs and proves three regressions are locked in:
//   1) Cell-parsed variables (keys with `$`) don't get re-prefixed to `$$`.
//   2) Preceding-cell variables (`$cellName.varName`) appear in completion.
//   3) Workspace variables (keys without `$`, the existing convention) still work.
//   4) B-096: cross-cell CREATE VIEW aliases appear as completions in SQL editors.

import { describe, it, expect } from 'vitest';
import type { CompletionContext } from '@codemirror/autocomplete';
import { dispatchCompletion } from '../components/editor/sql/completion/dispatcher';
import type { SchemaForCompletion, SqlCompletionDeps } from '../components/editor/completions';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import type { NotebookCellData, TableSchema, ViewSchema } from '../types';

const TABLES: TableSchema[] = [
    { name: 'events', columns: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'cpu', type: 'DOUBLE' }] },
];

function schema(): SchemaForCompletion {
    return schemaWithViews([]);
}

function schemaWithViews(views: ViewSchema[]): SchemaForCompletion {
    return {
        tables: TABLES,
        views,
        macros: [],
        tableMap: new Map(TABLES.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(views.map(v => [v.name.toLowerCase(), v])),
    };
}

function completeWithSchema(text: string, variables: Record<string, string>, s: SchemaForCompletion): string[] {
    const pos = text.indexOf('|');
    const stripped = text.slice(0, pos) + text.slice(pos + 1);
    const deps: SqlCompletionDeps = {
        getSchema: () => s,
        getVariables: () => variables,
    };
    const result = dispatchCompletion(makeCx(stripped, pos), deps);
    return result?.options.map(o => o.label) ?? [];
}

// B-096: cross-cell CREATE VIEW aliases must appear in SQL completions.
// The fix is in SQLEditor.tsx: it injects notebookPlotScope.queryRefs (those with
// an alias) as virtual ViewSchema entries into schemaForCompletion.
// We test the completion layer directly by constructing the same schema shape
// that SQLEditor.tsx would build after the fix.
describe('SQL editor — cross-cell view alias completions (B-096)', () => {
    it('completes a cross-cell CREATE VIEW alias when typing in FROM', () => {
        const views: ViewSchema[] = [
            { name: 'gc_pauses', query: 'SELECT ts, pause FROM gc', columns: [], internal: false },
        ];
        const labels = completeWithSchema('SELECT * FROM gc_|', {}, schemaWithViews(views));
        expect(labels).toContain('gc_pauses');
    });

    it('completes multiple cross-cell aliases', () => {
        const views: ViewSchema[] = [
            { name: 'slow_queries', query: 'SELECT * FROM q WHERE ms > 100', columns: [], internal: false },
            { name: 'gc_events', query: 'SELECT ts FROM gc', columns: [], internal: false },
        ];
        const labels = completeWithSchema('SELECT * FROM |', {}, schemaWithViews(views));
        expect(labels).toContain('slow_queries');
        expect(labels).toContain('gc_events');
    });

    it('cross-cell view is offered with detail "view"', () => {
        const views: ViewSchema[] = [
            { name: 'thread_cpu', query: 'SELECT thread, cpu FROM jfr', columns: [], internal: false },
        ];
        const deps: SqlCompletionDeps = {
            getSchema: () => schemaWithViews(views),
            getVariables: () => ({}),
        };
        const text = 'SELECT * FROM thread|';
        const pos = text.length;
        const result = dispatchCompletion(makeCx(text, pos), deps);
        const opt = result?.options.find(o => o.label === 'thread_cpu');
        expect(opt).toBeDefined();
        expect(opt?.detail).toMatch(/view/i);
    });

    it('cross-cell view does not appear as a duplicate when it is also in dbSchema.views', () => {
        // Views are deduplicated by the viewMap (last-writer wins on same lowercase key).
        const views: ViewSchema[] = [
            { name: 'gc_view', query: 'SELECT 1', columns: [], internal: false },
            { name: 'gc_view', query: 'SELECT 2', columns: [], internal: false },
        ];
        const labels = completeWithSchema('SELECT * FROM gc_|', {}, schemaWithViews(views));
        const count = labels.filter(l => l === 'gc_view').length;
        expect(count).toBe(1);
    });
});


function makeCx(text: string, pos: number): CompletionContext {
    return {
        state: {
            doc: {
                toString: () => text,
                sliceString: (a: number, b: number) => text.slice(a, b),
                length: text.length,
            },
        },
        pos,
        explicit: true,
        matchBefore: (re: RegExp) => {
            const upTo = text.slice(0, pos);
            const r = new RegExp(re.source + '$', re.flags);
            const m = upTo.match(r);
            return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
        },
    } as unknown as CompletionContext;
}

function complete(text: string, variables: Record<string, string>): string[] {
    const pos = text.indexOf('|');
    const stripped = text.slice(0, pos) + text.slice(pos + 1);
    const deps: SqlCompletionDeps = {
        getSchema: () => schema(),
        getVariables: () => variables,
    };
    const result = dispatchCompletion(makeCx(stripped, pos), deps);
    return result?.options.map(o => o.label) ?? [];
}

describe('SQL editor production wiring — variable autocomplete', () => {
    it('completes a cell-local variable whose key was stored with `$` (parsed.variables shape)', () => {
        // parseCellContent stores `result.variables['$threshold'] = '0.8'`.
        // Pre-fix this would have emitted `$$threshold` in the popup.
        const labels = complete('SELECT * FROM events WHERE cpu > $|', {
            '$threshold': '0.8',
            '$window': '5m',
        });
        expect(labels).toContain('$threshold');
        expect(labels).toContain('$window');
        expect(labels).not.toContain('$$threshold');
    });

    it('completes a workspace variable whose key was stored without `$` (metadata.variables shape)', () => {
        // SettingsPanel-style: keys stored as the literal name with NO `$`.
        const labels = complete('SELECT * FROM events WHERE cpu > $|', {
            'global_threshold': '0.5',
        });
        expect(labels).toContain('$global_threshold');
    });

    it('end-to-end: cells → collectPrecedingCellVariables → dispatcher → cross-cell completion', () => {
        const cells: NotebookCellData[] = [
            {
                id: 'a',
                title: 'baseline',
                content: '## baseline\n\n```variables\n$threshold = 0.5\n$window = 5m\n```\n',
            },
            { id: 'b', title: 'Current', content: '## Current\n' },
        ];
        // This is exactly what NotebookCell.tsx does at line 192+.
        const preceding = collectPrecedingCellVariables(cells, 'b');
        const merged = { ...preceding /* no workspace or own vars in this case */ };

        const labels = complete('SELECT * FROM events WHERE cpu > $baseline.|', merged);
        expect(labels).toContain('$baseline.threshold');
        expect(labels).toContain('$baseline.window');
    });

    it('end-to-end: workspace + preceding + own cell variables coexist without duplicates', () => {
        const cells: NotebookCellData[] = [
            { id: 'a', title: 'alpha', content: '## alpha\n\n```variables\n$x = 1\n```\n' },
            { id: 'b', title: 'Current', content: '' },
        ];
        const merged = {
            // workspace (settings panel) — key without `$`
            'workspaceVar': 'w',
            // preceding-cell exports
            ...collectPrecedingCellVariables(cells, 'b'),
            // current cell's own — keys with `$`
            '$ownVar': 'o',
        };

        const labels = complete('SELECT $|', merged);
        expect(labels).toContain('$workspaceVar');
        expect(labels).toContain('$alpha.x');
        expect(labels).toContain('$ownVar');
        // Each variable surfaces exactly once.
        const counts: Record<string, number> = {};
        for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
        for (const wanted of ['$workspaceVar', '$alpha.x', '$ownVar']) {
            expect(counts[wanted]).toBe(1);
        }
    });
});
