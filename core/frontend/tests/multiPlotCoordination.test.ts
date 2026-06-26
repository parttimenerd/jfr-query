/**
 * Multi-plot cross-cell coordination tests.
 *
 * Exercises the full chain that lets multiple plots from different cells
 * share zoom ranges (LINK_X) and brush selections (BRUSH + IN $sel.brush):
 *
 *   Cell A: LINE_CHART(x: ts, y: val) LINK_X($start, $end) BRUSH "$sel" MODE X
 *   Cell B: SELECT * FROM events WHERE ts IN $sel.brush
 *   Cell B: SELECT * FROM events WHERE ts BETWEEN $start AND $end
 *
 * Also tests the LINK-Y / LINK-XY Y-axis domain sync via plotBrushStore.
 */

import { describe, it, expect } from 'vitest';
import { expandBrushOperator } from '../services/variableExpander';
import { substituteVariables, findRemainingVariables } from '../utils/variableSubstitution';
import { parsePlotCall } from '../utils/plotParser';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import { plotBrushStore } from '../services/plotBrushStore';
import type { NotebookCellData } from '../types';

// ---------------------------------------------------------------------------
// Part 1: BRUSH variable wiring (expandBrushOperator + substituteVariables)
// ---------------------------------------------------------------------------

describe('BRUSH → SQL chain', () => {
    it('expands IN $sel.brush and substitutes lo/hi values fully', () => {
        const vars = { '$sel.brush.lo': '1000', '$sel.brush.hi': '2000' };
        const sql = 'SELECT * FROM events WHERE ts IN $sel.brush';
        const expanded = expandBrushOperator(sql, vars);
        expect(expanded).toBe('SELECT * FROM events WHERE ts BETWEEN $sel.brush.lo AND $sel.brush.hi');
        const substituted = substituteVariables(expanded, vars);
        expect(substituted).toBe('SELECT * FROM events WHERE ts BETWEEN 1000 AND 2000');
    });

    it('leaves IN $sel.brush intact and marks unresolved when brush not set', () => {
        const vars: Record<string, string> = {};
        const sql = 'SELECT * FROM events WHERE ts IN $sel.brush';
        const expanded = expandBrushOperator(sql, vars);
        // Not expanded — brush not set
        expect(expanded).toBe(sql);
        // findRemainingVariables sees the unresolved $sel.brush token
        expect(findRemainingVariables(expanded)).toContain('$sel.brush');
    });

    it('handles multiple brushes in the same SQL', () => {
        const vars = {
            '$a.brush.lo': '10', '$a.brush.hi': '20',
            '$b.brush.lo': '30', '$b.brush.hi': '40',
        };
        const sql = 'SELECT * FROM t WHERE x IN $a.brush AND y IN $b.brush';
        const expanded = expandBrushOperator(sql, vars);
        const substituted = substituteVariables(expanded, vars);
        expect(substituted).toBe('SELECT * FROM t WHERE x BETWEEN 10 AND 20 AND y BETWEEN 30 AND 40');
    });

    it('partial brush (only $a.brush set) expands $a.brush but leaves $b.brush', () => {
        const vars = { '$a.brush.lo': '10', '$a.brush.hi': '20' };
        const sql = 'WHERE x IN $a.brush AND y IN $b.brush';
        const expanded = expandBrushOperator(sql, vars);
        expect(expanded).toContain('BETWEEN $a.brush.lo AND $a.brush.hi');
        expect(expanded).toContain('IN $b.brush');
        // $b.brush remains unresolved — findRemainingVariables catches it
        const substituted = substituteVariables(expanded, vars);
        expect(findRemainingVariables(substituted)).toContain('$b.brush');
    });
});

// ---------------------------------------------------------------------------
// Part 2: LINK_X variable flow (metadata.variables → allVariables → SQL)
// ---------------------------------------------------------------------------

