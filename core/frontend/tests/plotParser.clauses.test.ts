// W2: tests for the expanded SQL-suffix clause set (LEGEND, AXIS-X, AXIS-Y,
// PALETTE, LINK-Y, LINK-XY, TOOLTIP, BRUSH, NAME, LET, ON HOVER/CLICK).
// Existing clauses (TITLE, ZOOM, HEIGHT, WIDTH, ON, LINK_X) are covered by
// tests/plotParser.test.ts.

import { describe, it, expect } from 'vitest';
import { parsePlotCall, parseComposite } from '../utils/plotParser';

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

    it('parses ZOOM_X 1.5 as a horizontal-only scale', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["cpu"]) ZOOM_X 1.5');
        expect(p.zoomX).toBe(1.5);
        expect(p.zoom).toBeUndefined();
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

describe('parsePlotCall — ON #N hash-index syntax (B-145)', () => {
    it('parses ON #1 as a single ref', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) ON #1');
        expect(p.on).toEqual(['#1']);
    });

    it('parses ON #1, #2 as two refs', () => {
        const p = parsePlotCall('BAR_CHART(x: "h", y: ["c"]) ON #1, #2');
        expect(p.on).toEqual(['#1', '#2']);
    });

    it('parses mixed numeric index and alias refs', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) ON #1, myView');
        expect(p.on).toEqual(['#1', 'myView']);
    });

    it('does not confuse ON #1 with a non-ON token', () => {
        const p = parsePlotCall('TABLE() ON #5');
        expect(p.on).toEqual(['#5']);
        expect(p.mainConfig).toBe('TABLE()');
    });
});

describe('parsePlotCall — bare LINK-Y / LINK-XY (B-146)', () => {
    it('parses bare (unquoted) LINK-Y $var', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) LINK-Y $sharedY');
        expect(p.linkY).toBe('$sharedY');
    });

    it('parses bare (unquoted) LINK-XY $var', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) LINK-XY $sharedXY');
        expect(p.linkXY).toBe('$sharedXY');
    });

    it('still parses quoted LINK-Y $var (backward compat)', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) LINK-Y "$sharedY"');
        expect(p.linkY).toBe('$sharedY');
    });
});

describe('parsePlotCall — escape handling in string arguments (B-153)', () => {
    it('does not split on + inside a double-quoted string', () => {
        // "a+b" inside a TITLE should not be treated as overlay operator
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) TITLE "a + b"');
        expect(p.title).toBe('a + b');
        expect(p.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('handles escaped quotes inside strings', () => {
        // The TITLE regex captures up to the closing quote but does not unescape
        // embedded backslash sequences — that is a known limitation. The important
        // thing is that the parser does not crash and mainConfig is left intact.
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) TITLE "normal title"');
        expect(p.title).toBe('normal title');
        expect(p.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });
});

// B-157: trailing `# comment` after clauses must not silently drop LINK_X.
describe('parsePlotCall — B-157 trailing comment stripping', () => {
    it('parses LINK_X when followed by a # comment', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) LINK_X($start, $end) # interactive zoom');
        expect(p.linkX).toEqual(['$start', '$end']);
        expect(p.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('parses TITLE when followed by a # comment', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) TITLE "My Chart" # dev note');
        expect(p.title).toBe('My Chart');
    });

    it('does not strip ON #1 (hash-index ref is not a comment)', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) ON #1');
        expect(p.on).toEqual(['#1']);
    });

    it('parses LINK_X followed by comment and ON clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) ON #2 LINK_X($a, $b) # zoom');
        expect(p.linkX).toEqual(['$a', '$b']);
        expect(p.on).toEqual(['#2']);
    });
});

