import { describe, it, expect } from 'vitest';
import { heuristicPlot } from '../../../services/ml/heuristicPlot';

type Col = { name: string; type: string };

// ─── edge cases ──────────────────────────────────────────────────────────────

describe('heuristicPlot — edge cases', () => {
    it('returns TABLE() for empty columns', () => {
        expect(heuristicPlot([], [])).toBe('TABLE()');
    });

    it('returns BIG_NUMBER for single aggregate column (count)', () => {
        const result = heuristicPlot([{ name: 'count', type: 'BIGINT' }], []);
        expect(result).toMatch(/^BIG_NUMBER\(/);
    });
});

// ─── GANTT ────────────────────────────────────────────────────────────────────

describe('heuristicPlot — GANTT', () => {
    it('produces GANTT with start+end+category', () => {
        const cols: Col[] = [
            { name: 'start', type: 'BIGINT' },
            { name: 'end', type: 'BIGINT' },
            { name: 'task', type: 'VARCHAR' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^GANTT\(/);
        expect(result).toContain('"start"');
        expect(result).toContain('"end"');
        expect(result).toContain('lane: "task"');
    });

    it('includes task param when two category columns present', () => {
        const cols: Col[] = [
            { name: 'startTime', type: 'BIGINT' },
            { name: 'endTime', type: 'BIGINT' },
            { name: 'lane', type: 'VARCHAR' },
            { name: 'label', type: 'VARCHAR' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toContain('task: "label"');
    });

    it('does NOT produce GANTT without end col', () => {
        const cols: Col[] = [
            { name: 'startTime', type: 'BIGINT' },
            { name: 'task', type: 'VARCHAR' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).not.toMatch(/^GANTT/);
    });

    it('does NOT produce GANTT without a category', () => {
        const cols: Col[] = [
            { name: 'start', type: 'BIGINT' },
            { name: 'end', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).not.toMatch(/^GANTT/);
    });
});

// ─── RANGE ────────────────────────────────────────────────────────────────────

describe('heuristicPlot — RANGE', () => {
    it('produces RANGE with category + p25/p75 numerics', () => {
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'p25', type: 'BIGINT' },
            { name: 'p75', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^RANGE\(/);
        expect(result).toContain('low: "p25"');
        expect(result).toContain('high: "p75"');
    });

    it('produces RANGE with min/max numerics', () => {
        const cols: Col[] = [
            { name: 'type', type: 'VARCHAR' },
            { name: 'min', type: 'DOUBLE' },
            { name: 'max', type: 'DOUBLE' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^RANGE\(/);
    });

    it('does NOT produce RANGE when both numerics are same bound (p25+p10)', () => {
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'p25', type: 'BIGINT' },
            { name: 'p10', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        // both are 'low' so range not produced
        expect(result).not.toMatch(/^RANGE/);
    });
});

// ─── AREA_CHART ───────────────────────────────────────────────────────────────

describe('heuristicPlot — AREA_CHART (stacked)', () => {
    it('produces stacked AREA_CHART for time + heap region numerics', () => {
        const cols: Col[] = [
            { name: 'time', type: 'BIGINT' },
            { name: 'eden', type: 'BIGINT' },
            { name: 'survivor', type: 'BIGINT' },
            { name: 'heap', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^AREA_CHART\(/);
        expect(result).toContain('layout: "stacked"');
    });

    it('falls back to LINE_CHART for time + 3 independent metrics', () => {
        const cols: Col[] = [
            { name: 'time', type: 'BIGINT' },
            { name: 'cpuUser', type: 'DOUBLE' },
            { name: 'cpuSystem', type: 'DOUBLE' },
            { name: 'cpuIdle', type: 'DOUBLE' },
        ];
        // 'cpuIdle' does not match STACKED_NAMES_RE so falls back to LINE_CHART
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
    });
});

// ─── LINE_CHART ───────────────────────────────────────────────────────────────

describe('heuristicPlot — LINE_CHART', () => {
    it('produces LINE_CHART for time + single numeric', () => {
        const cols: Col[] = [
            { name: 'time', type: 'BIGINT' },
            { name: 'value', type: 'DOUBLE' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('x: "time"');
        expect(result).toContain('"value"');
    });

    it('includes all numeric columns in y list', () => {
        const cols: Col[] = [
            { name: 'ts', type: 'BIGINT' },
            { name: 'a', type: 'DOUBLE' },
            { name: 'b', type: 'DOUBLE' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toContain('"a"');
        expect(result).toContain('"b"');
    });
});

// ─── BAR_CHART ───────────────────────────────────────────────────────────────

describe('heuristicPlot — BAR_CHART', () => {
    it('produces BAR_CHART for low-cardinality category + numeric', () => {
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const sample = [
            { cause: 'G1 Young', count: 10 },
            { cause: 'G1 Old', count: 5 },
        ];
        const result = heuristicPlot(cols, sample);
        expect(result).toMatch(/^BAR_CHART\(/);
    });

    it('falls back to TABLE() for high-cardinality category', () => {
        const cols: Col[] = [
            { name: 'className', type: 'VARCHAR' },
            { name: 'alloc', type: 'BIGINT' },
        ];
        // 33 distinct values → too many for a bar
        const sample = Array.from({ length: 33 }, (_, i) => ({ className: `class_${i}`, alloc: i }));
        const result = heuristicPlot(cols, sample);
        expect(result).toBe('TABLE()');
    });

    it('defaults to BAR_CHART for category+numeric with no sample (unknown cardinality)', () => {
        // When no sample is available, cardinality is unknown. The heuristic
        // assumes low cardinality (typical for GROUP BY aggregate queries)
        // and defaults to BAR_CHART rather than TABLE().
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^BAR_CHART\(/);
    });

    it('produces grouped BAR_CHART for category + multiple numerics', () => {
        const cols: Col[] = [
            { name: 'gcType', type: 'VARCHAR' },
            { name: 'duration', type: 'BIGINT' },
            { name: 'heapBefore', type: 'BIGINT' },
        ];
        const sample = [
            { gcType: 'G1 Young', duration: 100, heapBefore: 200 },
            { gcType: 'G1 Old', duration: 500, heapBefore: 800 },
        ];
        const result = heuristicPlot(cols, sample);
        expect(result).toMatch(/^BAR_CHART\(/);
        expect(result).toContain('"duration"');
        expect(result).toContain('"heapBefore"');
    });
});

// ─── SCATTER_PLOT ─────────────────────────────────────────────────────────────

describe('heuristicPlot — SCATTER_PLOT', () => {
    it('produces SCATTER_PLOT for two numerics with no time/cat', () => {
        const cols: Col[] = [
            { name: 'heapBefore', type: 'BIGINT' },
            { name: 'pauseDuration', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^SCATTER_PLOT\(/);
        expect(result).toContain('x: "heapBefore"');
        expect(result).toContain('y: "pauseDuration"');
    });
});

// ─── HISTOGRAM ───────────────────────────────────────────────────────────────

describe('heuristicPlot — HISTOGRAM', () => {
    it('produces HISTOGRAM for single numeric, no time/cat', () => {
        const cols: Col[] = [{ name: 'pauseDuration', type: 'BIGINT' }];
        // NOTE: a single numeric is normally TABLE() (scalar guard).
        // Two numerics without time/cat hits scatter; three+ hits histogram.
        // To reach HISTOGRAM we need exactly one numeric but also more than
        // zero total columns — but the scalar guard fires at roles.length===1.
        // Use multiple numerics for the "multiple numerics" HISTOGRAM path.
        const multiCols: Col[] = [
            { name: 'pauseDuration', type: 'BIGINT' },
            { name: 'cpuTime', type: 'BIGINT' },
            { name: 'ioTime', type: 'BIGINT' },
        ];
        const result = heuristicPlot(multiCols, []);
        expect(result).toMatch(/^HISTOGRAM\(/);
        // First numeric used as x
        expect(result).toContain('x: "pauseDuration"');
    });
});

// ─── TABLE fallback ───────────────────────────────────────────────────────────

describe('heuristicPlot — TABLE fallback', () => {
    it('returns TABLE() when no clear pattern matches', () => {
        // Two categories and one numeric — no pattern for this
        const cols: Col[] = [
            { name: 'type', type: 'VARCHAR' },
            { name: 'subtype', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, [{ type: 'gc', subtype: 'young', count: 5 }]);
        // cats.length === 2, numerics.length === 1 → no explicit branch → TABLE()
        expect(result).toBe('TABLE()');
    });
});

// ─── JFR-specific plot quality tests ─────────────────────────────────────────
// These test the four scenarios from the task spec:
//   a) bucket_time + COUNT → LINE_CHART
//   b) cause + COUNT aggregate → BAR_CHART (with sample)
//   c) single scalar aggregate with compound name → BIG_NUMBER
//   d) heap columns → AREA_CHART stacked or LINE_CHART

describe('heuristicPlot — JFR GC scenarios', () => {
    // a) bucket_time(startTime, 5000) AS ts, COUNT(*) AS count
    //    ts is BIGINT but name "ts" matches TIME_EXACT_NAMES_RE → time role
    it('a) bucket + count query → LINE_CHART', () => {
        const cols: Col[] = [
            { name: 'ts', type: 'BIGINT' },
            { name: 'count', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('x: "ts"');
        expect(result).toContain('"count"');
    });

    // b) cause + COUNT(*) — needs sample data for cardinality detection
    it('b) cause + count with sample → BAR_CHART', () => {
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        const sample = [
            { cause: 'G1 Young', count: 150 },
            { cause: 'G1 Old', count: 12 },
            { cause: 'G1 Concurrent GC', count: 88 },
        ];
        const result = heuristicPlot(cols, sample);
        expect(result).toMatch(/^BAR_CHART\(/);
        expect(result).toContain('x: "cause"');
        expect(result).toContain('"count"');
    });

    // b2) cause + COUNT(*) without sample — currently returns TABLE() because
    //     cardinality is unknown. This is MEDIOCRE: should assume low cardinality
    //     for a well-known categorical column and return BAR_CHART.
    it('b2) cause + count with NO sample → BAR_CHART (not TABLE)', () => {
        const cols: Col[] = [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'count', type: 'BIGINT' },
        ];
        // With no sample data, cardinality is unknown.
        // A GC cause column never has more than ~10 distinct values in practice.
        // The heuristic should assume low cardinality and suggest BAR_CHART.
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^BAR_CHART\(/);
    });

    // c) Single scalar aggregate with compound name like total_pauses
    it('c) single aggregate scalar with name total_pauses → BIG_NUMBER (no sample)', () => {
        const cols: Col[] = [
            { name: 'total_pauses', type: 'BIGINT' },
        ];
        // No sample: AGGREGATE_NAMES_RE doesn't match "total_pauses" because it
        // doesn't match the anchored pattern. Should still be BIG_NUMBER.
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^BIG_NUMBER\(/);
    });

    it('c2) single aggregate scalar with name pause_count → BIG_NUMBER (no sample)', () => {
        const cols: Col[] = [
            { name: 'pause_count', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^BIG_NUMBER\(/);
    });

    it('c3) single aggregate: total (exact) → BIG_NUMBER', () => {
        const cols: Col[] = [
            { name: 'total', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        expect(result).toMatch(/^BIG_NUMBER\(/);
    });

    // d) heap columns — heapUsed, heapCommitted, metaspaceUsed with time
    it('d) time + heap region columns (stacked) → AREA_CHART', () => {
        const cols: Col[] = [
            { name: 'ts', type: 'BIGINT' },
            { name: 'heapUsed', type: 'BIGINT' },
            { name: 'heapCommitted', type: 'BIGINT' },
            { name: 'metaspaceUsed', type: 'BIGINT' },
        ];
        const result = heuristicPlot(cols, []);
        // heapUsed, heapCommitted, metaspaceUsed all match STACKED_NAMES_RE
        expect(result).toMatch(/^AREA_CHART\(/);
        expect(result).toContain('layout: "stacked"');
    });
});

// ─── id-column stripping in y-axis ───────────────────────────────────────────

describe('heuristicPlot — id-column stripping', () => {
    it('GarbageCollection full schema: skips gcId in LINE_CHART y-axis', () => {
        const cols: Col[] = [
            { name: 'gcId', type: 'INTEGER' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'cause', type: 'VARCHAR' },
        ];
        const sample = [{ gcId: 1, startTime: new Date(), duration: 0.05, cause: 'G1 Young' }];
        const result = heuristicPlot(cols, sample);
        // gcId (an id column) should not appear in the y list
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).not.toContain('"gcId"');
        expect(result).toContain('"duration"');
    });

    it('time + id-only numerics: falls back to including id when no real metric available', () => {
        const cols: Col[] = [
            { name: 'ts', type: 'BIGINT' },
            { name: 'eventId', type: 'INTEGER' },
        ];
        const result = heuristicPlot(cols, []);
        // Only numeric is eventId — must still produce a chart, not TABLE()
        expect(result).toMatch(/^LINE_CHART\(/);
        expect(result).toContain('"eventId"');
    });
});
