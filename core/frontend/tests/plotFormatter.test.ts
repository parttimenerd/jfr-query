import { describe, it, expect } from 'vitest';
import { formatPlotCode } from '../utils/plotFormatter';

describe('Plot Formatter', () => {
    it('formats simple call', () => {
        const input = 'line_chart(x:"t",y:["v"])';
        const output = formatPlotCode(input);
        expect(output).toBe('LINE_CHART(x: "t", y: ["v"])');
    });

    it('uppercases chart type', () => {
        const output = formatPlotCode('bar_chart(x: "cat")');
        expect(output?.startsWith('BAR_CHART')).toBe(true);
    });

    it('uppercases chart type and trailing clause keywords', () => {
        // formatPlotCode uppercases both the main chart type and known clause keywords
        const output = formatPlotCode('table() title "My Title"');
        expect(output).toContain('TABLE()');
        // The 'title' keyword is uppercased by the keyword pass
        expect(output).toContain('TITLE');
    });

    it('handles already-uppercase input', () => {
        const input = 'LINE_CHART(x: "t", y: ["v"])';
        const output = formatPlotCode(input);
        expect(output).toBe(input);
    });

    it('returns non-null for empty-arg chart', () => {
        const output = formatPlotCode('table()');
        expect(output).not.toBeNull();
        expect(output?.startsWith('TABLE')).toBe(true);
    });
});
