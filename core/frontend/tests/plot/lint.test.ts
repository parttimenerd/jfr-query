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

// B-080 — lint.ts must not fire unknown-column for $variable refs
describe('lintPlot — $variable column refs (B-080)', () => {
    const columns = [
        { name: 'pause', dataType: 'INTERVAL' },
        { name: 'ts', dataType: 'TIMESTAMP' },
    ];

    it('does not emit unknown-column for an ident starting with $', () => {
        // $myVar is a runtime substitution — should never trigger unknown-column.
        const src = 'LINE_CHART(x: $myVar, y: pause)';
        const diags = lintPlot(src, makeDeps({ cellColumns: columns }));
        const unknownCol = diags.filter(d => /Unknown column/i.test(d.message));
        expect(unknownCol.length).toBe(0);
    });

    it('does not emit unknown-column for $ts even when ts is a known column', () => {
        // Both `$ts` (variable ref) and `ts` (bare ident) may appear; only bare
        // idents that don't resolve should be flagged.
        const src = 'LINE_CHART(x: $ts, y: pause)';
        const diags = lintPlot(src, makeDeps({ cellColumns: columns }));
        const unknownCol = diags.filter(d => /Unknown column/i.test(d.message));
        expect(unknownCol.length).toBe(0);
    });

    it('still emits unknown-column for a plain ident that does not resolve', () => {
        const src = 'LINE_CHART(x: nonexistent, y: pause)';
        const diags = lintPlot(src, makeDeps({ cellColumns: columns }));
        const unknownCol = diags.filter(d => /Unknown column/i.test(d.message));
        expect(unknownCol.length).toBeGreaterThanOrEqual(1);
    });
});

// B-167 — LINK_X() with zero $variable args should produce an error
describe('lintPlot — LINK_X zero-arg error (B-167)', () => {
    it('LINK_X() with no args emits an error', () => {
        const src = 'LINE_CHART(x: ts) LINK_X()';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const e = diags.find(d => /LINK_X.*requires at least two/i.test(d.message));
        expect(e).toBeTruthy();
        expect(e!.severity).toBe('error');
        expect(e!.actions?.some(a => /Add two variables/.test(a.name))).toBe(true);
    });

    it('LINK_Y() with no args emits an error', () => {
        const src = 'LINE_CHART(x: ts) LINK_Y()';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const e = diags.find(d => /LINK_Y.*requires at least two/i.test(d.message));
        expect(e).toBeTruthy();
        expect(e!.severity).toBe('error');
    });

    it('LINK_X($a) with one arg emits a warning (not an error)', () => {
        const src = 'LINE_CHART(x: ts) LINK_X($a)';
        const diags = lintPlot(src, makeDeps({ cellColumns: [{ name: 'ts' }] }));
        const w = diags.find(d => /LINK_X.*usually takes two/i.test(d.message));
        expect(w).toBeTruthy();
        expect(w!.severity).toBe('warning');
        // Should NOT emit the "requires at least two" error when there is one var
        const e = diags.find(d => /LINK_X.*requires at least two/i.test(d.message));
        expect(e).toBeFalsy();
    });

    it('LINK_X($a, $b) with two args produces no LINK error', () => {
        const src = 'LINE_CHART(x: ts) LINK_X($a, $b)';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            variables: { a: '0', b: '0' },
        }));
        const linkErr = diags.filter(d => /LINK_X/i.test(d.message) && d.severity === 'error');
        expect(linkErr.length).toBe(0);
    });
});

// B-168 — lintVarRef parent-tail walk must find LINK_ at any nesting depth
describe('lintPlot — LINK_ variable suppression at depth (B-168)', () => {
    it('does not warn about undefined $var inside LINK_X args', () => {
        // $a is not declared but is an output binding in LINK_X — no "not defined" info
        const src = 'LINE_CHART(x: ts) LINK_X($a, $b)';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            // provide some other variable so "no variable map at all" short-circuit
            // doesn't apply
            variables: { other: 'val' },
        }));
        const undefinedInfo = diags.filter(
            d => /not defined/i.test(d.message) && /\$a|\$b/.test(d.message),
        );
        expect(undefinedInfo.length).toBe(0);
    });

    it('does not warn about $var in LINK_SCROLL', () => {
        const src = 'LINE_CHART(x: ts) LINK_SCROLL($start, $end)';
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            variables: { other: 'val' },
        }));
        const undefinedInfo = diags.filter(
            d => /not defined/i.test(d.message) && /\$start|\$end/.test(d.message),
        );
        expect(undefinedInfo.length).toBe(0);
    });
});

// B-169 — hasMidTypingHoleAncestor should not suppress when cursor is elsewhere
describe('lintPlot — mid-typing guard with cursorPos (B-169)', () => {
    it('suppresses diagnostics when cursorPos is inside the hole', () => {
        // Trailing comma creates a clauseKey hole at position 17 (after the comma).
        // With cursorPos at that position the linter must stay silent.
        const src = 'LINE_CHART(x: ts,)';
        // pos 17 is after the comma, where the hole would be
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            cursorPos: 17,
        }));
        const u = diags.find(d => /Unknown clause/i.test(d.message));
        expect(u).toBeFalsy();
    });

    it('emits diagnostics when cursorPos is NOT inside the hole', () => {
        // Same source, but cursor is at position 0 (far from the hole).
        // The linter should now report normal diagnostics.
        const src = 'LINE_CHART(x: ts,)';
        // With cursor at 0, the hole at pos 17 should NOT suppress lint.
        // The trailing comma hole doesn't describe an "unknown clause" error
        // directly, but missing required clause 'y' should appear since 'y' is
        // still absent.
        const diags = lintPlot(src, makeDeps({
            cellColumns: [{ name: 'ts' }],
            cursorPos: 0,
        }));
        // The missing-required-clause warning for 'y' should surface now
        const w = diags.find(d => /missing required/i.test(d.message));
        expect(w).toBeTruthy();
    });
});
