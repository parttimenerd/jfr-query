import { describe, it, expect } from 'vitest';
import { normalizePlotName, PLOT_NAME_ALIASES } from '../../../components/plots/plotNames';

describe('normalizePlotName', () => {
    it('returns canonical name unchanged', () => {
        expect(normalizePlotName('LINE_CHART')).toBe('LINE_CHART');
        expect(normalizePlotName('BAR_CHART')).toBe('BAR_CHART');
        expect(normalizePlotName('HISTOGRAM')).toBe('HISTOGRAM');
        expect(normalizePlotName('TABLE')).toBe('TABLE');
    });

    it('maps short alias LINE → LINE_CHART', () => {
        expect(normalizePlotName('LINE')).toBe('LINE_CHART');
    });

    it('maps short alias BAR → BAR_CHART', () => {
        expect(normalizePlotName('BAR')).toBe('BAR_CHART');
    });

    it('maps short alias AREA → AREA_CHART', () => {
        expect(normalizePlotName('AREA')).toBe('AREA_CHART');
    });

    it('maps short alias SCATTER → SCATTER_PLOT', () => {
        expect(normalizePlotName('SCATTER')).toBe('SCATTER_PLOT');
    });

    it('maps short alias PIE → PIE_CHART', () => {
        expect(normalizePlotName('PIE')).toBe('PIE_CHART');
    });

    it('maps short alias BOX → BOX_PLOT', () => {
        expect(normalizePlotName('BOX')).toBe('BOX_PLOT');
    });

    it('maps short alias HIST → HISTOGRAM', () => {
        expect(normalizePlotName('HIST')).toBe('HISTOGRAM');
    });

    it('maps short alias FLAME → FLAMEGRAPH', () => {
        expect(normalizePlotName('FLAME')).toBe('FLAMEGRAPH');
    });

    it('maps short alias TREE → TREEMAP', () => {
        expect(normalizePlotName('TREE')).toBe('TREEMAP');
    });

    it('maps short alias FALL → WATERFALL', () => {
        expect(normalizePlotName('FALL')).toBe('WATERFALL');
    });

    it('is case-insensitive (lowercase input)', () => {
        expect(normalizePlotName('line')).toBe('LINE_CHART');
        expect(normalizePlotName('bar')).toBe('BAR_CHART');
        expect(normalizePlotName('table')).toBe('TABLE');
    });

    it('is case-insensitive (mixed case)', () => {
        expect(normalizePlotName('Line')).toBe('LINE_CHART');
        expect(normalizePlotName('HistoGram')).toBe('HISTOGRAM');
    });

    it('uppercases unknown names (no alias)', () => {
        expect(normalizePlotName('custom_plot')).toBe('CUSTOM_PLOT');
        expect(normalizePlotName('unknown')).toBe('UNKNOWN');
    });

    it('PLOT_NAME_ALIASES contains all expected short aliases', () => {
        const expected = ['LINE', 'BAR', 'AREA', 'SCATTER', 'PIE', 'BOX', 'HIST', 'FLAME', 'TREE', 'FALL'];
        for (const alias of expected) {
            expect(alias in PLOT_NAME_ALIASES).toBe(true);
        }
    });
});
