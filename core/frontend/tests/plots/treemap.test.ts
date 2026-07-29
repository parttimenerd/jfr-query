import { describe, it, expect } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';

const treemapPlot = plotRegistry['TREEMAP'];

describe('TreemapPlot registration', () => {
    it('has name TREEMAP', () => {
        expect(treemapPlot.name).toBe('TREEMAP');
    });

    it('parseConfig extracts label and value params', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight")', []);
        expect(cfg.label).toBe('objectClass');
        expect(cfg.value).toBe('weight');
    });

    it('parseConfig accepts optional colorBy param', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight", colorBy: "thread")', []);
        expect(cfg.colorBy).toBe('thread');
    });

    it('parseConfig uses defaults for missing optional params', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "name", value: "size")', []);
        expect(cfg.showLabels).toBe(true);
        expect(cfg.colorBy).toBeUndefined();
    });

    it('template contains required params', () => {
        expect(treemapPlot.template).toContain('label');
        expect(treemapPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(treemapPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});
