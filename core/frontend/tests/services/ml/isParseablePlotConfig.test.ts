import { describe, it, expect } from 'vitest';
import { isParseablePlotConfig } from '../../../services/ml/isParseablePlotConfig';

describe('isParseablePlotConfig — valid configs', () => {
    it('returns true for TABLE()', () => {
        expect(isParseablePlotConfig('TABLE()')).toBe(true);
    });

    it('returns true for TABLE with headers', () => {
        expect(isParseablePlotConfig('TABLE(headers: ["cause", "duration"])')).toBe(true);
    });

    it('returns true for BAR_CHART with required x and y', () => {
        expect(isParseablePlotConfig('BAR_CHART(x: cause, y: [duration])')).toBe(true);
    });

    it('returns true for HISTOGRAM with required x column', () => {
        expect(isParseablePlotConfig('HISTOGRAM(x: duration)')).toBe(true);
    });

    it('returns true for short alias TABLE (normalized)', () => {
        expect(isParseablePlotConfig('TABLE()')).toBe(true);
    });

    it('returns true with leading/trailing whitespace', () => {
        expect(isParseablePlotConfig('  TABLE()  ')).toBe(true);
    });
});

describe('isParseablePlotConfig — invalid / unparseable configs', () => {
    it('returns false for empty string', () => {
        expect(isParseablePlotConfig('')).toBe(false);
    });

    it('returns false for whitespace-only string', () => {
        expect(isParseablePlotConfig('   ')).toBe(false);
    });

    it('returns false for unknown plot type', () => {
        expect(isParseablePlotConfig('UNKNOWN_PLOT(x: foo)')).toBe(false);
    });

    it('returns false for plain SQL text', () => {
        expect(isParseablePlotConfig('SELECT * FROM events')).toBe(false);
    });

    it('returns false for string with no opening paren', () => {
        expect(isParseablePlotConfig('TABLE')).toBe(false);
    });

    it('returns false for config that triggers a parse error', () => {
        // Malformed: missing closing paren
        expect(isParseablePlotConfig('BAR_CHART(x: ')).toBe(false);
    });
});

describe('isParseablePlotConfig — short aliases', () => {
    it('returns true for LINE alias when config is valid', () => {
        expect(isParseablePlotConfig('LINE(x: ts, y: [value])')).toBe(true);
    });

    it('returns true for HIST alias', () => {
        expect(isParseablePlotConfig('HIST(x: duration)')).toBe(true);
    });
});