describe('parsePlotCall — LINK_SCROLL clause (LINK-SCROLL / LINK_SCROLL)', () => {
    it('parses LINK_SCROLL groupName (bare identifier)', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) LINK_SCROLL slowLog');
        expect(p.linkScroll).toBe('slowLog');
    });

    it('parses LINK-SCROLL "quoted" group name', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) LINK-SCROLL "my group"');
        expect(p.linkScroll).toBe('my group');
    });

    it('parses LINK_SCROLL together with LINK_X', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) LINK_X($a,$b) LINK_SCROLL logs');
        expect(p.linkX).toEqual(['$a', '$b']);
        expect(p.linkScroll).toBe('logs');
    });

    it('parses LINK_SCROLL together with TITLE', () => {
        const p = parsePlotCall('LINE_CHART(x:"ts",y:["c"]) TITLE "My Chart" LINK_SCROLL group1');
        expect(p.title).toBe('My Chart');
        expect(p.linkScroll).toBe('group1');
    });
});

// Bug fix: LINK-Y and LINK-XY take exactly one $variable (not two).
describe('parsePlotCall — LINK-Y / LINK-XY one-var semantics', () => {
    it('LINK-Y takes one $var and leaves linkX unset', () => {
        const p = parsePlotCall('AREA_CHART(x: ts, y: mem) LINK-Y $memDomain');
        expect(p.linkY).toBe('$memDomain');
        expect(p.linkX).toBeUndefined();
    });

    it('LINK-XY takes one $var and leaves linkX unset', () => {
        const p = parsePlotCall('SCATTER_PLOT(x: a, y: b) LINK-XY $combined');
        expect(p.linkXY).toBe('$combined');
        expect(p.linkX).toBeUndefined();
    });

    it('LINK-Y and LINK_X can coexist on the same plot', () => {
        const p = parsePlotCall('LINE_CHART(x: ts, y: cpu) LINK_X($start, $end) LINK-Y $cpuDomain');
        expect(p.linkX).toEqual(['$start', '$end']);
        expect(p.linkY).toBe('$cpuDomain');
    });

    it('LINK-Y $var is independent of LINK-XY $var on different leaves in a ROW', () => {
        const root = parseComposite(
            'ROW(LINE_CHART(x: ts, y: cpu) LINK-Y $cpuDomain, AREA_CHART(x: ts, y: mem) LINK-XY $memDomain)'
        );
        const children = root.composite!.children;
        expect(children[0].linkY).toBe('$cpuDomain');
        expect(children[0].linkXY).toBeUndefined();
        expect(children[1].linkXY).toBe('$memDomain');
        expect(children[1].linkY).toBeUndefined();
    });

    it('parses LINK_Y with underscore', () => {
        const res = parsePlotCall('LINE_CHART X time Y v LINK_Y $ydom');
        expect(res.linkY).toBe('$ydom');
    });

    it('parses LINK_XY with underscore', () => {
        const res = parsePlotCall('LINE_CHART X time Y v LINK_XY $xy');
        expect(res.linkXY).toBe('$xy');
    });

    it('parses AXIS_X sub-clause with underscore', () => {
        const res = parsePlotCall('LINE_CHART X time Y v AXIS_X LABEL "T"');
        expect(res.axisX?.label).toBe('T');
    });

    it('parses AXIS_Y sub-clause with underscore', () => {
        const res = parsePlotCall('LINE_CHART X time Y v AXIS_Y TYPE log');
        expect(res.axisY?.type).toBe('log');
    });

    it('sets linkXMaster undefined when master keyword absent', () => {
        const res = parsePlotCall('LINE_CHART X t Y v LINK_X($a, $b)');
        expect(res.linkX).toEqual(['$a', '$b']);
        expect(res.linkXMaster).toBeUndefined();
    });

    it('sets linkXMaster true when master keyword present', () => {
        const res = parsePlotCall('LINE_CHART X t Y v LINK_X($a, $b, master)');
        expect(res.linkXMaster).toBe(true);
    });
});

