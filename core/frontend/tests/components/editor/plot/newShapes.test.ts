import { describe, it, expect } from 'vitest';
import { parse } from '../../../../components/editor/plot/parser';
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