describe('LINK_X variable substitution chain', () => {
    it('substitutes LINK_X zoom variables in WHERE clause', () => {
        // Simulate: cell A's LINK_X gesture writes $start/$end to its metadata.variables
        // Cell B reads them via allVariables and uses them in WHERE clause
        const vars = { '$start': '1000000000', '$end': '2000000000' };
        const sql = 'SELECT * FROM gc_pauses WHERE ts BETWEEN $start AND $end';
        const substituted = substituteVariables(sql, vars);
        expect(substituted).toBe('SELECT * FROM gc_pauses WHERE ts BETWEEN 1000000000 AND 2000000000');
    });

    it('leaves SQL unchanged when zoom variables not yet set', () => {
        const vars: Record<string, string> = {};
        const sql = 'SELECT * FROM t WHERE ts > $start AND ts < $end';
        const substituted = substituteVariables(sql, vars);
        expect(substituted).toBe(sql);
        const remaining = findRemainingVariables(substituted);
        expect(remaining).toContain('$start');
        expect(remaining).toContain('$end');
    });

    it('cross-cell LINK_X: preceding cell variables are addressable as $Title.varName', () => {
        const cells: NotebookCellData[] = [
            {
                id: 'cell-a',
                title: 'Overview',
                content: `## Overview\n\`\`\`variables\n$start = 1000000000\n$end = 2000000000\n\`\`\``,
            },
            {
                id: 'cell-b',
                title: 'Detail',
                content: '## Detail',
            },
        ];
        const precedingVars = collectPrecedingCellVariables(cells, 'cell-b');
        expect(precedingVars['$Overview.start']).toBe('1000000000');
        expect(precedingVars['$Overview.end']).toBe('2000000000');
    });

    it('cross-cell reference in SQL substitutes correctly', () => {
        const vars = {
            '$Overview.start': '1000000000',
            '$Overview.end': '2000000000',
        };
        const sql = 'SELECT * FROM detail WHERE ts BETWEEN $Overview.start AND $Overview.end';
        const substituted = substituteVariables(sql, vars);
        expect(substituted).toBe('SELECT * FROM detail WHERE ts BETWEEN 1000000000 AND 2000000000');
    });
});

// ---------------------------------------------------------------------------
// Part 3: parsePlotCall — LINK_X and BRUSH clause parsing
// ---------------------------------------------------------------------------

describe('parsePlotCall — LINK_X and BRUSH parsing', () => {
    it('parses LINK_X($start, $end) correctly', () => {
        const result = parsePlotCall('LINE_CHART(x: ts, y: val) LINK_X($start, $end)');
        expect(result.linkX).toEqual(['$start', '$end']);
    });

    it('parses BRUSH "$sel" MODE X', () => {
        const result = parsePlotCall('AREA_CHART(x: ts, y: val) BRUSH "$sel" MODE X');
        expect(result.brush).toEqual({ name: '$sel', mode: 'x' });
    });

    it('parses combined LINK_X + BRUSH on the same plot', () => {
        const dsl = 'LINE_CHART(x: ts, y: val) LINK_X($start, $end) BRUSH "$sel" MODE X';
        const result = parsePlotCall(dsl);
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.brush).toEqual({ name: '$sel', mode: 'x' });
    });

    it('parses BRUSH with MODE Y', () => {
        const result = parsePlotCall('LINE_CHART(x: ts, y: val) BRUSH "$bY" MODE Y');
        expect(result.brush?.mode).toBe('y');
    });

    it('parses BRUSH with MODE XY', () => {
        const result = parsePlotCall('LINE_CHART(x: ts, y: val) BRUSH "$bXY" MODE XY');
        expect(result.brush?.mode).toBe('xy');
    });

    it('parses LINK-Y with bare $ variable', () => {
        const result = parsePlotCall('LINE_CHART(x: ts, y: mem) LINK-Y $memDomain');
        expect(result.linkY).toBe('$memDomain');
    });

    it('parses LINK-XY with quoted $ variable', () => {
        const result = parsePlotCall('SCATTER_PLOT(x: a, y: b) LINK-XY "$combined"');
        expect(result.linkXY).toBe('$combined');
    });

    it('parses ON #N numeric ref', () => {
        const result = parsePlotCall('LINE_CHART(x: ts, y: val) ON #2');
        expect(result.on).toContain('#2');
    });

    it('parses ON viewName alias ref', () => {
        const result = parsePlotCall('BAR_CHART(x: cat, y: count) ON gc_pauses');
        expect(result.on).toContain('gc_pauses');
    });
});

