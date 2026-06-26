// P3 — Tests for the notebook-wide plot scope discovery and cross-plot
// annotators (cross-plot, brush, queryRef resolution).
//
// The 10 scenarios listed in the P3 plan:
//   1. Single named plot above current cell → appears in `namedPlots`.
//   2. Plot below current cell → does NOT appear (defined-before rule).
//   3. `LINK_X($start, $end, master)` populates `linkedXVars`.
//   4. `CREATE VIEW gc_pauses AS ...` → `queryRefs` entry with alias.
//   5. Brush state preserved when `executedResults[cellId]` populated.
//   6. `$gc_plot.brush.lo` resolves with `source: 'brush'`, `dataType: 'timestamp'`.
//   7. `varRef` `$$workspace_var` → `scope: 'workspace'` (via workspaceVariables).
//   8. Annotator pass: `ON #2` resolves to `queryRef` with `targetCellId`.
//   9. Annotator pass: positional `master` keyword does NOT resolve as crossPlot.
//  10. Unknown plot name in `LINK_X` → diagnostic with `code: 'unknown-plot'`.

import { describe, it, expect } from 'vitest';
import {
    NotebookPlotScope,
    extractPlotMetadata,
    type CellParseSummary,
    type NotebookPlotContext,
} from '../../components/editor/plot/notebookPlotScope';
import { parseAndAnnotate } from '../../components/editor/plot';
import { walk, type PlotNode } from '../../components/editor/plot/ast';
import type { NotebookCellData } from '../../types';

// Helpers ---------------------------------------------------------------------

function cell(id: string, content = ''): NotebookCellData {
    return { id, title: id, content };
}

/**
 * Build a `parseCell` adapter for tests. Each call returns the prebuilt summary
 * keyed by cell id. Cells without an entry get an empty summary.
 */
function parseCellMap(map: Record<string, Partial<CellParseSummary>>): (c: NotebookCellData) => CellParseSummary {
    return c => {
        const s = map[c.id] ?? {};
        return {
            sqlBlocks: s.sqlBlocks ?? [],
            queryAliases: s.queryAliases ?? (s.sqlBlocks ?? []).map(() => null),
            plotBlocks: s.plotBlocks ?? [],
            cellLocalVariables: s.cellLocalVariables,
        };
    };
}

function buildView(opts: {
    cells: NotebookCellData[];
    currentCellId: string;
    parsed: Record<string, Partial<CellParseSummary>>;
    lookupColumns?: (sql: string) => ReturnType<NonNullable<Parameters<NotebookPlotScope['build']>[0]['lookupColumns']>>;
    executedResults?: Record<string, ReadonlyArray<Record<string, unknown>>[]>;
    workspaceVariables?: Record<string, string>;
}) {
    return new NotebookPlotScope().build({
        cells: opts.cells,
        currentCellId: opts.currentCellId,
        parseCell: parseCellMap(opts.parsed),
        lookupColumns: opts.lookupColumns,
        executedResults: opts.executedResults,
        workspaceVariables: opts.workspaceVariables,
    });
}

// Scope view builder ----------------------------------------------------------

