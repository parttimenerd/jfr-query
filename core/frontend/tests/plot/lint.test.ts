// Tests for the AST-based plot DSL linter.
//
// Each test calls `lintPlot(source, deps)` and asserts the returned CM6
// Diagnostic[]. Severities, codes, and (where relevant) fix actions are
// checked. Mid-typing guard tests pass a cursor position to make sure the
// linter doesn't emit while the user is mid-token.

import { describe, it, expect } from 'vitest';
import { lintPlot } from '../../components/editor/plot/lint';
import type { PlotLintDeps } from '../../components/editor/plot/lint';
import type { ShapeRegistry } from '../../components/editor/plot/annotators/shapeAnnotator';

const REGISTRY: ShapeRegistry = {
    line: {
        name: 'line',
        validClauses: ['x', 'y', 'color', 'size'],
        columnClauses: ['x', 'y', 'color'],
        requiredClauses: ['x', 'y'],
        clauseDefs: [
            { key: 'x', paramType: 'column', required: true },
            { key: 'y', paramType: 'column', required: true },
            { key: 'color', paramType: 'column' },
            { key: 'size', paramType: 'number' },
        ],
    },
    bar: {
        name: 'bar',
        validClauses: ['x', 'y'],
        columnClauses: ['x', 'y'],
        requiredClauses: ['x'],
    },
    table: { name: 'table' },
};

function makeDeps(overrides: Partial<PlotLintDeps> = {}): PlotLintDeps {
    return {
        shapeRegistry: REGISTRY,
        cellColumns: null,
        notebookScope: null,
        sqlBlockCount: 0,
        variables: {},
        ...overrides,
    };
}

describe('lintPlot — shape rules', () => {
    it('unknown shape with close match', () => {
        const src = 'LINE_CHRT(x: "ts")';
        const diags = lintPlot(src, makeDeps());
        const errs = diags.filter(d => d.severity === 'error');
        expect(errs.length).toBeGreaterThanOrEqual(1);
        const u = errs.find(d => /Unknown plot shape/i.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.message).toMatch(/LINE_CHART/);
        expect(u!.actions?.some(a => /LINE_CHART/.test(a.name))).toBe(true);
    });

    it('unknown clause for a known shape lists valid clauses', () => {
        const src = 'LINE_CHART(z: 1)';
        const diags = lintPlot(src, makeDeps());
        const u = diags.find(d => /Unknown clause/i.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.severity).toBe('error');
        expect(u!.message).toMatch(/\bx\b/);
        expect(u!.actions?.length).toBeGreaterThanOrEqual(1);
    });

    it('missing required clauses surface a warning with fix actions', () => {
        const src = 'LINE_CHART()';
        const diags = lintPlot(src, makeDeps());
        const w = diags.find(d => /missing required/i.test(d.message));
        expect(w).toBeTruthy();
        expect(w!.severity).toBe('warning');
        expect(w!.message).toMatch(/'x'/);
        expect(w!.message).toMatch(/'y'/);
        expect(w!.actions?.length).toBe(2);
    });
});

describe('lintPlot — column rules', () => {
    const columns = [
        { name: 'pause', dataType: 'INTERVAL' },
        { name: 'cause', dataType: 'VARCHAR' },
        { name: 'ts', dataType: 'TIMESTAMP' },
    ];

    it('unknown column with cellColumns suggests the closest', () => {
        const src = 'LINE_CHART(x: ts, y: pasue)';
        const diags = lintPlot(src, makeDeps({ cellColumns: columns }));
        const u = diags.find(d => /Unknown column 'pasue'/.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.severity).toBe('error');
        expect(u!.message).toMatch(/pause/);
    });

    it('no diagnostic when cellColumns is null (column-without-schema is info-only)', () => {
        const src = 'LINE_CHART(x: ts, y: pasue)';
        const diags = lintPlot(src, makeDeps({ cellColumns: null }));
        const errs = diags.filter(d => d.severity === 'error' && /Unknown column/i.test(d.message));
        expect(errs.length).toBe(0);
    });
});

