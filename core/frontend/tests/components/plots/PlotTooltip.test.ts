import { describe, it, expect } from 'vitest';
import { formatTooltipValue } from '../../../components/plots/PlotTooltip';

describe('formatTooltipValue', () => {
    it('formats large integers with thousands separators', () => {
        expect(formatTooltipValue(1234567)).toBe('1,234,567');
    });
    it('formats floats to at most 3 decimal places', () => {
        expect(formatTooltipValue(123.456789)).toBe('123.457');
    });
    it('passes strings through unchanged', () => {
        expect(formatTooltipValue('hello')).toBe('hello');
    });
    it('formats near-zero floats with toPrecision(3)', () => {
        // The exact output depends on locale; just verify it is a string
        const result = formatTooltipValue(0.001234);
        expect(typeof result).toBe('string');
        expect(result).toMatch(/0\.00123/);
    });
    it('handles null/undefined', () => {
        expect(formatTooltipValue(null)).toBe('');
        expect(formatTooltipValue(undefined)).toBe('');
    });
    it('handles Infinity', () => {
        expect(formatTooltipValue(Infinity)).toBe('Infinity');
    });
    it('handles zero', () => {
        expect(formatTooltipValue(0)).toBe('0');
    });
});
