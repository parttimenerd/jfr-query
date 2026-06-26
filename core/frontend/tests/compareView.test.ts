/**
 * Pure logic tests for CompareView header merging.
 * Tests the header union logic without needing a DOM.
 */
import { describe, it, expect } from 'vitest';

// Mirror the header merging logic from CompareView.tsx
function mergeHeaders(candidateData: any[] | null, baselineData: any[] | null): string[] {
    const candidateKeys = candidateData && candidateData.length > 0 ? Object.keys(candidateData[0]) : [];
    const baselineKeys = baselineData && baselineData.length > 0 ? Object.keys(baselineData[0]) : [];
    const extra = baselineKeys.filter(k => !candidateKeys.includes(k));
    return [...candidateKeys, ...extra];
}

describe('CompareView — header merging', () => {
    it('returns candidate keys when schemas match', () => {
        const candidate = [{ a: 1, b: 2 }];
        const baseline = [{ a: 10, b: 20 }];
        expect(mergeHeaders(candidate, baseline)).toEqual(['a', 'b']);
    });

    it('returns empty array when both datasets are null', () => {
        expect(mergeHeaders(null, null)).toEqual([]);
    });

    it('returns empty array when both datasets are empty', () => {
        expect(mergeHeaders([], [])).toEqual([]);
    });

    it('returns candidate keys when baseline is null', () => {
        const candidate = [{ x: 1, y: 2 }];
        expect(mergeHeaders(candidate, null)).toEqual(['x', 'y']);
    });

    it('returns baseline keys when candidate is null', () => {
        const baseline = [{ x: 1, y: 2 }];
        expect(mergeHeaders(null, baseline)).toEqual(['x', 'y']);
    });

    it('merges schemas: candidate keys first, then baseline-only extras', () => {
        const candidate = [{ a: 1, b: 2 }];
        // baseline has same a/b but also extra column c
        const baseline = [{ a: 10, b: 20, c: 30 }];
        const headers = mergeHeaders(candidate, baseline);
        expect(headers).toEqual(['a', 'b', 'c']);
    });

    it('candidate-only columns come first even if baseline lacks them', () => {
        const candidate = [{ a: 1, b: 2, c: 3 }];
        const baseline = [{ a: 10, d: 40 }];
        const headers = mergeHeaders(candidate, baseline);
        // candidate keys first, then baseline-only extras
        expect(headers).toEqual(['a', 'b', 'c', 'd']);
    });

    it('does not duplicate shared keys', () => {
        const candidate = [{ x: 1 }];
        const baseline = [{ x: 99 }];
        const headers = mergeHeaders(candidate, baseline);
        expect(headers).toEqual(['x']);
        expect(headers.filter(h => h === 'x').length).toBe(1);
    });
});
