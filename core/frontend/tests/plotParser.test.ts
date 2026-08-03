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

// Ohm.js PEG grammar smoke tests — verify the primary parser handles the canonical
// use-cases and that the regex fallback is only used for edge-case inputs.
describe('Plot Parser — Ohm.js grammar smoke tests', () => {
    it('Ohm grammar: parses all clause types in a single complex input', () => {
        const input =
            'LINE_CHART(x: "Time", y: ["GC Overhead %"]) ' +
            'TITLE "GC Overhead % (10-second windows)" ' +
            'LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"';
        const r = parsePlotCall(input);
        expect(r.mainConfig).toBe('LINE_CHART(x: "Time", y: ["GC Overhead %"])');
        expect(r.title).toBe('GC Overhead % (10-second windows)');
        expect(r.linkX).toEqual(['$start', '$end']);
        expect(r.zoom).toBe(1);
        expect(r.axisY).toEqual({ domain: [0, 100], label: '%' });
    });

    it('Ohm grammar: LINK-XY with quoted $var', () => {
        const r = parsePlotCall('SCATTER_PLOT(x: a, y: b) LINK-XY "$combined"');
        expect(r.linkXY).toBe('$combined');
    });

    it('Ohm grammar: LINK-XY without quotes', () => {
        const r = parsePlotCall('SCATTER_PLOT(x: a, y: b) LINK-XY $combined');
        expect(r.linkXY).toBe('$combined');
    });

    it('Ohm grammar: LINK_SCROLL before LINK_XY does not corrupt the latter', () => {
        const r = parsePlotCall('LINE_CHART(x: ts, y: v) LINK_XY $xy LINK_SCROLL logs');
        expect(r.linkXY).toBe('$xy');
        expect(r.linkScroll).toBe('logs');
    });

    it('Ohm grammar: all five AXIS_Y sub-clauses combined', () => {
        const r = parsePlotCall(
            'LINE_CHART(x: "ts", y: ["cpu"]) ' +
            'AXIS_Y DOMAIN [0, 100] LABEL "CPU %" TYPE LINEAR FORMAT ".1f"',
        );
        expect(r.axisY).toEqual({ domain: [0, 100], label: 'CPU %', type: 'linear', format: '.1f' });
    });

    it('Ohm grammar: ZOOM_X is parsed correctly (not confused with ZOOM)', () => {
        const r = parsePlotCall('LINE_CHART(x: "ts") ZOOM_X 1.5');
        expect(r.zoomX).toBe(1.5);
        expect(r.zoom).toBeUndefined();
    });
});

