// Complex multi-feature scenarios — these go beyond per-feature unit tests
// and pin behavior at the seams between features.
//
// Each test composes the real APIs (parsing, substitution, dependency
// extraction, condition evaluation) the way a notebook does at runtime:
//
//   1. Parse a full notebook with frontmatter (views, macros, $$vars,
//      cellConditions) and cells with their own ```variables``` blocks.
//   2. Track which cells expose which aliases and which variables.
//   3. Build the cross-cell dependency graph using `extractReferences`.
//   4. Substitute variables and run `evaluateCondition` for `{if}` blocks
//      against a stub DuckDB that returns canned rows.
//
// No React rendering — these stay fast and deterministic.

import { describe, it, expect } from 'vitest';
import {
    tokenizeCellContent,
    parseCellContent,
    parseNotebook,
    reconstructNotebook,
    parseCellDirective,
} from '../utils/notebookParser';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import {
    substituteVariables,
    toSqlVariables,
    findRemainingVariables,
} from '../utils/variableSubstitution';
import { parseComposite, parsePlotCall } from '../utils/plotParser';
import { extractReferences } from '../services/templating/dependencies';
import { evaluateCondition, evaluateScalar } from '../services/templating/evaluators';
import type { NotebookCellData } from '../types';

// =========================================================================
// Helpers — make complex cell content readable.
// =========================================================================

function cellWith(opts: {
    id: string;
    title?: string;
    intro?: string;
    name?: string;
    variables?: Record<string, string>;
    sql?: Array<{ alias?: string; materialized?: boolean; body: string; plot?: string }>;
    ifBlocks?: Array<{ condition: string; body: string }>;
    conclusion?: string;
}): NotebookCellData {
    const parts: string[] = [];
    if (opts.name) parts.push(`<!-- @cell name="${opts.name}" -->\n`);
    if (opts.title) parts.push(`## ${opts.title}\n\n`);
    if (opts.intro) parts.push(`${opts.intro}\n\n`);
    if (opts.variables) {
        parts.push('```variables\n' +
            Object.entries(opts.variables).map(([k, v]) => `${k} = ${v}`).join('\n') +
            '\n```\n\n');
    }
    for (const s of opts.sql ?? []) {
        const aliasLine = s.alias
            ? `-- alias ${s.alias}${s.materialized ? ' materialized' : ''}\n`
            : '';
        parts.push('```sql\n' + aliasLine + s.body + '\n```\n\n');
        if (s.plot) parts.push('```plot\n' + s.plot + '\n```\n\n');
    }
    for (const cond of opts.ifBlocks ?? []) {
        parts.push('```{if ' + cond.condition + '}\n' + cond.body + '\n```\n\n');
    }
    if (opts.conclusion) parts.push(opts.conclusion + '\n');
    return { id: opts.id, title: opts.title ?? '', name: opts.name, content: parts.join('') };
}

// Mock DuckDB: maps a SQL string to a canned response.
type QueryMap = Record<string, any[]>;
function mockQuery(map: QueryMap, opts: { failOn?: string[] } = {}) {
    return async (sql: string): Promise<any[]> => {
        if (opts.failOn?.some(p => sql.includes(p))) {
            throw new Error(`mock failure for SQL containing: ${opts.failOn.find(p => sql.includes(p))}`);
        }
        // Exact-match first, then prefix-match.
        if (sql in map) return map[sql];
        for (const k of Object.keys(map)) if (sql.startsWith(k)) return map[k];
        return [];
    };
}

// =========================================================================
// 1. Frontmatter — views, macros, $$variables, cellConditions
// =========================================================================

