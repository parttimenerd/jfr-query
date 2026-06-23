import { describe, it, expect } from 'vitest';
import { expandPlotConstants } from '../utils/plotConstants';

describe('expandPlotConstants — basics', () => {
    it('passes through config with no LET lines unchanged', () => {
        const r = expandPlotConstants('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.expanded).toBe('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.errors).toEqual([]);
        expect(r.constants).toEqual([]);
    });

    it('substitutes a simple string constant', () => {
        const r = expandPlotConstants('LET @x = "time"\nLINE_CHART(x: @x, y: ["cpu"])');
        expect(r.expanded).toBe('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.errors).toEqual([]);
        expect(r.constants).toEqual([{ name: 'x', value: '"time"' }]);
    });

    it('substitutes an array constant', () => {
        const r = expandPlotConstants('LET @y = ["cpu", "mem"]\nLINE_CHART(x: "time", y: @y)');
        expect(r.expanded).toBe('LINE_CHART(x: "time", y: ["cpu", "mem"])');
        expect(r.errors).toEqual([]);
    });

    it('substitutes a number constant', () => {
        const r = expandPlotConstants('LET @w = 300\nLINE_CHART(x: "t", y: ["c"]) WIDTH @w');
        expect(r.expanded).toBe('LINE_CHART(x: "t", y: ["c"]) WIDTH 300');
    });

    it('handles multiple constants in one line', () => {
        const r = expandPlotConstants('LET @a = "x"\nLET @b = "y"\nF(p: @a, q: @b)');
        expect(r.expanded).toBe('F(p: "x", q: "y")');
    });

    it('strips LET lines from output', () => {
        const r = expandPlotConstants('LET @c = 1\nLINE_CHART(x: "t", y: ["c"])');
        // The output should NOT contain "LET" anywhere
        expect(r.expanded).not.toMatch(/LET/);
    });

    it('preserves blank lines between configs (multi-row plots)', () => {
        const r = expandPlotConstants('LET @v = "duration"\nLINE_CHART(x: @v, y: ["c"])\n\nBAR_CHART(x: @v)');
        expect(r.expanded).toBe('LINE_CHART(x: "duration", y: ["c"])\n\nBAR_CHART(x: "duration")');
    });

    it('allows constants to reference earlier constants', () => {
        const r = expandPlotConstants('LET @col = "cpu"\nLET @arr = [@col, "mem"]\nF(y: @arr)');
        expect(r.expanded).toBe('F(y: ["cpu", "mem"])');
        expect(r.errors).toEqual([]);
    });
});

describe('expandPlotConstants — error cases', () => {
    it('reports undefined constant', () => {
        const r = expandPlotConstants('LINE_CHART(x: @missing)');
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toMatch(/undefined constant @missing/);
    });

    it('reports forward reference (undefined when used)', () => {
        const r = expandPlotConstants('F(x: @later)\nLET @later = "x"');
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toMatch(/undefined/);
    });

    it('reports redefinition', () => {
        const r = expandPlotConstants('LET @x = 1\nLET @x = 2\nF(p: @x)');
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toMatch(/redefinition of @x/);
        // Second definition wins
        expect(r.expanded).toBe('F(p: 2)');
    });

    it('error message includes line number', () => {
        const r = expandPlotConstants('\n\n\nF(x: @missing)');
        expect(r.errors[0]).toMatch(/Line 4/);
    });

    it('suggests a nearby defined constant for typos', () => {
        const r = expandPlotConstants('LET @colName = "x"\nF(p: @colNam)');
        expect(r.errors[0]).toMatch(/@colName/);
    });

    it('reports defined constants when reference unknown and no close match', () => {
        const r = expandPlotConstants('LET @aaa = 1\nLET @bbb = 2\nF(p: @zzz)');
        expect(r.errors[0]).toMatch(/@aaa/);
        expect(r.errors[0]).toMatch(/@bbb/);
    });

    it('hints to use LET when no constants defined', () => {
        const r = expandPlotConstants('F(p: @whatever)');
        expect(r.errors[0]).toMatch(/LET @name = value/);
    });
});

describe('expandPlotConstants — does not interfere with $-variables', () => {
    it('leaves $globalvar alone', () => {
        const r = expandPlotConstants('LINE_CHART(x: $start, y: ["cpu"])');
        expect(r.expanded).toBe('LINE_CHART(x: $start, y: ["cpu"])');
    });

    it('mixes @local and $global in one line', () => {
        const r = expandPlotConstants('LET @c = "cpu"\nLINE_CHART(x: $start, y: [@c])');
        expect(r.expanded).toBe('LINE_CHART(x: $start, y: ["cpu"])');
    });
});

describe('expandPlotConstants — whitespace & spacing', () => {
    it('tolerates extra whitespace around =', () => {
        const r = expandPlotConstants('LET    @x   =   "a"\nF(p: @x)');
        expect(r.expanded).toBe('F(p: "a")');
    });

    it('tolerates LET with trailing spaces before newline', () => {
        const r = expandPlotConstants('LET @x = "a"   \nF(p: @x)');
        expect(r.expanded).toBe('F(p: "a")');
    });

    it('case-insensitive LET keyword', () => {
        const r = expandPlotConstants('let @x = 1\nF(p: @x)');
        expect(r.expanded).toBe('F(p: 1)');
    });
});
