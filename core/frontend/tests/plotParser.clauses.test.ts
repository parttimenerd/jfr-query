// W2: tests for the expanded SQL-suffix clause set (LEGEND, AXIS-X, AXIS-Y,
// PALETTE, LINK-Y, LINK-XY, TOOLTIP, BRUSH, NAME, LET, ON HOVER/CLICK).
// Existing clauses (TITLE, ZOOM, HEIGHT, WIDTH, ON, LINK_X) are covered by
// tests/plotParser.test.ts.

import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — new showcase clauses', () => {
    it('parses LEGEND AT RIGHT', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) LEGEND AT RIGHT');
        expect(p.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
        expect(p.legend).toBe('right');
    });

    it('parses LEGEND AT NONE and LEGEND HIDDEN equivalently', () => {
        expect(parsePlotCall('LINE_CHART(x:"t",y:["c"]) LEGEND HIDDEN').legend).toBe('none');
        expect(parsePlotCall('LINE_CHART(x:"t",y:["c"]) LEGEND AT NONE').legend).toBe('none');
    });

    it('parses lowercase legend at bottom', () => {
        const p = parsePlotCall('line_chart(x:"t",y:["c"]) legend at bottom');
        expect(p.legend).toBe('bottom');
    });

    it('parses PALETTE "viridis"', () => {
        const p = parsePlotCall('BAR_CHART(x: "h", y: ["c"]) PALETTE "viridis"');
        expect(p.palette).toBe('viridis');
    });

    it('parses LINK-Y and LINK-XY', () => {
        const p1 = parsePlotCall('LINE_CHART(x:"t",y:["c"]) LINK-Y "$shared"');
        expect(p1.linkY).toBe('$shared');
        const p2 = parsePlotCall('LINE_CHART(x:"t",y:["c"]) LINK-XY "$shared"');
        expect(p2.linkXY).toBe('$shared');
    });

    it('parses TOOLTIP COLUMNS [..]', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) TOOLTIP COLUMNS ["host", "region"]');
        expect(p.tooltipColumns).toEqual(['host', 'region']);
    });

    it('parses ON HOVER TOOLTIP "..."', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) ON HOVER TOOLTIP "value={{cpu}}"');
        expect(p.onHoverTooltip).toBe('value={{cpu}}');
    });

    it('parses ON CLICK NAVIGATE "..."', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) ON CLICK NAVIGATE "/host/{{host}}"');
        expect(p.onClickNavigate).toBe('/host/{{host}}');
    });

    it('parses BRUSH "$var" MODE X', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) BRUSH "$sel" MODE X');
        expect(p.brush).toEqual({ name: '$sel', mode: 'x' });
    });

    it('parses NAME "cellAlias"', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) NAME "trafficCell"');
        expect(p.cellName).toBe('trafficCell');
    });

    it('parses BRUSH + NAME together', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) BRUSH "$sel" MODE X NAME "cellA"');
        expect(p.brush).toEqual({ name: '$sel', mode: 'x' });
        expect(p.cellName).toBe('cellA');
    });

    it('parses AXIS-Y DOMAIN [0, 100]', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) AXIS-Y DOMAIN [0, 100]');
        expect(p.axisY).toEqual({ domain: [0, 100] });
    });

    it('parses AXIS-X DOMAIN with quoted dates', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) AXIS-X DOMAIN ["2025-01-01", "2025-12-31"]');
        expect(p.axisX).toEqual({ domain: ['2025-01-01', '2025-12-31'] });
    });

    it('stacks multiple AXIS-Y sub-clauses (DOMAIN + LABEL + TYPE)', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) AXIS-Y DOMAIN [0, 100] AXIS-Y LABEL "CPU %" AXIS-Y TYPE LOG');
        expect(p.axisY?.domain).toEqual([0, 100]);
        expect(p.axisY?.label).toBe('CPU %');
        expect(p.axisY?.type).toBe('log');
    });

    it('parses AXIS-X FORMAT "..."', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) AXIS-X FORMAT ".2f"');
        expect(p.axisX?.format).toBe('.2f');
    });

    it('stacks multiple LET clauses', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["c"]) LET sloMs = 500 LET host = "edge-1"');
        expect(p.let).toEqual({ sloMs: '500', host: '"edge-1"' });
    });

    it('combines new clauses with legacy ones in any order', () => {
        const p = parsePlotCall(
            'LINE_CHART(x: "ts", y: ["cpu"]) TITLE "CPU" PALETTE "viridis" LEGEND AT BOTTOM HEIGHT 400px',
        );
        expect(p.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
        expect(p.title).toBe('CPU');
        expect(p.palette).toBe('viridis');
        expect(p.legend).toBe('bottom');
        expect(p.height).toBe('400px');
    });

    it('does not match clause keywords inside the body (word-boundary guard)', () => {
        // `legendary` should not be confused with LEGEND.
        const p = parsePlotCall('LINE_CHART(x: "legendary", y: ["c"]) TITLE "ok"');
        expect(p.mainConfig).toBe('LINE_CHART(x: "legendary", y: ["c"])');
        expect(p.legend).toBeUndefined();
        expect(p.title).toBe('ok');
    });

    it('keeps the ON HOVER TOOLTIP separate from the legacy ON query-ref clause', () => {
        // Bare ON 1 + later trailing ON HOVER TOOLTIP must not collide.
        const p = parsePlotCall(
            'LINE_CHART(x:"t",y:["c"]) ON 1 ON HOVER TOOLTIP "v={{c}}"',
        );
        expect(p.on).toEqual(['1']);
        expect(p.onHoverTooltip).toBe('v={{c}}');
    });
});