describe('frontmatter — views, macros, global vars, cell conditions', () => {
    const NB = [
        '---',
        'views:',
        '  - id: v_gc',
        '    name: gc_view',
        '    sql: |',
        '      SELECT * FROM gc_pauses WHERE duration > 100',
        'macros:',
        '  - id: m_top',
        '    name: top_n',
        '    sql: |',
        '      SELECT * FROM $table ORDER BY $col DESC LIMIT $n',
        'variables:',
        '  $$threshold: "1000"',
        '  $$watched: "A,B,C"',
        'cellConditions:',
        '  detail_cell: |',
        '    SELECT count(*) > 0 FROM gc_pauses',
        'timeFormat: "ISO"',
        'decimalPlaces: 3',
        '---',
        '## My Notebook',
        '',
        '```sql',
        '-- alias gc_summary',
        'SELECT * FROM gc_view',
        '```',
        '',
    ].join('\n');

    it('parses every frontmatter section into metadata', () => {
        const nb = parseNotebook(NB);
        expect(nb.metadata.views?.[0]?.name).toBe('gc_view');
        expect(nb.metadata.views?.[0]?.sql).toContain('FROM gc_pauses');
        expect(nb.metadata.macros?.[0]?.name).toBe('top_n');
        expect(nb.metadata.macros?.[0]?.sql).toContain('LIMIT $n');
        expect(nb.metadata.variables).toMatchObject({ '$$threshold': '1000', '$$watched': 'A,B,C' });
        expect(nb.metadata.cellConditions?.['detail_cell']).toContain('count(*) > 0');
        expect(nb.metadata.timeFormat).toBe('ISO');
        expect(nb.metadata.decimalPlaces).toBe(3);
    });

    it('round-trips frontmatter losslessly through reconstructNotebook', () => {
        const nb = parseNotebook(NB);
        const back = reconstructNotebook(nb);
        const reparsed = parseNotebook(back);
        expect(reparsed.metadata.views?.[0]?.name).toBe('gc_view');
        expect(reparsed.metadata.macros?.[0]?.name).toBe('top_n');
        expect(reparsed.metadata.variables).toEqual(nb.metadata.variables);
        expect(reparsed.metadata.cellConditions).toEqual(nb.metadata.cellConditions);
    });

    it('notebook with NO frontmatter still parses cleanly', () => {
        const nb = parseNotebook('## Just a title\n\nSome content.');
        expect(nb.metadata.views).toEqual([]);
        expect(nb.metadata.macros).toEqual([]);
        expect(nb.content).toContain('## Just a title');
    });

    it('frontmatter with extra unknown keys preserves them in rest', () => {
        const nb = parseNotebook([
            '---',
            'customSystemPrompt: "Be concise."',
            'views: []',
            'macros: []',
            '---',
            '# x',
        ].join('\n'));
        expect(nb.metadata.customSystemPrompt).toBe('Be concise.');
    });
});

// =========================================================================
// 2. Conditional rendering — `{if SELECT ...}` blocks evaluated against DuckDB
// =========================================================================

describe('{if} block evaluation — runs SQL against the DB and gates body rendering', () => {
    it('truthy scalar shows the body', async () => {
        const q = mockQuery({ 'SELECT 1': [{ '?column?': 1 }] });
        const r = await evaluateCondition(q, 'SELECT 1');
        expect(r).toEqual({ kind: 'ok', value: true });
    });

    it('zero-row response is false (no rows = condition not met)', async () => {
        const q = mockQuery({});
        const r = await evaluateCondition(q, 'SELECT count(*) FROM empty_table');
        expect(r).toEqual({ kind: 'ok', value: false });
    });

    it('numeric 0 / BigInt 0 / null / "false" / "0" are all falsy', async () => {
        const cases = [
            [{ x: 0 }], [{ x: 0n }], [{ x: null }],
            [{ x: 'false' }], [{ x: '0' }], [{ x: '' }],
        ];
        for (const rows of cases) {
            const r = await evaluateCondition(mockQuery({ 'SELECT x': rows }), 'SELECT x');
            expect(r).toEqual({ kind: 'ok', value: false });
        }
    });

    it('BigInt nonzero / nonzero number / nonempty string / true are truthy', async () => {
        const cases = [
            [{ x: 1 }], [{ x: 42n }], [{ x: 'hello' }], [{ x: true }],
        ];
        for (const rows of cases) {
            const r = await evaluateCondition(mockQuery({ 'SELECT x': rows }), 'SELECT x');
            expect(r).toEqual({ kind: 'ok', value: true });
        }
    });

    it('SQL error becomes a structured error result, not a throw', async () => {
        const q = mockQuery({}, { failOn: ['bogus'] });
        const r = await evaluateCondition(q, 'SELECT * FROM bogus_table');
        expect(r.kind).toBe('error');
        if (r.kind === 'error') expect(r.message).toMatch(/mock failure/);
    });

    it('empty SQL trims to "" → false (condition explicitly disabled)', async () => {
        const r = await evaluateCondition(mockQuery({}), '   ');
        expect(r).toEqual({ kind: 'ok', value: false });
    });

    it('end-to-end: `{if}` body with $-substituted SQL gates on a global threshold', async () => {
        // Author writes: ```{if SELECT count(*) > $$min FROM gc}``` followed by body.
        // We simulate: substitute $$min, then evaluate.
        const conditionRaw = 'SELECT count(*) > $$min FROM gc';
        const conditionSql = substituteVariables(conditionRaw, { '$$min': '10' });
        expect(conditionSql).toBe('SELECT count(*) > 10 FROM gc');

        const q = mockQuery({ 'SELECT count(*) > 10 FROM gc': [{ x: true }] });
        const r = await evaluateCondition(q, conditionSql);
        expect(r).toEqual({ kind: 'ok', value: true });
    });
});

