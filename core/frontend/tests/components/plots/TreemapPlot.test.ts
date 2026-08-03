import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { treemapPlot } from '../../../components/plots/TreemapPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('treemapPlot registration', () => {
    it('has name TREEMAP', () => expect(treemapPlot.name).toBe('TREEMAP'));

    it('label param is required', () => {
        expect(treemapPlot.params.find(p => p.name === 'label')?.required).toBe(true);
    });

    it('value param is required', () => {
        expect(treemapPlot.params.find(p => p.name === 'value')?.required).toBe(true);
    });

    it('colorBy param is optional', () => {
        const p = treemapPlot.params.find(p => p.name === 'colorBy');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('showLabels defaults to true', () => {
        expect(treemapPlot.params.find(p => p.name === 'showLabels')?.defaultValue).toBe(true);
    });

    it('supportsMultiQuery is falsy', () => {
        expect(treemapPlot.supportsMultiQuery).toBeFalsy();
    });

    it('template covers label and value', () => {
        expect(treemapPlot.template).toContain('label:');
        expect(treemapPlot.template).toContain('value:');
    });

    it('has at least 2 examples', () => {
        expect(treemapPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('treemapPlot parseConfig', () => {
    it('parses label and value', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight")', []);
        expect(cfg.label).toBe('objectClass');
        expect(cfg.value).toBe('weight');
    });

    it('parses optional colorBy column', () => {
        const cfg = treemapPlot.parseConfig(
            'TREEMAP(label: "region", value: "liveData", colorBy: "type")', []);
        expect(cfg.colorBy).toBe('type');
    });

    it('parses showLabels false', () => {
        const cfg = treemapPlot.parseConfig(
            'TREEMAP(label: "method", value: "count", showLabels: false)', []);
        expect(cfg.showLabels).toBe(false);
    });

    it('full config round-trip', () => {
        const cfg = treemapPlot.parseConfig(
            'TREEMAP(label: "region", value: "liveData", colorBy: "type", showLabels: true)', []);
        expect(cfg).toMatchObject({
            label: 'region',
            value: 'liveData',
            colorBy: 'type',
            showLabels: true,
        });
    });
});
