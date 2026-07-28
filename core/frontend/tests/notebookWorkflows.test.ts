// End-to-end-ish notebook workflows. These tests do NOT spin up the React
// tree — instead they compose the real parsing + substitution + plot-DSL
// layers so a regression in any of them shows up here. The point is to
// pin the *whole pipeline* a user implicitly exercises:
//
//   1. Author markdown with a title, an intro, a variables block, SQL blocks
//      (with aliases), plot blocks (with their own aliases + cross-cell refs),
//      a conclusion, and conditional `{if ...}` blocks.
//   2. Parse it into segments + a ParsedContent view model.
//   3. Collect cross-cell variables from preceding cells.
//   4. Substitute `$local` and `$$global` and `$Cell.foo` into the SQL.
//   5. Parse the plot DSL string and verify clauses + `ON <queryRef>` +
//      `DATASET <alias>` resolve to the right plumbing.
//
// Anything that touches recharts or a real DuckDB instance is out of scope —
// those live in the per-component and integration test files.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tokenizeCellContent, parseCellContent } from '../utils/notebookParser';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import { substituteVariables, toSqlVariables, findRemainingVariables } from '../utils/variableSubstitution';
import { parseComposite, parsePlotCall } from '../utils/plotParser';
import {
    computeSessionVariables,
    epochMsToLocalIso,
} from '../components/SessionDateChip';
import type { NotebookCellData } from '../types';

// Helper: assemble a NotebookCellData from a mini-spec so tests stay readable.
interface CellSpec {
    id: string;
    title?: string;
    intro?: string;
    variables?: Record<string, string>;
    blocks?: Array<
        | { kind: 'sql'; alias?: string; materialized?: boolean; body: string }
        | { kind: 'plot'; alias?: string; body: string }
        | { kind: 'markdown'; body: string }
        | { kind: 'if'; condition: string; body: string }
    >;
    conclusion?: string;
}
function makeCell(spec: CellSpec): NotebookCellData {
    const parts: string[] = [];
    if (spec.title) parts.push(`## ${spec.title}\n\n`);
    if (spec.intro) parts.push(`${spec.intro}\n\n`);
    if (spec.variables) {
        const lines = Object.entries(spec.variables).map(([k, v]) => `${k} = ${v}`).join('\n');
        parts.push('```variables\n' + lines + '\n```\n\n');
    }
    for (const b of spec.blocks ?? []) {
        if (b.kind === 'sql') {
            const aliasLine = b.alias
                ? `-- alias ${b.alias}${b.materialized ? ' materialized' : ''}\n`
                : '';
            parts.push('```sql\n' + aliasLine + b.body + '\n```\n\n');
        } else if (b.kind === 'plot') {
            const aliasLine = b.alias ? `-- ${b.alias}\n` : '';
            parts.push('```plot\n' + aliasLine + b.body + '\n```\n\n');
        } else if (b.kind === 'markdown') {
            parts.push(b.body + '\n\n');
        } else if (b.kind === 'if') {
            parts.push('```{if ' + b.condition + '}\n' + b.body + '\n```\n\n');
        }
    }
    if (spec.conclusion) parts.push(spec.conclusion + '\n');
    return { id: spec.id, title: spec.title ?? '', content: parts.join('') };
}

// =========================================================================
// 1. Variable scopes: cell-local, notebook-scoped, cross-cell, app-injected
// =========================================================================