describe('NotebookPlotScope.build', () => {
    it('1. exposes a named plot defined above the current cell', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, pause FROM gc'],
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: pause) NAME "gc_plot"', sqlIndex: 0 }],
                },
            },
        });
        expect(view.namedPlots).toHaveLength(1);
        expect(view.namedPlots[0]).toMatchObject({
            plotName: 'gc_plot',
            cellId: 'a',
            shape: 'line',
            plotIndexInCell: 0,
        });
    });

    it('2. ignores plots defined in or below the current cell', () => {
        const cells = [cell('a'), cell('b'), cell('c')];
        const view = buildView({
            cells,
            currentCellId: 'a',
            parsed: {
                a: { plotBlocks: [{ config: 'LINE_CHART(x: t) NAME "in_current"', sqlIndex: 0 }], sqlBlocks: ['SELECT t'] },
                b: { plotBlocks: [{ config: 'BAR_CHART(x: c) NAME "below"', sqlIndex: 0 }], sqlBlocks: ['SELECT c'] },
                c: { plotBlocks: [{ config: 'PIE_CHART(value: v) NAME "deeper"', sqlIndex: 0 }], sqlBlocks: ['SELECT v'] },
            },
        });
        expect(view.namedPlots).toEqual([]);
    });

    it('3. captures LINK_X variables on a named plot', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, pause FROM gc'],
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: pause) NAME "master" LINK_X($start, $end, master)', sqlIndex: 0 }],
                },
            },
        });
        expect(view.namedPlots[0]?.linkedXVars).toEqual(['start', 'end']);
    });

    it('3b. captures LINK-Y variable on a named plot (single var, not a pair)', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, mem FROM gc'],
                    plotBlocks: [{ config: 'AREA_CHART(x: ts, y: mem) NAME "memChart" LINK-Y $memDomain', sqlIndex: 0 }],
                },
            },
        });
        expect(view.namedPlots[0]?.linkedYVars).toBe('memDomain');
    });

    it('3c. captures brushVarName from BRUSH clause on a named plot', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, cpu FROM events'],
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: cpu) BRUSH "$gcSel" MODE Y NAME "gcPlot"', sqlIndex: 0 }],
                },
            },
        });
        expect(view.namedPlots[0]?.brushVarName).toBe('gcSel');
        expect(view.namedPlots[0]?.plotName).toBe('gcPlot');
    });

    it('4. parses `CREATE VIEW <alias> AS …` from SQL blocks', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['CREATE VIEW gc_pauses AS SELECT * FROM events'],
                },
            },
        });
        expect(view.queryRefs).toHaveLength(1);
        expect(view.queryRefs[0]).toMatchObject({
            index: 1,
            cellId: 'a',
            alias: 'gc_pauses',
        });
    });

    it('5. records `hasBrush: true` when executedResults are populated', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, pause FROM gc'],
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: pause) NAME "gc_plot"', sqlIndex: 0 }],
                },
            },
            executedResults: { a: [[{ ts: 1, pause: 2 }]] },
        });
        expect(view.namedPlots[0]?.hasBrush).toBe(true);
    });

    it('7. flattens workspaceVariables into the variables map', () => {
        const cells = [cell('a')];
        const view = buildView({
            cells,
            currentCellId: 'a',
            parsed: {},
            workspaceVariables: { foo: '42', when: '2024-01-01' },
        });
        const foo = view.variables.get('foo');
        const when = view.variables.get('when');
        expect(foo?.scope).toBe('workspace');
        expect(foo?.dataType).toBe('number');
        expect(when?.scope).toBe('workspace');
        expect(when?.dataType).toBe('timestamp');
    });

    it('caches results keyed on the (cells, currentCellId) pair', () => {
        const cells = [cell('a'), cell('b')];
        const scope = new NotebookPlotScope();
        const parseCell = parseCellMap({
            a: { sqlBlocks: ['SELECT 1'] },
        });
        const v1 = scope.build({ cells, currentCellId: 'b', parseCell });
        const v2 = scope.build({ cells, currentCellId: 'b', parseCell });
        expect(v1).toBe(v2);
    });
});

describe('extractPlotMetadata', () => {
    it('extracts plot name and shape from `| name: gc_plot`', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: ts, y: pause) | name: gc_plot');
        expect(meta.plotName).toBe('gc_plot');
        expect(meta.shape).toBe('line');
    });

    it('extracts plot name from uppercase `NAME "gc_plot"`', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: ts) NAME "gc_plot"');
        expect(meta.plotName).toBe('gc_plot');
    });

    it('binds x: column for axis-type inference', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: ts, y: pause) NAME "p"');
        expect(meta.xColumn).toBe('ts');
        expect(meta.yColumn).toBe('pause');
    });

    it('extracts LINK-Y variable from plot DSL', () => {
        const meta = extractPlotMetadata('AREA_CHART(x: ts, y: mem) NAME "memChart" LINK-Y $memDomain');
        expect(meta.plotName).toBe('memChart');
        expect(meta.linkedYVars).toEqual(['memDomain']);
    });

    it('extracts brushVarName from BRUSH "$var" clause', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: ts, y: cpu) BRUSH "$gcSel" MODE Y NAME "gcPlot"');
        expect(meta.brushVarName).toBe('gcSel');
        expect(meta.plotName).toBe('gcPlot');
    });

    it('brushVarName is undefined when no BRUSH clause', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: ts, y: cpu) NAME "gcPlot"');
        expect(meta.brushVarName).toBeUndefined();
    });
});

