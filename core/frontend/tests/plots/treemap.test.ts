// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { treemapPlot } from '../../components/plots/TreemapPlot';

describe('treemapPlot registration', () => {
    it('has the correct name', () => {
        expect(treemapPlot.name).toBe('TREEMAP');
    });

    it('parseConfig parses required params', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight")', []);
        expect(cfg).toMatchObject({ label: 'objectClass', value: 'weight' });
    });

    it('parseConfig parses optional colorBy param', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight", colorBy: "thread")', []);
        expect(cfg.colorBy).toBe('thread');
    });

    it('parseConfig applies showLabels default of true', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "name", value: "size")', []);
        expect(cfg.showLabels).toBe(true);
    });

    it('template contains label and value placeholders', () => {
        expect(treemapPlot.template).toContain('label');
        expect(treemapPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(treemapPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});