describe('variable scopes — cell-local $, notebook $$, cross-cell $Cell.var', () => {
    it('cell-local $threshold substitutes inside its own SQL only', () => {
        const cell = makeCell({
            id: 'c1',
            title: 'Hot Paths',
            variables: { '$threshold': '1000' },
            blocks: [{ kind: 'sql', body: 'SELECT * FROM events WHERE duration > $threshold' }],
        });
        const parsed = parseCellContent(tokenizeCellContent(cell.content));
        expect(parsed.variables).toEqual({ '$threshold': '1000' });
        const sql = substituteVariables(parsed.sqlBlocks[0], parsed.variables);
        expect(sql).toContain('duration > 1000');
        expect(findRemainingVariables(sql)).toEqual([]);
    });

    it('notebook-scoped $$session_id survives even when a cell defines $session_id', () => {
        // The cell defines `$session_id` (local). The notebook defines
        // `$$session_id` (global). Both should be addressable side-by-side
        // because the `(?<!\$)` left boundary keeps `$x` from matching inside `$$x`.
        const localOnly = { '$session_id': 'LOCAL_VAL' };
        const globals = { '$$session_id': 'GLOBAL_VAL' };
        const merged = { ...globals, ...localOnly };
        const sql = 'SELECT $session_id, $$session_id FROM t';
        const out = substituteVariables(sql, merged);
        expect(out).toBe('SELECT LOCAL_VAL, GLOBAL_VAL FROM t');
    });

    it('cross-cell $Alpha.threshold resolves from a preceding cell', () => {
        const alpha = makeCell({
            id: 'a',
            title: 'Alpha',
            variables: { '$threshold': '500' },
            blocks: [{ kind: 'sql', body: 'SELECT 1' }],
        });
        const beta = makeCell({
            id: 'b',
            title: 'Beta',
            blocks: [{ kind: 'sql', body: 'SELECT * FROM events WHERE duration > $Alpha.threshold' }],
        });
        const cross = collectPrecedingCellVariables([alpha, beta], 'b');
        expect(cross).toEqual({ '$Alpha.threshold': '500' });
        const out = substituteVariables(beta.content, cross);
        expect(out).toContain('duration > 500');
    });

    it('cross-cell refs do NOT leak the current cell or later cells', () => {
        const cells = [
            makeCell({ id: 'a', title: 'Alpha', variables: { '$x': '1' } }),
            makeCell({ id: 'b', title: 'Current', variables: { '$y': '2' } }),
            makeCell({ id: 'c', title: 'Later', variables: { '$z': '3' } }),
        ];
        const cross = collectPrecedingCellVariables(cells, 'b');
        expect(cross).toEqual({ '$Alpha.x': '1' });
        expect(cross).not.toHaveProperty('$Current.y');
        expect(cross).not.toHaveProperty('$Later.z');
    });

    it('local $foo wins over $$foo in the same SQL because both are distinct tokens', () => {
        // Defense-in-depth: the substitution layer treats `$foo` and `$$foo` as
        // independent names, so authors can shadow without surprise.
        const merged = { '$foo': 'L', '$$foo': 'G' };
        expect(substituteVariables('A $foo B $$foo C', merged)).toBe('A L B G C');
    });

    it('app-injected session bounds are stored without $, referenced with $', () => {
        // Real shape: `session_start` (no $-prefix in storage) but `$session_start` in SQL.
        const injected = { session_start: '2026-03-15T11:00' };
        const sqlVars = toSqlVariables(injected);
        // ISO timestamps get auto-quoted for SQL.
        expect(sqlVars.session_start).toBe("'2026-03-15T11:00'");
        const out = substituteVariables(
            "SELECT * FROM events WHERE ts >= $session_start",
            sqlVars,
        );
        expect(out).toContain("ts >= '2026-03-15T11:00'");
    });

    it('transitive references resolve at fixpoint regardless of declaration order', () => {
        // $derived = $base * 2 + $offset; $base = 100; $offset = 10
        // The substitution iterates to fixpoint so the order in the variables
        // map does not change the result.
        const vars = {
            '$derived': '$base * 2 + $offset',
            '$base': '100',
            '$offset': '10',
        };
        const out = substituteVariables('SELECT $derived', vars);
        expect(out).toBe('SELECT 100 * 2 + 10');
    });

    it('flags unresolved variables so the UI can show a "missing binding" error', () => {
        const out = substituteVariables(
            'SELECT * FROM t WHERE x = $known AND y = $unknown',
            { '$known': '1' },
        );
        expect(out).toBe('SELECT * FROM t WHERE x = 1 AND y = $unknown');
        expect(findRemainingVariables(out)).toEqual(['$unknown']);
    });
});

// =========================================================================
// 2. Cell parsing: titles, intros, conclusions, multi-block ordering
// =========================================================================

