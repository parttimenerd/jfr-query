import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { waterfallPlot, buildWaterfallBars } from '../../../components/plots/WaterfallPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('waterfallPlot registration', () => {
    it('has name WATERFALL', () => expect(waterfallPlot.name).toBe('WATERFALL'));

    it('category param is required', () => {
        expect(waterfallPlot.params.find(p => p.name === 'category')?.required).toBe(true);
    });

    it('value param is required', () => {
        expect(waterfallPlot.params.find(p => p.name === 'value')?.required).toBe(true);
    });

    it('showValues defaults to true', () => {
        expect(waterfallPlot.params.find(p => p.name === 'showValues')?.defaultValue).toBe(true);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('waterfallPlot parseConfig', () => {
    it('parses category and value', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "phase", value: "delta")', []);
        expect(cfg.category).toBe('phase');
        expect(cfg.value).toBe('delta');
    });

    it('parses optional total column', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "c", value: "v", total: "isTotal")', []);
        expect(cfg.total).toBe('isTotal');
    });

    it('parses custom colors', () => {
        const cfg = waterfallPlot.parseConfig(
            'WATERFALL(category: "c", value: "v", positiveColor: "#00ff00", negativeColor: "#ff0000")', []);
        expect(cfg.positiveColor).toBe('#00ff00');
        expect(cfg.negativeColor).toBe('#ff0000');
    });
});

// ── buildWaterfallBars ────────────────────────────────────────────────────────
describe('buildWaterfallBars', () => {
    const cfg = { category: 'phase', value: 'delta' };

    it('returns empty array for empty data', () => {
        expect(buildWaterfallBars([], cfg as any)).toEqual([]);
    });

    it('positive delta: base is running total, delta is the value', () => {
        const data = [{ phase: 'Start', delta: 100 }];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars).toHaveLength(1);
        expect(bars[0].base).toBe(0);
        expect(bars[0].delta).toBe(100);
        expect(bars[0].rawDelta).toBe(100);
    });

    it('running total accumulates across bars', () => {
        const data = [
            { phase: 'A', delta: 100 },
            { phase: 'B', delta: 50 },
            { phase: 'C', delta: -30 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars[0].base).toBe(0);    // starts at 0
        expect(bars[1].base).toBe(100);  // after A: 100
        expect(bars[2].base).toBe(120);  // after B: 150, but negative: base = 150-30 = 120
    });

    it('negative delta: base is running + delta (lower edge of bar)', () => {
        const data = [
            { phase: 'Up', delta: 200 },
            { phase: 'Down', delta: -50 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars[1].base).toBe(150);   // 200 + (-50) = 150
        expect(bars[1].delta).toBe(50);   // abs value for bar height
        expect(bars[1].rawDelta).toBe(-50);
    });

    it('positive bars get positiveColor, negative bars get negativeColor', () => {
        const data = [
            { phase: 'Up', delta: 10 },
            { phase: 'Down', delta: -5 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars[0].fill).toBe('#22c55e');  // default positiveColor
        expect(bars[1].fill).toBe('#ef4444');  // default negativeColor
    });

    it('total bar renders from 0 (base=0) and resets running total', () => {
        const data = [
            { phase: 'A', delta: 100, isTotal: false },
            { phase: 'B', delta: -30, isTotal: false },
            { phase: 'Net', delta: 70, isTotal: true },
        ];
        const cfgWithTotal = { ...cfg, total: 'isTotal' };
        const bars = buildWaterfallBars(data, cfgWithTotal as any);
        const totalBar = bars[2];
        expect(totalBar.isTotal).toBe(true);
        expect(totalBar.base).toBe(0);        // total always renders from 0
        expect(totalBar.fill).toBe('#60a5fa'); // default totalColor
    });

    it('custom colors override defaults', () => {
        const data = [{ phase: 'Up', delta: 5 }, { phase: 'Down', delta: -2 }];
        const customCfg = { ...cfg, positiveColor: '#00ff00', negativeColor: '#ff0000' };
        const bars = buildWaterfallBars(data, customCfg as any);
        expect(bars[0].fill).toBe('#00ff00');
        expect(bars[1].fill).toBe('#ff0000');
    });

    it('skips rows with NaN values', () => {
        const data = [
            { phase: 'A', delta: 10 },
            { phase: 'B', delta: 'not-a-number' },
            { phase: 'C', delta: 5 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars).toHaveLength(2);
        expect(bars[0].name).toBe('A');
        expect(bars[1].name).toBe('C');
    });

    it('running total after skip is consistent', () => {
        const data = [
            { phase: 'A', delta: 100 },
            { phase: 'bad', delta: null },
            { phase: 'C', delta: 20 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars).toHaveLength(2);
        expect(bars[1].base).toBe(100); // running total was 100 after A
    });

    it('uses name from category column for each bar', () => {
        const data = [
            { phase: 'Phase One', delta: 10 },
            { phase: 'Phase Two', delta: -5 },
        ];
        const bars = buildWaterfallBars(data, cfg as any);
        expect(bars[0].name).toBe('Phase One');
        expect(bars[1].name).toBe('Phase Two');
    });
});
