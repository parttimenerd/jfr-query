// Pure synchronous harness for autocomplete eval. Runs a single case
// through either the SQL dispatcher or the plot completion source and
// returns the labels offered at the cursor. No real network, no timers.
//
// A case carries a SQL/plot snippet with a `|` cursor marker plus the
// expected label set: `contains` must all appear in the top N; `excludes`
// must NOT appear anywhere; `matchesRegex` must match at least one label.

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { dispatchCompletion } from '../../components/editor/sql/completion/dispatcher';
import { plotCompletionSource } from '../../components/editor/completions';
import type { SchemaForCompletion, SqlCompletionDeps, PlotCompletionDeps } from '../../components/editor/completions';
import type { TableSchema, ViewSchema, MacroSchema } from '../../types';
import type { ColumnSchema } from '../../components/editor/plot/ast';
import type { PlotScopeView } from '../../components/editor/plot/notebookPlotScope';

export interface AutocompleteCase {
    name: string;
    kind: 'sql' | 'plot';
    tier: string;
    /** Snippet with a `|` marker for the cursor position. */
    input: string;
    schema?: SchemaForCompletion;
    resultColumns?: ColumnSchema[];
    variables?: Record<string, string>;
    plotScope?: PlotScopeView | null;
    sqlBlockCount?: number;
    /** Treat the completion request as explicitly invoked (Ctrl-Space). */
    explicit?: boolean;
    expected: {
        /** Every label here must be in the result's `options`. */
        contains?: string[];
        /** None of these labels may appear. */
        excludes?: string[];
        /** At least one label must match. */
        matchesRegex?: RegExp;
        /** No-suggestion expectation. */
        empty?: boolean;
    };
}

export interface CaseResult {
    name: string;
    tier: string;
    pass: boolean;
    why: string;
    labels: string[];
}

export interface HarnessReport {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    byTier: Record<string, { total: number; passed: number; passRate: number }>;
    results: CaseResult[];
}

const DEFAULT_TABLES: TableSchema[] = [
    {
        name: 'events',
        columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'host', type: 'VARCHAR' },
            { name: 'cpu', type: 'DOUBLE' },
        ],
    },
    {
        name: 'requests',
        columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'status_code', type: 'INTEGER' },
            { name: 'path', type: 'VARCHAR' },
        ],
    },
];

const DEFAULT_VIEWS: ViewSchema[] = [];
const DEFAULT_MACROS: MacroSchema[] = [];

