// Parameter-variant robustness for every plot type.
// Goal: verify that non-default params (layout, logScale, horizontal, y2,
// lineType, connectNulls, refLines, innerRadius, sliceLabel, logBins, etc.)
// do not crash the renderer.
//
// Pattern: identical to plotDataShapes.test.tsx — parse via registry then
// renderToStaticMarkup. We never assert visible output; a throw is a regression.

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

// =========================================================================
// BAR_CHART variants
// =========================================================================

describe('BAR_CHART param variants', () => {
    const multiSeries = [
        { label: 'A', y1: 10, y2: 5, grp: 'x' },
        { label: 'B', y1: 20, y2: 15, grp: 'y' },
        { label: 'C', y1: 30, y2: 25, grp: 'x' },
    ];

    it('layout:"stacked" multi-series', () => {
        expect(() => renderLeaf('BAR_CHART(x: "label", y: ["y1","y2"], layout: "stacked")', multiSeries)).not.toThrow();
    });

    it('layout:"grouped" multi-series (explicit default)', () => {
        expect(() => renderLeaf('BAR_CHART(x: "label", y: ["y1","y2"], layout: "grouped")', multiSeries)).not.toThrow();
    });

    it('horizontal:true', () => {
        expect(() => renderLeaf('BAR_CHART(x: "label", y: ["y1"], horizontal: true)', multiSeries)).not.toThrow();
    });

    it('logScale:true with all-positive values', () => {
        const data = [{ t: 'a', v: 1 }, { t: 'b', v: 10 }, { t: 'c', v: 100 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["v"], logScale: true)', data)).not.toThrow();
    });

    it('logScale:true with zero/negative values (should not throw)', () => {
        const data = [{ t: 'a', v: -5 }, { t: 'b', v: 0 }, { t: 'c', v: 50 }];
        expect(() => renderLeaf('BAR_CHART(x: "t", y: ["v"], logScale: true)', data)).not.toThrow();
    });

    it('lineY overlay (bars + lines)', () => {
        const data = [
            { ts: '12:00', alloc: 500, p99: 45 },
            { ts: '12:05', alloc: 800, p99: 60 },
            { ts: '12:10', alloc: 650, p99: 55 },
        ];
        expect(() => renderLeaf('BAR_CHART(x: "ts", y: ["alloc"], lineY: ["p99"])', data)).not.toThrow();
    });

    it('color column grouping', () => {
        expect(() => renderLeaf('BAR_CHART(x: "label", y: ["y1"], color: "grp")', multiSeries)).not.toThrow();
    });

    it('yAxisLabel with horizontal:true', () => {
        expect(() => renderLeaf('BAR_CHART(x: "label", y: ["y1"], horizontal: true, yAxisLabel: "Value")', multiSeries)).not.toThrow();
    });
});

// =========================================================================
// LINE_CHART variants
// =========================================================================

describe('LINE_CHART param variants', () => {
    const tsData = [
        { time: 0, v1: 10, v2: 99 },
        { time: 1, v1: 20, v2: 97 },
        { time: 2, v1: 15, v2: 98 },
        { time: 3, v1: 30, v2: 96 },
    ];

    it('y2 dual-axis', () => {
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v1"], y2: ["v2"])', tsData)).not.toThrow();
    });

    it('lineType:"dots"', () => {
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v1"], lineType: "dots")', tsData)).not.toThrow();
    });

    it('connectNulls:true with null gaps', () => {
        const gapped = [
            { time: 0, v: 10 },
            { time: 1, v: null },
            { time: 2, v: 15 },
            { time: 3, v: undefined },
            { time: 4, v: 20 },
        ];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v"], connectNulls: true)', gapped)).not.toThrow();
    });

    it('yRefLines horizontal reference line', () => {
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v1"], yRefLines: [{value: 50, label: "threshold"}])', tsData)).not.toThrow();
    });

    it('xRefLines vertical reference line', () => {
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v1"], xRefLines: [{value: 5, label: "event"}])', tsData)).not.toThrow();
    });

    it('yScale:"log" with positive values', () => {
        const posData = [{ time: 0, v: 1 }, { time: 1, v: 10 }, { time: 2, v: 100 }, { time: 3, v: 1000 }];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v"], yScale: "log")', posData)).not.toThrow();
    });

    it('yScale:"log" with non-positive values (should not throw)', () => {
        const mixedData = [{ time: 0, v: -1 }, { time: 1, v: 0 }, { time: 2, v: 1 }, { time: 3, v: 100 }];
        expect(() => renderLeaf('LINE_CHART(x: "time", y: ["v"], yScale: "log")', mixedData)).not.toThrow();
    });

    it('yAxisLabel and y2AxisLabel', () => {
        expect(() => renderLeaf(
            'LINE_CHART(x: "time", y: ["v1"], y2: ["v2"], yAxisLabel: "Primary", y2AxisLabel: "Secondary")',
            tsData,
        )).not.toThrow();
    });

    it('multiple yRefLines', () => {
        expect(() => renderLeaf(
            'LINE_CHART(x: "time", y: ["v1"], yRefLines: [{value: 10, label: "low"}, {value: 25, label: "high"}])',
            tsData,
        )).not.toThrow();
    });
});

// =========================================================================
// AREA_CHART variants
// =========================================================================

describe('AREA_CHART param variants', () => {
    const areaData = [
        { t: 0, eden: 200, survivor: 50, old: 300 },
        { t: 1, eden: 350, survivor: 80, old: 320 },
        { t: 2, eden: 100, survivor: 30, old: 340 },
        { t: 3, eden: 400, survivor: 90, old: 360 },
    ];

    it('layout:"stacked"', () => {
        expect(() => renderLeaf('AREA_CHART(x: "t", y: ["eden","survivor","old"], layout: "stacked")', areaData)).not.toThrow();
    });

    it('layout:"overlay"', () => {
        expect(() => renderLeaf('AREA_CHART(x: "t", y: ["eden","survivor"], layout: "overlay")', areaData)).not.toThrow();
    });

    it('connectNulls:true', () => {
        const gapped = [
            { t: 0, v: 100 },
            { t: 1, v: null },
            { t: 2, v: 150 },
            { t: 3, v: undefined },
            { t: 4, v: 200 },
        ];
        expect(() => renderLeaf('AREA_CHART(x: "t", y: ["v"], connectNulls: true)', gapped)).not.toThrow();
    });

    it('yAxisLabel', () => {
        expect(() => renderLeaf('AREA_CHART(x: "t", y: ["eden"], yAxisLabel: "Bytes")', areaData)).not.toThrow();
    });

    it('opacity non-default', () => {
        expect(() => renderLeaf('AREA_CHART(x: "t", y: ["eden"], opacity: 0.3)', areaData)).not.toThrow();
    });
});

// =========================================================================
// PIE_CHART variants
// =========================================================================

describe('PIE_CHART param variants', () => {
    const pieData = [
        { cause: 'Allocation Failure', count: 142 },
        { cause: 'Metadata GC Threshold', count: 23 },
        { cause: 'System.gc()', count: 8 },
        { cause: 'Ergonomics', count: 5 },
    ];

    it('innerRadius:0.5 (donut chart)', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", innerRadius: 0.5)', pieData)).not.toThrow();
    });

    it('sliceLabel:"inside"', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", sliceLabel: "inside")', pieData)).not.toThrow();
    });

    it('sliceLabel:"none"', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", sliceLabel: "none")', pieData)).not.toThrow();
    });

    it('sliceLabel:"outside" (default)', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", sliceLabel: "outside")', pieData)).not.toThrow();
    });

    it('donut with sliceLabel:"none"', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", innerRadius: 0.5, sliceLabel: "none")', pieData)).not.toThrow();
    });

    it('showPercent:false', () => {
        expect(() => renderLeaf('PIE_CHART(category: "cause", value: "count", showPercent: false)', pieData)).not.toThrow();
    });

    it('many slices (>12, triggers soft-cap folding)', () => {
        const bigData = Array.from({ length: 20 }, (_, i) => ({ cat: `cat-${i}`, val: i + 1 }));
        expect(() => renderLeaf('PIE_CHART(category: "cat", value: "val")', bigData)).not.toThrow();
    });
});

