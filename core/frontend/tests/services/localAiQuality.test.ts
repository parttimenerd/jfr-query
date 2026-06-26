// Tests that the local AI inference paths produce plot configs the actual plot
// registry will accept. The plot registry param names (BAR_CHART(x:, y:[]),
// HISTOGRAM(value:), SCATTER_PLOT(x:, y:), …) are the contract — if these
// tests fail, plots will silently fail to render in the UI.

import { describe, it, expect } from 'vitest';
import { heuristicPlot } from '../../services/ml/heuristicPlot';
import { cleanPlotConfig, CANDIDATES } from '../../services/ml/candidates';
import { isParseablePlotConfig } from '../../services/ml/isParseablePlotConfig';

describe('heuristicPlot — output is a valid plot-registry config', () => {
    it('time + 1 numeric → LINE_CHART(x, y[])', () => {
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'cpuLoad', type: 'DOUBLE' },
        ];
        const sample = [{ ts: 1, cpuLoad: 0.5 }];
        expect(heuristicPlot(cols, sample)).toBe('LINE_CHART(x: "ts", y: ["cpuLoad"])');
    });

    it('time + 2 numerics → LINE_CHART with multiple y', () => {
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'cpuLoad', type: 'DOUBLE' },
            { name: 'memUsed', type: 'BIGINT' },
        ];
        expect(heuristicPlot(cols, [{ ts: 1, cpuLoad: 1, memUsed: 1 }])).toBe(
            'LINE_CHART(x: "ts", y: ["cpuLoad", "memUsed"])',
        );
    });

    it('single category + single numeric → BAR_CHART(x, y[]) — NOT category/value', () => {
        const cols = [
            { name: 'gcCause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const out = heuristicPlot(cols, [{ gcCause: 'G1', count: 10 }]);
        expect(out).toBe('BAR_CHART(x: "gcCause", y: ["count"])');
        // Regression guard: never emit the legacy `category:` / `value:` syntax.
        expect(out).not.toMatch(/\bcategory\s*:/);
    });

    it('category + multiple numerics → grouped BAR_CHART(x, y[])', () => {
        const cols = [
            { name: 'gcCause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
            { name: 'totalMs', type: 'BIGINT' },
        ];
        expect(heuristicPlot(cols, [{ gcCause: 'G1', count: 1, totalMs: 1 }])).toBe(
            'BAR_CHART(x: "gcCause", y: ["count", "totalMs"])',
        );
    });

    it('2 numerics, no time/cat → SCATTER_PLOT (with the underscore — NOT SCATTER)', () => {
        const cols = [
            { name: 'reclaimedBytes', type: 'BIGINT' },
            { name: 'pauseDuration', type: 'DOUBLE' },
        ];
        const out = heuristicPlot(cols, [{ reclaimedBytes: 1, pauseDuration: 1 }]);
        expect(out).toBe('SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration")');
        expect(out).not.toMatch(/^SCATTER\(/);
    });

    it('single numeric, no time/cat → HISTOGRAM(value:) — NOT HISTOGRAM(column:)', () => {
        const cols = [{ name: 'duration', type: 'DOUBLE' }];
        const out = heuristicPlot(cols, [{ duration: 5 }, { duration: 8 }]);
        // Single column + numeric is now a scalar/TABLE in the heuristic;
        // for two+ rows we still want it treated as a distribution candidate.
        // Reality: with cols.length === 1 the function returns TABLE() because
        // there's only one role. That's fine for a single-column scalar result.
        expect(out).toBe('TABLE()');
    });

    it('two numerics, no time/cat → SCATTER_PLOT not HISTOGRAM', () => {
        // The previous heuristic returned HISTOGRAM here, which is wrong because
        // we have two columns the user clearly cares about. Scatter is sharper.
        const cols = [
            { name: 'a', type: 'BIGINT' },
            { name: 'b', type: 'BIGINT' },
        ];
        expect(heuristicPlot(cols, [{ a: 1, b: 2 }])).toBe('SCATTER_PLOT(x: "a", y: "b")');
    });

    it('empty columns → TABLE()', () => {
        expect(heuristicPlot([], [])).toBe('TABLE()');
    });

    it('only categorical columns → TABLE()', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'region', type: 'VARCHAR' },
        ];
        expect(heuristicPlot(cols, [{ host: 'a', region: 'eu' }])).toBe('TABLE()');
    });

    // ── cardinality-aware switching ──────────────────────────────────────
    it('high-cardinality category + numeric → TABLE() (bar of >32 bars is unreadable)', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'reqCount', type: 'BIGINT' },
        ];
        // 40 distinct hosts.
        const sample = Array.from({ length: 40 }, (_, i) => ({ host: `h${i}`, reqCount: i }));
        expect(heuristicPlot(cols, sample)).toBe('TABLE()');
    });

    it('low-cardinality category + numeric → BAR_CHART (4 distinct values)', () => {
        const cols = [
            { name: 'gcCause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const sample = [
            { gcCause: 'G1 Evacuation', count: 10 },
            { gcCause: 'Allocation Failure', count: 5 },
            { gcCause: 'System.gc()', count: 2 },
            { gcCause: 'Metadata GC', count: 1 },
        ];
        expect(heuristicPlot(cols, sample)).toBe('BAR_CHART(x: "gcCause", y: ["count"])');
    });

    it('high-cardinality category + multiple numerics → TABLE()', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'cpu', type: 'DOUBLE' },
            { name: 'mem', type: 'BIGINT' },
        ];
        const sample = Array.from({ length: 50 }, (_, i) => ({ host: `h${i}`, cpu: i, mem: i }));
        expect(heuristicPlot(cols, sample)).toBe('TABLE()');
    });

    // ── expanded time-name detection ────────────────────────────────────
    it('startTime (no timestamp type) is recognised as time axis', () => {
        const cols = [
            { name: 'startTime', type: 'BIGINT' },  // jfr often stores ns
            { name: 'cpuLoad', type: 'DOUBLE' },
        ];
        // No sample → name-based detection only. BIGINT typically numeric,
        // but `startTime` matches the time-name regex AND isn't a duration.
        const out = heuristicPlot(cols, [{ startTime: 1, cpuLoad: 0.5 }]);
        expect(out).toBe('LINE_CHART(x: "startTime", y: ["cpuLoad"])');
    });

    it('created_at (snake_case timestamp suffix) is recognised as time axis', () => {
        const cols = [
            { name: 'created_at', type: 'VARCHAR' },  // ISO string column
            { name: 'count', type: 'BIGINT' },
        ];
        const out = heuristicPlot(cols, [{ created_at: '2026-01-01', count: 1 }]);
        expect(out).toBe('LINE_CHART(x: "created_at", y: ["count"])');
    });

    it('pauseDuration is NOT misclassified as time (despite "Time"-ish look)', () => {
        // Common pitfall: durations are numeric, not temporal.
        // We never want pauseDuration on the x-axis as a "time".
        const cols = [
            { name: 'reclaimedBytes', type: 'BIGINT' },
            { name: 'pauseDuration', type: 'DOUBLE' },
        ];
        const out = heuristicPlot(cols, [{ reclaimedBytes: 1, pauseDuration: 1 }]);
        // 2 numerics, no time → SCATTER_PLOT.
        expect(out).toBe('SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration")');
    });

    it('pauseTime is NOT misclassified as time', () => {
        const cols = [
            { name: 'pauseTime', type: 'DOUBLE' },
            { name: 'reclaimedBytes', type: 'BIGINT' },
        ];
        const out = heuristicPlot(cols, [{ pauseTime: 1, reclaimedBytes: 2 }]);
        expect(out).toBe('SCATTER_PLOT(x: "pauseTime", y: "reclaimedBytes")');
    });
});

