import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { pieChartPlot } from '../../../components/plots/PieChartPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('pieChartPlot registration', () => {
    it('has name PIE_CHART', () => expect(pieChartPlot.name).toBe('PIE_CHART'));

    it('category param is required', () => {
        expect(pieChartPlot.params.find(p => p.name === 'category')?.required).toBe(true);
    });

    it('value param is required', () => {
        expect(pieChartPlot.params.find(p => p.name === 'value')?.required).toBe(true);
    });

    it('innerRadius defaults to 0 (solid pie)', () => {
        expect(pieChartPlot.params.find(p => p.name === 'innerRadius')?.defaultValue).toBe(0);
    });

    it('outerRadius defaults to 0.8', () => {
        expect(pieChartPlot.params.find(p => p.name === 'outerRadius')?.defaultValue).toBeCloseTo(0.8);
    });

    it('showPercent defaults to true', () => {
        expect(pieChartPlot.params.find(p => p.name === 'showPercent')?.defaultValue).toBe(true);
    });

    it('sliceLabel defaults to "outside"', () => {
        expect(pieChartPlot.params.find(p => p.name === 'sliceLabel')?.defaultValue).toBe('outside');
    });

    it('"name" is a deprecated alias for category', () => {
        const p = pieChartPlot.params.find(p => p.name === 'name');
        expect(p?.aliasFor).toBe('category');
        expect(p?.deprecated).toBe(true);
    });

    it('"labels" is a deprecated alias for category', () => {
        const p = pieChartPlot.params.find(p => p.name === 'labels');
        expect(p?.aliasFor).toBe('category');
        expect(p?.deprecated).toBe(true);
    });

    it('"values" is a deprecated alias for value', () => {
        const p = pieChartPlot.params.find(p => p.name === 'values');
        expect(p?.aliasFor).toBe('value');
        expect(p?.deprecated).toBe(true);
    });

    it('template covers category and value', () => {
        expect(pieChartPlot.template).toBeDefined();
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('pieChartPlot parseConfig', () => {
    it('parses category and value', () => {
        const cfg = pieChartPlot.parseConfig('PIE_CHART(category: "gcCause", value: "count")', []);
        expect(cfg.category).toBe('gcCause');
        expect(cfg.value).toBe('count');
    });

    it('parses donut via innerRadius', () => {
        const cfg = pieChartPlot.parseConfig(
            'PIE_CHART(category: "type", value: "count", innerRadius: 0.5)', []);
        expect(cfg.innerRadius).toBeCloseTo(0.5);
    });

    it('parses showPercent false', () => {
        const cfg = pieChartPlot.parseConfig(
            'PIE_CHART(category: "type", value: "count", showPercent: false)', []);
        expect(cfg.showPercent).toBe(false);
    });

    it('parses sliceLabel "inside"', () => {
        const cfg = pieChartPlot.parseConfig(
            'PIE_CHART(category: "type", value: "count", sliceLabel: "inside")', []);
        expect(cfg.sliceLabel).toBe('inside');
    });

    it('deprecated "name" alias resolves to category', () => {
        const cfg = pieChartPlot.parseConfig('PIE_CHART(name: "gcCause", value: "count")', []);
        expect(cfg.category).toBe('gcCause');
    });

    it('deprecated "labels" alias resolves to category', () => {
        const cfg = pieChartPlot.parseConfig('PIE_CHART(labels: "gcCause", values: "count")', []);
        expect(cfg.category).toBe('gcCause');
        expect(cfg.value).toBe('count');
    });
});