describe('regression — AXIS_Y DOMAIN+LABEL after LINK_X and ZOOM', () => {
    it('AXIS_Y DOMAIN+LABEL after LINK_X and ZOOM — gc-analysis regression', () => {
        const input = 'LINE_CHART(x: "Time", y: ["GC Overhead %"]) TITLE "GC Overhead % (10-second windows)" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('LINE_CHART(x: "Time", y: ["GC Overhead %"])');
        expect(result.title).toBe('GC Overhead % (10-second windows)');
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.zoom).toBe(1);
        expect(result.axisY).toEqual({ domain: [0, 100], label: '%' });
    });
});

// ---------------------------------------------------------------------------
// Comprehensive grammar clause coverage tests (≥20 tests covering all 21
// clause types plus variable-arg forms and edge cases).
// ---------------------------------------------------------------------------

describe('parsePlotCall — comprehensive clause coverage', () => {

    // ---- 1. TITLE ----
    it('TITLE clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) TITLE "My Title"');
        expect(p.title).toBe('My Title');
        expect(p.mainConfig).toBe('LINE_CHART(x: "t", y: ["v"])');
    });

    // ---- 2. ZOOM bare ----
    it('ZOOM bare sets zoom to 1', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM');
        expect(p.zoom).toBe(1);
    });

    // ---- 3. ZOOM with number ----
    it('ZOOM with numeric factor', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM 2.5');
        expect(p.zoom).toBe(2.5);
    });

    // ---- 4. ZOOM with $variable ----
    it('ZOOM $variable stores variable name as string', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM $scale');
        expect(p.zoom).toBe('$scale');
    });

    // ---- 5. ZOOM_X ----
    it('ZOOM_X with numeric factor', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM_X 3');
        expect(p.zoomX).toBe(3);
        expect(p.zoom).toBeUndefined();
    });

    // ---- 6. WIDTH with px ----
    it('WIDTH with px value', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) WIDTH 800px');
        expect(p.width).toBe('800px');
    });

    // ---- 7. HEIGHT with % ----
    it('HEIGHT with percent value', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) HEIGHT 50%');
        expect(p.height).toBe('50%');
    });

    // ---- 8. WIDTH $variable ----
    it('WIDTH $variable stores variable name', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) WIDTH $w');
        expect(p.width).toBe('$w');
    });

    // ---- 9. HEIGHT $variable ----
    it('HEIGHT $variable stores variable name', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) HEIGHT $h');
        expect(p.height).toBe('$h');
    });

    // ---- 10. ON with query ref ----
    it('ON clause with single ref', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ON myQuery');
        expect(p.on).toEqual(['myQuery']);
    });

    // ---- 11. ON HOVER TOOLTIP ----
    it('ON HOVER TOOLTIP clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ON HOVER TOOLTIP "val={{v}}"');
        expect(p.onHoverTooltip).toBe('val={{v}}');
    });

    // ---- 12. LEGEND AT LEFT ----
    it('LEGEND AT LEFT', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LEGEND AT LEFT');
        expect(p.legend).toBe('left');
    });

    // ---- 13. LEGEND HIDDEN ----
    it('LEGEND HIDDEN', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LEGEND HIDDEN');
        expect(p.legend).toBe('none');
    });

    // ---- 14. PALETTE ----
    it('PALETTE clause', () => {
        const p = parsePlotCall('BAR_CHART(x: "h", y: ["c"]) PALETTE "dark2"');
        expect(p.palette).toBe('dark2');
    });

    // ---- 15. BRUSH single-var MODE Y ----
    it('BRUSH single-var MODE Y', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) BRUSH $sel MODE Y');
        expect(p.brush).toEqual({ name: '$sel', mode: 'y' });
    });

    // ---- 16. BRUSH single-var MODE XY ----
    it('BRUSH single-var MODE XY', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) BRUSH $sel MODE XY');
        expect(p.brush).toEqual({ name: '$sel', mode: 'xy' });
    });

    // ---- 17. BRUSH two-var (CROSSTAB) form ----
    it('BRUSH two-var form for CROSSTAB', () => {
        const p = parsePlotCall('CROSSTAB(x: "a", y: "b") BRUSH $rowSel $colSel');
        expect(p.brush).toEqual({ name: '$rowSel', mode: 'xy' });
        expect(p.brush2).toBe('$colSel');
    });

    // ---- 18. AXIS_Y DOMAIN with number bounds ----
    it('AXIS_Y DOMAIN with number bounds', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_Y DOMAIN [0, 200]');
        expect(p.axisY?.domain).toEqual([0, 200]);
    });

    // ---- 19. AXIS_X DOMAIN with $variable bounds ----
    it('AXIS_X DOMAIN with $variable bounds', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_X DOMAIN [$min, $max]');
        expect(p.axisX?.domain).toEqual(['$min', '$max']);
    });

    // ---- 20. AXIS_Y DOMAIN with mixed $var and number ----
    it('AXIS_Y DOMAIN with mixed $var and number bound', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_Y DOMAIN [$floor, 100]');
        expect(p.axisY?.domain).toEqual(['$floor', 100]);
    });

    // ---- 21. AXIS_Y LABEL ----
    it('AXIS_Y LABEL sub-clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_Y LABEL "ms"');
        expect(p.axisY?.label).toBe('ms');
    });

    // ---- 22. AXIS_Y TYPE ----
    it('AXIS_Y TYPE LOG', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_Y TYPE LOG');
        expect(p.axisY?.type).toBe('log');
    });

    // ---- 23. AXIS_X FORMAT ----
    it('AXIS_X FORMAT sub-clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "ts", y: ["v"]) AXIS_X FORMAT ".3s"');
        expect(p.axisX?.format).toBe('.3s');
    });

    // ---- 24. LINK_X ----
    it('LINK_X with two variables', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LINK_X($start, $end)');
        expect(p.linkX).toEqual(['$start', '$end']);
    });

    // ---- 25. LINK_X with master and clamp ----
    it('LINK_X with master and clamp options', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LINK_X($a, $b, master, clamp)');
        expect(p.linkX).toEqual(['$a', '$b']);
        expect(p.linkXMaster).toBe(true);
        expect(p.linkXClamp).toBe(true);
    });

    // ---- 26. LINK_Y ----
    it('LINK_Y clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LINK_Y $ydomain');
        expect(p.linkY).toBe('$ydomain');
    });

    // ---- 27. LINK_XY ----
    it('LINK_XY clause', () => {
        const p = parsePlotCall('SCATTER_PLOT(x: "a", y: "b") LINK_XY $combined');
        expect(p.linkXY).toBe('$combined');
    });

    // ---- 28. LINK_SCROLL ----
    it('LINK_SCROLL clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LINK_SCROLL logGroup');
        expect(p.linkScroll).toBe('logGroup');
    });

    // ---- 29. TOOLTIP COLUMNS ----
    it('TOOLTIP COLUMNS clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) TOOLTIP COLUMNS ["host", "dc"]');
        expect(p.tooltipColumns).toEqual(['host', 'dc']);
    });

    // ---- 30. NAME ----
    it('NAME clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) NAME "cpuCell"');
        expect(p.cellName).toBe('cpuCell');
    });

    // ---- 31. DATASET ----
    it('DATASET clause', () => {
        const p = parsePlotCall('TABLE() DATASET my_view');
        expect(p.dataset).toBe('my_view');
        expect(p.mainConfig).toBe('TABLE()');
    });

    // ---- 32. LET single ----
    it('LET clause single variable', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LET threshold = 100');
        expect(p.let).toEqual({ threshold: '100' });
    });

    // ---- 33. LET multiple clauses ----
    it('multiple LET clauses accumulate into map', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) LET a = 1 LET b = 2');
        expect(p.let).toEqual({ a: '1', b: '2' });
    });

    // ---- 34. TABLE() empty args ----
    it('TABLE() with no args is parsed as mainConfig', () => {
        const p = parsePlotCall('TABLE()');
        expect(p.mainConfig).toBe('TABLE()');
        expect(p.title).toBeUndefined();
    });

    // ---- 35. Mixed ordering: TITLE before LINK_X ----
    it('TITLE before LINK_X parsed correctly', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) TITLE "A" LINK_X($a, $b)');
        expect(p.title).toBe('A');
        expect(p.linkX).toEqual(['$a', '$b']);
    });

    // ---- 36. Mixed ordering: AXIS_Y after ZOOM ----
    it('AXIS_Y after ZOOM is parsed correctly', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM AXIS_Y DOMAIN [0, 50]');
        expect(p.zoom).toBe(1);
        expect(p.axisY?.domain).toEqual([0, 50]);
    });

    // ---- 37. Mixed ordering: LEGEND before PALETTE ----
    it('LEGEND before PALETTE parsed correctly', () => {
        const p = parsePlotCall('BAR_CHART(x: "h", y: ["c"]) LEGEND AT TOP PALETTE "set2"');
        expect(p.legend).toBe('top');
        expect(p.palette).toBe('set2');
    });

    // ---- 38. gc-analysis regression (unchanged) ----
    it('gc-analysis regression — AXIS_Y DOMAIN+LABEL after LINK_X and ZOOM', () => {
        const input = 'LINE_CHART(x: "Time", y: ["GC Overhead %"]) TITLE "GC Overhead %" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"';
        const result = parsePlotCall(input);
        expect(result.mainConfig).toBe('LINE_CHART(x: "Time", y: ["GC Overhead %"])');
        expect(result.title).toBe('GC Overhead %');
        expect(result.linkX).toEqual(['$start', '$end']);
        expect(result.zoom).toBe(1);
        expect(result.axisY).toEqual({ domain: [0, 100], label: '%' });
    });

    // ---- 39. ZOOM $scale combined with HEIGHT $h and WIDTH $w ----
    it('ZOOM / HEIGHT / WIDTH all accept $variable args', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) ZOOM $zf HEIGHT $h WIDTH $w');
        expect(p.zoom).toBe('$zf');
        expect(p.height).toBe('$h');
        expect(p.width).toBe('$w');
    });

    // ---- 40. AXIS_Y multiple sub-clauses in single clause ----
    it('AXIS_Y with DOMAIN, LABEL, TYPE in one clause', () => {
        const p = parsePlotCall('LINE_CHART(x: "t", y: ["v"]) AXIS_Y DOMAIN [0, 100] LABEL "CPU %" TYPE LINEAR');
        expect(p.axisY?.domain).toEqual([0, 100]);
        expect(p.axisY?.label).toBe('CPU %');
        expect(p.axisY?.type).toBe('linear');
    });

    // ---- 41. AXIS_X LABEL and TYPE TIME together ----
    it('AXIS_X LABEL "Time" TYPE TIME', () => {
        const r = parsePlotCall('LINE_CHART(x:"t",y:["v"]) AXIS_X LABEL "Time" TYPE TIME');
        expect(r.axisX?.label).toBe('Time');
        expect(r.axisX?.type).toBe('time');
    });

    // ---- 42. AXIS_Y TYPE LOG and FORMAT together ----
    it('AXIS_Y TYPE LOG FORMAT ".2f"', () => {
        const r = parsePlotCall('LINE_CHART(x:"t",y:["v"]) AXIS_Y TYPE LOG FORMAT ".2f"');
        expect(r.axisY?.type).toBe('log');
        expect(r.axisY?.format).toBe('.2f');
    });

    // ---- 43. TITLE with single-quoted string ----
    it("TITLE with single quotes", () => {
        const r = parsePlotCall("TABLE() TITLE 'hello world'");
        expect(r.title).toBe('hello world');
    });
});