// =========================================================================
// HISTOGRAM variants
// =========================================================================

describe('HISTOGRAM param variants', () => {
    const posData = Array.from({ length: 50 }, (_, i) => ({ x: i + 1 }));
    const mixedData = [
        ...Array.from({ length: 20 }, (_, i) => ({ x: -5 + i * 0.5 })),
        ...Array.from({ length: 20 }, (_, i) => ({ x: i + 1 })),
    ];

    it('bins:"auto" (Freedman-Diaconis)', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x", bins: "auto")', posData)).not.toThrow();
    });

    it('logBins:true with all-positive data', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x", logBins: true)', posData)).not.toThrow();
    });

    it('logBins:true with mixed zero/negative data (should not throw)', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x", logBins: true)', mixedData)).not.toThrow();
    });

    it('explicit bin count', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x", bins: 20)', posData)).not.toThrow();
    });

    it('logScale:true on frequency axis', () => {
        expect(() => renderLeaf('HISTOGRAM(x: "x", logScale: true)', posData)).not.toThrow();
    });
});

// =========================================================================
// BOX_PLOT variants
// =========================================================================

describe('BOX_PLOT param variants', () => {
    const categorized = [
        ...Array.from({ length: 10 }, (_, i) => ({ gcType: 'Young', v: 5 + i })),
        ...Array.from({ length: 10 }, (_, i) => ({ gcType: 'Old', v: 80 + i * 5 })),
        ...Array.from({ length: 10 }, (_, i) => ({ gcType: 'Full', v: 200 + i * 10 })),
    ];

    it('with category column (multiple boxes)', () => {
        expect(() => renderLeaf('BOX_PLOT(value: "v", category: "gcType")', categorized)).not.toThrow();
    });

    it('single value column (no grouping)', () => {
        const data = Array.from({ length: 20 }, (_, i) => ({ v: i * 7 + 3 }));
        expect(() => renderLeaf('BOX_PLOT(value: "v")', data)).not.toThrow();
    });

    it('two distinct categories', () => {
        expect(() => renderLeaf('BOX_PLOT(value: "v", category: "gcType")', categorized.filter(d => d.gcType !== 'Full'))).not.toThrow();
    });

    it('many categories', () => {
        const many = Array.from({ length: 80 }, (_, i) => ({ cat: `cat-${i % 8}`, v: Math.random() * 100 }));
        expect(() => renderLeaf('BOX_PLOT(value: "v", category: "cat")', many)).not.toThrow();
    });
});

