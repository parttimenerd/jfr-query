import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { boxPlot, calculateStats } from '../../../components/plots/BoxPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('boxPlot registration', () => {
    it('has name BOX_PLOT', () => expect(boxPlot.name).toBe('BOX_PLOT'));

    it('value param is required', () => {
        expect(boxPlot.params.find(p => p.name === 'value')?.required).toBe(true);
    });

    it('category param is optional', () => {
        const p = boxPlot.params.find(p => p.name === 'category');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('x is an alias for value', () => {
        expect(boxPlot.params.find(p => p.name === 'x')?.aliasFor).toBe('value');
    });

    it('color is an alias for category', () => {
        expect(boxPlot.params.find(p => p.name === 'color')?.aliasFor).toBe('category');
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('boxPlot parseConfig', () => {
    it('parses value column', () => {
        expect(boxPlot.parseConfig('BOX_PLOT(value: "pauseDuration")', []).value).toBe('pauseDuration');
    });

    it('parses category', () => {
        const cfg = boxPlot.parseConfig('BOX_PLOT(value: "dur", category: "gcType")', []);
        expect(cfg.category).toBe('gcType');
    });

    it('x is resolved as value alias', () => {
        expect(boxPlot.parseConfig('BOX_PLOT(x: "latency")', []).value).toBe('latency');
    });

    it('color is resolved as category alias', () => {
        expect(boxPlot.parseConfig('BOX_PLOT(value: "dur", color: "phase")', []).category).toBe('phase');
    });
});

// ── calculateStats ────────────────────────────────────────────────────────────
describe('calculateStats', () => {
    it('returns null for empty array', () => {
        expect(calculateStats([])).toBeNull();
    });

    it('single-element array: all five stats equal the single value', () => {
        const s = calculateStats([42]);
        expect(s).not.toBeNull();
        expect(s!.min).toBe(42);
        expect(s!.max).toBe(42);
        expect(s!.median).toBe(42);
        expect(s!.q1).toBe(42);
        expect(s!.q3).toBe(42);
    });

    it('two-element array: median is the average, q1/q3 are the two values', () => {
        const s = calculateStats([10, 20]);
        expect(s!.median).toBeCloseTo(15);
        expect(s!.min).toBe(10);
        expect(s!.max).toBe(20);
    });

    it('10-element sorted array [1..10]: q1≈3.25, median≈5.5, q3≈7.75', () => {
        const s = calculateStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(s!.q1).toBeCloseTo(3.25);
        expect(s!.median).toBeCloseTo(5.5);
        expect(s!.q3).toBeCloseTo(7.75);
    });

    it('whiskers respect 1.5×IQR rule — outliers excluded from min/max', () => {
        // [1,2,3,4,5,6,7,8,9,100] — 100 is an outlier
        const s = calculateStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
        expect(s!.max).toBeLessThan(100);  // 100 is beyond the upper fence
        expect(s!.min).toBe(1);            // 1 is within the lower fence
    });

    it('all-equal values: q1 === q3, min === max', () => {
        const s = calculateStats([5, 5, 5, 5]);
        expect(s!.q1).toBe(5);
        expect(s!.q3).toBe(5);
        expect(s!.min).toBe(5);
        expect(s!.max).toBe(5);
    });

    it('sorts input before computing (unsorted array gives same result as sorted)', () => {
        const unsorted = calculateStats([9, 1, 5, 3, 7]);
        const sorted   = calculateStats([1, 3, 5, 7, 9]);
        expect(unsorted!.median).toBeCloseTo(sorted!.median);
        expect(unsorted!.q1).toBeCloseTo(sorted!.q1);
        expect(unsorted!.q3).toBeCloseTo(sorted!.q3);
    });

    it('does not mutate the input array', () => {
        const arr = [9, 1, 5, 3, 7];
        const copy = [...arr];
        calculateStats(arr);
        expect(arr).toEqual(copy);
    });

    it('large dataset: median of 1..100 is 50.5', () => {
        const arr = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(calculateStats(arr)!.median).toBeCloseTo(50.5);
    });
});
