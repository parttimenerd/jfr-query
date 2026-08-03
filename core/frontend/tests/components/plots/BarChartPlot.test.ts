import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { barChartPlot } from '../../../components/plots/BarChartPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('barChartPlot registration', () => {
    it('has name BAR_CHART', () => expect(barChartPlot.name).toBe('BAR_CHART'));

    it('x param is required', () => {
        expect(barChartPlot.params.find(p => p.name === 'x')?.required).toBe(true);
    });

    it('y param is required', () => {
        expect(barChartPlot.params.find(p => p.name === 'y')?.required).toBe(true);
    });

    it('layout defaults to "grouped"', () => {
        expect(barChartPlot.params.find(p => p.name === 'layout')?.defaultValue).toBe('grouped');
    });

    it('logScale defaults to false', () => {
        expect(barChartPlot.params.find(p => p.name === 'logScale')?.defaultValue).toBe(false);
    });

    it('horizontal defaults to false', () => {
        expect(barChartPlot.params.find(p => p.name === 'horizontal')?.defaultValue).toBe(false);
    });

    it('template covers x and y', () => {
        expect(barChartPlot.template).toContain('x:');
        expect(barChartPlot.template).toContain('y:');
    });

    it('supportsMultiQuery is true', () => {
        expect(barChartPlot.supportsMultiQuery).toBe(true);
    });

    it('has at least 3 examples', () => {
        expect(barChartPlot.examples.length).toBeGreaterThanOrEqual(3);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('barChartPlot parseConfig', () => {
    it('parses required x and y', () => {
        const cfg = barChartPlot.parseConfig('BAR_CHART(x: "gcCause", y: ["duration"])', []);
        expect(cfg.x).toBe('gcCause');
        expect(cfg.y).toContain('duration');
    });

    it('parses multiple y columns', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "ts", y: ["young", "old"])', []);
        expect(cfg.y).toContain('young');
        expect(cfg.y).toContain('old');
    });

    it('parses stacked layout', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "ts", y: ["a"], layout: "stacked")', []);
        expect(cfg.layout).toBe('stacked');
    });

    it('parses optional lineY overlay columns', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "ts", y: ["alloc"], lineY: ["p99"])', []);
        expect(cfg.lineY).toContain('p99');
    });

    it('parses logScale override', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "ts", y: ["count"], logScale: true)', []);
        expect(cfg.logScale).toBe(true);
    });

    it('parses horizontal override', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "method", y: ["time"], horizontal: true)', []);
        expect(cfg.horizontal).toBe(true);
    });

    it('parses optional color column', () => {
        const cfg = barChartPlot.parseConfig(
            'BAR_CHART(x: "ts", y: ["val"], color: "gcCause")', []);
        expect(cfg.color).toBe('gcCause');
    });
});
