import { describe, it, expect } from 'vitest';
import { withCommonParams, COMMON_PLOT_PARAMS, type PlotParameter } from '../../../components/plots/plotTypes';

// ── COMMON_PLOT_PARAMS ────────────────────────────────────────────────────────

describe('COMMON_PLOT_PARAMS', () => {
    it('is a non-empty array', () => {
        expect(COMMON_PLOT_PARAMS.length).toBeGreaterThan(0);
    });

    it('contains a title param', () => {
        const titleParam = COMMON_PLOT_PARAMS.find(p => p.name === 'title');
        expect(titleParam).toBeDefined();
        expect(titleParam?.required).toBe(false);
    });
});

// ── withCommonParams ──────────────────────────────────────────────────────────

const xParam: PlotParameter = { name: 'x', type: 'column', required: true, description: 'X axis' };
const yParam: PlotParameter = { name: 'y', type: 'column', required: true, description: 'Y axis' };

describe('withCommonParams', () => {
    it('appends COMMON_PLOT_PARAMS to given params', () => {
        const result = withCommonParams([xParam, yParam]);
        expect(result.length).toBe(2 + COMMON_PLOT_PARAMS.length);
    });

    it('preserves the original params in order', () => {
        const result = withCommonParams([xParam, yParam]);
        expect(result[0].name).toBe('x');
        expect(result[1].name).toBe('y');
    });

    it('does not duplicate if a common param already exists', () => {
        const titleParam: PlotParameter = { name: 'title', type: 'string', required: false, description: 'Custom title' };
        const result = withCommonParams([xParam, titleParam]);
        const titleCount = result.filter(p => p.name === 'title').length;
        expect(titleCount).toBe(1);
    });

    it('keeps the caller-provided version when deduplicating', () => {
        const customTitle: PlotParameter = { name: 'title', type: 'string', required: true, description: 'My title' };
        const result = withCommonParams([customTitle]);
        const t = result.find(p => p.name === 'title')!;
        expect(t.required).toBe(true);
        expect(t.description).toBe('My title');
    });

    it('returns a new array (does not mutate input)', () => {
        const input = [xParam];
        const result = withCommonParams(input);
        expect(result).not.toBe(input);
        expect(input).toHaveLength(1);
    });

    it('handles empty input by returning only common params', () => {
        const result = withCommonParams([]);
        expect(result).toEqual(COMMON_PLOT_PARAMS);
    });
});