// =========================================================================
// SCATTER_PLOT variants
// =========================================================================

describe('SCATTER_PLOT param variants', () => {
    const scatterData = [
        { x: 100, y: 15, sz: 10, type: 'Allocation Failure' },
        { x: 200, y: 25, sz: 20, type: 'Allocation Failure' },
        { x: 150, y: 80, sz: 15, type: 'System.gc()' },
        { x: 300, y: 35, sz: 25, type: 'Allocation Failure' },
        { x: 250, y: 90, sz: 30, type: 'System.gc()' },
    ];

    it('with size column (bubble chart)', () => {
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y", size: "sz")', scatterData)).not.toThrow();
    });

    it('with color column grouping (one series per value)', () => {
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y", color: "type")', scatterData)).not.toThrow();
    });

    it('with size and color columns combined', () => {
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y", size: "sz", color: "type")', scatterData)).not.toThrow();
    });

    it('all identical size values (degenerate size domain)', () => {
        const same = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i * 2, sz: 10 }));
        expect(() => renderLeaf('SCATTER_PLOT(x: "x", y: "y", size: "sz")', same)).not.toThrow();
    });
});

// =========================================================================
// GANTT variants
// =========================================================================

describe('GANTT param variants', () => {
    const ganttData = [
        { s: '2023-01-01T12:00:00.000Z', e: '2023-01-01T12:00:00.050Z', lane: 'Young GC', state: 'minor' },
        { s: '2023-01-01T12:00:01.000Z', e: '2023-01-01T12:00:01.200Z', lane: 'Old GC', state: 'major' },
        { s: '2023-01-01T12:00:02.000Z', e: '2023-01-01T12:00:02.030Z', lane: 'Young GC', state: 'minor' },
    ];

    it('basic start/end/lane', () => {
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane")', ganttData)).not.toThrow();
    });

    it('with color column', () => {
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane", color: "state")', ganttData)).not.toThrow();
    });

    it('BigInt start/end values (should not throw)', () => {
        const bigintGantt = [
            { s: BigInt(1000000), e: BigInt(2000000), lane: 'Thread-1' },
            { s: BigInt(1500000), e: BigInt(3000000), lane: 'Thread-2' },
        ];
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane")', bigintGantt)).not.toThrow();
    });

    it('single row', () => {
        const single = [{ s: '2023-01-01T12:00:00.000Z', e: '2023-01-01T12:00:00.100Z', lane: 'GC' }];
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane")', single)).not.toThrow();
    });

    it('numeric start/end (non-time axis)', () => {
        const numericGantt = [
            { s: 100, e: 200, lane: 'phase-A' },
            { s: 150, e: 350, lane: 'phase-B' },
            { s: 300, e: 400, lane: 'phase-A' },
        ];
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane")', numericGantt)).not.toThrow();
    });

    it('task label column', () => {
        const labeled = [
            { s: '2023-01-01T12:00:00.000Z', e: '2023-01-01T12:00:00.050Z', lane: 'Thread-1', task: 'parse' },
            { s: '2023-01-01T12:00:00.100Z', e: '2023-01-01T12:00:00.300Z', lane: 'Thread-1', task: 'lock-wait' },
        ];
        expect(() => renderLeaf('GANTT(start: "s", end: "e", lane: "lane", task: "task")', labeled)).not.toThrow();
    });
});

