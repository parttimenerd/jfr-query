// Data-shape robustness for every plot type. JFR / DuckDB result rows often
// contain values that browser charts don't expect:
//   - BigInt (from DuckDB BIGINT/UBIGINT)
//   - null / undefined (LEFT JOIN holes, missing keys)
//   - NaN / Infinity (division by zero, log of negative)
//   - mixed types in numeric columns (numeric-as-string from JSON_EXTRACT)
//   - single-row results
//   - large result sets (decimation paths)
//
// We render the leaf via the registry's parseConfig + component and assert
// rendering does not throw. Visible output is not asserted (recharts under SSR
// often emits only its wrapper), but a throw is a real regression.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { plotRegistry } from '../components/plots/plotRegistry';
import { parseComposite } from '../utils/plotParser';
import { normalizePlotName } from '../components/plots/plotNames';

function renderLeaf(code: string, data: any[]): void {
    const parsed = parseComposite(code);
    const main = parsed.mainConfig;
    const typeName = normalizePlotName(main.match(/^(\w+)/)?.[1] || '');
    const reg = plotRegistry[typeName];
    if (!reg) throw new Error(`No registry entry for ${typeName}`);
    const cfg = reg.parseConfig(main, data);
    renderToStaticMarkup(
        React.createElement(reg.component as any, { config: cfg, data, isAnimationActive: false }),
    );
}

// ---- BigInt -------------------------------------------------------------
// DuckDB BIGINT columns surface in JS as native BigInt. Recharts internals
// call Number() on values; a naked BigInt → TypeError("Cannot convert a
// BigInt to a number") if not coerced upstream. The plot config layer
// should massage these before they reach recharts.