// =========================================================================
// 3. Inline `{{expr}}` scalar evaluation in markdown
// =========================================================================

describe('scalar substitution — `{{SELECT …}}` resolves to a single value', () => {
    it('returns the first-row first-column scalar', async () => {
        const q = mockQuery({ 'SELECT count(*) FROM gc': [{ c: 42 }] });
        const r = await evaluateScalar(q, 'SELECT count(*) FROM gc');
        expect(r).toEqual({ kind: 'ok', value: 42 });
    });

    it('returns "empty" on zero rows (so the renderer can show a placeholder)', async () => {
        const r = await evaluateScalar(mockQuery({}), 'SELECT x FROM empty');
        expect(r).toEqual({ kind: 'empty' });
    });

    it('error case preserves the underlying message', async () => {
        const q = mockQuery({}, { failOn: ['DROP'] });
        const r = await evaluateScalar(q, 'DROP TABLE foo');
        expect(r.kind).toBe('error');
    });

    it('handles BigInt scalars without coercion (renderer formats them)', async () => {
        const q = mockQuery({ 'SELECT n': [{ n: 9007199254740993n }] });
        const r = await evaluateScalar(q, 'SELECT n');
        expect(r).toEqual({ kind: 'ok', value: 9007199254740993n });
    });
});

// =========================================================================
// 4. Cross-cell dependency graph via extractReferences
// =========================================================================

describe('dependency extraction — which aliases and variables a SQL block consumes', () => {
    it('finds bare table refs', () => {
        const refs = extractReferences('SELECT * FROM gc_pauses JOIN allocations USING (ts)');
        const bare = refs.filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toEqual(expect.arrayContaining(['gc_pauses', 'allocations']));
    });

    it('finds variable refs (both $local and $$global)', () => {
        const refs = extractReferences('SELECT * FROM t WHERE x = $threshold AND y > $$min');
        const vars = refs.filter(r => r.kind === 'variable') as any[];
        expect(vars).toContainEqual({ kind: 'variable', name: 'threshold', scoped: false });
        expect(vars).toContainEqual({ kind: 'variable', name: 'min', scoped: true });
    });

    it('ignores keywords and aggregate function names', () => {
        const refs = extractReferences('SELECT count(*), sum(x), avg(y) FROM events');
        const bare = refs.filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toContain('events');
        expect(bare).not.toContain('count');
        expect(bare).not.toContain('sum');
        expect(bare).not.toContain('select');
    });

    it('strips string literals so they do not pollute refs', () => {
        const refs = extractReferences("SELECT * FROM users WHERE name = 'fake_table_name'");
        const bare = refs.filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toContain('users');
        expect(bare).not.toContain('fake_table_name');
    });

    it('strips line and block comments', () => {
        const sql = `
            -- references commented_out_table
            SELECT * FROM real_table /* and not block_commented_table */
        `;
        const bare = extractReferences(sql).filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toContain('real_table');
        expect(bare).not.toContain('commented_out_table');
        expect(bare).not.toContain('block_commented_table');
    });

    it('deduplicates references (each (kind, name) appears once)', () => {
        const refs = extractReferences('SELECT * FROM t WHERE x=$v OR y=$v UNION SELECT * FROM t');
        const vars = refs.filter(r => r.kind === 'variable').filter((r: any) => r.name === 'v');
        expect(vars.length).toBe(1);
        const tables = refs.filter(r => r.kind === 'bare').filter((r: any) => r.name === 't');
        expect(tables.length).toBe(1);
    });
});