// =========================================================================
// RANGE variants
// =========================================================================

describe('RANGE param variants', () => {
    const rangeData = [
        { t: 0, lo: 5, hi: 45, mid: 25 },
        { t: 1, lo: 8, hi: 60, mid: 34 },
        { t: 2, lo: 4, hi: 38, mid: 21 },
        { t: 3, lo: 10, hi: 80, mid: 45 },
    ];

    it('basic x/low/high', () => {
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi")', rangeData)).not.toThrow();
    });

    it('with center line', () => {
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi", center: "mid")', rangeData)).not.toThrow();
    });

    it('custom color and opacity', () => {
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi", color: "#82ca9d", opacity: 0.2)', rangeData)).not.toThrow();
    });

    it('single row', () => {
        const single = [{ t: 0, lo: 10, hi: 50 }];
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi")', single)).not.toThrow();
    });

    it('yAxisLabel', () => {
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi", yAxisLabel: "Latency (ms)")', rangeData)).not.toThrow();
    });

    it('low equals high (zero-width band)', () => {
        const flat = rangeData.map(r => ({ ...r, hi: r.lo }));
        expect(() => renderLeaf('RANGE(x: "t", low: "lo", high: "hi")', flat)).not.toThrow();
    });
});

// =========================================================================
// FLAMEGRAPH variants
// =========================================================================

