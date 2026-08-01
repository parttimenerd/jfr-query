import { describe, it, expect } from 'vitest';
import {
    parseIntervalToSeconds,
    isIntervalLike,
    isDurationLike,
    isByteLike,
    formatBytes,
    compareValues,
    csvValue,
    DURATION_KEYWORDS,
} from '../../utils/dataTableUtils';

// ─── parseIntervalToSeconds ───────────────────────────────────────────────────

describe('parseIntervalToSeconds', () => {
    it('parses array [µs, days, months] — only µs set', () => {
        expect(parseIntervalToSeconds([1_000_000, 0, 0])).toBeCloseTo(1);
    });

    it('parses array with days', () => {
        expect(parseIntervalToSeconds([0, 1, 0])).toBeCloseTo(86_400);
    });

    it('parses array with months (30-day approximation)', () => {
        expect(parseIntervalToSeconds([0, 0, 1])).toBeCloseTo(30 * 86_400);
    });

    it('parses array with all three components', () => {
        const expected = 500_000 / 1_000_000 + 1 * 86_400 + 1 * 30 * 86_400;
        expect(parseIntervalToSeconds([500_000, 1, 1])).toBeCloseTo(expected);
    });

    it('parses comma-string format', () => {
        expect(parseIntervalToSeconds('1000000,0,0')).toBeCloseTo(1);
    });

    it('parses comma-string with days', () => {
        expect(parseIntervalToSeconds('0,2,0')).toBeCloseTo(2 * 86_400);
    });

    it('returns null for non-array non-string', () => {
        expect(parseIntervalToSeconds(42)).toBeNull();
        expect(parseIntervalToSeconds(null)).toBeNull();
        expect(parseIntervalToSeconds({})).toBeNull();
    });

    it('returns null for unmatched string', () => {
        expect(parseIntervalToSeconds('abc')).toBeNull();
    });

    it('handles 4-element array (ignores 4th)', () => {
        expect(parseIntervalToSeconds([1_000_000, 0, 0, 99])).toBeCloseTo(1);
    });
});

// ─── isIntervalLike ───────────────────────────────────────────────────────────

describe('isIntervalLike', () => {
    it('recognises 3-element numeric array', () => {
        expect(isIntervalLike([0, 0, 0])).toBe(true);
    });

    it('recognises 4-element numeric array', () => {
        expect(isIntervalLike([1_000_000, 0, 0, 0])).toBe(true);
    });

    it('recognises comma-string', () => {
        expect(isIntervalLike('1000000,0,0')).toBe(true);
    });

    it('rejects array with non-numeric elements', () => {
        expect(isIntervalLike([1, 'x', 0])).toBe(false);
    });

    it('rejects 2-element array', () => {
        expect(isIntervalLike([1, 2])).toBe(false);
    });

    it('rejects plain number', () => {
        expect(isIntervalLike(1_000_000)).toBe(false);
    });

    it('rejects plain string without commas', () => {
        expect(isIntervalLike('hello')).toBe(false);
    });
});

// ─── isDurationLike ───────────────────────────────────────────────────────────

describe('isDurationLike', () => {
    it('returns true for genuine INTERVAL array', () => {
        expect(isDurationLike('foo', { foo: [500_000, 0, 0] })).toBe(true);
    });

    it('returns true when column name has duration keyword and value in range', () => {
        // 1 ms = 1000 µs
        expect(isDurationLike('duration', { duration: 1_000 })).toBe(true);
    });

    it('uses all keywords from DURATION_KEYWORDS', () => {
        for (const kw of DURATION_KEYWORDS) {
            expect(isDurationLike(kw, { [kw]: 1_000 })).toBe(true);
        }
    });

    it('returns false for value above cap (1e12)', () => {
        expect(isDurationLike('duration', { duration: 1e13 })).toBe(false);
    });

    it('returns false for negative value', () => {
        expect(isDurationLike('duration', { duration: -1 })).toBe(false);
    });

    it('returns false when column name has no duration keyword', () => {
        expect(isDurationLike('price', { price: 1_000 })).toBe(false);
    });

    it('returns false when sample is null', () => {
        expect(isDurationLike('duration', null)).toBe(false);
    });

    it('returns false when column value is absent', () => {
        expect(isDurationLike('duration', {})).toBe(false);
    });

    it('returns false for string value on numeric path', () => {
        expect(isDurationLike('duration', { duration: 'fast' })).toBe(false);
    });
});

