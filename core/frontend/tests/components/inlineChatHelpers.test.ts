import { describe, it, expect } from 'vitest';
import { resolveVisibility, buildRecentResultFromRows } from '../../components/inlineChatHelpers';
import type { VisibilityMode } from '../../services/AiService';

// ─── resolveVisibility ────────────────────────────────────────────────────────

describe('resolveVisibility', () => {
    it('returns the dropdown value when useFullContext is false', () => {
        expect(resolveVisibility(false, 'sanitized')).toBe('sanitized');
    });

    it('returns the dropdown value when useFullContext is true (override removed)', () => {
        // The useFullContext param is deprecated and ignored; dropdownValue always wins
        expect(resolveVisibility(true, 'sanitized')).toBe('sanitized');
    });

    it('returns "no-data" when dropdown is no-data', () => {
        expect(resolveVisibility(false, 'no-data')).toBe('no-data');
    });

    it('returns "full" when dropdown is full', () => {
        expect(resolveVisibility(true, 'full')).toBe('full');
    });

    it('passes all three VisibilityMode values unchanged', () => {
        const modes: VisibilityMode[] = ['no-data', 'sanitized', 'full'];
        for (const mode of modes) {
            expect(resolveVisibility(false, mode)).toBe(mode);
            expect(resolveVisibility(true, mode)).toBe(mode);
        }
    });
});

// ─── buildRecentResultFromRows ────────────────────────────────────────────────

describe('buildRecentResultFromRows', () => {
    it('returns null for null input', () => {
        expect(buildRecentResultFromRows(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
        expect(buildRecentResultFromRows(undefined)).toBeNull();
    });

    it('returns null for empty array', () => {
        expect(buildRecentResultFromRows([])).toBeNull();
    });

    it('returns null when first row is not an object', () => {
        expect(buildRecentResultFromRows(['string'])).toBeNull();
    });

    it('builds columns from first row keys', () => {
        const result = buildRecentResultFromRows([{ cause: 'GC', count: 5 }]);
        expect(result).not.toBeNull();
        expect(result!.columns.map(c => c.name)).toEqual(['cause', 'count']);
    });

    it('infers DOUBLE type for number values', () => {
        const result = buildRecentResultFromRows([{ duration: 123.4 }]);
        expect(result!.columns[0].type).toBe('DOUBLE');
    });

    it('infers VARCHAR type for string values', () => {
        const result = buildRecentResultFromRows([{ cause: 'G1 GC' }]);
        expect(result!.columns[0].type).toBe('VARCHAR');
    });

    it('infers OTHER type for boolean/object/null values', () => {
        const result = buildRecentResultFromRows([{ active: true }]);
        expect(result!.columns[0].type).toBe('OTHER');
    });

    it('returns all rows', () => {
        const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
        const result = buildRecentResultFromRows(rows);
        expect(result!.rows).toHaveLength(3);
        expect(result!.rows).toEqual(rows);
    });

    it('column types are inferred from first row only', () => {
        // Second row has different types — column type is from first row
        const rows = [{ val: 42 }, { val: 'text' }];
        const result = buildRecentResultFromRows(rows);
        expect(result!.columns[0].type).toBe('DOUBLE');
    });

    it('handles single-row input', () => {
        const result = buildRecentResultFromRows([{ ts: 1000 }]);
        expect(result!.rows).toHaveLength(1);
        expect(result!.columns).toHaveLength(1);
    });

    it('handles multiple columns with mixed types', () => {
        const result = buildRecentResultFromRows([{ name: 'GC', count: 10, ratio: 0.5 }]);
        const colMap = Object.fromEntries(result!.columns.map(c => [c.name, c.type]));
        expect(colMap['name']).toBe('VARCHAR');
        expect(colMap['count']).toBe('DOUBLE');
        expect(colMap['ratio']).toBe('DOUBLE');
    });
});
