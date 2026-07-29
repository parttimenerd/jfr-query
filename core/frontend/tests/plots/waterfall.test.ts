import { describe, it, expect } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';
import { buildWaterfallBars } from '../../components/plots/WaterfallPlot';

const waterfallPlot = plotRegistry['WATERFALL'];

describe('WaterfallPlot registration', () => {
    it('has name WATERFALL', () => {
        expect(waterfallPlot.name).toBe('WATERFALL');
    });

    it('parseConfig extracts category and value params', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "phase", value: "delta")', []);
        expect(cfg.category).toBe('phase');
        expect(cfg.value).toBe('delta');
    });

    it('parseConfig accepts optional total param', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change", total: "isTotal")', []);
        expect(cfg.total).toBe('isTotal');
    });

    it('parseConfig has showValues defaulting to true', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change")', []);
        expect(cfg.showValues).toBe(true);
    });

    it('template contains required params', () => {
        expect(waterfallPlot.template).toContain('category');
        expect(waterfallPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(waterfallPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});

describe('buildWaterfallBars', () => {
    it('positive delta: base=0, delta=value, positive fill', () => {
        const result = buildWaterfallBars([{ phase: 'A', delta: 10 }], { category: 'phase', value: 'delta' });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: 'A', base: 0, delta: 10, rawDelta: 10, isTotal: false });
        expect(result[0].fill).toBe('#22c55e');
    });

    it('negative delta: base = running + rawDelta (bottom edge), negative fill', () => {
        const result = buildWaterfallBars([{ phase: 'A', delta: -5 }], { category: 'phase', value: 'delta' });
        expect(result).toHaveLength(1);
        // negative delta: base = running + rawDelta = 0 + (-5) = -5 (bottom edge of bar)
        expect(result[0]).toMatchObject({ base: -5, delta: 5, rawDelta: -5, isTotal: false });
        expect(result[0].fill).toBe('#ef4444');
    });

    it('total bar: base=0, uses total fill, resets running', () => {
        const result = buildWaterfallBars(
            [{ phase: 'Total', delta: 15, isTotal: true }],
            { category: 'phase', value: 'delta', total: 'isTotal' },
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ base: 0, delta: 15, isTotal: true });
        expect(result[0].fill).toBe('#60a5fa');
    });

    it('NaN values are filtered out', () => {
        const result = buildWaterfallBars([{ phase: 'A', delta: 'bad' }], { category: 'phase', value: 'delta' });
        expect(result).toHaveLength(0);
    });

    it('accumulates running total across multiple rows', () => {
        const result = buildWaterfallBars(
            [{ phase: 'A', delta: 10 }, { phase: 'B', delta: 5 }],
            { category: 'phase', value: 'delta' },
        );
        expect(result[0]).toMatchObject({ base: 0, delta: 10 });
        expect(result[1]).toMatchObject({ base: 10, delta: 5 });
    });
});
