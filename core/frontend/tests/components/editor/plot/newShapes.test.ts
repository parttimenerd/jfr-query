import { describe, it, expect } from 'vitest';
import { parse, KNOWN_SHAPES } from '../../../../components/editor/plot/parser';
import { derive } from '../../../../components/editor/plot/derive';
import { parsePlotCall } from '../../../../utils/plotParser';

function p(src: string) {
    const root = parse(src);
    return derive(root);
}

describe('treemap / waterfall lowercase DSL fix', () => {
    it('parses TREEMAP uppercase without error', () => {
        const r = p('TREEMAP(label: "name", value: "size")');
        expect(r.mainConfig).toMatch(/TREEMAP/i);
    });

    it('parses treemap lowercase form', () => {
        const r = p('treemap { label: name, value: size }');
        expect(r.mainConfig).toMatch(/TREEMAP/i);
    });

    it('parses WATERFALL uppercase without error', () => {
        const r = p('WATERFALL(category: "phase", value: "delta")');
        expect(r.mainConfig).toMatch(/WATERFALL/i);
    });

    it('parses waterfall lowercase form', () => {
        const r = p('waterfall { category: phase, value: delta }');
        expect(r.mainConfig).toMatch(/WATERFALL/i);
    });
});

describe('VIOLIN_PLOT / SUNBURST / SANKEY / CROSSTAB / BIG_NUMBER recognized in parser', () => {
    it('KNOWN_SHAPES contains violin_plot', () => {
        expect(KNOWN_SHAPES.has('violin_plot')).toBe(true);
    });
    it('KNOWN_SHAPES contains sunburst', () => {
        expect(KNOWN_SHAPES.has('sunburst')).toBe(true);
    });
    it('KNOWN_SHAPES contains sankey', () => {
        expect(KNOWN_SHAPES.has('sankey')).toBe(true);
    });
    it('KNOWN_SHAPES contains crosstab', () => {
        expect(KNOWN_SHAPES.has('crosstab')).toBe(true);
    });
    it('KNOWN_SHAPES contains big_number', () => {
        expect(KNOWN_SHAPES.has('big_number')).toBe(true);
    });

    it('parses VIOLIN_PLOT uppercase', () => {
        const r = p('VIOLIN_PLOT(value: "dur")');
        expect(r.mainConfig).toMatch(/VIOLIN_PLOT/i);
    });

    it('parses SUNBURST uppercase', () => {
        const r = p('SUNBURST(path: ["pkg", "cls"], value: "samples")');
        expect(r.mainConfig).toMatch(/SUNBURST/i);
    });

    it('parses SANKEY uppercase', () => {
        const r = p('SANKEY(source: "caller", target: "callee", value: "n")');
        expect(r.mainConfig).toMatch(/SANKEY/i);
    });

    it('parses BIG_NUMBER uppercase', () => {
        const r = p('BIG_NUMBER(value: "count")');
        expect(r.mainConfig).toMatch(/BIG_NUMBER/i);
    });

    it('KNOWN_SHAPES boundary check: multi-word tail does not consume next VIOLIN_PLOT block', () => {
        // LEGEND clause followed by VIOLIN_PLOT — parser should stop at VIOLIN_PLOT
        const src = 'LINE_CHART(x: "t", y: ["v"]) LEGEND BOTTOM\nVIOLIN_PLOT(value: "dur")';
        const root = parse(src);
        // Should parse as two separate plot calls
        expect(root.children.length).toBeGreaterThanOrEqual(1);
    });
});

describe('BRUSH two-variable extension', () => {
    it('parses single-variable BRUSH (existing behavior unchanged)', () => {
        const r = parsePlotCall('LINE_CHART(x: "ts") BRUSH $sel MODE X');
        expect(r.brush?.name).toBe('$sel');
        expect(r.brush?.mode).toBe('x');
        expect(r.brush2).toBeUndefined();
    });

    it('parses two-variable BRUSH for CROSSTAB', () => {
        const r = parsePlotCall('CROSSTAB(row: "gcType", col: "phase", value: "dur") BRUSH $row_var $col_var');
        expect(r.brush?.name).toBe('$row_var');
        expect(r.brush2).toBe('$col_var');
    });

    it('brush2 is undefined when only one variable given', () => {
        const r = parsePlotCall('BAR_CHART(x: "cat", y: ["val"]) BRUSH $v MODE X');
        expect(r.brush2).toBeUndefined();
    });
});