// =========================================================================
// 5. Full multi-cell dependency walk — alias chains
// =========================================================================

describe('multi-cell alias chain — A defines q_a → B reads q_a → C reads q_b', () => {
    // Author writes three cells:
    //   Cell A (alias q_a): SELECT * FROM events
    //   Cell B (alias q_b): SELECT count(*) FROM q_a WHERE duration > $threshold
    //   Cell C: SELECT * FROM q_b ORDER BY count DESC LIMIT $$top
    // We should be able to derive the DAG: C → q_b → q_a → events.

    const cellA = cellWith({
        id: 'A', title: 'Source',
        sql: [{ alias: 'q_a', body: 'SELECT ts, duration FROM events' }],
    });
    const cellB = cellWith({
        id: 'B', title: 'Filter',
        variables: { '$threshold': '500' },
        sql: [{ alias: 'q_b', body: 'SELECT count(*) AS n, ts FROM q_a WHERE duration > $threshold GROUP BY ts' }],
    });
    const cellC = cellWith({
        id: 'C', title: 'Top',
        sql: [{ body: 'SELECT * FROM q_b ORDER BY n DESC LIMIT $$top' }],
    });

    it('cell B depends on q_a and on $threshold', () => {
        const parsed = parseCellContent(tokenizeCellContent(cellB.content));
        const refs = extractReferences(parsed.sqlBlocks[0]);
        const bare = refs.filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toContain('q_a');
        const vars = refs.filter(r => r.kind === 'variable') as any[];
        expect(vars.find(v => v.name === 'threshold' && !v.scoped)).toBeDefined();
    });

    it('cell C depends on q_b and on the global $$top', () => {
        const parsed = parseCellContent(tokenizeCellContent(cellC.content));
        const refs = extractReferences(parsed.sqlBlocks[0]);
        const bare = refs.filter(r => r.kind === 'bare').map(r => (r as any).name);
        expect(bare).toContain('q_b');
        const vars = refs.filter(r => r.kind === 'variable') as any[];
        expect(vars.find(v => v.name === 'top' && v.scoped)).toBeDefined();
    });

    it('substituting B with $threshold from its own variables and C with $$top from globals', () => {
        const parsedB = parseCellContent(tokenizeCellContent(cellB.content));
        const subB = substituteVariables(parsedB.sqlBlocks[0], parsedB.variables);
        expect(subB).toContain('duration > 500');
        expect(findRemainingVariables(subB)).toEqual([]);

        const parsedC = parseCellContent(tokenizeCellContent(cellC.content));
        const subC = substituteVariables(parsedC.sqlBlocks[0], { '$$top': '10' });
        expect(subC).toContain('LIMIT 10');
    });
});

// =========================================================================
// 6. Cross-cell with cell-qualified `$Cell.var` AND materialized aliases
// =========================================================================

describe('cross-cell with @cell name directives + materialized aliases', () => {
    // Author writes:
    //   <!-- @cell name="overview" -->
    //   ## Overview Bounds
    //   ```variables
    //   $lo = 0
    //   $hi = 1000
    //   ```
    //   ```sql
    //   -- alias bounds_view materialized
    //   SELECT $lo AS lo, $hi AS hi
    //   ```
    // and a later cell referencing $overview.lo / bounds_view.

    const overview = cellWith({
        id: 'cell-1',
        name: 'overview',
        title: 'Overview Bounds',
        variables: { '$lo': '0', '$hi': '1000' },
        sql: [{ alias: 'bounds_view', materialized: true, body: 'SELECT $lo AS lo, $hi AS hi' }],
    });

    const detail = cellWith({
        id: 'cell-2',
        title: 'Detail',
        sql: [{
            body: 'SELECT * FROM events, bounds_view WHERE duration BETWEEN $Overview Bounds.lo AND $Overview Bounds.hi',
        }],
    });

    it('parseCellDirective extracts the @cell name', () => {
        const dir = parseCellDirective('<!-- @cell name="overview" -->\n## Title');
        expect(dir?.name).toBe('overview');
    });

    it('materialized flag survives parse + reconstruct', () => {
        const parsed = parseCellContent(tokenizeCellContent(overview.content));
        expect(parsed.queryAliases).toEqual(['bounds_view']);
        expect(parsed.queryAliasMaterialized).toEqual([true]);
    });

    it('detail cell references bounds_view (alias) and the qualified $Overview Bounds.lo/hi', () => {
        const parsed = parseCellContent(tokenizeCellContent(detail.content));
        // collectPrecedingCellVariables uses cell.title to build the qualified
        // prefix, so titles with spaces are valid keys.
        const cross = collectPrecedingCellVariables([overview, detail], 'cell-2');
        expect(cross['$Overview Bounds.lo']).toBe('0');
        expect(cross['$Overview Bounds.hi']).toBe('1000');

        const sub = substituteVariables(parsed.sqlBlocks[0], cross);
        expect(sub).toContain('BETWEEN 0 AND 1000');
        expect(sub).toContain('bounds_view');
    });
});