describe('BigInt robustness', () => {
    const bigintData = [
        { t: 'a', y: BigInt(1000000000) },
        { t: 'b', y: BigInt(2500000000) },
        { t: 'c', y: BigInt(3750000000) },
    ];

    it('BAR_CHART with BigInt y values', () => {
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"])', bigintData)).not.toThrow();
    });
    it('LINE_CHART with BigInt y values', () => {
        const data = bigintData.map((r, i) => ({ time: i, value: r.y }));
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });
    it('AREA_CHART with BigInt y values', () => {
        const data = bigintData.map((r, i) => ({ time: i, value: r.y }));
        expect(() => renderLeaf('AREA_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });
    it('SCATTER_PLOT with BigInt values', () => {
        const data = bigintData.map((r, i) => ({ x: BigInt(i), y: r.y }));
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y")', data)).not.toThrow();
    });
    it('PIE_CHART with BigInt slice values', () => {
        expect(() => renderLeaf('PIE_CHART(category: "t", value: "y")', bigintData)).not.toThrow();
    });
    it('HISTOGRAM with BigInt source column', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "y")', bigintData)).not.toThrow();
    });
    it('BOX_PLOT with BigInt values', () => {
        const data = Array.from({ length: 10 }, (_, i) => ({ value: BigInt(i * 100) }));
        expect(() => renderLeaf('BOX_PLOT(value: "value")', data)).not.toThrow();
    });
    it('TABLE with BigInt cells', () => {
        expect(() => renderLeaf('TABLE()', bigintData)).not.toThrow();
    });
});

// ---- nulls & undefined --------------------------------------------------
// LEFT JOINs and OPTIONAL clauses produce rows where a column may be null or
// missing. Plots should tolerate this as "no datapoint", not crash.

describe('null / undefined robustness', () => {
    it('LINE_CHART with null gaps', () => {
        const data = [
            { time: 0, value: 1 },
            { time: 1, value: null },
            { time: 2, value: 3 },
            { time: 3, value: undefined },
            { time: 4, value: 5 },
        ];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });

    it('BAR_CHART with null x labels', () => {
        const data = [
            { t: 'a', y: 1 },
            { t: null, y: 2 },
            { t: 'c', y: 3 },
        ];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"])', data)).not.toThrow();
    });

    it('SCATTER_PLOT with null coordinates', () => {
        const data = [
            { x: 1, y: 2 },
            { x: null, y: 5 },
            { x: 3, y: null },
            { x: 4, y: 8 },
        ];
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y")', data)).not.toThrow();
    });

    it('PIE_CHART with null slice value (zero-effective)', () => {
        const data = [
            { category: 'a', value: 1 },
            { category: 'b', value: null },
            { category: 'c', value: 3 },
        ];
        expect(() => renderLeaf('PIE_CHART(category: "category", value: "value")', data)).not.toThrow();
    });

    it('HISTOGRAM ignores null/undefined samples', () => {
        const data = [
            { x: 1 }, { x: null }, { x: 2 }, { x: undefined }, { x: 3 },
        ];
        expect(() => renderLeaf('HISTOGRAM(x: "x")', data)).not.toThrow();
    });

    it('HEATMAP with null value cells', () => {
        const data = [
            { x: 'a', y: '1', value: 1 },
            { x: 'a', y: '2', value: null },
            { x: 'b', y: '1', value: 3 },
        ];
        expect(() => renderLeaf('HEATMAP(x: "x", y: "y", value: "value")', data)).not.toThrow();
    });
});

// ---- NaN / Infinity -----------------------------------------------------

describe('NaN / Infinity robustness', () => {
    it('LINE_CHART with NaN entries', () => {
        const data = [
            { time: 0, value: 1 },
            { time: 1, value: NaN },
            { time: 2, value: Infinity },
            { time: 3, value: -Infinity },
            { time: 4, value: 5 },
        ];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });

    it('BAR_CHART logScale skips NaN/Infinity safely', () => {
        const data = [
            { t: 'a', y: 1 },
            { t: 'b', y: NaN },
            { t: 'c', y: Infinity },
            { t: 'd', y: 100 },
        ];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"], logScale: true)', data)).not.toThrow();
    });

    it('HISTOGRAM with NaN-padded samples', () => {
        const data = [{ x: 1 }, { x: NaN }, { x: 2 }, { x: Infinity }, { x: 3 }];
        expect(() => renderLeaf('HISTOGRAM(x: "x")', data)).not.toThrow();
    });
});

// ---- Mixed types --------------------------------------------------------
// `JSON_EXTRACT(...)` and CASE expressions in user SQL can yield strings
// where a number is expected. Plots should coerce or skip — never throw.

describe('mixed-type column robustness', () => {
    it('LINE_CHART with numeric-as-string values', () => {
        const data = [
            { time: 0, value: '1.5' },
            { time: 1, value: '2.5' },
            { time: 2, value: 3 },
        ];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });

    it('SCATTER_PLOT with stringified numbers', () => {
        const data = [
            { x: '1', y: '2' },
            { x: '3', y: '4' },
        ];
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y")', data)).not.toThrow();
    });

    it('BAR_CHART with date-as-string x', () => {
        const data = [
            { t: '2026-01-01', y: 10 },
            { t: '2026-01-02', y: 20 },
            { t: '2026-01-03', y: 15 },
        ];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"])', data)).not.toThrow();
    });

    it('PIE_CHART with numeric-as-string slice values', () => {
        const data = [
            { c: 'a', v: '10' },
            { c: 'b', v: '20' },
            { c: 'c', v: '30' },
        ];
        expect(() => renderLeaf('PIE_CHART(category: "c", value: "v")', data)).not.toThrow();
    });
});

// ---- Single-row & two-row corner cases ---------------------------------
// Aggregations may return one row; box-plots / histograms then have nothing
// to bin against. Should render an empty plot frame, not crash.

describe('tiny-dataset robustness', () => {
    it('BAR_CHART with one row', () => {
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"])', [{ t: 'a', y: 1 }])).not.toThrow();
    });
    it('LINE_CHART with one point (no line possible)', () => {
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', [{ time: 0, value: 5 }])).not.toThrow();
    });
    it('SCATTER_PLOT with one point', () => {
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y")', [{ x: 1, y: 2 }])).not.toThrow();
    });
    it('HISTOGRAM with one sample', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x")', [{ x: 1 }])).not.toThrow();
    });
    it('BOX_PLOT with one value (degenerate quartiles)', () => {
        expect(() => renderLeaf('BOX_PLOT(value: "v")', [{ v: 5 }])).not.toThrow();
    });
    it('PIE_CHART with one slice', () => {
        expect(() => renderLeaf('PIE_CHART(category: "c", value: "v")', [{ c: 'only', v: 100 }])).not.toThrow();
    });
});

// ---- Large datasets -----------------------------------------------------
// LINE_CHART and AREA_CHART have LTTB decimation with a soft cap. We test
// that the decimation path itself doesn't throw on big inputs.

describe('large-dataset robustness', () => {
    it('LINE_CHART with 10k points (decimation path)', () => {
        const data = Array.from({ length: 10000 }, (_, i) => ({
            time: i,
            value: Math.sin(i / 100) * 100 + Math.random() * 10,
        }));
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });

    it('AREA_CHART with 10k points', () => {
        const data = Array.from({ length: 10000 }, (_, i) => ({
            time: i,
            value: Math.cos(i / 100) * 50 + 100,
        }));
        expect(() => renderLeaf('AREA_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });

    it('SCATTER_PLOT with 5k points', () => {
        const data = Array.from({ length: 5000 }, () => ({
            x: Math.random() * 100,
            y: Math.random() * 100,
        }));
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y")', data)).not.toThrow();
    });

    it('HISTOGRAM with 5k samples', () => {
        const data = Array.from({ length: 5000 }, () => ({ x: Math.random() * 1000 }));
        expect(() => renderLeaf('HISTOGRAM(x: "x", bins: 30)', data)).not.toThrow();
    });

    it('TABLE with 1k rows (virtualization path)', () => {
        const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `row-${i}`, value: i * 1.5 }));
        expect(() => renderLeaf('TABLE()', data)).not.toThrow();
    });
});

// ---- Missing-column behavior contract ----------------------------------
// User SQL might project columns that don't match the plot DSL's `x:` / `y:`.
// parseConfig SHOULD throw a structured error (caught upstream by PlotRenderer
// and turned into an inline error box). Asserting this is the contract — a
// silent empty chart would be worse UX.

describe('missing-column error contract', () => {
    it('BAR_CHART throws with hint when y column is absent', () => {
        const data = [{ t: 'a' }, { t: 'b' }, { t: 'c' }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["missing_col"])', data))
            .toThrow(/Column "missing_col" not found/);
    });

    it('LINE_CHART throws when x column is absent', () => {
        const data = [{ value: 1 }, { value: 2 }];
        expect(() => renderLeaf('LINE_CHART(x: "missing_time", y: ["value"])', data))
            .toThrow(/Column "missing_time" not found/);
    });

    it('SCATTER_PLOT throws when both columns absent', () => {
        const data = [{ a: 1 }, { a: 2 }];
        expect(() => renderLeaf('SCATTER_PLOT(x: "nope_x", y: "nope_y")', data))
            .toThrow(/Column "nope_x" not found/);
    });

    it('PIE_CHART throws when value column absent', () => {
        const data = [{ c: 'a' }, { c: 'b' }];
        expect(() => renderLeaf('PIE_CHART(category: "c", value: "missing_v")', data))
            .toThrow(/Column "missing_v" not found/);
    });

    it('error message includes available columns hint', () => {
        const data = [{ a: 1, b: 2, c: 3 }];
        try {
            renderLeaf('BAR_CHART(x: "missing", y: ["b"])', data);
            expect.fail('should have thrown');
        } catch (e: any) {
            expect(String(e.message)).toMatch(/Available columns/);
        }
    });
});

// ---- All-same-value edge case ------------------------------------------
// HISTOGRAM bin computation breaks if min===max; BOX_PLOT quartiles
// degenerate. They should still render a frame.

describe('zero-variance robustness', () => {
    it('HISTOGRAM where every sample is the same value', () => {
        const data = Array.from({ length: 100 }, () => ({ x: 42 }));
        expect(() => renderLeaf('HISTOGRAM(x: "x")', data)).not.toThrow();
    });

    it('BOX_PLOT where every value is identical', () => {
        const data = Array.from({ length: 20 }, () => ({ v: 7 }));
        expect(() => renderLeaf('BOX_PLOT(value: "v")', data)).not.toThrow();
    });

    it('LINE_CHART where all y values are equal', () => {
        const data = Array.from({ length: 10 }, (_, i) => ({ time: i, value: 5 }));
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"])', data)).not.toThrow();
    });
});

// ---- Negative-value robustness on log-scale axes ----------------------

describe('negative-value robustness', () => {
    it('LINE_CHART log Y with negative values (should not throw)', () => {
        const data = [
            { time: 0, value: -1 },
            { time: 1, value: 0 },
            { time: 2, value: 1 },
            { time: 3, value: 100 },
        ];
        // log-scale + non-positive values is a recharts warning, not a throw.
        // The component should either clip or accept gracefully.
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"], yScale: "log")', data)).not.toThrow();
    });

    it('BAR_CHART logScale with zero and negative bars', () => {
        const data = [{ t: 'a', y: -5 }, { t: 'b', y: 0 }, { t: 'c', y: 50 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"], logScale: true)', data)).not.toThrow();
    });
});

// =========================================================================
// BUG-5: Malformed DSL shows TABLE() fallback alongside error
//
// Investigation findings:
//   - In PlotRenderer, `lastValidContentRef` holds the last successfully
//     rendered plot. When a new config fails to parse, PlotRenderer shows
//     both the error banner AND lastValidContentRef (the stale valid content).
//     That stale content could be a TABLE() from the previous config, which
//     appears as a "TABLE fallback alongside error" in the UI.
//   - At the *parser/config layer* (below PlotRenderer), the behavior is
//     unambiguous: parseComposite on malformed input does NOT produce a
//     fallback — it returns a ParsedPlotCall whose mainConfig is the raw
//     malformed string, and the subsequent reg.parseConfig call then throws
//     a "Missing closing ')'" error. There is no silent TABLE substitution.
//   - The "error + TABLE" ambiguity is therefore a PlotRenderer UI concern,
//     not a parser concern. The unit tests below document the parser contract.
// =========================================================================

describe('malformed DSL parse behavior (BUG-5)', () => {
    const data = [
        { t: 'a', y: 1 },
        { t: 'b', y: 2 },
        { t: 'c', y: 3 },
    ];

    it('parseComposite on unclosed-paren input returns a mainConfig (no fallback table)', () => {
        // parseComposite itself is a pure parser — it never synthesises TABLE().
        // It returns the raw (malformed) string in mainConfig. There is no
        // "TABLE() fallback" at this layer.
        const malformed = 'LINE_CHART(x: "t", y: ["y"';
        const parsed = parseComposite(malformed);
        expect(parsed.composite).toBeUndefined();
        // mainConfig carries the raw input through; it is NOT silently rewritten to TABLE().
        expect(parsed.mainConfig).not.toMatch(/^TABLE\s*\(\s*\)/i);
        expect(parsed.mainConfig).toBe(malformed);
    });

    it('parseComposite on unclosed-paren input does NOT produce an error field itself', () => {
        // parseComposite is a structural parser only — it does not call parseConfig
        // and therefore cannot validate param-level syntax. No error is thrown here.
        const malformed = 'BAR_CHART(x: "t", y: ["y"';
        expect(() => parseComposite(malformed)).not.toThrow();
    });

    it('reg.parseConfig on unclosed-paren input throws a clear "Missing closing )" error', () => {
        // The error is produced by createConfigParser when the malformed mainConfig
        // fails the /^\w+\s*\(([\s\S]*)\)\s*$/ regex. The message explicitly names
        // the missing ")".
        const malformed = 'BAR_CHART(x: "t", y: ["y"';
        const parsed = parseComposite(malformed);
        const typeName = normalizePlotName(parsed.mainConfig.match(/^(\w+)/)?.[1] || '');
        const reg = plotRegistry[typeName];
        expect(reg).toBeTruthy(); // BAR_CHART is registered
        expect(() => reg!.parseConfig(parsed.mainConfig, data)).toThrow(/Missing closing "\)"/);
    });

    it('renderLeaf on unclosed-paren input throws (no silent TABLE fallback at parse layer)', () => {
        // End-to-end through renderLeaf: the throw should propagate, not be swallowed
        // and replaced with a TABLE() render. Any TABLE() shown alongside an error
        // in the real UI comes from PlotRenderer's lastValidContentRef, not from here.
        const malformed = 'LINE_CHART(x: "t", y: ["y"';
        expect(() => renderLeaf(malformed, data)).toThrow();
    });

    it('renderLeaf on empty string throws (no silent TABLE substitution)', () => {
        // An empty config string similarly throws at the parser level.
        expect(() => renderLeaf('', data)).toThrow();
    });

    it('completely garbled input throws (no silent TABLE substitution)', () => {
        // Verify the general contract: any input that cannot be parsed as a valid
        // plot DSL call results in a throw, never in silent TABLE fallback rendering.
        expect(() => renderLeaf('not a plot call at all', data)).toThrow();
    });
});