// ---------------------------------------------------------------------------
// Part 4: Combined BRUSH→store→SQL chain
// ---------------------------------------------------------------------------

describe('BRUSH + LINK_X combined workflow', () => {
    it('brush variables from a BRUSH gesture feed SQL WHERE IN correctly', () => {
        // Simulate PlotRenderer writing brush variables after a gesture.
        // makeBrushVarHandler produces flat keys:
        const brushVars: Record<string, string> = {
            '$sel.brush.lo': '1500000000',
            '$sel.brush.hi': '1800000000',
        };
        // Cell-level variables also have LINK_X zoom written:
        const allVars: Record<string, string> = {
            '$start': '1000000000',
            '$end': '2000000000',
            ...brushVars,
        };

        // SQL that uses both zoom variables and brush filter
        const sql = `SELECT * FROM jfr_events
WHERE ts BETWEEN $start AND $end
  AND alloc_size_bytes IN $sel.brush`;

        const expanded = expandBrushOperator(sql, allVars);
        expect(expanded).toContain('BETWEEN $sel.brush.lo AND $sel.brush.hi');

        const substituted = substituteVariables(expanded, allVars);
        expect(substituted).toBe(
            `SELECT * FROM jfr_events
WHERE ts BETWEEN 1000000000 AND 2000000000
  AND alloc_size_bytes BETWEEN 1500000000 AND 1800000000`
        );
    });

    it('leaves combined SQL with brush+zoom intact when brush not yet set', () => {
        const allVars: Record<string, string> = {
            '$start': '1000000000',
            '$end': '2000000000',
            // No $sel.brush.lo / .hi
        };

        const sql = 'SELECT * FROM t WHERE ts BETWEEN $start AND $end AND v IN $sel.brush';
        const expanded = expandBrushOperator(sql, allVars);
        // Brush not expanded, zoom variables present
        expect(expanded).toContain('IN $sel.brush');  // unchanged
        // The unresolved $sel.brush prevents execution (findRemainingVariables)
        const substituted = substituteVariables(expanded, allVars);
        expect(findRemainingVariables(substituted)).toContain('$sel.brush');
    });
});

// ---------------------------------------------------------------------------
// Part 5: allVariables merge precedence
// ---------------------------------------------------------------------------

describe('allVariables merge priority', () => {
    // Simulates: allVariables = { ...metadata.variables, ...precedingCellVariables, ...parsed.variables }
    // Cell-local ($start in parsed.variables) overrides workspace (metadata.variables),
    // which itself overrides nothing. Cross-cell vars ($Overview.start) come from
    // precedingCellVariables which sits between them.

    it('cell-local variable overrides metadata.variables with same name', () => {
        const metadataVars: Record<string, string> = { '$start': '1000', '$end': '2000' };
        const cellLocalVars: Record<string, string> = { '$start': '5000' };
        const allVars = { ...metadataVars, ...cellLocalVars };
        const sql = 'SELECT * FROM t WHERE ts > $start';
        expect(substituteVariables(sql, allVars)).toBe('SELECT * FROM t WHERE ts > 5000');
    });

    it('metadata.variables LINK_X zoom values are accessible via bare $name in any cell', () => {
        // After user pans Cell A chart, metadata.variables gets: { $start: ..., $end: ... }
        // Cell B picks these up via allVariables = { ...metadata.variables, ... }
        const metadataVars: Record<string, string> = {
            '$start': '1700000000',
            '$end': '1800000000',
        };
        const allVars = { ...metadataVars };
        const sql = 'SELECT * FROM gc_pauses WHERE ts BETWEEN $start AND $end';
        expect(substituteVariables(sql, allVars))
            .toBe('SELECT * FROM gc_pauses WHERE ts BETWEEN 1700000000 AND 1800000000');
    });

    it('cross-cell $Title.varName refs are independent of LINK_X zoom updates', () => {
        // $Overview.start is the static initial value from the preceding cell's variables block.
        // $start (bare) is the live interactive zoom value from metadata.variables.
        // When both exist, the bare $start (from a cell-local var) takes precedence.
        const precedingVars: Record<string, string> = { '$Overview.start': '1000000000' };
        const metadataVars: Record<string, string> = { '$start': '1700000000' };
        const allVars = { ...metadataVars, ...precedingVars };

        const sqlBare = 'SELECT * FROM t WHERE ts > $start';
        const sqlCrossCell = 'SELECT * FROM t WHERE ts > $Overview.start';
        expect(substituteVariables(sqlBare, allVars)).toBe('SELECT * FROM t WHERE ts > 1700000000');
        expect(substituteVariables(sqlCrossCell, allVars)).toBe('SELECT * FROM t WHERE ts > 1000000000');
    });

    it('brush variables from brush store coexist with LINK_X zoom variables', () => {
        // Both brush (.lo/.hi) and zoom ($start/$end) can be in allVariables simultaneously.
        const allVars: Record<string, string> = {
            '$start': '1000000000',
            '$end': '2000000000',
            '$sel.brush.lo': '1400000000',
            '$sel.brush.hi': '1600000000',
        };
        const sql = 'SELECT alloc FROM t WHERE ts BETWEEN $start AND $end AND alloc IN $sel.brush';
        const expanded = expandBrushOperator(sql, allVars);
        const substituted = substituteVariables(expanded, allVars);
        expect(substituted).toBe(
            'SELECT alloc FROM t WHERE ts BETWEEN 1000000000 AND 2000000000 AND alloc BETWEEN 1400000000 AND 1600000000'
        );
    });
});

