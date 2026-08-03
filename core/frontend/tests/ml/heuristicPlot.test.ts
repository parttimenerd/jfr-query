import { describe, it, expect } from 'vitest';
import { heuristicPlot } from '../../services/ml/heuristicPlot';

// ── helpers ───────────────────────────────────────────────────────────────────
function col(name: string, type: string) { return { name, type }; }
function rows(...entries: Record<string, unknown>[]) { return entries; }

// ── step 1: empty / trivial ───────────────────────────────────────────────────
describe('heuristicPlot — TABLE fallback', () => {
    it('empty columns → TABLE()', () => {
        expect(heuristicPlot([], [])).toBe('TABLE()');
    });

    it('single numeric column → TABLE()', () => {
        expect(heuristicPlot([col('count', 'BIGINT')], [])).toBe('TABLE()');
    });

    it('no matching rule → TABLE()', () => {
        // Multiple categories, no numerics — no supported chart type
        const cols = [col('phase', 'VARCHAR'), col('state', 'VARCHAR')];
        expect(heuristicPlot(cols, rows({ phase: 'G1', state: 'running' }))).toBe('TABLE()');
    });
});

// ── step 3: GANTT ─────────────────────────────────────────────────────────────
describe('heuristicPlot — GANTT', () => {
    it('start+end time cols + category → GANTT', () => {
        const cols = [col('startTime', 'BIGINT'), col('endTime', 'BIGINT'), col('phase', 'VARCHAR')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^GANTT\(/);
        expect(result).toContain('start: "startTime"');
        expect(result).toContain('end: "endTime"');
        expect(result).toContain('lane: "phase"');
    });

    it('two categories → second becomes task', () => {
        const cols = [
            col('startTime', 'BIGINT'), col('endTime', 'BIGINT'),
            col('thread', 'VARCHAR'), col('phase', 'VARCHAR'),
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toContain('lane: "thread"');
        expect(result).toContain('task: "phase"');
    });

    it('begin+finish names → GANTT', () => {
        const cols = [col('begin', 'BIGINT'), col('finish', 'BIGINT'), col('lane', 'VARCHAR')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^GANTT\(/);
        expect(result).toContain('start: "begin"');
        expect(result).toContain('end: "finish"');
    });

    it('two start-like cols but no end → no GANTT (LINE_CHART instead)', () => {
        // startTime + startAt with a category — neither is an end
        const cols = [col('startTime', 'BIGINT'), col('startAt', 'BIGINT'), col('phase', 'VARCHAR')];
        const result = heuristicPlot(cols, []);
        expect(result).not.toMatch(/^GANTT\(/);
    });

    it('start+end but no category → no GANTT', () => {
        const cols = [col('startTime', 'BIGINT'), col('endTime', 'BIGINT')];
        const result = heuristicPlot(cols, []);
        expect(result).not.toMatch(/^GANTT\(/);
    });
});

// ── step 4: RANGE ─────────────────────────────────────────────────────────────
describe('heuristicPlot — RANGE', () => {
    it('category + p25/p75 → RANGE with correct low/high', () => {
        const cols = [col('bucket', 'VARCHAR'), col('p25', 'DOUBLE'), col('p75', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^RANGE\(/);
        expect(result).toContain('low: "p25"');
        expect(result).toContain('high: "p75"');
        expect(result).toContain('x: "bucket"');
    });

    it('category + min/max → RANGE', () => {
        const cols = [col('gcType', 'VARCHAR'), col('min', 'DOUBLE'), col('max', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^RANGE\(/);
        expect(result).toContain('low: "min"');
        expect(result).toContain('high: "max"');
    });

    it('category + p5/p95 → RANGE (asymmetric percentiles)', () => {
        const cols = [col('phase', 'VARCHAR'), col('p5', 'DOUBLE'), col('p95', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^RANGE\(/);
    });

    it('category + two same-direction numerics → no RANGE', () => {
        // p25 + p10: both low — no valid low/high pair
        const cols = [col('phase', 'VARCHAR'), col('p25', 'DOUBLE'), col('p10', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).not.toMatch(/^RANGE\(/);
    });

    it('no category → no RANGE (falls through to SCATTER)', () => {
        const cols = [col('p25', 'DOUBLE'), col('p75', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^SCATTER_PLOT\(/);
    });
});

// ── step 5: AREA_CHART ────────────────────────────────────────────────────────
describe('heuristicPlot — AREA_CHART', () => {
    it('time + 3 stacked-named numerics → AREA_CHART stacked', () => {
        const cols = [
            col('bucket', 'BIGINT'),
            col('heapUsed', 'DOUBLE'), col('heapFree', 'DOUBLE'), col('metaspaceUsed', 'DOUBLE'),
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^AREA_CHART\(/);
        expect(result).toContain('layout: "stacked"');
        expect(result).toContain('x: "bucket"');
    });

    it('time + 3 independent numerics → LINE_CHART not AREA_CHART', () => {
        const cols = [
            col('bucket', 'BIGINT'),
            col('cpuUser', 'DOUBLE'), col('cpuSys', 'DOUBLE'), col('gcCount', 'DOUBLE'),
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
    });
});

// ── step 6: LINE_CHART ────────────────────────────────────────────────────────
describe('heuristicPlot — LINE_CHART', () => {
    it('time + single numeric → LINE_CHART', () => {
        const cols = [col('bucket', 'BIGINT'), col('pauseMs', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('x: "bucket"');
        expect(result).toContain('"pauseMs"');
    });

    it('time + two numerics → LINE_CHART with both y columns', () => {
        const cols = [col('bucket', 'BIGINT'), col('p50', 'DOUBLE'), col('p99', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('"p50"');
        expect(result).toContain('"p99"');
    });

    it('TIMESTAMP type column used as x', () => {
        const cols = [col('eventTime', 'TIMESTAMP'), col('allocMb', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('x: "eventTime"');
    });
});

// ── step 7: BAR_CHART ─────────────────────────────────────────────────────────
describe('heuristicPlot — BAR_CHART', () => {
    it('category + numeric with low cardinality → BAR_CHART', () => {
        const sampleRows = Array.from({ length: 5 }, (_, i) => ({ gcType: `Type${i}`, count: i * 10 }));
        const cols = [col('gcType', 'VARCHAR'), col('count', 'BIGINT')];
        const result = heuristicPlot(cols, sampleRows);
        expect(result).toMatch(/^BAR_CHART\(/);
        expect(result).toContain('x: "gcType"');
        expect(result).toContain('"count"');
    });

    it('category + numeric with high cardinality (>32) → TABLE()', () => {
        const sampleRows = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, val: i }));
        const cols = [col('name', 'VARCHAR'), col('val', 'BIGINT')];
        const result = heuristicPlot(cols, sampleRows);
        expect(result).toBe('TABLE()');
    });

    it('category + multiple numerics → grouped BAR_CHART', () => {
        const sampleRows = [
            { phase: 'G1 Young', p50: 5, p99: 20 },
            { phase: 'G1 Old', p50: 100, p99: 500 },
        ];
        const cols = [col('phase', 'VARCHAR'), col('p50', 'DOUBLE'), col('p99', 'DOUBLE')];
        const result = heuristicPlot(cols, sampleRows);
        expect(result).toMatch(/^BAR_CHART\(/);
        expect(result).toContain('"p50"');
        expect(result).toContain('"p99"');
    });

    it('empty sample with category → TABLE() (unknown cardinality)', () => {
        const cols = [col('gcType', 'VARCHAR'), col('count', 'BIGINT')];
        const result = heuristicPlot(cols, []);
        expect(result).toBe('TABLE()');
    });
});

// ── step 8: SCATTER_PLOT ──────────────────────────────────────────────────────
describe('heuristicPlot — SCATTER_PLOT', () => {
    it('two numerics, no time/category → SCATTER_PLOT', () => {
        const cols = [col('allocMb', 'DOUBLE'), col('pauseMs', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^SCATTER_PLOT\(/);
        expect(result).toContain('x: "allocMb"');
        expect(result).toContain('y: "pauseMs"');
    });
});

// ── step 9/10: HISTOGRAM ──────────────────────────────────────────────────────
describe('heuristicPlot — HISTOGRAM', () => {
    it('single numeric, no time/category → HISTOGRAM', () => {
        const cols = [col('pauseMs', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^HISTOGRAM\(/);
        expect(result).toContain('x: "pauseMs"');
    });

    it('three numerics, no time/category → HISTOGRAM of first', () => {
        const cols = [col('a', 'DOUBLE'), col('b', 'DOUBLE'), col('c', 'DOUBLE')];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^HISTOGRAM\(/);
        expect(result).toContain('x: "a"');
    });
});