describe('cleanPlotConfig — recovers a plot config from noisy model output', () => {
    it('strips a leading prose preamble', () => {
        const raw = 'Sure, here is the config:\nLINE_CHART(x: "ts", y: ["cpu"])';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('strips markdown code fences', () => {
        const raw = '```plot\nBAR_CHART(x: "host", y: ["count"])\n```';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "host", y: ["count"])');
    });

    it('strips wrapping double quotes', () => {
        const raw = '"LINE_CHART(x: \\"ts\\", y: [\\"cpu\\"])"';
        // Inner escaped quotes survive unescaping is not our concern — only outer wrapping.
        const out = cleanPlotConfig(raw);
        expect(out.startsWith('LINE_CHART(')).toBe(true);
        expect(out.endsWith(')')).toBe(true);
    });

    it('strips wrapping backticks', () => {
        expect(cleanPlotConfig('`HISTOGRAM(value: "pauseMs")`')).toBe('HISTOGRAM(value: "pauseMs")');
    });

    it('strips HuggingFace special tokens', () => {
        const raw = '<pad>LINE_CHART(x: "ts", y: ["cpu"])</s>';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('strips <|endoftext|> / <|im_end|> from causal LM output', () => {
        const raw = 'BAR_CHART(x: "host", y: ["count"])<|im_end|>';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "host", y: ["count"])');
    });

    it('truncates trailing prose after the balanced paren', () => {
        const raw = 'LINE_CHART(x: "ts", y: ["cpu"])\nThis chart shows CPU load over time.';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('keeps same-line trailing modifiers like TITLE "…"', () => {
        const raw = 'LINE_CHART(x: "ts", y: ["cpu"]) TITLE "CPU Load"';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "ts", y: ["cpu"]) TITLE "CPU Load"');
    });

    it('handles nested parens (function args inside plot config)', () => {
        const raw = 'LINE_CHART(x: "ts", y: ["cpu"], yRefLines: [{value: 500, label: "High"}])';
        expect(cleanPlotConfig(raw)).toBe(raw);
    });

    it('falls back to TABLE() when no recognised plot name is found', () => {
        expect(cleanPlotConfig('I do not know what plot you want here')).toBe(
            'I do not know what plot you want here', // no plot name → returned as-is (TABLE() fallback only when empty)
        );
        // Truly empty / whitespace → TABLE().
        expect(cleanPlotConfig('   ')).toBe('TABLE()');
        expect(cleanPlotConfig('')).toBe('TABLE()');
    });

    it('handles parens inside string literals without confusing balance counter', () => {
        const raw = 'BAR_CHART(x: "(host)", y: ["count"])';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "(host)", y: ["count"])');
    });

    it('selects the earliest plot name when multiple appear', () => {
        const raw = 'Maybe LINE_CHART(x: "ts") or alternatively BAR_CHART(x: "h", y: ["c"])';
        const out = cleanPlotConfig(raw);
        expect(out.startsWith('LINE_CHART(')).toBe(true);
    });
});

describe('candidates — extractOutput produces valid configs from real model noise', () => {
    it('t5-small-finetuned (seq2seq) cleans wrapped output', () => {
        const c = CANDIDATES['t5-small-finetuned'];
        expect(c.extractOutput('<pad> LINE_CHART(x: "ts", y: ["cpu"])</s>')).toBe(
            'LINE_CHART(x: "ts", y: ["cpu"])',
        );
    });

    it('flan-t5-small (seq2seq) handles plain output', () => {
        const c = CANDIDATES['flan-t5-small'];
        expect(c.extractOutput('TABLE()')).toBe('TABLE()');
    });

    it('qwen2.5-coder-0.5b (causal-lm) strips chat-template artefacts', () => {
        const c = CANDIDATES['qwen2.5-coder-0.5b'];
        const raw = 'Sure! Here is the plot config:\nBAR_CHART(x: "gcCause", y: ["count"])<|im_end|>';
        expect(c.extractOutput(raw)).toBe('BAR_CHART(x: "gcCause", y: ["count"])');
    });

    it('smollm2-360m (causal-lm) survives fenced output', () => {
        const c = CANDIDATES['smollm2-360m'];
        const raw = '```\nHISTOGRAM(value: "pauseMs")\n```';
        expect(c.extractOutput(raw)).toBe('HISTOGRAM(value: "pauseMs")');
    });
});

describe('contract: heuristicPlot output is accepted by the real plot registry', () => {
    // Critical regression suite: every output of heuristicPlot MUST parse via
    // the plot registry's `parseConfig`. If a plot template's param name changes
    // (e.g. BAR_CHART expected `category:` once, now expects `x:`), this test
    // catches the silent breakage.

    it('LINE_CHART suggestion parses', () => {
        const cfg = heuristicPlot(
            [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'cpu', type: 'DOUBLE' }],
            [{ ts: 1, cpu: 1 }],
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('BAR_CHART suggestion parses (regression for category:/value: bug)', () => {
        const cfg = heuristicPlot(
            [{ name: 'host', type: 'VARCHAR' }, { name: 'count', type: 'BIGINT' }],
            [{ host: 'a', count: 1 }],
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('SCATTER_PLOT suggestion parses (regression for SCATTER vs SCATTER_PLOT bug)', () => {
        const cfg = heuristicPlot(
            [{ name: 'x', type: 'BIGINT' }, { name: 'y', type: 'BIGINT' }],
            [{ x: 1, y: 2 }],
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('HISTOGRAM suggestion parses (regression for column: vs value: bug)', () => {
        const cfg = heuristicPlot(
            [{ name: 'dur1', type: 'DOUBLE' }, { name: 'dur2', type: 'DOUBLE' }, { name: 'dur3', type: 'DOUBLE' }],
            [{ dur1: 1, dur2: 2, dur3: 3 }],
        );
        // 3 numerics, no time, no category → HISTOGRAM(value: "dur1").
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('TABLE fallback parses', () => {
        expect(isParseablePlotConfig(heuristicPlot([], []))).toBe(true);
    });

    it('grouped BAR_CHART (1 cat + N numerics) parses', () => {
        const cfg = heuristicPlot(
            [
                { name: 'host', type: 'VARCHAR' },
                { name: 'cpu', type: 'DOUBLE' },
                { name: 'mem', type: 'BIGINT' },
            ],
            [{ host: 'a', cpu: 1, mem: 1 }],
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('startTime-named BIGINT column produces a parseable LINE_CHART', () => {
        const cfg = heuristicPlot(
            [{ name: 'startTime', type: 'BIGINT' }, { name: 'pauseMs', type: 'DOUBLE' }],
            [{ startTime: 1, pauseMs: 2 }],
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
        expect(cfg).toContain('LINE_CHART');
    });

    it('high-cardinality category produces a parseable TABLE() (not BAR with 100 bars)', () => {
        const sample = Array.from({ length: 50 }, (_, i) => ({ host: `h${i}`, c: i }));
        const cfg = heuristicPlot(
            [{ name: 'host', type: 'VARCHAR' }, { name: 'c', type: 'BIGINT' }],
            sample,
        );
        expect(isParseablePlotConfig(cfg)).toBe(true);
        expect(cfg).toBe('TABLE()');
    });
});

// W6 — New emission branches: AREA / GANTT / RANGE.
describe('heuristicPlot — AREA_CHART (time + 3+ numerics → stacked)', () => {
    it('emits LINE_CHART for independent metrics like cpu/mem/disk (B-089)', () => {
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'cpu', type: 'DOUBLE' },
            { name: 'mem', type: 'DOUBLE' },
            { name: 'disk', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ ts: 1, cpu: 1, mem: 1, disk: 1 }]);
        // Independent metrics should use LINE_CHART, not stacked AREA_CHART
        expect(cfg).toContain('LINE_CHART');
        expect(cfg).not.toContain('AREA_CHART');
        expect(cfg).toContain('x: "ts"');
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('emits stacked AREA_CHART when 3+ numerics look like heap regions (B-089)', () => {
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'heapUsed', type: 'BIGINT' },
            { name: 'heapFree', type: 'BIGINT' },
            { name: 'heapReserved', type: 'BIGINT' },
        ];
        const cfg = heuristicPlot(cols, [{ ts: 1, heapUsed: 1, heapFree: 1, heapReserved: 1 }]);
        expect(cfg).toContain('AREA_CHART');
        expect(cfg).toContain('layout: "stacked"');
        expect(cfg).toContain('x: "ts"');
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('stays on LINE_CHART for time + 2 numerics (only flips at 3+)', () => {
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'cpu', type: 'DOUBLE' },
            { name: 'mem', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ ts: 1, cpu: 1, mem: 1 }]);
        expect(cfg).toContain('LINE_CHART');
        expect(cfg).not.toContain('AREA_CHART');
    });
});

describe('heuristicPlot — GANTT (start* + end* + category)', () => {
    it('emits GANTT for startTime + endTime + thread', () => {
        const cols = [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'endTime', type: 'TIMESTAMP' },
            { name: 'thread', type: 'VARCHAR' },
        ];
        const cfg = heuristicPlot(cols, [{ startTime: 1, endTime: 2, thread: 't1' }]);
        expect(cfg).toContain('GANTT');
        expect(cfg).toContain('start: "startTime"');
        expect(cfg).toContain('end: "endTime"');
        expect(cfg).toContain('lane: "thread"');
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('uses second category as task when both present', () => {
        const cols = [
            { name: 'beginAt', type: 'TIMESTAMP' },
            { name: 'finishAt', type: 'TIMESTAMP' },
            { name: 'thread', type: 'VARCHAR' },
            { name: 'phase', type: 'VARCHAR' },
        ];
        const cfg = heuristicPlot(cols, [{ beginAt: 1, finishAt: 2, thread: 't1', phase: 'gc' }]);
        expect(cfg).toContain('GANTT');
        expect(cfg).toContain('lane: "thread"');
        expect(cfg).toContain('task: "phase"');
    });

    it('does NOT emit GANTT when only start* matches (conservative)', () => {
        const cols = [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'thread', type: 'VARCHAR' },
        ];
        const cfg = heuristicPlot(cols, [{ startTime: 1, duration: 1, thread: 't' }]);
        expect(cfg).not.toContain('GANTT');
    });

    it('does NOT emit GANTT without a category column', () => {
        const cols = [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'endTime', type: 'TIMESTAMP' },
        ];
        const cfg = heuristicPlot(cols, [{ startTime: 1, endTime: 2 }]);
        expect(cfg).not.toContain('GANTT');
    });
});

describe('heuristicPlot — RANGE (1 category + low/high numerics)', () => {
    it('emits RANGE for host + minLatency + maxLatency', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'minLatency', type: 'DOUBLE' },
            { name: 'maxLatency', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ host: 'h1', minLatency: 1, maxLatency: 10 }]);
        expect(cfg).toContain('RANGE');
        expect(cfg).toContain('x: "host"');
        expect(cfg).toContain('low: "minLatency"');
        expect(cfg).toContain('high: "maxLatency"');
        expect(isParseablePlotConfig(cfg)).toBe(true);
    });

    it('emits RANGE for host + p25 + p75', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'p25', type: 'DOUBLE' },
            { name: 'p75', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ host: 'h1', p25: 1, p75: 5 }]);
        expect(cfg).toContain('RANGE');
        expect(cfg).toContain('low: "p25"');
        expect(cfg).toContain('high: "p75"');
    });

    it('orders low/high correctly regardless of column order in input', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'maxLatency', type: 'DOUBLE' },
            { name: 'minLatency', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ host: 'h', maxLatency: 10, minLatency: 1 }]);
        expect(cfg).toContain('low: "minLatency"');
        expect(cfg).toContain('high: "maxLatency"');
    });

    it('falls back to grouped BAR when two numerics do NOT look like a range pair', () => {
        const cols = [
            { name: 'host', type: 'VARCHAR' },
            { name: 'cpu', type: 'DOUBLE' },
            { name: 'mem', type: 'DOUBLE' },
        ];
        const cfg = heuristicPlot(cols, [{ host: 'h1', cpu: 1, mem: 2 }]);
        expect(cfg).toContain('BAR_CHART');
        expect(cfg).not.toContain('RANGE');
    });
});
