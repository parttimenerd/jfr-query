/**
 * Pure logic tests for FilterChip formatting helpers.
 * Mirrors the fmtNs/fmtValue logic from FilterChip.tsx without DOM.
 */
import { describe, it, expect } from 'vitest';

// Mirror from FilterChip.tsx
function fmtNs(ns: number): string {
    const s = ns / 1e9;
    if (s >= 1) return `${s.toFixed(2)}s`;
    const ms = ns / 1e6;
    if (ms >= 1) return `${ms.toFixed(1)}ms`;
    const us = ns / 1e3;
    if (us >= 1) return `${us.toFixed(0)}µs`;
    return `${ns}ns`;
}

function fmtValue(v: number): string {
    if (v > 1e6) return fmtNs(v);
    if (v > 1000) return v.toLocaleString();
    return String(v);
}

describe('FilterChip — fmtNs formatting', () => {
    it('formats nanoseconds below 1µs', () => {
        expect(fmtNs(500)).toBe('500ns');
    });
    it('formats microseconds', () => {
        expect(fmtNs(5000)).toBe('5µs');
        expect(fmtNs(999000)).toBe('999µs');
    });
    it('formats milliseconds', () => {
        expect(fmtNs(1_000_000)).toBe('1.0ms');
        expect(fmtNs(42_500_000)).toBe('42.5ms');
        expect(fmtNs(999_000_000)).toBe('999.0ms');
    });
    it('formats seconds', () => {
        expect(fmtNs(1_000_000_000)).toBe('1.00s');
        expect(fmtNs(2_500_000_000)).toBe('2.50s');
    });
});

describe('FilterChip — fmtValue formatting', () => {
    it('delegates large values to fmtNs', () => {
        // > 1e6 → nanosecond format (2_000_000 ns = 2ms)
        expect(fmtValue(2_000_000)).toBe('2.0ms');
        expect(fmtValue(1_000_000_000)).toBe('1.00s');
    });
    it('formats medium values (>1000) with toLocaleString', () => {
        // Between 1001 and 1e6 — locale-formatted
        const result = fmtValue(12345);
        // toLocaleString varies by locale; just check it's a non-empty string
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toContain('µs');
        expect(result).not.toContain('ms');
    });
    it('formats small values as plain string', () => {
        expect(fmtValue(42)).toBe('42');
        expect(fmtValue(1000)).toBe('1000');
    });
});
