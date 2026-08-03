import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { scatterPlot } from '../../../components/plots/ScatterPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('scatterPlot registration', () => {
    it('has name SCATTER_PLOT', () => expect(scatterPlot.name).toBe('SCATTER_PLOT'));

    it('x param is required', () => {
        expect(scatterPlot.params.find(p => p.name === 'x')?.required).toBe(true);
    });

    it('y param is required', () => {
        expect(scatterPlot.params.find(p => p.name === 'y')?.required).toBe(true);
    });

    it('size param is optional', () => {
        const p = scatterPlot.params.find(p => p.name === 'size');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('color param is optional', () => {
        const p = scatterPlot.params.find(p => p.name === 'color');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('category is a deprecated alias for color', () => {
        const p = scatterPlot.params.find(p => p.name === 'category');
        expect(p?.aliasFor).toBe('color');
        expect(p?.deprecated).toBe(true);
    });

    it('supportsZoom is true', () => {
        expect(scatterPlot.supportsZoom).toBe(true);
    });

    it('template covers x and y', () => {
        expect(scatterPlot.template).toContain('x:');
        expect(scatterPlot.template).toContain('y:');
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('scatterPlot parseConfig', () => {
    it('parses x and y columns', () => {
        const cfg = scatterPlot.parseConfig('SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration")', []);
        expect(cfg.x).toBe('reclaimedBytes');
        expect(cfg.y).toBe('pauseDuration');
    });

    it('parses optional size column', () => {
        const cfg = scatterPlot.parseConfig(
            'SCATTER_PLOT(x: "x", y: "y", size: "youngGenSize")', []);
        expect(cfg.size).toBe('youngGenSize');
    });

    it('parses optional color column', () => {
        const cfg = scatterPlot.parseConfig(
            'SCATTER_PLOT(x: "x", y: "y", color: "gcCause")', []);
        expect(cfg.color).toBe('gcCause');
    });

    it('deprecated category alias resolves to color', () => {
        const cfg = scatterPlot.parseConfig(
            'SCATTER_PLOT(x: "x", y: "y", category: "gcCause")', []);
        expect(cfg.color).toBe('gcCause');
    });

    it('full config round-trip', () => {
        const cfg = scatterPlot.parseConfig(
            'SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration", size: "youngGenSize", color: "gcCause")', []);
        expect(cfg).toMatchObject({
            x: 'reclaimedBytes',
            y: 'pauseDuration',
            size: 'youngGenSize',
            color: 'gcCause',
        });
    });
});
