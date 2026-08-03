import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { areaChartPlot } from '../../../components/plots/AreaChartPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('areaChartPlot registration', () => {
    it('has name AREA_CHART', () => expect(areaChartPlot.name).toBe('AREA_CHART'));

    it('x param is required', () => {
        expect(areaChartPlot.params.find(p => p.name === 'x')?.required).toBe(true);
    });

    it('y param is required', () => {
        expect(areaChartPlot.params.find(p => p.name === 'y')?.required).toBe(true);
    });

    it('layout defaults to "overlay"', () => {
        expect(areaChartPlot.params.find(p => p.name === 'layout')?.defaultValue).toBe('overlay');
    });

    it('opacity defaults to 0.6', () => {
        expect(areaChartPlot.params.find(p => p.name === 'opacity')?.defaultValue).toBeCloseTo(0.6);
    });

    it('yScale defaults to "linear"', () => {
        expect(areaChartPlot.params.find(p => p.name === 'yScale')?.defaultValue).toBe('linear');
    });

    it('connectNulls defaults to false', () => {
        expect(areaChartPlot.params.find(p => p.name === 'connectNulls')?.defaultValue).toBe(false);
    });

    it('stack param is deprecated', () => {
        expect(areaChartPlot.params.find(p => p.name === 'stack')?.deprecated).toBe(true);
    });

    it('supportsZoom is true', () => {
        expect(areaChartPlot.supportsZoom).toBe(true);
    });

    it('supportsMultiQuery is true', () => {
        expect(areaChartPlot.supportsMultiQuery).toBe(true);
    });

    it('template covers x and y', () => {
        expect(areaChartPlot.template).toContain('x:');
        expect(areaChartPlot.template).toContain('y:');
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('areaChartPlot parseConfig', () => {
    it('parses x and y columns', () => {
        const cfg = areaChartPlot.parseConfig('AREA_CHART(x: "timestamp", y: ["heapUsed"])', []);
        expect(cfg.x).toBe('timestamp');
        expect(cfg.y).toContain('heapUsed');
    });

    it('parses multiple y columns', () => {
        const cfg = areaChartPlot.parseConfig(
            'AREA_CHART(x: "ts", y: ["eden", "survivor", "old"])', []);
        expect(cfg.y).toContain('eden');
        expect(cfg.y).toContain('survivor');
        expect(cfg.y).toContain('old');
    });

    it('parses stacked layout', () => {
        const cfg = areaChartPlot.parseConfig(
            'AREA_CHART(x: "ts", y: ["a"], layout: "stacked")', []);
        expect(cfg.layout).toBe('stacked');
    });

    it('parses opacity override', () => {
        const cfg = areaChartPlot.parseConfig(
            'AREA_CHART(x: "ts", y: ["val"], opacity: 0.4)', []);
        expect(cfg.opacity).toBeCloseTo(0.4);
    });

    it('parses yScale log override', () => {
        const cfg = areaChartPlot.parseConfig(
            'AREA_CHART(x: "ts", y: ["val"], yScale: "log")', []);
        expect(cfg.yScale).toBe('log');
    });

    it('parses connectNulls override', () => {
        const cfg = areaChartPlot.parseConfig(
            'AREA_CHART(x: "ts", y: ["val"], connectNulls: true)', []);
        expect(cfg.connectNulls).toBe(true);
    });
});
