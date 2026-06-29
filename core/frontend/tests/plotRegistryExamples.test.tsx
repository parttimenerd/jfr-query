// Per-plot smoke tests driven by each registration's own `examples` array.
//
// Contract per plot type:
//   1. Every example's `code` parses via parseComposite without throwing.
//   2. reg.parseConfig(mainConfig, sampleData) returns a non-null config.
//   3. React.createElement(reg.component, { config, data }) → renderToStaticMarkup
//      completes without throwing. Recharts' ResponsiveContainer often emits
//      no inner SVG under SSR (it waits for a measured size), so we assert
//      the wrapper element is present, NOT that the chart is fully painted.
//
// This catches: parser regressions, config-shape mismatches, component
// constructor / hook-order errors, and any throw inside the render path.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { plotRegistry } from '../components/plots/plotRegistry';
import { parseComposite } from '../utils/plotParser';
import { normalizePlotName } from '../components/plots/plotNames';

const sampleByType: Record<string, any[]> = {
    BAR_CHART: [{ gcCause: 'A', duration: 1 }, { gcCause: 'B', duration: 2 }],
    LINE_CHART: [{ time: 0, value: 1 }, { time: 1, value: 2 }],
    AREA_CHART: [{ time: 0, value: 1 }, { time: 1, value: 2 }],
    SCATTER_PLOT: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    PIE_CHART: [{ category: 'a', value: 1 }, { category: 'b', value: 2 }],
    BOX_PLOT: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }],
    HISTOGRAM: [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }],
    HEATMAP: [{ x: 'a', y: '1', value: 1 }, { x: 'b', y: '2', value: 2 }],
    RANGE: [{ x: 0, low: 1, high: 3 }, { x: 1, low: 2, high: 4 }],
    GANTT: [{ start: 0, end: 10, lane: 'T1' }, { start: 5, end: 20, lane: 'T2' }],
    TABLE: [{ a: 1, b: 2 }, { a: 3, b: 4 }],
    // Flamegraph expects hierarchical stack rows; minimal shape.
    FLAMEGRAPH: [{ stackTrace: 'a;b;c', samples: 10 }, { stackTrace: 'a;b;d', samples: 5 }],
};

function renderLeaf(code: string, data: any[]): string {
    const parsed = parseComposite(code);
    const main = parsed.mainConfig;
    const typeName = normalizePlotName(main.match(/^(\w+)/)?.[1] || '');
    const reg = plotRegistry[typeName];
    if (!reg) throw new Error(`No registry entry for type "${typeName}"`);
    const cfg = reg.parseConfig(main, data);
    expect(cfg, 'parseConfig produced a value').toBeTruthy();
    return renderToStaticMarkup(
        React.createElement(reg.component as any, { config: cfg, data, isAnimationActive: false }),
    );
}

describe('plot registry — every example renders', () => {
    for (const [name, reg] of Object.entries(plotRegistry)) {
        // Skip the FLAME_GRAPH alias; FLAMEGRAPH covers the same component.
        if (name === 'FLAME_GRAPH') continue;
        describe(name, () => {
            for (const example of reg.examples) {
                it(`example: ${example.description.slice(0, 60)}`, () => {
                    const data = example.sampleData ?? sampleByType[name] ?? [];
                    const html = renderLeaf(example.code, data);
                    // SSR of recharts typically yields a wrapper <div>; for
                    // non-recharts plots (TABLE) we get actual table markup.
                    // Either way, an empty string means React rendered nothing,
                    // which we treat as a failure.
                    expect(html.length, 'render produced markup').toBeGreaterThan(0);
                });
            }
        });
    }
});

describe('plot registry — every plot has metadata', () => {
    for (const [name, reg] of Object.entries(plotRegistry)) {
        it(`${name} has template, params, examples, parseConfig, component`, () => {
            expect(reg.template, 'template').toBeTruthy();
            expect(Array.isArray(reg.params), 'params is array').toBe(true);
            expect(reg.params.length, 'has at least one param').toBeGreaterThan(0);
            expect(Array.isArray(reg.examples), 'examples is array').toBe(true);
            expect(reg.examples.length, `${name} has at least one example`).toBeGreaterThan(0);
            expect(typeof reg.parseConfig, 'parseConfig is fn').toBe('function');
            expect(typeof reg.component, 'component is fn').toBe('function');
        });
    }
});

