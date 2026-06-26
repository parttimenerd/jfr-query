import { describe, it, expect } from 'vitest';
import { formatNumber } from '../utils/numberFormatter';

describe('formatNumber', () => {
    it('formats integer with 0 decimal places (no trailing .0)', () => {
        expect(formatNumber(42, 2)).toBe('42');
    });

    it('formats float with up to N decimal places', () => {
        expect(formatNumber(3.14159, 2)).toBe('3.14');
        expect(formatNumber(3.14159, 4)).toBe('3.1416');
    });

    it('does not add trailing zeros', () => {
        expect(formatNumber(3.1, 4)).toBe('3.1');
        expect(formatNumber(3, 4)).toBe('3');
    });

    it('returns boolean values as-is', () => {
        expect(formatNumber(true, 2)).toBe('true');
        expect(formatNumber(false, 2)).toBe('false');
    });

    it('returns null as string "null"', () => {
        expect(formatNumber(null, 2)).toBe('null');
    });

    it('returns undefined as string "undefined"', () => {
        expect(formatNumber(undefined, 2)).toBe('undefined');
    });

    it('returns NaN as string "NaN"', () => {
        expect(formatNumber(NaN, 2)).toBe('NaN');
    });

    it('returns non-numeric strings as-is', () => {
        expect(formatNumber('not-a-number', 2)).toBe('not-a-number');
    });

    it('handles 0 decimal places', () => {
        expect(formatNumber(3.7, 0)).toBe('4');
        expect(formatNumber(3.2, 0)).toBe('3');
    });

    it('handles string numbers', () => {
        expect(formatNumber('42.567', 1)).toBe('42.6');
    });

    it('does not use grouping separators (no commas)', () => {
        expect(formatNumber(1234567, 0)).toBe('1234567');
    });

    it('handles negative numbers', () => {
        expect(formatNumber(-3.14159, 2)).toBe('-3.14');
    });

    it('handles very small numbers', () => {
        expect(formatNumber(0.0001, 6)).toBe('0.0001');
    });
});