// ─── isByteLike ───────────────────────────────────────────────────────────────

describe('isByteLike', () => {
    it('returns true for heap column with 50 MB', () => {
        expect(isByteLike('heap', { heap: 50 * 1024 * 1024 })).toBe(true);
    });

    it('returns true for bytes column with 1 KB', () => {
        expect(isByteLike('bytes', { bytes: 1_024 })).toBe(true);
    });

    it('returns false for value below MIN_BYTE_VAL (1 KB)', () => {
        expect(isByteLike('bytes', { bytes: 512 })).toBe(false);
    });

    it('returns false for value above MAX_BYTE_VAL (256 GB)', () => {
        const tooBig = 256 * 1024 ** 3 + 1;
        expect(isByteLike('bytes', { bytes: tooBig })).toBe(false);
    });

    it('returns false for column with no byte keyword', () => {
        expect(isByteLike('duration', { duration: 1_000_000 })).toBe(false);
    });

    it('returns false for non-numeric value', () => {
        expect(isByteLike('bytes', { bytes: '1024' })).toBe(false);
    });

    it('returns false when sample is null', () => {
        expect(isByteLike('bytes', null)).toBe(false);
    });
});

// ─── formatBytes ─────────────────────────────────────────────────────────────

describe('formatBytes', () => {
    it('formats bytes', () => {
        expect(formatBytes(512)).toBe('512 B');
    });

    it('formats kilobytes', () => {
        expect(formatBytes(1_024)).toBe('1.0 KB');
    });

    it('formats megabytes', () => {
        expect(formatBytes(1_024 ** 2)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
        expect(formatBytes(1_024 ** 3)).toBe('1.0 GB');
    });

    it('formats fractional megabytes', () => {
        expect(formatBytes(512 * 1024)).toBe('512.0 KB');
    });

    it('formats negative values', () => {
        expect(formatBytes(-1_024)).toBe('-1.0 KB');
    });
});

// ─── compareValues ────────────────────────────────────────────────────────────

describe('compareValues', () => {
    it('sorts numbers ascending', () => {
        expect(compareValues(1, 2, true)).toBeLessThan(0);
        expect(compareValues(2, 1, true)).toBeGreaterThan(0);
        expect(compareValues(1, 1, true)).toBe(0);
    });

    it('reverses for descending', () => {
        expect(compareValues(1, 2, false)).toBeGreaterThan(0);
    });

    it('sorts BigInt values', () => {
        expect(compareValues(1n, 2n, true)).toBeLessThan(0);
        expect(compareValues(2n, 1n, true)).toBeGreaterThan(0);
    });

    it('handles mixed BigInt and number', () => {
        expect(compareValues(1n, 2, true)).toBeLessThan(0);
        expect(compareValues(2, 1n, true)).toBeGreaterThan(0);
    });

    it('sorts strings lexicographically', () => {
        expect(compareValues('a', 'b', true)).toBeLessThan(0);
        expect(compareValues('b', 'a', true)).toBeGreaterThan(0);
    });

    it('sorts nulls last in ascending order', () => {
        expect(compareValues(null, 1, true)).toBeGreaterThan(0);
        expect(compareValues(1, null, true)).toBeLessThan(0);
    });

    it('handles two nulls as equal', () => {
        expect(compareValues(null, null, true)).toBe(0);
    });
});

// ─── csvValue ─────────────────────────────────────────────────────────────────

describe('csvValue', () => {
    it('converts number to string', () => {
        expect(csvValue(42)).toBe('42');
    });

    it('converts string to string', () => {
        expect(csvValue('hello')).toBe('hello');
    });

    it('returns empty string for null', () => {
        expect(csvValue(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(csvValue(undefined)).toBe('');
    });

    it('converts BigInt to string', () => {
        expect(csvValue(9007199254740993n)).toBe('9007199254740993');
    });
});