describe('plot registry — empty / minimal data does not crash render', () => {
    // Each plot should tolerate `data: []` (e.g., user wrote SQL that returned no rows).
    // We only assert no-throw; the visible output may be a "no data" message or empty wrapper.
    const minimalCallByType: Record<string, string> = {
        BAR_CHART: 'BAR_CHART(x: "gcCause", y: ["duration"])',
        LINE_CHART: 'LINE_CHART(x: "time", y: ["value"])',
        AREA_CHART: 'AREA_CHART(x: "time", y: ["value"])',
        SCATTER_PLOT: 'SCATTER_PLOT(x: "x", y: "y")',
        PIE_CHART: 'PIE_CHART(category: "category", value: "value")',
        BOX_PLOT: 'BOX_PLOT(value: "value")',
        HISTOGRAM: 'HISTOGRAM(x: "x")',
        HEATMAP: 'HEATMAP(x: "x", y: "y", value: "value")',
        RANGE: 'RANGE(x: "x", low: "low", high: "high")',
        GANTT: 'GANTT(start: "start", end: "end", lane: "lane")',
        TABLE: 'TABLE()',
        FLAMEGRAPH: 'FLAMEGRAPH(frames: "stackTrace", value: "samples")',
    };

    for (const [name, call] of Object.entries(minimalCallByType)) {
        it(`${name} handles empty data`, () => {
            expect(() => renderLeaf(call, [])).not.toThrow();
        });
    }
});

describe('plot registry — option permutations', () => {
    // Selected per-type options worth a smoke test beyond the canned examples.
    // The goal is to exercise option-conditional code paths in each component.

    it('BAR_CHART: stacked layout', () => {
        const data = [{ t: 'a', y1: 1, y2: 2 }, { t: 'b', y1: 3, y2: 4 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y1", "y2"], layout: "stacked")', data)).not.toThrow();
    });

    it('BAR_CHART: horizontal layout', () => {
        const data = [{ t: 'a', y: 1 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"], horizontal: true)', data)).not.toThrow();
    });

    it('BAR_CHART: logScale', () => {
        const data = [{ t: 'a', y: 10 }, { t: 'b', y: 100 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["y"], logScale: true)', data)).not.toThrow();
    });

    it('BAR_CHART: bar + lineY overlay (dual axis)', () => {
        const data = [{ t: 'a', bar: 1, line: 10 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["bar"], lineY: ["line"])', data)).not.toThrow();
    });

    it('LINE_CHART: log scale on Y', () => {
        const data = [{ time: 0, value: 1 }, { time: 1, value: 1000 }];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["value"], yScale: "log")', data)).not.toThrow();
    });

    it('AREA_CHART: stacked', () => {
        const data = [{ x: 0, a: 1, b: 2 }];
        expect(() => renderLeaf('AREA_CHART(x: "x", y: ["a", "b"], layout: "stacked")', data)).not.toThrow();
    });

    it('PIE_CHART: donut (innerRadius)', () => {
        const data = [{ c: 'a', v: 1 }, { c: 'b', v: 2 }];
        expect(() => renderLeaf('PIE_CHART(category: "c", value: "v", innerRadius: 40)', data)).not.toThrow();
    });

    it('SCATTER_PLOT: size column for bubble', () => {
        const data = [{ x: 1, y: 2, s: 5 }, { x: 3, y: 4, s: 10 }];
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y", size: "s")', data)).not.toThrow();
    });

    it('HISTOGRAM: explicit bins', () => {
        const data = Array.from({ length: 50 }, (_, i) => ({ x: i }));
        expect(() => renderLeaf('HISTOGRAM(x: "x", bins: 10)', data)).not.toThrow();
    });
});