// crossPlotAnnotator + brushAnnotator -----------------------------------------

function buildContextForAnnotator(opts: {
    namedPlots?: NotebookPlotContext['scope']['namedPlots'][number][];
    queryRefs?: NotebookPlotContext['scope']['queryRefs'][number][];
    variables?: Map<string, { name: string; scope: 'cellLocal' | 'workspace' | 'crossCell' | 'gesture'; value?: string; dataType: 'number' | 'string' | 'timestamp' | 'json' | 'unknown' }>;
    brushes?: Map<string, { plotName: string; cellId: string; xType: 'number' | 'timestamp' | 'string' | 'unknown'; yType: 'number' | 'timestamp' | 'string' | 'unknown' }>;
}): NotebookPlotContext {
    return {
        currentCellId: 'cur',
        scope: {
            namedPlots: opts.namedPlots ?? [],
            queryRefs: opts.queryRefs ?? [],
            variables: opts.variables ?? new Map(),
            brushes: opts.brushes ?? new Map(),
        },
    };
}

function findFirst(root: PlotNode, predicate: (n: PlotNode) => boolean): PlotNode | undefined {
    let found: PlotNode | undefined;
    walk(root, n => { if (!found && predicate(n)) found = n; });
    return found;
}

describe('crossPlotAnnotator + brushAnnotator', () => {
    it('6. resolves `$gc_plot.brush.lo` as a brush with timestamp dataType', () => {
        const brushes = new Map<string, { plotName: string; cellId: string; xType: 'number' | 'timestamp' | 'string' | 'unknown'; yType: 'number' | 'timestamp' | 'string' | 'unknown' }>([
            ['gc_plot', { plotName: 'gc_plot', cellId: 'a', xType: 'timestamp', yType: 'number' }],
        ]);
        const ctx = buildContextForAnnotator({ brushes });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: $gc_plot.brush.lo, y: pause)',
            notebookContext: ctx,
        });
        const v = findFirst(root, n => n.kind === 'varRef');
        expect(v?.annotations.resolves).toMatchObject({
            kind: 'variable',
            source: 'brush',
            dataType: 'timestamp',
        });
    });

    it('8. resolves `ON #2` to a queryRef with targetCellId', () => {
        const ctx = buildContextForAnnotator({
            queryRefs: [
                { index: 1, cellId: 'a', sql: 'SELECT 1' },
                { index: 2, cellId: 'b', sql: 'SELECT 2' },
            ],
        });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) ON #2',
            notebookContext: ctx,
        });
        const qref = findFirst(root, n => n.kind === 'queryRef');
        expect(qref?.annotations.resolves).toMatchObject({
            kind: 'queryRef',
            targetCellId: 'b',
            targetSql: 'SELECT 2',
        });
    });

    it('9. does NOT resolve `master` positional keyword as a crossPlot', () => {
        const ctx = buildContextForAnnotator({
            namedPlots: [],
        });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) LINK_X($a, $b, master)',
            notebookContext: ctx,
        });
        const masterIdent = findFirst(root, n => n.kind === 'ident' && n.name === 'master');
        expect(masterIdent?.annotations.resolves).toBeUndefined();
        // and no diagnostic.
        expect(masterIdent?.annotations.structuredDiagnostics ?? []).toEqual([]);
    });

    it('10. emits an `unknown-plot` diagnostic for an unrecognised plot name', () => {
        const ctx = buildContextForAnnotator({ namedPlots: [] });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) | link-x: [ghost_plot]',
            notebookContext: ctx,
        });
        const ghost = findFirst(root, n => n.kind === 'ident' && n.name === 'ghost_plot');
        const diags = ghost?.annotations.structuredDiagnostics ?? [];
        expect(diags.some(d => d.code === 'unknown-plot')).toBe(true);
    });

    it('resolves a crossPlot when the LINK_X ident matches a named plot', () => {
        const ctx = buildContextForAnnotator({
            namedPlots: [
                { plotName: 'master_plot', cellId: 'a', plotIndexInCell: 0, shape: 'line', hasBrush: false },
            ],
        });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) | link-x: [master_plot]',
            notebookContext: ctx,
        });
        const ref = findFirst(root, n => n.kind === 'ident' && n.name === 'master_plot');
        expect(ref?.annotations.resolves).toMatchObject({
            kind: 'crossPlot',
            plotName: 'master_plot',
            cellId: 'a',
        });
    });

    it('emits an unknown-query-ref diagnostic when `#N` has no match', () => {
        const ctx = buildContextForAnnotator({ queryRefs: [] });
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) ON #5',
            notebookContext: ctx,
        });
        const qref = findFirst(root, n => n.kind === 'queryRef');
        const diags = qref?.annotations.structuredDiagnostics ?? [];
        expect(diags.some(d => d.code === 'unknown-query-ref')).toBe(true);
    });

    it('is a no-op when no notebookContext is supplied', () => {
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) ON #2',
        });
        const qref = findFirst(root, n => n.kind === 'queryRef');
        expect(qref?.annotations.resolves).toBeUndefined();
        expect(qref?.annotations.structuredDiagnostics ?? []).toEqual([]);
    });

    // B-187 — crossPlotAnnotator must compare plot names case-insensitively
    it('B-187: resolves crossPlot with case-insensitive plot name comparison', () => {
        const ctx = buildContextForAnnotator({
            namedPlots: [
                { plotName: 'GC_Plot', cellId: 'a', plotIndexInCell: 0, shape: 'line', hasBrush: false },
            ],
        });
        // LINK_X reference uses lowercase; named plot stored with mixed case.
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts) | link-x: [gc_plot]',
            notebookContext: ctx,
        });
        const ref = findFirst(root, n => n.kind === 'ident' && n.name?.toLowerCase() === 'gc_plot');
        // Must resolve, not emit unknown-plot.
        expect(ref?.annotations.resolves).toMatchObject({
            kind: 'crossPlot',
            plotName: 'GC_Plot',
        });
        expect(ref?.annotations.structuredDiagnostics ?? []).toEqual([]);
    });
});

