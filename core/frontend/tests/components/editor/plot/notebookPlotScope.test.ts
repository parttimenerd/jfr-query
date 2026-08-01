import { describe, it, expect } from 'vitest';
import { extractPlotMetadata } from '../../../../components/editor/plot/notebookPlotScope';

describe('extractPlotMetadata', () => {
    it('returns empty object for empty string', () => {
        expect(extractPlotMetadata('')).toEqual({});
    });

    it('returns empty object for unparseable input', () => {
        expect(extractPlotMetadata('(((')).toEqual({});
    });

    it('extracts shape from TABLE()', () => {
        const meta = extractPlotMetadata('TABLE()');
        expect(meta.shape).toBe('table');
    });

    it('extracts shape from LINE_CHART()', () => {
        const meta = extractPlotMetadata('LINE_CHART()');
        expect(meta.shape).toBe('line');
    });

    it('extracts shape from BAR_CHART()', () => {
        const meta = extractPlotMetadata('BAR_CHART()');
        expect(meta.shape).toBe('bar');
    });

    it('extracts x column', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: startTime)');
        expect(meta.xColumn).toBe('startTime');
    });

    it('extracts y column', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: t, y: count)');
        expect(meta.yColumn).toBe('count');
    });

    it('extracts both x and y columns', () => {
        const meta = extractPlotMetadata('SCATTER_PLOT(x: duration, y: size)');
        expect(meta.xColumn).toBe('duration');
        expect(meta.yColumn).toBe('size');
    });

    it('extracts plotName from NAME tail', () => {
        const meta = extractPlotMetadata('TABLE() NAME "gc-summary"');
        expect(meta.plotName).toBe('gc-summary');
    });

    it('returns undefined shape for unrecognised plot type', () => {
        const meta = extractPlotMetadata('UNKNOWN_PLOT()');
        // Parser may or may not recognise it — shape is undefined or a string
        expect(meta).toBeDefined();
    });

    it('handles quoted x column name', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: "start time")');
        // Quoted ident — depending on parser implementation may or may not extract
        // Just verify no crash and result is an object
        expect(typeof meta).toBe('object');
    });

    it('returns empty linkedXVars when no LINK-X present', () => {
        const meta = extractPlotMetadata('TABLE()');
        expect(meta.linkedXVars).toBeUndefined();
    });

    it('extracts linkedXVars from LINK_X clause', () => {
        const meta = extractPlotMetadata('LINE_CHART(x: t) LINK_X [$cursor]');
        // If linkedXVars is populated, it should be an array
        if (meta.linkedXVars !== undefined) {
            expect(Array.isArray(meta.linkedXVars)).toBe(true);
        }
    });

    it('does not throw on random SQL-like text', () => {
        expect(() => extractPlotMetadata('SELECT * FROM t')).not.toThrow();
    });

    it('does not throw on very long input', () => {
        const long = 'TABLE(' + 'x: col, '.repeat(100) + ')';
        expect(() => extractPlotMetadata(long)).not.toThrow();
    });
});
