import { describe, it, expect } from 'vitest';
import { analyzeRecentResult } from '../services/ai/anomalyAnalyzer';
import type { RecentResult } from '../services/ai/visibility';

const mkResult = (rows: Array<Record<string, any>>, columns: string[] = []): RecentResult => ({
    columns: (columns.length ? columns : Object.keys(rows[0] ?? {})).map(name => ({ name, type: 'VARCHAR' })),
    rows,
});

describe('analyzeRecentResult', () => {
    it('returns empty when result is null/undefined', () => {
        expect(analyzeRecentResult(null)).toEqual([]);
        expect(analyzeRecentResult(undefined)).toEqual([]);
    });

    it('flags zero-row results', () => {
        const hints = analyzeRecentResult(mkResult([], ['x']));
        expect(hints.length).toBe(1);
        expect(hints[0].text).toContain('0 rows');
        expect(hints[0].source).toBe('analyzer');
    });

    it('flags all-NULL columns', () => {
        const rows = Array.from({ length: 10 }, () => ({ a: 1, b: null }));
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.some(h => h.text.includes('entirely NULL'))).toBe(true);
    });

    it('flags >50% null columns with percentage', () => {
        const rows = [
            { a: 1, b: null }, { a: 2, b: null }, { a: 3, b: null },
            { a: 4, b: null }, { a: 5, b: null }, { a: 6, b: null },
            { a: 7, b: 2 }, { a: 8, b: 3 }, { a: 9, b: 4 }, { a: 10, b: 5 },
        ];
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.some(h => /60%|NULL/.test(h.text))).toBe(true);
    });

    it('does not flag nulls for results with < 5 rows', () => {
        const rows = [{ a: null }, { a: null }];
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.every(h => !h.text.includes('NULL'))).toBe(true);
    });

    it('flags top-row dominance >70%', () => {
        // top row = 800, total = 1000 → 80%
        const rows = [
            { name: 'a', cnt: 800 },
            { name: 'b', cnt: 100 },
            { name: 'c', cnt: 100 },
        ];
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.some(h => /Top row holds/.test(h.text))).toBe(true);
    });

    it('does not flag dominance when top row is < 70%', () => {
        const rows = [
            { cnt: 500 }, { cnt: 300 }, { cnt: 200 },
        ];
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.every(h => !h.text.includes('Top row holds'))).toBe(true);
    });

    it('caps at 3 hints total', () => {
        const rows = Array.from({ length: 10 }, () => ({ a: null, b: null, c: null, d: null }));
        const hints = analyzeRecentResult(mkResult(rows));
        expect(hints.length).toBeLessThanOrEqual(3);
    });

    it('hints are tagged with source: analyzer', () => {
        const hints = analyzeRecentResult(mkResult([], ['x']));
        expect(hints.every(h => h.source === 'analyzer')).toBe(true);
    });
});