// B-152 — VIEW_ALIAS_RE must match double-quoted view names
describe('NotebookPlotScope.build — VIEW_ALIAS_RE quoted names (B-152)', () => {
    it('extracts alias from `CREATE VIEW "My View" AS …`', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['CREATE VIEW "gc pauses" AS SELECT * FROM events'],
                },
            },
        });
        expect(view.queryRefs).toHaveLength(1);
        expect(view.queryRefs[0].alias).toBe('gc pauses');
    });

    it('extracts alias from unquoted `CREATE VIEW gc_plain AS …`', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['CREATE VIEW gc_plain AS SELECT * FROM events'],
                },
            },
        });
        expect(view.queryRefs[0].alias).toBe('gc_plain');
    });
});

// B-151 — queryIndexCounter must stay in sync with queryRefs
// Current-cell SQL blocks must not increment the counter (they produce no refs),
// otherwise the index assigned to prior-cell refs would be inflated.
describe('NotebookPlotScope.build — queryIndexCounter sync (B-151)', () => {
    it('assigns correct 1-based indices when current cell has SQL blocks', () => {
        // Cell A has 2 SQL blocks → refs at index 1 and 2.
        // Cell B (current) has 3 SQL blocks — they must NOT shift cell A's indices.
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT 1', 'SELECT 2'],
                },
                b: {
                    sqlBlocks: ['SELECT x', 'SELECT y', 'SELECT z'],
                },
            },
        });
        expect(view.queryRefs).toHaveLength(2);
        expect(view.queryRefs[0].index).toBe(1);
        expect(view.queryRefs[1].index).toBe(2);
    });

    it('queryRefs count equals the number of non-empty SQL blocks in prior cells', () => {
        const cells = [cell('a'), cell('b'), cell('c')];
        const view = buildView({
            cells,
            currentCellId: 'c',
            parsed: {
                a: { sqlBlocks: ['SELECT 1', 'SELECT 2'] },
                b: { sqlBlocks: ['SELECT 3'] },
                c: { sqlBlocks: ['SELECT 4', 'SELECT 5'] },
            },
        });
        // Only cells a and b contribute (c is current).
        expect(view.queryRefs).toHaveLength(3);
        expect(view.queryRefs.map(r => r.index)).toEqual([1, 2, 3]);
    });

    it('empty SQL blocks in prior cells occupy an index slot but produce no ref', () => {
        // Cell A has: one real block (index 1), one empty block (index 2).
        // Cell B (current). Cell A's ref should be at index 1.
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: { sqlBlocks: ['SELECT 1', ''] },
                b: { sqlBlocks: [] },
            },
        });
        // The real block from cell A should be at index 1.
        expect(view.queryRefs).toHaveLength(1);
        expect(view.queryRefs[0].index).toBe(1);
    });
});