// ---------------------------------------------------------------------------
// Part 6: parsePlotCall composite + BRUSH + LINK_X
// ---------------------------------------------------------------------------

describe('parsePlotCall — composite BRUSH + LINK_X clauses', () => {
    it('LINK_X on a leaf inside ROW() parses independently via parsePlotCall on the leaf', () => {
        const leaf = 'LINE_CHART(x: ts, y: cpu) LINK_X($start, $end)';
        const result = parsePlotCall(leaf);
        expect(result.linkX).toEqual(['$start', '$end']);
    });

    it('BRUSH on area chart leaf returns correct name and mode', () => {
        const leaf = 'AREA_CHART(x: ts, y: alloc) BRUSH "$gc" MODE X';
        const result = parsePlotCall(leaf);
        expect(result.brush?.name).toBe('$gc');
        expect(result.brush?.mode).toBe('x');
    });

    it('LINK_X master option is parsed correctly', () => {
        const dsl = 'LINE_CHART(x: ts, y: v) LINK_X($start, $end, master)';
        const result = parsePlotCall(dsl);
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.linkXMaster).toBe(true);
    });

    it('LINK_X clamp option is parsed correctly', () => {
        const dsl = 'LINE_CHART(x: ts, y: v) LINK_X($start, $end, clamp)';
        const result = parsePlotCall(dsl);
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.linkXClamp).toBe(true);
    });

    it('BRUSH only accepts single-$ variable names ($$name not supported)', () => {
        // The BRUSH regex requires exactly one $ prefix: "$varName"
        // Double-$ (notebook-scoped) vars are a SQL convention but not valid BRUSH names.
        const dsl = 'AREA_CHART(x: ts, y: v) BRUSH "$$global" MODE XY';
        const result = parsePlotCall(dsl);
        // Parser does not recognise $$global as a BRUSH variable — brush is undefined
        expect(result.brush).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Part 7: LINK-Y / LINK-XY brush store subscription (plotBrushStore)
// ---------------------------------------------------------------------------

describe('LINK-Y / LINK-XY — plotBrushStore pub/sub', () => {
    it('subscribing to a LINK-Y var receives Y-mode brush domain', () => {
        const received: Array<[number, number] | null> = [];
        const unsub = plotBrushStore.subscribe('$memDomain', payload => {
            received.push(payload.domain);
        });
        plotBrushStore.publish({ name: '$memDomain', domain: [100, 500], mode: 'y', cellName: 'cellA' });
        unsub();
        expect(received).toEqual([[100, 500]]);
    });

    it('XY mode broadcast is received by a LINK-XY subscriber', () => {
        const received: Array<{ domain: [number, number] | null; mode: string }> = [];
        const unsub = plotBrushStore.subscribe('$combined', payload => {
            received.push({ domain: payload.domain, mode: payload.mode });
        });
        plotBrushStore.publish({ name: '$combined', domain: [0, 1000], mode: 'xy', cellName: 'cellB' });
        unsub();
        expect(received[0]?.mode).toBe('xy');
        expect(received[0]?.domain).toEqual([0, 1000]);
    });

    it('clearing a brush (domain: null) is propagated to subscriber', () => {
        const received: Array<[number, number] | null> = [];
        const unsub = plotBrushStore.subscribe('$gcBrush', payload => {
            received.push(payload.domain);
        });
        plotBrushStore.publish({ name: '$gcBrush', domain: [200, 800], mode: 'y', cellName: 'cellC' });
        plotBrushStore.clear('$gcBrush', 'cellC');
        unsub();
        expect(received[0]).toEqual([200, 800]);
        expect(received[1]).toBeNull();
    });

    it('late subscriber immediately receives current stored domain (replay on subscribe)', () => {
        // Simulate: publisher brushes first, then subscriber mounts (e.g. user scrolls to it).
        plotBrushStore.publish({ name: '$lateDomain', domain: [300, 700], mode: 'y', cellName: 'publisher' });
        const received: Array<[number, number] | null> = [];
        const unsub = plotBrushStore.subscribe('$lateDomain', payload => {
            received.push(payload.domain);
        }, 'lateCell');
        unsub();
        // Should have been called immediately with stored value on subscribe.
        expect(received).toEqual([[300, 700]]);
    });

    it('LINK-Y variable is parsed from DSL correctly', () => {
        const result = parsePlotCall('AREA_CHART(x: ts, y: mem) LINK-Y $memDomain');
        expect(result.linkY).toBe('$memDomain');
    });

    it('LINK-XY variable is parsed from DSL correctly', () => {
        const result = parsePlotCall('SCATTER_PLOT(x: a, y: b) LINK-XY "$combined"');
        expect(result.linkXY).toBe('$combined');
    });
});

// ---------------------------------------------------------------------------
// Part 8: Composite multi-query routing (ROW + ON clause)
// ---------------------------------------------------------------------------

import { parseComposite } from '../utils/plotParser';

describe('parseComposite — ROW/COL multi-query routing via ON clause', () => {
    it('ROW children each get their own ON clause', () => {
        const result = parseComposite('ROW(LINE_CHART(x: ts, y: cpu) ON #1, BAR_CHART(x: cat, y: cnt) ON #2)');
        expect(result.composite?.direction).toBe('row');
        const children = result.composite!.children;
        expect(children).toHaveLength(2);
        expect(children[0].on).toContain('#1');
        expect(children[1].on).toContain('#2');
    });

    it('ROW children each get their own LINK_X', () => {
        const result = parseComposite(
            'ROW(LINE_CHART(x: ts, y: a) LINK_X($start, $end), AREA_CHART(x: ts, y: b) LINK_X($start, $end))'
        );
        const children = result.composite!.children;
        expect(children[0].linkX).toEqual(['$start', '$end']);
        expect(children[1].linkX).toEqual(['$start', '$end']);
    });

    it('ROW child with both ON clause and LINK_X parses both correctly', () => {
        const result = parseComposite(
            'ROW(LINE_CHART(x: ts, y: a) ON #1 LINK_X($s, $e), LINE_CHART(x: ts, y: b) ON #2 LINK_X($s, $e))'
        );
        const c = result.composite!.children;
        expect(c[0].on).toContain('#1');
        expect(c[0].linkX).toEqual(['$s', '$e']);
        expect(c[1].on).toContain('#2');
        expect(c[1].linkX).toEqual(['$s', '$e']);
    });

    it('COL children have independent BRUSH clauses', () => {
        const result = parseComposite(
            'COL(AREA_CHART(x: ts, y: cpu) BRUSH "$selA" MODE X, AREA_CHART(x: ts, y: mem) BRUSH "$selB" MODE Y)'
        );
        const c = result.composite!.children;
        expect(c[0].brush?.name).toBe('$selA');
        expect(c[0].brush?.mode).toBe('x');
        expect(c[1].brush?.name).toBe('$selB');
        expect(c[1].brush?.mode).toBe('y');
    });

    it('overlay (+) preserves LINK_X on each operand', () => {
        const result = parseComposite(
            'LINE_CHART(x: ts, y: a) LINK_X($s, $e) + BAR_CHART(x: ts, y: b) LINK_X($s, $e)'
        );
        expect(result.composite?.direction).toBe('overlay');
        const c = result.composite!.children;
        expect(c[0].linkX).toEqual(['$s', '$e']);
        expect(c[1].linkX).toEqual(['$s', '$e']);
    });

    it('ROW children each parse their own LINK-Y variable independently', () => {
        // When two leaves subscribe to *different* Y-domain variables, they should
        // both have distinct linkY values parsed from their individual clauses.
        const result = parseComposite(
            'ROW(LINE_CHART(x: ts, y: cpu) LINK-Y $cpuDomain, LINE_CHART(x: ts, y: mem) LINK-Y $memDomain)'
        );
        const c = result.composite!.children;
        expect(c[0].linkY).toBe('$cpuDomain');
        expect(c[1].linkY).toBe('$memDomain');
    });

    it('COL children each parse their own LINK-XY variable', () => {
        const result = parseComposite(
            'COL(SCATTER_PLOT(x: a, y: b) LINK-XY $xyA, SCATTER_PLOT(x: c, y: d) LINK-XY $xyB)'
        );
        const c = result.composite!.children;
        expect(c[0].linkXY).toBe('$xyA');
        expect(c[1].linkXY).toBe('$xyB');
    });
});

// ---------------------------------------------------------------------------
// Part 9: plotBrushStore — per-name multi-variable pub/sub (for per-leaf LINK-Y)
// ---------------------------------------------------------------------------

describe('plotBrushStore — multiple independent LINK-Y variable subscriptions', () => {
    it('two subscribers on different var names receive independent domains', () => {
        const cpuReceived: Array<[number, number] | null> = [];
        const memReceived: Array<[number, number] | null> = [];

        const unsubCpu = plotBrushStore.subscribe('$cpuY', p => cpuReceived.push(p.domain), 'viewerCpu');
        const unsubMem = plotBrushStore.subscribe('$memY', p => memReceived.push(p.domain), 'viewerMem');

        plotBrushStore.publish({ name: '$cpuY', domain: [0, 100], mode: 'y', cellName: 'publisherA' });
        plotBrushStore.publish({ name: '$memY', domain: [0, 8192], mode: 'y', cellName: 'publisherB' });

        unsubCpu();
        unsubMem();

        expect(cpuReceived).toEqual([[0, 100]]);
        expect(memReceived).toEqual([[0, 8192]]);
    });

    it('updating one variable does not affect the other subscriber', () => {
        const cpuReceived: Array<[number, number] | null> = [];
        const memReceived: Array<[number, number] | null> = [];

        const unsubCpu = plotBrushStore.subscribe('$cpuY2', p => cpuReceived.push(p.domain), 'viewerCpu2');
        const unsubMem = plotBrushStore.subscribe('$memY2', p => memReceived.push(p.domain), 'viewerMem2');

        plotBrushStore.publish({ name: '$cpuY2', domain: [10, 90], mode: 'y', cellName: 'pubA2' });
        // Second update to cpuY2 only
        plotBrushStore.publish({ name: '$cpuY2', domain: [20, 80], mode: 'y', cellName: 'pubA2' });

        unsubCpu();
        unsubMem();

        // cpu got both updates; mem got nothing (no publish to $memY2)
        expect(cpuReceived).toEqual([[10, 90], [20, 80]]);
        expect(memReceived).toEqual([]);
    });

    it('late subscribers to both variables each get their stored domain on mount (replay)', () => {
        plotBrushStore.publish({ name: '$cpuLate', domain: [5, 95], mode: 'y', cellName: 'earlyPub' });
        plotBrushStore.publish({ name: '$memLate', domain: [512, 4096], mode: 'y', cellName: 'earlyPub' });

        const cpuGot: Array<[number, number] | null> = [];
        const memGot: Array<[number, number] | null> = [];

        const u1 = plotBrushStore.subscribe('$cpuLate', p => cpuGot.push(p.domain), 'lateCpu');
        const u2 = plotBrushStore.subscribe('$memLate', p => memGot.push(p.domain), 'lateMem');
        u1(); u2();

        expect(cpuGot).toEqual([[5, 95]]);
        expect(memGot).toEqual([[512, 4096]]);
    });
});

// ---------------------------------------------------------------------------
// Part 10: applyPlot plotBlockIndex segment selection
// ---------------------------------------------------------------------------

import { tokenizeCellContent, reconstructCellContent } from '../utils/notebookParser';

describe('applyPlot — plotBlockIndex segment selection', () => {
    function applyPlotToCell(content: string, plotConfig: string, plotBlockIndex: number): string {
        const segs = tokenizeCellContent(content);
        const targetIdx = plotBlockIndex;
        const plotSegs = segs.map((s, i) => ({ s, i })).filter(x => x.s.type === 'plot');
        if (plotSegs.length === 0) {
            return content + '\n\n```plot\n' + plotConfig + '\n```\n';
        }
        const target = plotSegs[Math.min(targetIdx, plotSegs.length - 1)];
        const updatedSegs = segs.map((s, i) =>
            i === target.i ? { ...s, content: '\n' + plotConfig + '\n' } : s
        );
        return reconstructCellContent(updatedSegs);
    }

    it('replaces the first plot block when plotBlockIndex is 0', () => {
        const content = '```sql\nSELECT 1;\n```\n\n```plot\nTABLE()\n```\n';
        const result = applyPlotToCell(content, 'LINE_CHART(x: ts, y: v)', 0);
        expect(result).toContain('LINE_CHART(x: ts, y: v)');
        expect(result).not.toContain('TABLE()');
    });

    it('replaces the second plot block (index 1) in a multi-plot cell', () => {
        const content = '```sql\nSELECT 1;\n```\n\n```plot\nTABLE()\n```\n\n```sql\nSELECT 2;\n```\n\n```plot\nBAR_CHART(x: cat, y: [])\n```\n';
        const result = applyPlotToCell(content, 'LINE_CHART(x: ts, y: v)', 1);
        expect(result).toContain('TABLE()');
        expect(result).toContain('LINE_CHART(x: ts, y: v)');
        expect(result).not.toContain('BAR_CHART');
    });

    it('clamps to the last plot block when plotBlockIndex exceeds available blocks', () => {
        const content = '```sql\nSELECT 1;\n```\n\n```plot\nTABLE()\n```\n';
        // Only one plot block; index 5 should clamp to it.
        const result = applyPlotToCell(content, 'AREA_CHART(x: ts, y: v)', 5);
        expect(result).toContain('AREA_CHART(x: ts, y: v)');
        expect(result).not.toContain('TABLE()');
    });

    it('appends a new plot block when the cell has no existing plot blocks', () => {
        const content = '```sql\nSELECT 1;\n```\n';
        const result = applyPlotToCell(content, 'LINE_CHART(x: ts, y: v)', 0);
        expect(result).toContain('LINE_CHART(x: ts, y: v)');
        expect(result).toContain('```plot');
        // Original SQL is preserved
        expect(result).toContain('SELECT 1;');
    });

    it('first plot block is left unchanged when replacing the second', () => {
        const content = '```sql\nSELECT 1;\n```\n\n```plot\nTABLE()\n```\n\n```sql\nSELECT 2;\n```\n\n```plot\nSCATTER_PLOT(x: a, y: b)\n```\n';
        const result = applyPlotToCell(content, 'LINE_CHART(x: ts, y: v)', 1);
        expect(result).toContain('TABLE()');
        expect(result).toContain('LINE_CHART(x: ts, y: v)');
        expect(result).not.toContain('SCATTER_PLOT');
    });
});
