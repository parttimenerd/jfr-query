import { describe, it, expect } from 'vitest';
import {
    isDurationLike,
    isIntervalLike,
    parseIntervalToSeconds,
    compareValues,
    csvValue,
} from '../utils/dataTableUtils';

// ─── B-113: isDurationLike upper cap ─────────────────────────────────────────

describe('isDurationLike — B-113: upper cap raised to 1e12', () => {
    // Genuine DuckDB INTERVAL values are always treated as durations.
    it('detects INTERVAL array shape', () => {
        expect(isDurationLike('col', { col: [1_800_000_000, 0, 0] })).toBe(true);
    });

    it('detects INTERVAL comma-string shape', () => {
        expect(isDurationLike('col', { col: '1800000000,0,0' })).toBe(true);
    });

    // Numeric heuristic — column must have a duration keyword.
    it('accepts numeric duration at exactly 1e9 (was rejected with old 1e9 cap)', () => {
        // 1e9 µs = 1 000 s ≈ 16.7 min — a valid GC pause duration.
        expect(isDurationLike('gcDuration', { gcDuration: 1_000_000_000 })).toBe(true);
    });

    it('accepts 30-minute pause (1.8e9 µs) which was excluded by the old 1e9 cap', () => {
        const thirtyMinutesMicros = 1_800_000_000;
        expect(isDurationLike('pause', { pause: thirtyMinutesMicros })).toBe(true);
    });

    it('accepts value at exactly the new cap (1e12 µs ≈ 11.6 days)', () => {
        expect(isDurationLike('duration', { duration: 1e12 })).toBe(true);
    });

    it('rejects value above the new cap (epoch-scale numbers)', () => {
        // 2e12 µs would be epoch territory
        expect(isDurationLike('duration', { duration: 2e12 })).toBe(false);
    });

    it('rejects negative values', () => {
        expect(isDurationLike('duration', { duration: -1 })).toBe(false);
    });

    it('rejects numeric column without a duration keyword', () => {
        expect(isDurationLike('value', { value: 500 })).toBe(false);
        expect(isDurationLike('count', { count: 500 })).toBe(false);
    });

    it('rejects non-numeric non-interval values even with duration keyword', () => {
        expect(isDurationLike('duration', { duration: 'hello' })).toBe(false);
    });

    it('handles null/undefined sample', () => {
        expect(isDurationLike('duration', null)).toBe(false);
        expect(isDurationLike('duration', undefined)).toBe(false);
        expect(isDurationLike('duration', {})).toBe(false);
    });

    it('accepts BigInt duration values', () => {
        expect(isDurationLike('pause', { pause: BigInt(1_800_000_000) })).toBe(true);
    });
});

// ─── B-114: BigInt sort ───────────────────────────────────────────────────────

describe('compareValues — B-114: BigInt sort is numeric not lexicographic', () => {
    it('sorts two BigInt values numerically ascending', () => {
        expect(compareValues(BigInt(2), BigInt(10), true)).toBeLessThan(0);
        expect(compareValues(BigInt(10), BigInt(2), true)).toBeGreaterThan(0);
    });

    it('sorts two BigInt values numerically descending', () => {
        expect(compareValues(BigInt(2), BigInt(10), false)).toBeGreaterThan(0);
    });

    it('does NOT compare BigInts lexicographically (regression guard)', () => {
        // Lexicographic: '10' < '2', so BigInt(10) would come before BigInt(2) asc if lex.
        // Numeric: 2 < 10, so ascending should put 2 first.
        const asc = compareValues(BigInt(2), BigInt(10), true);
        expect(asc).toBeLessThan(0);  // 2 < 10 numerically
    });

    it('BigInt and number mixed comparison is numeric', () => {
        expect(compareValues(BigInt(5), 10, true)).toBeLessThan(0);
        expect(compareValues(5, BigInt(10), true)).toBeLessThan(0);
    });

    it('sorts two numbers numerically', () => {
        expect(compareValues(1, 2, true)).toBeLessThan(0);
        expect(compareValues(2, 1, true)).toBeGreaterThan(0);
        expect(compareValues(1, 1, true)).toBe(0);
    });

    it('handles null: null sorts to end', () => {
        expect(compareValues(null, 5, true)).toBeGreaterThan(0);
        expect(compareValues(5, null, true)).toBeLessThan(0);
        expect(compareValues(null, null, true)).toBe(0);
    });

    it('falls back to string comparison for non-numeric values', () => {
        expect(compareValues('apple', 'banana', true)).toBeLessThan(0);
        expect(compareValues('banana', 'apple', true)).toBeGreaterThan(0);
    });
});

// ─── B-115: CSV export uses raw values ───────────────────────────────────────

describe('csvValue — B-115: CSV uses raw values not formatted ones', () => {
    it('returns raw number as string', () => {
        const rawEpoch = 1716584383215000000;
        expect(csvValue(rawEpoch)).toBe(String(rawEpoch));
    });

    it('returns BigInt as string (not formatted/rounded)', () => {
        const big = BigInt('1716584383215000000');
        expect(csvValue(big)).toBe('1716584383215000000');
    });

    it('returns plain string unchanged', () => {
        expect(csvValue('hello')).toBe('hello');
    });

    it('returns empty string for null', () => {
        expect(csvValue(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(csvValue(undefined)).toBe('');
    });

    it('returns boolean as string', () => {
        expect(csvValue(true)).toBe('true');
        expect(csvValue(false)).toBe('false');
    });

    it('preserves ISO timestamp string as-is (no re-formatting)', () => {
        const iso = '2024-05-24T20:59:43.215Z';
        expect(csvValue(iso)).toBe(iso);
    });
});

// ─── isIntervalLike and parseIntervalToSeconds ────────────────────────────────

describe('isIntervalLike', () => {
    it('recognizes 3-element array', () => {
        expect(isIntervalLike([1800000000, 0, 0])).toBe(true);
    });

    it('recognizes 4-element array', () => {
        expect(isIntervalLike([1800000000, 0, 0, 0])).toBe(true);
    });

    it('recognizes comma-string form', () => {
        expect(isIntervalLike('1800000000,0,0')).toBe(true);
        expect(isIntervalLike('-500000,0,0,0')).toBe(true);
    });

    it('rejects plain number', () => {
        expect(isIntervalLike(1800000000)).toBe(false);
    });

    it('rejects plain string that is not comma-separated', () => {
        expect(isIntervalLike('1800000000')).toBe(false);
    });
});

describe('parseIntervalToSeconds', () => {
    it('converts microseconds array to seconds', () => {
        // 1 800 000 000 µs = 1800 s = 30 min
        expect(parseIntervalToSeconds([1_800_000_000, 0, 0])).toBeCloseTo(1800);
    });

    it('converts comma-string to seconds', () => {
        expect(parseIntervalToSeconds('1800000000,0,0')).toBeCloseTo(1800);
    });

    it('returns null for plain number', () => {
        expect(parseIntervalToSeconds(1800000000)).toBeNull();
    });

    it('returns null for non-interval string', () => {
        expect(parseIntervalToSeconds('hello')).toBeNull();
    });
});