describe('lintPlot — tail rules', () => {
    it('unknown tail-style keyword surfaces as an error (parser sees it as a stray ident)', () => {
        // TITLEE isn't in UPPERCASE_TAIL_KEYWORDS, so the parser treats it as
        // a separate plotCall. The linter then flags it as an unknown shape.
        const src = 'LINE_CHART(x: ts) TITLEE "x"';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const u = diags.find(d => /Unknown plot shape 'TITLEE'/i.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.severity).toBe('error');
    });

    it('unknown lowercase tail key suggests closest', () => {
        const src = 'line { x: ts } | titlee: "x"';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const u = diags.find(d => /Unknown tail keyword/i.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.severity).toBe('error');
        expect(u!.message).toMatch(/title/);
    });

    it('dimension-format warns for bare numbers in WIDTH', () => {
        const src = 'LINE_CHART(x: ts) WIDTH 400';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const w = diags.find(d => /Dimension should include a unit/i.test(d.message));
        expect(w).toBeTruthy();
        expect(w!.severity).toBe('warning');
        expect(w!.actions?.some(a => /px/.test(a.name))).toBe(true);
    });

    it('LINK_X with unknown plot ref errors', () => {
        const src = 'LINE_CHART(x: ts) LINK_X($a, gc_top)';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            notebookScope: { namedPlots: [{ name: 'gc', shape: 'line' }] },
        }));
        const u = diags.find(d => /Unknown plot reference 'gc_top'/.test(d.message));
        expect(u).toBeTruthy();
    });
});

describe('lintPlot — constants', () => {
    it('forward reference flagged as warning', () => {
        const src = 'LINE_CHART(x: @later)\nLET @later = "ts"';
        const diags = lintPlot(src, makeDeps());
        const w = diags.find(d => /Forward reference/i.test(d.message));
        expect(w).toBeTruthy();
        expect(w!.severity).toBe('warning');
    });

    it('cycle in constants flagged as error', () => {
        const src = 'LET @a = @b\nLET @b = @a';
        const diags = lintPlot(src, makeDeps());
        const e = diags.find(d => /Cycle/i.test(d.message));
        expect(e).toBeTruthy();
        expect(e!.severity).toBe('error');
    });
});

describe('lintPlot — query refs', () => {
    it('out-of-range numeric ref errors with a fix', () => {
        const src = 'LINE_CHART(x: ts) ON #5';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            sqlBlockCount: 2,
        }));
        const u = diags.find(d => /out of range/i.test(d.message));
        expect(u).toBeTruthy();
        expect(u!.severity).toBe('error');
        expect(u!.actions?.some(a => /#1/.test(a.name))).toBe(true);
    });
});

describe('lintPlot — composite', () => {
    it('empty composite emits info', () => {
        const src = 'row {}';
        const diags = lintPlot(src, makeDeps());
        const i = diags.find(d => /Empty .* container/i.test(d.message));
        expect(i).toBeTruthy();
        expect(i!.severity).toBe('info');
        expect(i!.actions?.some(a => /LINE_CHART/.test(a.name))).toBe(true);
    });
});

describe('lintPlot — mid-typing guard', () => {
    it('does not emit unknown-clause inside a clauseKey hole', () => {
        // No cursor pos passed via the lint API, but the parser still emits
        // holes for empty/partial slots. Linter must not fire on those.
        const src = 'LINE_CHART(x: ts,)'; // trailing comma leaves a clauseKey hole
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const u = diags.find(d => /Unknown clause/i.test(d.message));
        expect(u).toBeFalsy();
    });
});

describe('lintPlot — brush and variables', () => {
    it('brush on a known plot without hasBrush emits info', () => {
        const src = 'LINE_CHART(x: $gc.brush)';
        const diags = lintPlot(src, makeDeps({
            notebookScope: { namedPlots: [{ name: 'gc', hasBrush: false }] },
        }));
        const i = diags.find(d => /no live brush selection/i.test(d.message));
        expect(i).toBeTruthy();
        expect(i!.severity).toBe('info');
    });

    it('undefined $variable in clause emits info', () => {
        const src = 'LINE_CHART(x: $undefined_var)';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            variables: { other: 'x' },
        }));
        const i = diags.find(d => /not defined/i.test(d.message));
        expect(i).toBeTruthy();
        expect(i!.severity).toBe('info');
    });
});

describe('lintPlot — robustness', () => {
    it('returns empty on empty source', () => {
        expect(lintPlot('', makeDeps())).toEqual([]);
    });

    it('valid input produces no errors', () => {
        const src = 'LINE_CHART(x: ts, y: cnt) TITLE "ok"';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [
                { name: 'ts', dataType: 'TIMESTAMP' },
                { name: 'cnt', dataType: 'BIGINT' },
            ],
        }));
        const errs = diags.filter(d => d.severity === 'error');
        expect(errs.length).toBe(0);
    });
});
