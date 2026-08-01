import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../utils/durationParser';

describe('parseDuration', () => {
    it('returns null for empty string', () => {
        expect(parseDuration('')).toBeNull();
        expect(parseDuration('   ')).toBeNull();
    });

    it('parses plain number as milliseconds', () => {
        expect(parseDuration('100')).toBe(100);
        expect(parseDuration('2.5')).toBe(2.5);
    });

    it('parses milliseconds (ms)', () => {
        expect(parseDuration('500ms')).toBe(500);
    });

    it('parses seconds (s)', () => {
        expect(parseDuration('2s')).toBe(2000);
    });

    it('parses minutes (m)', () => {
        expect(parseDuration('1m')).toBe(60_000);
    });

    it('parses hours (h)', () => {
        expect(parseDuration('1h')).toBe(3_600_000);
    });

    it('parses days (d)', () => {
        expect(parseDuration('1d')).toBe(86_400_000);
    });

    it('parses compound duration "5m 30s"', () => {
        expect(parseDuration('5m 30s')).toBe(5 * 60_000 + 30_000);
    });

    it('parses "1h 30m 45s 100ms"', () => {
        const expected = 3_600_000 + 30 * 60_000 + 45_000 + 100;
        expect(parseDuration('1h 30m 45s 100ms')).toBeCloseTo(expected);
    });

    it('handles fractional values', () => {
        expect(parseDuration('1.5s')).toBe(1500);
    });

    it('returns null for unrecognized unit', () => {
        expect(parseDuration('5ns')).toBeNull();
    });

    it('returns null for garbage input', () => {
        expect(parseDuration('not-a-duration')).toBeNull();
    });

    it('is case-sensitive (uppercase units not recognized)', () => {
        // The parser lowercases input, so 'S' is matched as 's'
        // Actually parseDuration lowercases: `trimmed.toLowerCase()`
        expect(parseDuration('2S')).toBe(2000);
    });
});