// Cross-cell multi-query scenarios: ON alias routing + LINK_X discovery
// ─────────────────────────────────────────────────────────────────────────────

describe('NotebookPlotScope.build — cross-cell ON alias routing', () => {
    it('exposes a prior-cell SQL alias in queryRefs so ON clause can reference it', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['CREATE VIEW gc_pauses AS SELECT ts, pause FROM gc'],
                    queryAliases: ['gc_pauses'],
                },
            },
        });
        // The alias from cell A must be visible as a queryRef with the correct alias.
        expect(view.queryRefs).toHaveLength(1);
        expect(view.queryRefs[0].alias).toBe('gc_pauses');
        expect(view.queryRefs[0].cellId).toBe('a');
    });

    it('current-cell SQL aliases are NOT included in queryRefs (they are in scope locally)', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: { sqlBlocks: ['SELECT 1'], queryAliases: ['a_view'] },
                b: { sqlBlocks: ['CREATE VIEW b_view AS SELECT 2'], queryAliases: ['b_view'] },
            },
        });
        // Only a_view from cell A — b_view (current cell) is not in queryRefs.
        const aliases = view.queryRefs.map(r => r.alias).filter(Boolean);
        expect(aliases).toContain('a_view');
        expect(aliases).not.toContain('b_view');
    });

    it('multiple prior cells with aliases produce multiple queryRefs', () => {
        const cells = [cell('a'), cell('b'), cell('c')];
        const view = buildView({
            cells,
            currentCellId: 'c',
            parsed: {
                a: { sqlBlocks: ['SELECT 1'], queryAliases: ['view_a'] },
                b: { sqlBlocks: ['SELECT 2'], queryAliases: ['view_b'] },
            },
        });
        const aliases = view.queryRefs.map(r => r.alias).filter(Boolean);
        expect(aliases).toContain('view_a');
        expect(aliases).toContain('view_b');
        expect(view.queryRefs).toHaveLength(2);
    });
});

describe('NotebookPlotScope.build — cross-cell LINK_X discovery', () => {
    it('discovers linkedXVars from a prior-cell plot with LINK_X', () => {
        const cells = [cell('a'), cell('b')];
        const view = buildView({
            cells,
            currentCellId: 'b',
            parsed: {
                a: {
                    sqlBlocks: ['SELECT ts, cpu FROM perf'],
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: cpu) LINK_X($start, $end) NAME "perf_plot"', sqlIndex: 0 }],
                },
            },
        });
        const plot = view.namedPlots.find(p => p.plotName === 'perf_plot');
        expect(plot).toBeDefined();
        expect(plot!.linkedXVars).toEqual(['start', 'end']);
    });

    it('multiple plots in different cells each appear in namedPlots', () => {
        const cells = [cell('a'), cell('b'), cell('c')];
        const view = buildView({
            cells,
            currentCellId: 'c',
            parsed: {
                a: {
                    plotBlocks: [{ config: 'LINE_CHART(x: ts, y: v) NAME "plot_a"', sqlIndex: 0 }],
                    sqlBlocks: ['SELECT 1'],
                },
                b: {
                    plotBlocks: [{ config: 'BAR_CHART(x: category, y: count) NAME "plot_b"', sqlIndex: 0 }],
                    sqlBlocks: ['SELECT 2'],
                },
            },
        });
        const names = view.namedPlots.map(p => p.plotName);
        expect(names).toContain('plot_a');
        expect(names).toContain('plot_b');
    });
});
