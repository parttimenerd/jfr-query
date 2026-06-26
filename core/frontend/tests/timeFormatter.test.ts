import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../utils/timeFormatter';

// Use a fixed UTC epoch for deterministic tests.
// 2024-05-24T20:59:43.215Z = 1716584383215 ms
const EPOCH_MS = 1716584383215;
const EPOCH_NS = EPOCH_MS * 1_000_000; // 16 digits → nano heuristic kicks in

describe('formatTimestamp — ISO output', () => {
    it('formats millisecond epoch as ISO', () => {
        const result = formatTimestamp(EPOCH_MS, 'ISO');
        expect(result).toBe(new Date(EPOCH_MS).toISOString());
    });

    it('formats nanosecond epoch as ISO (16+ digit heuristic)', () => {
        const result = formatTimestamp(EPOCH_NS, 'ISO');
        expect(result).toBe(new Date(EPOCH_MS).toISOString());
    });

    it('formats ISO string input as ISO', () => {
        const iso = '2024-05-24T20:59:43.215Z';
        expect(formatTimestamp(iso, 'ISO')).toBe(new Date(iso).toISOString());
    });
});

describe('formatTimestamp — custom format strings', () => {
    // Lock to a known UTC date: 2024-05-24T20:59:43.215Z
    // Note: local hour depends on timezone — test only UTC-safe parts.

    it('YYYY extracts 4-digit year', () => {
        const result = formatTimestamp(EPOCH_MS, 'YYYY');
        expect(result).toMatch(/^\d{4}$/);
    });

    it('MM extracts zero-padded month', () => {
        const result = formatTimestamp(EPOCH_MS, 'MM');
        expect(result).toMatch(/^\d{2}$/);
        expect(parseInt(result, 10)).toBeGreaterThanOrEqual(1);
        expect(parseInt(result, 10)).toBeLessThanOrEqual(12);
    });

    it('DD extracts zero-padded day', () => {
        const result = formatTimestamp(EPOCH_MS, 'DD');
        expect(result).toMatch(/^\d{2}$/);
    });

    it('SSS returns 3-digit milliseconds', () => {
        const result = formatTimestamp(EPOCH_MS, 'SSS');
        expect(result).toMatch(/^\d{3}$/);
    });

    it('SS returns 2-digit milliseconds prefix', () => {
        const result = formatTimestamp(EPOCH_MS, 'SS');
        expect(result).toMatch(/^\d{2}$/);
    });

    it('S returns 1-digit milliseconds prefix', () => {
        const result = formatTimestamp(EPOCH_MS, 'S');
        expect(result).toMatch(/^\d{1}$/);
    });

    it('compound format YYYY-MM-DD', () => {
        const result = formatTimestamp(EPOCH_MS, 'YYYY-MM-DD');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('compound format HH:mm:ss', () => {
        const result = formatTimestamp(EPOCH_MS, 'HH:mm:ss');
        expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
});

describe('formatTimestamp — edge cases', () => {
    it('returns null/undefined as string', () => {
        expect(formatTimestamp(null as any, 'ISO')).toBe('null');
        expect(formatTimestamp(undefined as any, 'ISO')).toBe('undefined');
    });

    it('returns original value for unparseable string', () => {
        const bad = 'not-a-date';
        expect(formatTimestamp(bad, 'YYYY')).toBe(bad);
    });

    it('handles bigint epoch', () => {
        const result = formatTimestamp(BigInt(EPOCH_MS), 'ISO');
        expect(result).toBe(new Date(EPOCH_MS).toISOString());
    });

    it('handles numeric string (milliseconds)', () => {
        const result = formatTimestamp(String(EPOCH_MS), 'ISO');
        expect(result).toBe(new Date(EPOCH_MS).toISOString());
    });
});