// =========================================================================
// 7. Plot interdependencies — composite with cross-query brushes
// =========================================================================

describe('plot interdependencies — composite + multi-query + brush + tooltip', () => {
    it('OVERLAY of two queries: bar(ON q_a) + line(ON q_b) shares one cell', () => {
        const parsed = parseComposite(
            'BAR_CHART(x: "t", y: ["count"]) ON q_a + LINE_CHART(x: "t", y: ["p99"]) ON q_b',
        );
        expect(parsed.composite?.direction).toBe('overlay');
        expect(parsed.composite?.children[0].on).toEqual(['q_a']);
        expect(parsed.composite?.children[1].on).toEqual(['q_b']);
    });

    it('a brushable parent plot exposes brush vars used by a downstream cell', () => {
        // Cell A: plot with `BRUSH "$sel" MODE X`
        const cellA = cellWith({
            id: 'A', title: 'Range',
            sql: [{ alias: 'rng', body: 'SELECT ts, val FROM events', plot: 'LINE_CHART(x: "ts", y: ["val"]) ON rng BRUSH "$sel" MODE X' }],
        });
        // Cell B: SQL consumes $sel.brush.lo / $sel.brush.hi
        const cellB = cellWith({
            id: 'B', title: 'Detail',
            sql: [{ body: 'SELECT * FROM events WHERE ts BETWEEN $sel.brush.lo AND $sel.brush.hi' }],
        });

        const parsedA = parseCellContent(tokenizeCellContent(cellA.content));
        const callA = parsePlotCall(parsedA.plotBlocks[0]);
        expect(callA.brush?.name).toBe('$sel');

        // Cell B's SQL has unresolved dotted vars until the brush emits values.
        const parsedB = parseCellContent(tokenizeCellContent(cellB.content));
        expect(findRemainingVariables(parsedB.sqlBlocks[0])).toEqual(
            expect.arrayContaining(['$sel.brush.lo', '$sel.brush.hi']),
        );
    });

    it('a plot with TOOLTIP COLUMNS and ON HOVER TOOLTIP attaches both', () => {
        const call = parsePlotCall(
            'LINE_CHART(x: "t", y: ["v"]) TOOLTIP COLUMNS ["host", "region"] ON HOVER TOOLTIP "v={{v}}"',
        );
        expect(call.tooltipColumns).toEqual(['host', 'region']);
        expect(call.onHoverTooltip).toBe('v={{v}}');
    });

    it('a deeply-nested composite parses + recovers every leaf\'s ON ref', () => {
        // ROW( COL(plot ON q_a, plot ON q_b), plot ON q_c + plot ON q_d )
        const parsed = parseComposite(
            'ROW(' +
            '  COL(BAR_CHART(x: "t", y: ["v"]) ON q_a, LINE_CHART(x: "t", y: ["v"]) ON q_b),' +
            '  AREA_CHART(x: "t", y: ["v"]) ON q_c + SCATTER_PLOT(x: "x", y: "y") ON q_d' +
            ')',
        );
        const collectRefs = (node: any): string[] => {
            if (node.composite) return node.composite.children.flatMap(collectRefs);
            return node.on ?? [];
        };
        expect(collectRefs(parsed).sort()).toEqual(['q_a', 'q_b', 'q_c', 'q_d']);
    });
});

// =========================================================================
// 8. Conflict scenarios — duplicate aliases, shadowed vars, self-reference
// =========================================================================