export function defaultSchema(): SchemaForCompletion {
    return {
        tables: DEFAULT_TABLES,
        views: DEFAULT_VIEWS,
        macros: DEFAULT_MACROS,
        tableMap: new Map(DEFAULT_TABLES.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(DEFAULT_VIEWS.map(v => [v.name.toLowerCase(), v])),
    };
}

export const DEFAULT_RESULT_COLUMNS: ColumnSchema[] = [
    { name: 'ts', dataType: 'TIMESTAMP' },
    { name: 'cpu', dataType: 'DOUBLE' },
    { name: 'host', dataType: 'VARCHAR' },
];

function parseCursor(input: string): { text: string; pos: number } {
    const pos = input.indexOf('|');
    if (pos < 0) throw new Error(`harness: case missing | marker: ${input}`);
    return { text: input.slice(0, pos) + input.slice(pos + 1), pos };
}

function makeCx(text: string, pos: number, explicit = false): CompletionContext {
    return {
        state: {
            doc: {
                toString: () => text,
                sliceString: (a: number, b: number) => text.slice(a, b),
                length: text.length,
            },
        },
        pos,
        explicit,
        matchBefore: (re: RegExp) => {
            const upTo = text.slice(0, pos);
            const r = new RegExp(re.source + '$', re.flags);
            const m = upTo.match(r);
            if (!m) return null;
            return { from: pos - m[0].length, to: pos, text: m[0] };
        },
    } as unknown as CompletionContext;
}

function runSql(c: AutocompleteCase): CompletionResult | null {
    const { text, pos } = parseCursor(c.input);
    const cx = makeCx(text, pos, c.explicit ?? true);
    const deps: SqlCompletionDeps = {
        getSchema: () => c.schema ?? defaultSchema(),
        getVariables: () => c.variables ?? {},
    };
    return dispatchCompletion(cx, deps);
}

function runPlot(c: AutocompleteCase): CompletionResult | null {
    const { text, pos } = parseCursor(c.input);
    const cx = makeCx(text, pos, c.explicit ?? true);
    const deps: PlotCompletionDeps = {
        getData: () => null,
        getCellResultColumns: () => c.resultColumns ?? DEFAULT_RESULT_COLUMNS,
        getCellSql: () => 'SELECT ts, cpu, host FROM events',
        requestSchemaDiscovery: () => { },
        getNotebookPlotScope: () => c.plotScope ?? null,
        getCurrentCellId: () => 'cell-test',
        getVariables: () => c.variables ?? {},
        getSqlBlockCount: () => c.sqlBlockCount ?? 0,
    };
    const source = plotCompletionSource(deps);
    return source(cx);
}

export function runCase(c: AutocompleteCase): CaseResult {
    const result = c.kind === 'sql' ? runSql(c) : runPlot(c);
    const labels = result?.options.map(o => o.label) ?? [];
    const why: string[] = [];

    if (c.expected.empty) {
        const pass = !result || labels.length === 0;
        return {
            name: c.name,
            tier: c.tier,
            pass,
            why: pass ? 'ok (empty as expected)' : `expected empty, got ${labels.slice(0, 5).join(',')}`,
            labels,
        };
    }

    if (c.expected.contains) {
        for (const wanted of c.expected.contains) {
            if (!labels.includes(wanted)) why.push(`missing: ${wanted}`);
        }
    }
    if (c.expected.excludes) {
        for (const banned of c.expected.excludes) {
            if (labels.includes(banned)) why.push(`unexpected: ${banned}`);
        }
    }
    if (c.expected.matchesRegex) {
        if (!labels.some(l => c.expected.matchesRegex!.test(l))) {
            why.push(`no label matches ${c.expected.matchesRegex}`);
        }
    }

    return {
        name: c.name,
        tier: c.tier,
        pass: why.length === 0,
        why: why.length ? why.join('; ') : 'ok',
        labels,
    };
}

export function runHarness(cases: AutocompleteCase[]): HarnessReport {
    const results = cases.map(runCase);
    const byTier: Record<string, { total: number; passed: number; passRate: number }> = {};
    for (const r of results) {
        const t = byTier[r.tier] ??= { total: 0, passed: 0, passRate: 0 };
        t.total++;
        if (r.pass) t.passed++;
    }
    for (const t of Object.values(byTier)) {
        t.passRate = t.total ? t.passed / t.total : 0;
    }
    const passed = results.filter(r => r.pass).length;
    return {
        total: results.length,
        passed,
        failed: results.length - passed,
        passRate: results.length ? passed / results.length : 0,
        byTier,
        results,
    };
}

export function formatReport(r: HarnessReport): string {
    const lines: string[] = [];
    lines.push(`\n=== Autocomplete Harness ===`);
    lines.push(`Total: ${r.passed}/${r.total} (${(r.passRate * 100).toFixed(1)}%)`);
    lines.push(`\nBy tier:`);
    for (const [tier, t] of Object.entries(r.byTier).sort()) {
        lines.push(`  ${tier.padEnd(20)} ${t.passed}/${t.total} (${(t.passRate * 100).toFixed(0)}%)`);
    }
    const fails = r.results.filter(x => !x.pass);
    if (fails.length) {
        lines.push(`\nFailures (${fails.length}):`);
        for (const f of fails) {
            lines.push(`  [${f.tier}] ${f.name} — ${f.why}`);
            if (f.labels.length) lines.push(`    got: ${f.labels.slice(0, 8).join(', ')}`);
        }
    }
    return lines.join('\n');
}
