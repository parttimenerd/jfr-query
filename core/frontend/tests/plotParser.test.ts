import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('Plot Parser', () => {
    it('parses basic plot call', () => {
        const input = 'LINE_CHART(x: "time", y: ["cpu"])';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('LINE_CHART(x: "time", y: ["cpu"])');
        expect(result.title).toBeFalsy();
    });

    it('extracts TITLE clause', () => {
        const input = 'TABLE() TITLE "My Table"';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('TABLE()');
        expect(result.title).toBe('My Table');
    });

    it('extracts ON clause with single index', () => {
        const input = 'BAR_CHART(x: "cat") ON 1';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('BAR_CHART(x: "cat")');
        expect(result.on).toEqual(['1']);
    });

    it('extracts complex dimensions and link_x', () => {
        // WIDTH/HEIGHT clauses before LINK_X are now correctly stripped because
        // the clause loop runs a second time after LINK_X is parsed and removed.
        const input = 'SCATTER_PLOT() WIDTH 50% HEIGHT 300px LINK_X($start, $end, master)';
        const result = parsePlotCall(input);
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.linkXMaster).toBe(true);
        expect(result.width).toBe('50%');
        expect(result.height).toBe('300px');
        expect(result.mainConfig).toBe('SCATTER_PLOT()');
    });

    it('extracts WIDTH and HEIGHT when they are the trailing clauses', () => {
        const input = 'SCATTER_PLOT() WIDTH 50% HEIGHT 300px';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('SCATTER_PLOT()');
        expect(result.width).toBe('50%');
        expect(result.height).toBe('300px');
    });

    it('handles plot call with no arguments', () => {
        const result = parsePlotCall('TABLE()');
        expect(result.mainConfig).toBe('TABLE()');
        expect(result.title).toBeFalsy();
        expect(result.on).toBeUndefined();
    });

    it('ON clause with single integer', () => {
        const result = parsePlotCall('LINE_CHART(x: "t") ON 1');
        expect(result.on).toEqual(['1']);
    });

    it('ON clause does not support bracket syntax', () => {
        // The ON regex matches comma-separated values without brackets
        const result = parsePlotCall('LINE_CHART(x: "t") ON [1, 2]');
        expect(result.on).toBeUndefined();
    });

    it('extracts LINK_X with clamp mode', () => {
        const result = parsePlotCall('TABLE() LINK_X($start, $end, clamp)');
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.linkXMaster).toBeFalsy();
    });

    it('extracts WIDTH and HEIGHT with px values', () => {
        // When WIDTH/HEIGHT are the trailing clauses they are correctly stripped
        const result = parsePlotCall('TABLE() WIDTH 400px HEIGHT 200px');
        expect(result.width).toBe('400px');
        expect(result.height).toBe('200px');
    });
});