describe('conflict scenarios — shadowing, duplication, self-reference', () => {
    it('local $var shadows cross-cell $Other.var of the same suffix', () => {
        const otherCell = cellWith({
            id: 'o', title: 'Other',
            variables: { '$x': 'OTHER' },
        });
        const me = cellWith({
            id: 'm', title: 'Me',
            variables: { '$x': 'LOCAL' },
            sql: [{ body: 'SELECT $x, $Other.x' }],
        });
        const cross = collectPrecedingCellVariables([otherCell, me], 'm');
        const parsed = parseCellContent(tokenizeCellContent(me.content));
        const all = { ...cross, ...parsed.variables };
        const sub = substituteVariables(parsed.sqlBlocks[0], all);
        expect(sub).toBe('SELECT LOCAL, OTHER');
    });

    it('two SQL blocks with the SAME alias both appear in queryAliases — caller picks resolution policy', () => {
        // The parser does not de-duplicate. Downstream code is responsible for
        // detecting collisions and warning the user. We pin the current
        // behavior so a future change is a conscious decision.
        const c = cellWith({
            id: 'dup', title: 'Dup',
            sql: [
                { alias: 'q', body: 'SELECT 1' },
                { alias: 'q', body: 'SELECT 2' },
            ],
        });
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        expect(parsed.queryAliases).toEqual(['q', 'q']);
        expect(parsed.sqlBlocks.length).toBe(2);
    });

    it('a notebook variable shadowed by an app-injected variable: app wins (caller-decided merge order)', () => {
        // The merge order is the caller's responsibility — we just confirm the
        // substituteVariables() doesn't have hidden precedence rules.
        const notebookVars = { '$$x': 'NB' };
        const appVars = { '$$x': 'APP' };

        const sub1 = substituteVariables('SELECT $$x', { ...notebookVars, ...appVars });
        expect(sub1).toBe('SELECT APP');

        const sub2 = substituteVariables('SELECT $$x', { ...appVars, ...notebookVars });
        expect(sub2).toBe('SELECT NB');
    });

    it('a $var that resolves to "$var" creates a 1-step fixpoint with itself', () => {
        // $a = $a → after the first pass nothing changes; we exit cleanly.
        const out = substituteVariables('SELECT $a', { '$a': '$a' });
        expect(out).toBe('SELECT $a');
        // The unresolved var is still detectable.
        expect(findRemainingVariables(out)).toEqual(['$a']);
    });
});

// =========================================================================
// 9. Mixed pipeline — frontmatter $$vars + cell $vars + brush + condition
// =========================================================================

