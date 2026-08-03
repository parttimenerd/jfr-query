import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { heatmapPlot } from '../../../components/plots/HeatmapPlot';

describe('heatmapPlot registration', () => {
    it('has name HEATMAP', () => expect(heatmapPlot.name).toBe('HEATMAP'));

    it('x, y, value params are all required', () => {
        const required = heatmapPlot.params.filter(p => p.required).map(p => p.name);
        expect(required).toContain('x');
        expect(required).toContain('y');
        expect(required).toContain('value');
    });

    it('template covers x, y, and value', () => {
        expect(heatmapPlot.template).toContain('x:');
        expect(heatmapPlot.template).toContain('y:');
        expect(heatmapPlot.template).toContain('value:');
    });
});

describe('heatmapPlot parseConfig', () => {
    it('parses x, y, value columns', () => {
        const cfg = heatmapPlot.parseConfig('HEATMAP(x: "bucket", y: "phase", value: "count")', []);
        expect(cfg.x).toBe('bucket');
        expect(cfg.y).toBe('phase');
        expect(cfg.value).toBe('count');
    });

    it('column names with spaces are quoted', () => {
        const cfg = heatmapPlot.parseConfig('HEATMAP(x: "time bucket", y: "gc phase", value: "avg pause")', []);
        expect(cfg.x).toBe('time bucket');
        expect(cfg.y).toBe('gc phase');
        expect(cfg.value).toBe('avg pause');
    });
});