describe('FLAMEGRAPH param variants', () => {
    const flameData = [
        { stack: 'java.lang.Thread.run;com.app.Worker.process;com.app.Parser.parse', cnt: 120 },
        { stack: 'java.lang.Thread.run;com.app.Worker.process;com.app.Network.send', cnt: 80 },
        { stack: 'java.lang.Thread.run;com.app.Worker.idle', cnt: 50 },
        { stack: 'GC Worker;G1ConcurrentMark.remark', cnt: 35 },
    ];

    it('basic frames/value', () => {
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt")', flameData)).not.toThrow();
    });

    it('with search param (initial search term)', () => {
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt", search: "Worker")', flameData)).not.toThrow();
    });

    it('with minFrameWidth param', () => {
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt", minFrameWidth: 1)', flameData)).not.toThrow();
    });

    it('semicolon-separated frame strings (normal path)', () => {
        const data = [
            { frames: 'A;B;C', val: 10 },
            { frames: 'A;B;D', val: 5 },
            { frames: 'A;E', val: 3 },
        ];
        expect(() => renderLeaf('FLAMEGRAPH(frames: "frames", value: "val")', data)).not.toThrow();
    });

    it('single frame (no semicolons)', () => {
        const single = [{ frames: 'com.app.Main.main', val: 100 }];
        expect(() => renderLeaf('FLAMEGRAPH(frames: "frames", value: "val")', single)).not.toThrow();
    });

    it('BigInt value column (should not throw)', () => {
        const bigintFlame = [
            { stack: 'A;B;C', cnt: BigInt(1000) },
            { stack: 'A;B;D', cnt: BigInt(500) },
        ];
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt")', bigintFlame)).not.toThrow();
    });

    it('empty/missing frames string (should not throw)', () => {
        const emptyFrames = [
            { stack: '', cnt: 10 },
            { stack: null, cnt: 5 },
            { stack: 'A;B', cnt: 20 },
        ];
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt")', emptyFrames)).not.toThrow();
    });

    it('direction:"up" icicle mode', () => {
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt", direction: "up")', flameData)).not.toThrow();
    });

    it('search with regex special chars (should not throw)', () => {
        expect(() => renderLeaf('FLAMEGRAPH(frames: "stack", value: "cnt", search: "com\\.app")', flameData)).not.toThrow();
    });
});

// =========================================================================
// HEATMAP variants
// =========================================================================

describe('HEATMAP param variants', () => {
    it('basic x/y/value', () => {
        const data = [
            { x: 'a', y: '1', v: 10 },
            { x: 'a', y: '2', v: 20 },
            { x: 'b', y: '1', v: 30 },
            { x: 'b', y: '2', v: 40 },
        ];
        expect(() => renderLeaf('HEATMAP(x: "x", y: "y", value: "v")', data)).not.toThrow();
    });

    it('many unique x/y labels (10x10 grid)', () => {
        const data: any[] = [];
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
                data.push({ col: `col-${i}`, row: `row-${j}`, val: i * 10 + j });
            }
        }
        expect(() => renderLeaf('HEATMAP(x: "col", y: "row", value: "val")', data)).not.toThrow();
    });

    it('all same value (zero variance — color scale edge case)', () => {
        const data = [
            { x: 'a', y: '1', v: 42 },
            { x: 'a', y: '2', v: 42 },
            { x: 'b', y: '1', v: 42 },
            { x: 'b', y: '2', v: 42 },
        ];
        expect(() => renderLeaf('HEATMAP(x: "x", y: "y", value: "v")', data)).not.toThrow();
    });

    it('single cell', () => {
        const data = [{ x: 'only', y: 'one', v: 1 }];
        expect(() => renderLeaf('HEATMAP(x: "x", y: "y", value: "v")', data)).not.toThrow();
    });

    it('float values', () => {
        const data = [
            { h: '08:00', d: 'Mon', cpu: 0.45 },
            { h: '09:00', d: 'Mon', cpu: 0.82 },
            { h: '08:00', d: 'Tue', cpu: 0.38 },
            { h: '09:00', d: 'Tue', cpu: 0.75 },
        ];
        expect(() => renderLeaf('HEATMAP(x: "h", y: "d", value: "cpu")', data)).not.toThrow();
    });
});

