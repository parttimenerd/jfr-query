import { describe, it, expect } from 'vitest';
import { parseDuration } from '../utils/durationParser';

describe('Duration Parser', () => {
    it('parses simple milliseconds', () => {
        expect(parseDuration('500ms')).toBe(500);
    });

    it('parses seconds', () => {
        expect(parseDuration('1.5s')).toBe(1500);
    });

    it('parses mixed units', () => {
        expect(parseDuration('1m 30s')).toBe(90000);
    });

    it('returns null for invalid input', () => {
        expect(parseDuration('abc')).toBeNull();
        expect(parseDuration('100x')).toBeNull();
    });

    it('parses minutes only', () => {
        expect(parseDuration('2m')).toBe(120000);
    });

    it('parses hours', () => {
        expect(parseDuration('1h')).toBe(3600000);
    });

    it('returns 0 for zero value (zero is a valid parse result)', () => {
        expect(parseDuration('0ms')).toBe(0);
    });

    it('handles whitespace variants', () => {
        expect(parseDuration('  500ms  ')).toBe(500);
    });

    it('treats a bare number as milliseconds', () => {
        expect(parseDuration('250')).toBe(250);
        expect(parseDuration('1.5')).toBe(1.5);
    });

    it('returns null for empty string', () => {
        expect(parseDuration('')).toBeNull();
        expect(parseDuration('   ')).toBeNull();
    });

    it('parses days', () => {
        expect(parseDuration('1d')).toBe(86400000);
    });

    it('parses complex multi-unit: hours + minutes + seconds + ms', () => {
        const expected = 1 * 3600000 + 2 * 60000 + 3 * 1000 + 500;
        expect(parseDuration('1h 2m 3s 500ms')).toBe(expected);
    });
});
