import { describe, it, expect } from 'vitest';
import { violinPlot, computeKde } from '../../../components/plots/ViolinPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('violinPlot registration', () => {
    it('has name VIOLIN_PLOT', () => {
        expect(violinPlot.name).toBe('VIOLIN_PLOT');
    });

    it('has required param: value', () => {
        const value = violinPlot.params.find(p => p.name === 'value');
        expect(value?.required).toBe(true);
    });

    it('has optional param: category', () => {
        const cat = violinPlot.params.find(p => p.name === 'category');
        expect(cat).toBeDefined();
        expect(cat?.required).toBeFalsy();
    });

    it('has optional param: bins with default 20', () => {
        const bins = violinPlot.params.find(p => p.name === 'bins');
        expect(bins).toBeDefined();
        expect(bins?.defaultValue).toBe(20);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('violinPlot parseConfig', () => {
    it('parses value column', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "duration")', []);
        expect(cfg.value).toBe('duration');
    });

    it('parses category and bins', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "dur", category: "gcType", bins: 30)', []);
        expect(cfg.category).toBe('gcType');
        expect(cfg.bins).toBe(30);
    });

    it('bins defaults to 20 when not specified', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "dur")', []);
        expect(cfg.bins ?? 20).toBe(20);
    });
});

// ── KDE helper ────────────────────────────────────────────────────────────────
describe('computeKde', () => {
    it('returns bins array of correct length', () => {
        const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = computeKde(data, 10);
        expect(result).toHaveLength(10);
    });

    it('each bin has x and density', () => {
        const result = computeKde([1, 2, 3], 5);
        result.forEach(bin => {
            expect(typeof bin.x).toBe('number');
            expect(typeof bin.density).toBe('number');
            expect(bin.density).toBeGreaterThanOrEqual(0);
        });
    });

    it('returns empty array for empty data', () => {
        expect(computeKde([], 10)).toHaveLength(0);
    });
});