// =========================================================================
// BUG-2: RANGE_CHART DSL parameter name mismatch
//
// Investigation findings:
//   - The registry key is "RANGE", not "RANGE_CHART". normalizePlotName does
//     not have a RANGE_CHART → RANGE alias, so "RANGE_CHART" fails with
//     "No registry entry for RANGE_CHART" before any param validation even runs.
//   - The correct canonical params are x, low, high, center — NOT y, yLow, yHigh.
//   - Using y/yLow/yHigh throws: Unknown parameter "y" (resp. yLow, yHigh).
//   - There are no aliasFor entries in RangePlot.tsx for these alternate names.
// =========================================================================

describe('RANGE_CHART DSL parameter name mismatch (BUG-2)', () => {
    const rangeData = [
        { label: 'p0', val: 25, lo: 5, hi: 45 },
        { label: 'p1', val: 34, lo: 8, hi: 60 },
        { label: 'p2', val: 21, lo: 4, hi: 38 },
        { label: 'p3', val: 45, lo: 10, hi: 80 },
    ];

    // --- Correct usage: canonical param names with canonical type name --------

    it('RANGE with correct params (x/center/low/high) renders without throwing', () => {
        // This is the supported API. All four params map to registered spec entries.
        expect(() =>
            renderLeaf('RANGE(x:"label", center:"val", low:"lo", high:"hi")', rangeData),
        ).not.toThrow();
    });

    // --- BUG-2a: wrong type name (RANGE_CHART vs. RANGE) ----------------------

    it('RANGE_CHART is NOT a known registry alias — throws a clear "No registry entry" error', () => {
        // normalizePlotName("RANGE_CHART") returns "RANGE_CHART" (no alias defined),
        // and plotRegistry["RANGE_CHART"] is undefined, so renderLeaf throws immediately.
        // This test documents the current behavior: RANGE_CHART is rejected at the
        // registry lookup step, not at param validation.
        expect(() =>
            renderLeaf('RANGE_CHART(x:"label", center:"val", low:"lo", high:"hi")', rangeData),
        ).toThrow(/No registry entry for RANGE_CHART/);
    });

    // --- BUG-2b: legacy / misspelled param names (y, yLow, yHigh) with RANGE --

    it('RANGE with y/yLow/yHigh params throws "Unknown parameter" error for "y"', () => {
        // The RangePlot spec has no entry for "y", "yLow", or "yHigh" and no
        // aliasFor mappings pointing to them. The config parser therefore rejects
        // the first unknown name it encounters.
        // This test documents the bug: a user writing RANGE(x, y, yLow, yHigh)
        // sees an opaque "Unknown parameter" error instead of a helpful suggestion.
        expect(() =>
            renderLeaf('RANGE(x:"label", y:"val", yLow:"lo", yHigh:"hi")', rangeData),
        ).toThrow(/Unknown parameter "y"/);
    });

    it('RANGE error for unknown param y includes available param names', () => {
        // The error message should list the valid params so the user knows to use
        // "low", "high", and "center" instead of "y", "yLow", "yHigh".
        try {
            renderLeaf('RANGE(x:"label", y:"val", yLow:"lo", yHigh:"hi")', rangeData);
            expect.fail('should have thrown');
        } catch (e: any) {
            const msg: string = String(e.message);
            // The error mentions the function name and the valid params.
            expect(msg).toMatch(/RANGE/i);
            // At minimum one of the correct param names should appear in the hint.
            const mentionsValidParam = /\blow\b|\bhigh\b|\bcenter\b/.test(msg);
            expect(mentionsValidParam).toBe(true);
        }
    });
});
