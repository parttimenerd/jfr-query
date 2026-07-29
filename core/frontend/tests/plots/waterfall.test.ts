// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { waterfallPlot, buildWaterfallBars } from '../../components/plots/WaterfallPlot';

describe('waterfallPlot registration', () => {
    it('has the correct name', () => {
        expect(waterfallPlot.name).toBe('WATERFALL');
    });

    it('parseConfig parses required params', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "phase", value: "delta")', []);
        expect(cfg).toMatchObject({ category: 'phase', value: 'delta' });
    });

    it('parseConfig parses optional total param', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change", total: "isTotal")', []);
        expect(cfg.total).toBe('isTotal');
    });

    it('parseConfig applies showValues default of true', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change")', []);
        expect(cfg.showValues).toBe(true);
    });

    it('template contains category and value placeholders', () => {
        expect(waterfallPlot.template).toContain('category');
        expect(waterfallPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(waterfallPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});

describe('buildWaterfallBars', () => {
    it('handles positive delta correctly', () => {
        const result = buildWaterfallBars(
            [{ phase: 'A', delta: 10 }],
            { category: 'phase', value: 'delta' }
        );
        expect(result).toEqual([
            { name: 'A', base: 0, delta: 10, rawDelta: 10, isTotal: false, fill: '#22c55e' }
        ]);
    });

    it('handles negative delta correctly', () => {
        const result = buildWaterfallBars(
            [{ phase: 'A', delta: -5 }],
            { category: 'phase', value: 'delta' }
        );
        expect(result).toMatchObject([
            { base: -5, delta: 5, rawDelta: -5, fill: '#ef4444' }
        ]);
    });

    it('handles total bar correctly', () => {
        const result = buildWaterfallBars(
            [{ phase: 'Total', delta: 15, isTotal: true }],
            { category: 'phase', value: 'delta', total: 'isTotal' }
        );
        expect(result).toMatchObject([
            { base: 0, delta: 15, isTotal: true, fill: '#60a5fa' }
        ]);
    });

    it('filters out NaN values', () => {
        const result = buildWaterfallBars(
            [{ phase: 'A', delta: 'bad' }],
            { category: 'phase', value: 'delta' }
        );
        expect(result).toEqual([]);
    });

    it('accumulates running total correctly across multiple steps', () => {
        const result = buildWaterfallBars(
            [
                { phase: 'A', delta: 10 },
                { phase: 'B', delta: -3 },
                { phase: 'C', delta: 5 },
            ],
            { category: 'phase', value: 'delta' }
        );
        expect(result[0]).toMatchObject({ name: 'A', base: 0, delta: 10 });
        expect(result[1]).toMatchObject({ name: 'B', base: 7, delta: 3 }); // negative delta: base = running + rawDelta = 10 + (-3) = 7 (bottom edge of bar)
        expect(result[2]).toMatchObject({ name: 'C', base: 7, delta: 5 }); // base = running = 7
    });

    it('returns empty array for empty data', () => {
        const result = buildWaterfallBars([], { category: 'phase', value: 'delta' });
        expect(result).toEqual([]);
    });

    it('uses custom colors when provided', () => {
        const result = buildWaterfallBars(
            [{ phase: 'A', delta: 5 }],
            { category: 'phase', value: 'delta', positiveColor: '#aabbcc' }
        );
        expect(result[0].fill).toBe('#aabbcc');
    });

    it('resets running total on total rows', () => {
        const result = buildWaterfallBars(
            [
                { phase: 'A', delta: 10 },
                { phase: 'Total', delta: 10, isTotal: true },
                { phase: 'B', delta: 5 },
            ],
            { category: 'phase', value: 'delta', total: 'isTotal' }
        );
        expect(result[1]).toMatchObject({ base: 0, delta: 10, isTotal: true });
        expect(result[2]).toMatchObject({ base: 10, delta: 5 }); // running reset to 10 after total
    });
});
