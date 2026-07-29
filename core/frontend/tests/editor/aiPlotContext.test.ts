// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { summarizeShapeRegistry } from '../../components/editor/plot/aiPlotContext';

describe('summarizeShapeRegistry', () => {
    it('returns empty string for undefined', () => {
        expect(summarizeShapeRegistry(undefined)).toBe('');
    });

    it('returns empty string for empty registry', () => {
        expect(summarizeShapeRegistry({})).toBe('');
    });

    it('lists required params for each shape', () => {
        const summary = summarizeShapeRegistry({
            LINE_CHART: {
                name: 'LINE_CHART',
                description: 'line',
                params: [{ name: 'x', type: 'column', required: true, description: 'X' }],
                examples: [{ description: 'Basic', code: 'LINE_CHART(x: "ts", y: "val")' }],
                template: '',
                parseConfig: () => ({} as any),
                component: (() => null) as any,
            },
        } as any);
        expect(summary).toContain('LINE_CHART');
        expect(summary).toContain('x: column');
    });

    it('includes multiple examples per shape when available', () => {
        const fakeReg = {
            FOO_PLOT: {
                name: 'FOO_PLOT',
                description: 'A foo plot',
                params: [
                    { name: 'x', type: 'column', required: true, description: 'X axis' },
                    { name: 'y', type: 'column', required: true, description: 'Y axis' },
                ],
                examples: [
                    { description: 'Basic', code: 'FOO_PLOT(x: "a", y: "b")' },
                    { description: 'Multi-y', code: 'FOO_PLOT(x: "a", y: ["b","c"])' },
                ],
                template: 'FOO_PLOT(x: "$x", y: "$y")',
                parseConfig: () => ({} as any),
                component: (() => null) as any,
            },
        } as any;
        const summary = summarizeShapeRegistry(fakeReg);
        expect(summary).toContain('FOO_PLOT(x: "a", y: "b")');
        expect(summary).toContain('FOO_PLOT(x: "a", y: ["b","c"])');
    });

    it('limits to at most 3 examples per shape', () => {
        const fakeReg = {
            BAR: {
                name: 'BAR',
                description: 'bar',
                params: [],
                examples: [
                    { description: '1', code: 'BAR(a: "x")' },
                    { description: '2', code: 'BAR(b: "y")' },
                    { description: '3', code: 'BAR(c: "z")' },
                    { description: '4', code: 'BAR(d: "w")' },  // should NOT appear
                ],
                template: '',
                parseConfig: () => ({} as any),
                component: (() => null) as any,
            },
        } as any;
        const summary = summarizeShapeRegistry(fakeReg);
        expect(summary).toContain('BAR(a: "x")');
        expect(summary).toContain('BAR(c: "z")');
        expect(summary).not.toContain('BAR(d: "w")');
    });
});