describe('mixed pipeline — frontmatter, cell vars, brush, conditional, plot all together', () => {
    it('full author workflow: gated detail cell with brushable parent', async () => {
        // === Author writes ===
        const cellRange = cellWith({
            id: 'r', title: 'Range Selector',
            sql: [{
                alias: 'all_events',
                body: 'SELECT ts, duration FROM events WHERE duration >= $$min_dur',
                plot: 'LINE_CHART(x: "ts", y: ["duration"]) ON all_events BRUSH "$range" MODE X',
            }],
        });
        const cellDetail = cellWith({
            id: 'd', title: 'Detail',
            name: 'detail_cell',
            ifBlocks: [{
                condition: 'SELECT count(*) > 0 FROM all_events WHERE ts BETWEEN $range.brush.lo AND $range.brush.hi',
                body: 'Showing detailed breakdown for the selected range.',
            }],
            sql: [{
                body: 'SELECT cause, count(*) FROM events WHERE ts BETWEEN $range.brush.lo AND $range.brush.hi GROUP BY cause',
                plot: 'BAR_CHART(x: "cause", y: ["count"]) TITLE "Causes in Range"',
            }],
        });

        // === Runtime substitutes ===
        const globals = { '$$min_dur': '50' };
        const brushState = { '$range.brush.lo': "'2026-01-01'", '$range.brush.hi': "'2026-01-31'" };

        // Parent plot is parsed: confirm clauses are intact.
        const parsedR = parseCellContent(tokenizeCellContent(cellRange.content));
        const rangeSql = substituteVariables(parsedR.sqlBlocks[0], globals);
        expect(rangeSql).toContain('duration >= 50');

        const rangePlot = parsePlotCall(parsedR.plotBlocks[0]);
        expect(rangePlot.brush?.name).toBe('$range');
        expect(rangePlot.brush?.mode).toBe('x');

        // Detail cell's `{if}` body evaluates against current brush state.
        const parsedD = parseCellContent(tokenizeCellContent(cellDetail.content));
        const segs = tokenizeCellContent(cellDetail.content);
        const ifSeg = segs.find(s => s.type === 'if');
        expect(ifSeg).toBeDefined();
        if (ifSeg && ifSeg.type === 'if') {
            const condResolved = substituteVariables(
                ifSeg.condition,
                { ...globals, ...brushState },
            );
            expect(condResolved).toContain("BETWEEN '2026-01-01' AND '2026-01-31'");
            // Evaluator with canned response:
            const q = mockQuery({}); // returns []
            const result = await evaluateCondition(q, condResolved);
            expect(result.kind).toBe('ok');
            // 0 rows → false: detail body should be hidden.
            if (result.kind === 'ok') expect(result.value).toBe(false);
        }

        // Detail SQL gets brush-substituted.
        const detailSql = substituteVariables(parsedD.sqlBlocks[0], brushState);
        expect(detailSql).toContain("BETWEEN '2026-01-01' AND '2026-01-31'");

        // Plot stays intact.
        const detailPlot = parsePlotCall(parsedD.plotBlocks[0]);
        expect(detailPlot.title).toBe('Causes in Range');
    });

    it('app-injected ISO timestamps + $$global + local $vars all coexist in one SQL', () => {
        const sql = 'SELECT * FROM e WHERE ts BETWEEN $session_start AND $session_end ' +
                    'AND duration > $$min AND user = $current_user';
        const merged = {
            ...toSqlVariables({ session_start: '2026-06-01T00:00', session_end: '2026-06-30T23:59' }),
            '$$min': '100',
            '$current_user': "'alice'",
        };
        const out = substituteVariables(sql, merged);
        expect(out).toContain("BETWEEN '2026-06-01T00:00' AND '2026-06-30T23:59'");
        expect(out).toContain('duration > 100');
        expect(out).toContain("user = 'alice'");
        expect(findRemainingVariables(out)).toEqual([]);
    });
});

// =========================================================================
// 10. Adversarial inputs — what the parser must NOT crash on
// =========================================================================

describe('adversarial input — malformed authors / model outputs', () => {
    it('unclosed code fence is captured to end-of-content as markdown (not silently dropped)', () => {
        const content = '## Bad\n\n```sql\nSELECT 1\n\nNo closing fence here.';
        const segs = tokenizeCellContent(content);
        // No matched sql block → no sql segment.
        expect(segs.find(s => s.type === 'sql')).toBeUndefined();
        // The unclosed fence content lives in the trailing markdown segment.
        const md = segs.filter(s => s.type === 'markdown').map(s => s.content).join('');
        expect(md).toContain('SELECT 1');
    });

    it('plot DSL with mismatched parens does not throw at parse time — error surfaces at validation', () => {
        // The lightweight parser tolerates this; downstream plotValidator
        // raises the structured error. We confirm no crash here.
        expect(() => parsePlotCall('BAR_CHART(x: "t", y: ["y"')).not.toThrow();
    });

    it('extremely long variable substitution does not pathologically slow down', () => {
        const longVal = 'x'.repeat(50_000);
        const sql = 'SELECT $a';
        const t0 = Date.now();
        const out = substituteVariables(sql, { '$a': longVal });
        const elapsed = Date.now() - t0;
        expect(out.length).toBeGreaterThan(50_000);
        expect(elapsed).toBeLessThan(100); // generous; should be <10ms in practice
    });

    it('extractReferences on a 10kb SQL stays linear (no regex catastrophe)', () => {
        const sql = 'SELECT ' + Array.from({ length: 500 }, (_, i) => `t${i}.col`).join(', ') +
                    ' FROM ' + Array.from({ length: 500 }, (_, i) => `tbl${i} t${i}`).join(', ');
        const t0 = Date.now();
        const refs = extractReferences(sql);
        const elapsed = Date.now() - t0;
        expect(refs.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(200);
    });

    it('substituteVariables with an EMPTY variables map is a no-op (fast path)', () => {
        const sql = 'SELECT * FROM t WHERE $x = $y';
        expect(substituteVariables(sql, {})).toBe(sql);
    });
});
