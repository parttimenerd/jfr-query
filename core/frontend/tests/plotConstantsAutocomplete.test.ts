// Verifies the contract PlotConfigEditor depends on for @-reference autocomplete:
// expandPlotConstants(buffer).constants must return everything defined so far,
// in source order, even when the buffer also contains unresolved references.
import { describe, it, expect } from 'vitest';
import { expandPlotConstants } from '../utils/plotConstants';

describe('plot constants — autocomplete discovery', () => {
    it('returns all constants defined in the buffer for completion', () => {
        const r = expandPlotConstants('LET @x = "time"\nLET @y = ["cpu"]\nLINE_CHART(x: @x, y: @y)');
        expect(r.constants.map(c => c.name)).toEqual(['x', 'y']);
    });

    it('still discovers constants when later refs are unresolved', () => {
        // The editor calls expandPlotConstants on every keystroke — partial input
        // with broken references must not hide the constants the user already defined.
        const r = expandPlotConstants('LET @col = "cpu"\nF(x: @c');
        expect(r.constants.map(c => c.name)).toEqual(['col']);
    });

    it('preserves declaration order for stable hint ordering', () => {
        const r = expandPlotConstants('LET @z = 1\nLET @a = 2\nLET @m = 3');
        expect(r.constants.map(c => c.name)).toEqual(['z', 'a', 'm']);
    });

    it('returns the expanded value (with nested refs resolved) for hint preview', () => {
        const r = expandPlotConstants('LET @col = "cpu"\nLET @arr = [@col, "mem"]');
        const arr = r.constants.find(c => c.name === 'arr');
        expect(arr?.value).toBe('["cpu", "mem"]');
    });

    it('empty buffer yields no constants', () => {
        const r = expandPlotConstants('');
        expect(r.constants).toEqual([]);
    });

    it('buffer without any LET yields no constants', () => {
        const r = expandPlotConstants('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.constants).toEqual([]);
    });
});