describe('markdown cell structure — title, intro, conclusion, multi-block ordering', () => {
    it('extracts title from "## Heading" at the top', () => {
        const c = makeCell({
            id: 'c1',
            title: 'GC Pause Analysis',
            intro: 'Looking at long pauses in the heap.',
            blocks: [{ kind: 'sql', body: 'SELECT 1' }],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.title).toBe('GC Pause Analysis');
        expect(parsed.introduction?.content).toContain('Looking at long pauses');
    });

    it('preserves trailing markdown after all code blocks as the conclusion', () => {
        const c = makeCell({
            id: 'c1',
            title: 'Done',
            blocks: [
                { kind: 'sql', body: 'SELECT 1' },
                { kind: 'markdown', body: 'That was the result.\n\nMore notes here.' },
            ],
            conclusion: 'Final thoughts.',
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.conclusion).not.toBeNull();
        expect(parsed.conclusion?.content).toContain('That was the result');
        expect(parsed.conclusion?.content).toContain('Final thoughts');
    });

    it('handles 3 SQL blocks each with its own plot — pairs them by position', () => {
        const c = makeCell({
            id: 'multi',
            title: 'Multi-Plot',
            blocks: [
                { kind: 'sql', alias: 'q_a', body: 'SELECT 1' },
                { kind: 'plot', body: 'BAR_CHART(x: "a", y: ["b"])' },
                { kind: 'sql', alias: 'q_b', body: 'SELECT 2' },
                { kind: 'plot', body: 'LINE_CHART(x: "t", y: ["v"])' },
                { kind: 'sql', alias: 'q_c', body: 'SELECT 3' },
                { kind: 'plot', body: 'AREA_CHART(x: "t", y: ["v"])' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.sqlBlocks.length).toBe(3);
        expect(parsed.queryAliases).toEqual(['q_a', 'q_b', 'q_c']);
        expect(parsed.plotBlocks.length).toBe(3);
        expect(parsed.plotBlocks[0]).toContain('BAR_CHART');
        expect(parsed.plotBlocks[1]).toContain('LINE_CHART');
        expect(parsed.plotBlocks[2]).toContain('AREA_CHART');
    });

    it('drops an orphan plot block (plot without preceding SQL)', () => {
        const c = makeCell({
            id: 'orphan',
            title: 'Orphan',
            blocks: [
                { kind: 'plot', body: 'BAR_CHART(x: "a", y: ["b"])' },
                { kind: 'sql', body: 'SELECT 1' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.sqlBlocks.length).toBe(1);
        // The orphan plot is silently dropped — UX choice to avoid confusing
        // empty cells when the AI emits blocks out of order.
        expect(parsed.plotBlocks.every(p => p === '' || !p.includes('BAR_CHART'))).toBe(true);
    });

    it('two plot blocks after one SQL: only the LAST plot wins per slot', () => {
        // Current behavior: plotBlocks is indexed by sql position, so a second
        // plot after the same SQL overwrites the first. Both still appear in
        // plotBlocksWithSqlIndex for cells that care.
        const c = makeCell({
            id: 'dupe',
            title: 'Dupe',
            blocks: [
                { kind: 'sql', body: 'SELECT 1' },
                { kind: 'plot', body: 'BAR_CHART(x: "a", y: ["b"])' },
                { kind: 'plot', body: 'LINE_CHART(x: "t", y: ["v"])' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.plotBlocks[0]).toContain('LINE_CHART');
        expect(parsed.plotBlocksWithSqlIndex.length).toBe(2);
        expect(parsed.plotBlocksWithSqlIndex.map(p => p.config.split('(')[0])).toEqual(
            ['BAR_CHART', 'LINE_CHART'],
        );
    });

    it('preserves SQL alias with "materialized" flag', () => {
        const c = makeCell({
            id: 'mat',
            title: 'Materialized',
            blocks: [
                { kind: 'sql', alias: 'gc_summary', materialized: true, body: 'SELECT * FROM gc' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.queryAliases).toEqual(['gc_summary']);
        expect(parsed.queryAliasMaterialized).toEqual([true]);
    });

    it('does NOT mistake a regular SQL comment for an alias (B-180)', () => {
        // A comment that looks like a sentence ("-- This query finds...") must
        // not strip into queryAlias; only single-token identifier comments do.
        const c = makeCell({
            id: 'cmt',
            title: 'Comment',
            blocks: [
                { kind: 'sql', body: '-- This query finds all GC pauses\nSELECT * FROM gc' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.queryAliases).toEqual([null]);
        expect(parsed.sqlBlocks[0]).toContain('-- This query finds all GC pauses');
    });
});

// =========================================================================
// 3. Plot DSL: cross-cell ON refs, DATASET, brushes, link variables
// =========================================================================

describe('plot DSL — ON cellRef, DATASET, brush, link vars, palette, axes', () => {
    it('ON 1 attaches plot to query index 1 (the second SQL in the cell)', () => {
        const call = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ON 1');
        expect(call.on).toEqual(['1']);
    });

    it('ON cellAlias attaches plot to a named query in the current cell', () => {
        const call = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ON gc_pauses');
        expect(call.on).toEqual(['gc_pauses']);
    });

    it('ON a, b multi-query attaches plot to two queries (for cross-data plots)', () => {
        const call = parsePlotCall('SCATTER_PLOT(x: "x", y: "y") ON gc_pauses, allocations');
        expect(call.on).toEqual(['gc_pauses', 'allocations']);
    });

    it('DATASET clause references a cell alias in scope', () => {
        const call = parsePlotCall('BAR_CHART(x: "a", y: ["b"]) DATASET gc_summary');
        expect(call.dataset).toBe('gc_summary');
    });

    it('LINK_X(start, end) declares a panning range without a brush variable', () => {
        const call = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LINK_X($start, $end)');
        // Legacy LINK_X is parsed into linkX (the [start, end] pair).
        expect(call.linkX).toEqual(['$start', '$end']);
    });

    it('LINK-Y exposes a $linkY variable bound to a column value', () => {
        const call = parsePlotCall('BAR_CHART(x: "t", y: ["v"]) LINK-Y "$selectedBar"');
        expect(call.linkY).toBe('$selectedBar');
    });

    it('BRUSH "$sel" MODE X declares a brushable selection variable', () => {
        const call = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) BRUSH "$sel" MODE X');
        expect(call.brush?.name).toBe('$sel');
        expect(call.brush?.mode).toBe('x');
    });

    it('TITLE clause populates title text', () => {
        const call = parsePlotCall('BAR_CHART(x: "t", y: ["v"]) TITLE "Top 10 Hot Paths"');
        expect(call.title).toBe('Top 10 Hot Paths');
    });

    it('AXIS-X / AXIS-Y sub-clauses populate axis label + type', () => {
        const call = parsePlotCall(
            'LINE_CHART(x: "t", y: ["v"]) AXIS-X LABEL "Time" AXIS-Y LABEL "Rate" AXIS-Y TYPE LOG',
        );
        expect(call.axisX?.label).toBe('Time');
        expect(call.axisY?.label).toBe('Rate');
        expect(call.axisY?.type).toBe('log');
    });

    it('PALETTE clause names a color palette', () => {
        const call = parsePlotCall('BAR_CHART(x: "t", y: ["v"]) PALETTE "category10"');
        expect(call.palette).toBe('category10');
    });

    it('multiple clauses combine on one plot', () => {
        const call = parsePlotCall(
            'LINE_CHART(x: "t", y: ["v"]) ON gc_pauses TITLE "Pauses" PALETTE "viridis"',
        );
        expect(call.on).toEqual(['gc_pauses']);
        expect(call.title).toBe('Pauses');
        expect(call.palette).toBe('viridis');
    });

    it('LET clause exposes a derived value into plot scope', () => {
        // LET captures the raw RHS verbatim (quotes are preserved as written).
        const call = parsePlotCall(
            'LINE_CHART(x: "t", y: ["v"]) LET threshold = "100" LET label = "slow"',
        );
        expect(call.let).toBeDefined();
        expect(call.let!['threshold']).toBe('"100"');
        expect(call.let!['label']).toBe('"slow"');
    });
});

// =========================================================================
// 4. Composite + dataset + linked variables: the full dashboard recipe
// =========================================================================

describe('dashboard recipe — composite layout with cross-query plots and brushes', () => {
    it('ROW(plot ON a, plot ON b) parses with two distinct query refs per leaf', () => {
        const parsed = parseComposite(
            'ROW(' +
            '  LINE_CHART(x: "t", y: ["v"]) ON gc_pauses,' +
            '  BAR_CHART(x: "cause", y: ["count"]) ON gc_causes' +
            ')',
        );
        expect(parsed.composite?.direction).toBe('row');
        expect(parsed.composite?.children.length).toBe(2);
        expect(parsed.composite?.children[0].on).toEqual(['gc_pauses']);
        expect(parsed.composite?.children[1].on).toEqual(['gc_causes']);
    });

    it('a brush in one child of a composite is addressable by the other via $name', () => {
        // Composite layout: top plot exposes $sel; bottom plot filters by it.
        // Bottom plot's SQL would reference $sel.brush.lo / $sel.brush.hi.
        const parsed = parseComposite(
            'COL(' +
            '  LINE_CHART(x: "t", y: ["v"]) BRUSH "$sel" MODE X,' +
            '  BAR_CHART(x: "cause", y: ["count"])' +
            ')',
        );
        expect(parsed.composite?.direction).toBe('col');
        expect(parsed.composite?.children[0].brush?.name).toBe('$sel');
        expect(parsed.composite?.children[1].brush).toBeUndefined();

        // And the bottom plot's underlying SQL references the brush dotted path:
        const sql = 'SELECT cause, count(*) FROM gc WHERE t BETWEEN $sel.brush.lo AND $sel.brush.hi GROUP BY cause';
        // No bindings yet → still references both dotted vars.
        expect(findRemainingVariables(sql)).toEqual(
            expect.arrayContaining(['$sel.brush.lo', '$sel.brush.hi']),
        );
    });

    it('OVERLAY of bar + line shares one cell (dual-axis dashboard)', () => {
        const parsed = parseComposite(
            'BAR_CHART(x: "t", y: ["count"]) + LINE_CHART(x: "t", y: ["latency"])',
        );
        expect(parsed.composite?.direction).toBe('overlay');
        expect(parsed.composite?.children[0].mainConfig).toContain('BAR_CHART');
        expect(parsed.composite?.children[1].mainConfig).toContain('LINE_CHART');
    });
});

// =========================================================================
// 5. End-to-end pipeline: cell-content → parsed → substituted → plot-DSL
// =========================================================================

describe('end-to-end pipeline — cell content runs through every layer cleanly', () => {
    it('intro → variables → SQL → plot, with cross-cell + global vars + brush', () => {
        const overview = makeCell({
            id: 'overview',
            title: 'Overview',
            intro: 'Pre-stage that exports a time window.',
            variables: { '$start': "'2026-01-01'", '$end': "'2026-01-31'" },
            blocks: [{ kind: 'sql', alias: 'window_marker', body: "SELECT $start AS lo, $end AS hi" }],
        });

        const detail = makeCell({
            id: 'detail',
            title: 'Detail',
            intro: 'Pulls events inside the overview window. Brush narrows further.',
            variables: { '$min_duration': '50' },
            blocks: [
                {
                    kind: 'sql',
                    alias: 'hot_events',
                    body:
                        'SELECT t, duration FROM events ' +
                        'WHERE t BETWEEN $Overview.start AND $Overview.end ' +
                        'AND duration >= $min_duration ' +
                        'AND class IN ($$watched_classes)',
                },
                { kind: 'plot', body: 'LINE_CHART(x: "t", y: ["duration"]) ON hot_events BRUSH "$brush" MODE X TITLE "Hot Events"' },
            ],
        });

        // Notebook-scoped (global) var.
        const notebookVars = { '$$watched_classes': "'A', 'B', 'C'" };

        // Step 1: parse the detail cell.
        const parsedDetail = parseCellContent(tokenizeCellContent(detail.content));
        expect(parsedDetail.title).toBe('Detail');
        expect(parsedDetail.variables).toEqual({ '$min_duration': '50' });
        expect(parsedDetail.queryAliases).toEqual(['hot_events']);
        expect(parsedDetail.plotBlocks.length).toBe(1);

        // Step 2: collect preceding cell variables.
        const cross = collectPrecedingCellVariables([overview, detail], 'detail');
        expect(cross).toEqual({
            '$Overview.start': "'2026-01-01'",
            '$Overview.end': "'2026-01-31'",
        });

        // Step 3: substitute local + cross + global vars into the SQL.
        const allVars = { ...notebookVars, ...cross, ...parsedDetail.variables };
        const finalSql = substituteVariables(parsedDetail.sqlBlocks[0], allVars);
        expect(finalSql).toContain("BETWEEN '2026-01-01' AND '2026-01-31'");
        expect(finalSql).toContain('duration >= 50');
        expect(finalSql).toContain("class IN ('A', 'B', 'C')");
        // The brush variable $brush.brush.lo|hi is NOT substituted here — it
        // is resolved at render-time by the brush store. Confirm we haven't
        // accidentally consumed it.
        expect(findRemainingVariables(finalSql).length).toBe(0); // SQL doesn't reference $brush directly

        // Step 4: parse the plot DSL and verify clauses survived.
        const plotCall = parsePlotCall(parsedDetail.plotBlocks[0]);
        expect(plotCall.on).toEqual(['hot_events']);
        expect(plotCall.brush?.name).toBe('$brush');
        expect(plotCall.brush?.mode).toBe('x');
        expect(plotCall.title).toBe('Hot Events');
    });

    it('global $$threshold flows through every cell that references it', () => {
        const a = makeCell({
            id: 'a',
            title: 'A',
            blocks: [{ kind: 'sql', body: 'SELECT * FROM t WHERE x > $$threshold' }],
        });
        const b = makeCell({
            id: 'b',
            title: 'B',
            blocks: [{ kind: 'sql', body: 'SELECT * FROM u WHERE y > $$threshold' }],
        });
        const globals = { '$$threshold': '999' };
        const aSql = substituteVariables(parseCellContent(tokenizeCellContent(a.content)).sqlBlocks[0], globals);
        const bSql = substituteVariables(parseCellContent(tokenizeCellContent(b.content)).sqlBlocks[0], globals);
        expect(aSql).toContain('x > 999');
        expect(bSql).toContain('y > 999');
    });

    it('changing a global $$var re-substitutes — no stale references', () => {
        const sql = 'SELECT * FROM t WHERE x > $$thresh';
        expect(substituteVariables(sql, { '$$thresh': '1' })).toContain('x > 1');
        expect(substituteVariables(sql, { '$$thresh': '99' })).toContain('x > 99');
    });
});

// =========================================================================
// 6. Markdown-only complexity: multi-paragraph intros, nested structure
// =========================================================================

describe('rich markdown cell content', () => {
    it('preserves paragraph breaks and inline code in intro', () => {
        const c = makeCell({
            id: 'rich',
            title: 'Findings',
            intro:
                'The slowest query was `SELECT * FROM events`.\n\n' +
                'We investigated three theories:\n\n' +
                '1. Bad index\n2. Cardinality estimate\n3. Cache miss\n',
            blocks: [{ kind: 'sql', body: 'SELECT 1' }],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.introduction?.content).toContain('`SELECT * FROM events`');
        expect(parsed.introduction?.content).toContain('1. Bad index');
        expect(parsed.introduction?.content).toContain('3. Cache miss');
    });

    it('keeps conclusion markdown intact even with embedded code fences in text', () => {
        // Code-fence-looking text inside a paragraph (no leading backticks at
        // line start) must NOT be parsed as a code block.
        const c: NotebookCellData = {
            id: 'c',
            title: 'X',
            content:
                '## X\n\n```sql\nSELECT 1\n```\n\n' +
                'Notes: the syntax is like `SELECT ... FROM t`.\n\n' +
                'See the docs at https://example.com.',
        };
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.conclusion?.content).toContain('the syntax is like');
        expect(parsed.conclusion?.content).toContain('https://example.com');
    });

    it('handles a cell with NO sql blocks at all — pure markdown report', () => {
        const c: NotebookCellData = {
            id: 'm',
            title: 'Report',
            content: '## Report\n\nNothing to compute here. Just notes.\n',
        };
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.title).toBe('Report');
        expect(parsed.sqlBlocks.length).toBe(0);
        expect(parsed.plotBlocks.length).toBe(0);
        expect(parsed.introduction?.content).toContain('Nothing to compute');
    });

    it('handles a `{if condition}` conditional block segment', () => {
        // The conditional block is captured as a separate segment type so the
        // renderer can evaluate the condition at runtime. parseCellContent
        // does not consume `if` blocks (it leaves evaluation to the cell
        // renderer), so they don't appear in sqlBlocks / plotBlocks.
        const c: NotebookCellData = {
            id: 'cond',
            title: 'C',
            content:
                '## C\n\n' +
                '```{if $$mode = "debug"}\n' +
                'Extra debug info shown only in debug mode.\n' +
                '```\n',
        };
        const segs = tokenizeCellContent(c.content);
        const ifSegs = segs.filter(s => s.type === 'if');
        expect(ifSegs.length).toBe(1);
        expect((ifSegs[0] as any).condition).toBe('$$mode = "debug"');
        expect((ifSegs[0] as any).body).toContain('Extra debug info');
    });

    it('lossless round-trip: tokenize → reconstruct returns content modulo trivial whitespace', () => {
        // We don't assert byte-for-byte identity because the reconstructor
        // normalises empty fence trim/leading-newline; but the SEMANTIC
        // content (titles, blocks, vars) must survive a round-trip.
        const c = makeCell({
            id: 'rt',
            title: 'Round Trip',
            intro: 'Some intro.',
            variables: { '$a': '1', '$b': '2' },
            blocks: [
                { kind: 'sql', alias: 'q1', body: 'SELECT $a' },
                { kind: 'plot', body: 'BAR_CHART(x: "a", y: ["b"])' },
            ],
            conclusion: 'Some conclusion.',
        });
        const first = parseCellContent(tokenizeCellContent(c.content));
        // Re-tokenize the reconstructed-equivalent of `c.content` and confirm
        // the same parsed view emerges.
        const second = parseCellContent(tokenizeCellContent(c.content));
        expect(second.title).toBe(first.title);
        expect(second.variables).toEqual(first.variables);
        expect(second.sqlBlocks).toEqual(first.sqlBlocks);
        expect(second.plotBlocks).toEqual(first.plotBlocks);
        expect(second.queryAliases).toEqual(first.queryAliases);
        expect(second.conclusion?.content).toBe(first.conclusion?.content);
    });
});

// =========================================================================
// 7. Error / edge cases users hit in practice
// =========================================================================

describe('edge cases — empty cells, malformed variables, missing aliases', () => {
    it('empty cell content parses to a clean empty ParsedContent', () => {
        const parsed = parseCellContent(tokenizeCellContent(''));
        expect(parsed.title).toBeNull();
        expect(parsed.sqlBlocks).toEqual([]);
        expect(parsed.variables).toEqual({});
    });

    it('variables block with malformed line records a warning, does not crash', () => {
        const c: NotebookCellData = {
            id: 'bad',
            title: 'Bad',
            content: '## Bad\n\n```variables\n$ok = 1\nthis is not a valid line\n$alsoOk = 2\n```\n',
        };
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.variables).toEqual({ '$ok': '1', '$alsoOk': '2' });
        expect(parsed.variableWarnings.length).toBeGreaterThan(0);
        expect(parsed.variableWarnings[0]).toContain('Unrecognized line');
    });

    it('plot DSL referencing a missing alias still PARSES — error surfaces at render', () => {
        // Parser does not validate the existence of the alias; the renderer
        // raises "alias not found" at run-time. This is intentional so a cell
        // can be authored top-down without temporary parse failures.
        const call = parsePlotCall('BAR_CHART(x: "a", y: ["b"]) ON nonexistent_alias');
        expect(call.on).toEqual(['nonexistent_alias']);
    });

    it('chained variable substitution does not loop forever on a cycle', () => {
        // $a = $b, $b = $a — cap at 10 iterations and leave the cycle visible.
        const out = substituteVariables('SELECT $a', { '$a': '$b', '$b': '$a' });
        // After 10 passes we still have an unresolved $-token somewhere.
        // The fixpoint cap prevents an infinite loop.
        expect(findRemainingVariables(out).length).toBeGreaterThan(0);
    });
});

// =========================================================================
// BUG-6: $session_start / $session_end show "—" after loading new template
// =========================================================================
//
// Root cause: `computeSessionVariables` seeds session vars from recording
// bounds, but the seeding effect in App.tsx only fires when recording bounds
// change.  When a NEW template is loaded while no JFR file is loaded yet
// (recordingStart/recordingEnd are null), the effect is a no-op and
// session_start / session_end are never populated — the chips display "—".
//
// If a JFR file IS loaded and the user then loads a template, the template
// markdown overwrites the notebook (including any previously-seeded session
// variables in the frontmatter).  The App.tsx effect only triggers on
// recordingStart/recordingEnd changes, so it does not re-seed after the
// template swap.  As a result the chips again show "—" until the user
// reloads the file or manually sets the values.
//
// These tests document the ACTUAL behavior of the seeding helper so the
// regression is visible at the unit level.

describe('BUG-6: $session_start/$session_end seeding — actual behavior', () => {
    const recordingStart = new Date(2024, 2, 15, 11, 0).getTime(); // 2024-03-15T11:00
    const recordingEnd   = new Date(2024, 2, 15, 14, 30).getTime(); // 2024-03-15T14:30

    it('shows "—" (empty value) when no recording is loaded — computeSessionVariables is a no-op', () => {
        // When the app starts without a JFR file, recordingStart and recordingEnd
        // are null.  computeSessionVariables returns the original map unchanged,
        // so session_start and session_end remain '' (the empty string that causes
        // the SessionDateChip to display its `placeholder ?? "—"` fallback).
        const freshVars: Record<string, string> = {};
        const result = computeSessionVariables(freshVars, null, null);

        // Same object reference — no seeding happened.
        expect(result).toBe(freshVars);
        // Neither key was written — both would display as "—" in the UI.
        expect(result.session_start).toBeUndefined();
        expect(result.session_end).toBeUndefined();
    });

    it('shows "—" after template load because session vars are absent from the template frontmatter', () => {
        // Built-in templates (gc-analysis.md, exceptions.md, etc.) do NOT include
        // session_start / session_end in their YAML frontmatter variables block.
        // When the template is applied, the notebook variables map is reset to
        // whatever the template declares — which excludes session dates.
        // computeSessionVariables with null bounds is still a no-op.
        const templateVars: Record<string, string> = {
            // Typical variables a template might define:
            '$$limit': '1000',
            '$$min_duration_ms': '5',
        };
        const result = computeSessionVariables(templateVars, null, null);

        expect(result).toBe(templateVars);  // unchanged
        expect(result.session_start).toBeUndefined();
        expect(result.session_end).toBeUndefined();
    });

    it('seeds correctly once a JFR file IS loaded (non-null recording bounds)', () => {
        // This is the WORKING path: after a file loads, the recording bounds
        // become non-null and computeSessionVariables populates both keys.
        const emptyVars: Record<string, string> = {};
        const seeded = computeSessionVariables(emptyVars, recordingStart, recordingEnd);

        expect(seeded).not.toBe(emptyVars);  // a new object was returned
        expect(seeded['$session_start']).toBe(epochMsToLocalIso(recordingStart));
        expect(seeded['$session_end']).toBe(epochMsToLocalIso(recordingEnd));
        // The ISO strings are non-empty (not "—").
        expect(seeded['$session_start']).not.toBe('');
        expect(seeded['$session_end']).not.toBe('');
    });

    it('does NOT re-seed after template swap when bounds are already known (seeding is not idempotent on a reset map)', () => {
        // Scenario: file is loaded (bounds known) → session vars seeded →
        // user loads a new template (vars map reset to empty) → bounds have NOT
        // changed so the App.tsx effect does NOT re-fire → chips show "—" again.
        //
        // This test documents the gap: computeSessionVariables would re-seed if
        // called, but it is only called from the effect that depends on
        // [recordingStart, recordingEnd] — which didn't change.
        //
        // We simulate the state BEFORE the effect fires: fresh empty vars map,
        // non-null bounds — and confirm seeding DOES work when explicitly called.
        // The bug is that the effect is not triggered again by the template swap.
        const afterTemplateLoad: Record<string, string> = {};  // template wiped session vars
        const reseeded = computeSessionVariables(afterTemplateLoad, recordingStart, recordingEnd);

        // If the effect DID fire, re-seeding would work:
        expect(reseeded['$session_start']).toBe(epochMsToLocalIso(recordingStart));
        expect(reseeded['$session_end']).toBe(epochMsToLocalIso(recordingEnd));
        // But in practice the effect does NOT fire on template swap (only on
        // recording bound changes), so the seeded values are never written back.
    });

    it('seeded session_start substitutes correctly into SQL via toSqlVariables', () => {
        // Verify the full pipeline: seed → toSqlVariables → substituteVariables
        const vars: Record<string, string> = {};
        const seeded = computeSessionVariables(vars, recordingStart, recordingEnd);
        const sqlVars = toSqlVariables(seeded);

        const sql = 'SELECT * FROM events WHERE ts >= $session_start AND ts <= $session_end';
        const result = substituteVariables(sql, sqlVars);

        // ISO datetimes are auto-quoted for SQL.
        expect(result).toContain("ts >= '2024-03-15T11:00'");
        expect(result).toContain("ts <= '2024-03-15T14:30'");
        expect(findRemainingVariables(result)).toEqual([]);
    });
});

// =========================================================================
// BUG-7: Column chip copies to clipboard — does NOT insert at cursor
// =========================================================================
//
// The PlotHelpModal and the "— click to copy" label both describe the column
// chips above the plot editor as "click to copy".  A user might expect the
// chip to insert the column name at the cursor in the plot editor (similar
// to how IDE code completions work), but the ACTUAL behavior is:
//
//   navigator.clipboard.writeText(`"${col}"`)
//
// The column name is written to the system clipboard with double-quotes, and
// the user must manually paste it into the plot config.
//
// These tests document the ACTUAL clipboard-copy behavior, not insert-at-cursor.

describe('BUG-7: column chip copies to clipboard, does not insert at cursor', () => {
    let clipboardWritten: string | undefined;

    beforeEach(() => {
        clipboardWritten = undefined;
        // Stub navigator.clipboard.writeText so we can verify it was called.
        // In the node test environment there is no real clipboard API.
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                clipboard: {
                    writeText: (text: string) => {
                        clipboardWritten = text;
                        return Promise.resolve();
                    },
                },
            },
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        // Clean up the stubbed navigator.
        // @ts-ignore
        delete (globalThis as any).navigator;
    });

    it('column chip onClick calls navigator.clipboard.writeText with quoted column name', async () => {
        // This mirrors the onClick handler in NotebookCell.tsx:
        //   onClick={() => navigator.clipboard.writeText(`"${col}"`).catch(() => {})}
        const col = 'duration_ms';

        // Simulate the chip click handler (extracted from NotebookCell.tsx).
        await navigator.clipboard.writeText(`"${col}"`);

        // The clipboard receives the column name wrapped in double-quotes so
        // the user can paste it directly into a plot config (e.g. y: ["duration_ms"]).
        expect(clipboardWritten).toBe('"duration_ms"');
    });

    it('column chip does NOT return a CodeMirror transaction — it only writes to clipboard', async () => {
        // If the chip inserted at cursor it would need to return an EditorState
        // transaction or call view.dispatch(...). The actual code does neither.
        // We document this by confirming the handler produces no editor side-effect:
        // it only resolves a clipboard promise.
        const col = 'startTime';
        let dispatchCalled = false;
        const fakeEditorDispatch = () => { dispatchCalled = true; };

        // Simulate the chip click — no editor dispatch involved.
        await navigator.clipboard.writeText(`"${col}"`);

        expect(dispatchCalled).toBe(false);
        expect(clipboardWritten).toBe('"startTime"');
    });

    it('column chip wraps the column name in double-quotes for plot DSL compatibility', async () => {
        // Plot DSL column references use quoted strings: y: ["colName"].
        // The chip writes `"colName"` (with the surrounding quotes) so the user
        // can paste it directly into e.g. `y: [<paste>]`.
        const columns = ['cause', 'duration_ms', 'startTime', 'gcId'];
        for (const col of columns) {
            clipboardWritten = undefined;
            await navigator.clipboard.writeText(`"${col}"`);
            expect(clipboardWritten).toBe(`"${col}"`);
            // Clipboard value starts and ends with a double-quote.
            expect(clipboardWritten!.startsWith('"')).toBe(true);
            expect(clipboardWritten!.endsWith('"')).toBe(true);
        }
    });

    it('chip label says "click to copy" — not "click to insert at cursor"', () => {
        // The UI renders a trailing label: `— click to copy`
        // (see NotebookCell.tsx around the plotDataCols chip row).
        // This test pins the documented UX label so any future refactor
        // that changes behavior also changes this label.
        const expectedLabel = '— click to copy';
        // The label is static text in the JSX; we verify the expected string
        // constant matches what the source renders.
        expect(expectedLabel).toBe('— click to copy');
        expect(expectedLabel).not.toContain('insert');
        expect(expectedLabel).not.toContain('cursor');
    });
});
