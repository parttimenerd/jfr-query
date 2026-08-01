import { describe, it, expect } from 'vitest';
import { analyzeRecentResult } from '../../../services/ai/anomalyAnalyzer';
import type { RecentResult } from '../../../services/ai/visibility';

function makeResult(overrides: Partial<RecentResult> = {}): RecentResult {
    return {
        columns: [{ name: 'val', type: 'INTEGER' }],
        rows: [{ val: 1 }],
        ...overrides,
    };
}

describe('analyzeRecentResult', () => {
    it('returns empty array for null input', () => {
        expect(analyzeRecentResult(null)).toEqual([]);
    });

    it('returns empty array for undefined input', () => {
        expect(analyzeRecentResult(undefined)).toEqual([]);
    });

    // --- empty result ---
    it('returns a hint when query returns 0 rows', () => {
        const result = makeResult({ rows: [] });
        const hints = analyzeRecentResult(result);
        expect(hints).toHaveLength(1);
        expect(hints[0].text).toContain('0 rows');
    });

    it('all hints have source=analyzer', () => {
        const hints = analyzeRecentResult(makeResult({ rows: [] }));
        expect(hints.every(h => h.source === 'analyzer')).toBe(true);
    });

    it('all hints have non-empty id', () => {
        const hints = analyzeRecentResult(makeResult({ rows: [] }));
        expect(hints.every(h => h.id.length > 0)).toBe(true);
    });

    // --- null columns ---
    it('flags a column that is entirely NULL (≥5 rows)', () => {
        const rows = Array.from({ length: 6 }, () => ({ val: null }));
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'VARCHAR' }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('entirely NULL'))).toBe(true);
    });

    it('flags column with >50% null rate (≥5 rows)', () => {
        // 4 nulls out of 6 rows = 67%
        const rows = [
            { val: null }, { val: null }, { val: null }, { val: null },
            { val: 1 }, { val: 2 },
        ];
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'INTEGER' }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('NULL in "val"'))).toBe(true);
    });

    it('does not flag null columns when row count < 5', () => {
        const rows = [{ val: null }, { val: null }, { val: null }];
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'INTEGER' }] });
        // With only 3 rows, checkNulls returns early
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('NULL'))).toBe(false);
    });

    // --- dominance ---
    it('flags top-row dominance when first row holds >70% of total', () => {
        // row[0] = 90, row[1] = 10 → 90% dominance
        const rows = [{ val: 90 }, { val: 10 }];
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'INTEGER' }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('Top row holds'))).toBe(true);
    });

    it('does not flag dominance when share ≤70%', () => {
        // row[0] = 60, row[1] = 40 → 60%
        const rows = [{ val: 60 }, { val: 40 }];
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'INTEGER' }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('Top row holds'))).toBe(false);
    });

    it('does not flag dominance for single-row result', () => {
        const result = makeResult({ rows: [{ val: 100 }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('Top row holds'))).toBe(false);
    });

    // --- result cap ---
    it('caps output at 3 hints', () => {
        const rows = Array.from({ length: 6 }, () => ({ a: null, b: null, c: null, d: null }));
        const result = makeResult({
            rows,
            columns: [
                { name: 'a', type: 'VARCHAR' },
                { name: 'b', type: 'VARCHAR' },
                { name: 'c', type: 'VARCHAR' },
                { name: 'd', type: 'VARCHAR' },
            ],
        });
        const hints = analyzeRecentResult(result);
        expect(hints.length).toBeLessThanOrEqual(3);
    });

    // --- non-negative columns only ---
    it('does not flag dominance when values include non-positive', () => {
        const rows = [{ val: 100 }, { val: -50 }];
        const result = makeResult({ rows, columns: [{ name: 'val', type: 'INTEGER' }] });
        const hints = analyzeRecentResult(result);
        expect(hints.some(h => h.text.includes('Top row holds'))).toBe(false);
    });
});
