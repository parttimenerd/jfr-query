import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { histogramPlot, freedmanDiaconisBins } from '../../../components/plots/HistogramPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('histogramPlot registration', () => {
    it('has name HISTOGRAM', () => expect(histogramPlot.name).toBe('HISTOGRAM'));

    it('x param is required', () => {
        expect(histogramPlot.params.find(p => p.name === 'x')?.required).toBe(true);
    });

    it('bins param has default value "10"', () => {
        const p = histogramPlot.params.find(p => p.name === 'bins');
        expect(p?.defaultValue).toBe('10');
    });

    it('logBins param defaults to false', () => {
        expect(histogramPlot.params.find(p => p.name === 'logBins')?.defaultValue).toBe(false);
    });

    it('yLog param defaults to false', () => {
        expect(histogramPlot.params.find(p => p.name === 'yLog')?.defaultValue).toBe(false);
    });

    it('value param is a deprecated alias for x', () => {
        const p = histogramPlot.params.find(p => p.name === 'value');
        expect(p?.aliasFor).toBe('x');
        expect(p?.deprecated).toBe(true);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('histogramPlot parseConfig', () => {
    it('parses x column', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "duration")', []).x).toBe('duration');
    });

    it('parses bins as number', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "dur", bins: 20)', []).bins).toBe(20);
    });

    it('parses logBins flag', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "size", logBins: true)', []).logBins).toBe(true);
    });

    it('value alias resolves to x', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(value: "pauseMs")', []).x).toBe('pauseMs');
    });

    it('bins defaults to "10" when absent', () => {
        const cfg = histogramPlot.parseConfig('HISTOGRAM(x: "v")', []);
        expect(cfg.bins ?? '10').toBe('10');
    });

    it('parses yLog: true', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "v", yLog: true)', []).yLog).toBe(true);
    });

    it('yLog defaults to false when absent', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "v")', []).yLog).toBe(false);
    });
});

// ── freedmanDiaconisBins ──────────────────────────────────────────────────────
describe('freedmanDiaconisBins', () => {
    it('returns 1 for a single-element array', () => {
        expect(freedmanDiaconisBins([42])).toBe(1);
    });

    it('returns ≥ 1 for any non-empty array', () => {
        const cases: number[][] = [
            [1, 2],
            [1, 2, 3, 4, 5],
            Array.from({ length: 100 }, (_, i) => i),
        ];
        cases.forEach(arr => {
            expect(freedmanDiaconisBins(arr)).toBeGreaterThanOrEqual(1);
        });
    });

    it('returns at most 100 bins', () => {
        const big = Array.from({ length: 10_000 }, (_, i) => i);
        expect(freedmanDiaconisBins(big)).toBeLessThanOrEqual(100);
    });

    it('all-equal values (zero IQR): uses sqrt fallback, result ≥ 1', () => {
        const arr = Array(50).fill(5);
        const result = freedmanDiaconisBins(arr);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(50);
    });

    it('larger spread → more bins than tight cluster', () => {
        const tight  = Array.from({ length: 100 }, (_, i) => 50 + (i % 3));   // range=2
        const spread = Array.from({ length: 100 }, (_, i) => i * 10);          // range=990
        expect(freedmanDiaconisBins(spread)).toBeGreaterThan(freedmanDiaconisBins(tight));
    });

    it('does not mutate the input array', () => {
        const arr = [9, 1, 5, 3, 7, 2, 8, 4, 6];
        const copy = [...arr];
        freedmanDiaconisBins(arr);
        expect(arr).toEqual(copy);
    });
});
