import { describe, it, expect } from 'vitest';
import {
    SQL_FUNCTIONS,
    SQL_KEYWORDS_AFTER_SELECT,
    SQL_KEYWORDS_AT_TOP,
    SQL_KEYWORDS_AFTER_FROM,
    SQL_KEYWORDS_AFTER_WHERE,
    SQL_KEYWORDS_AFTER_GROUP_BY,
    SQL_KEYWORDS_AFTER_ORDER_BY,
    SQL_KEYWORDS_AFTER_JOIN_ON,
} from '../../../components/editor/sqlFunctions';

// ── SQL_FUNCTIONS catalog ─────────────────────────────────────────────────────

describe('SQL_FUNCTIONS', () => {
    it('is a non-empty array', () => {
        expect(SQL_FUNCTIONS.length).toBeGreaterThan(0);
    });

    it('every entry has a non-empty name, signature, and detail', () => {
        for (const fn of SQL_FUNCTIONS) {
            expect(typeof fn.name).toBe('string');
            expect(fn.name.length).toBeGreaterThan(0);
            expect(typeof fn.signature).toBe('string');
            expect(fn.signature.length).toBeGreaterThan(0);
            expect(typeof fn.detail).toBe('string');
            expect(fn.detail.length).toBeGreaterThan(0);
        }
    });

    it('has no duplicate function names', () => {
        const names = SQL_FUNCTIONS.map(f => f.name);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it('boost values, when present, are positive numbers', () => {
        for (const fn of SQL_FUNCTIONS) {
            if (fn.boost !== undefined) {
                expect(typeof fn.boost).toBe('number');
                expect(fn.boost).toBeGreaterThan(0);
            }
        }
    });

    it('contains essential aggregate functions', () => {
        const names = new Set(SQL_FUNCTIONS.map(f => f.name));
        expect(names.has('COUNT')).toBe(true);
        expect(names.has('SUM')).toBe(true);
        expect(names.has('AVG')).toBe(true);
        expect(names.has('MIN')).toBe(true);
        expect(names.has('MAX')).toBe(true);
    });

    it('contains string functions', () => {
        const names = new Set(SQL_FUNCTIONS.map(f => f.name));
        expect(names.has('LENGTH')).toBe(true);
        expect(names.has('UPPER')).toBe(true);
        expect(names.has('LOWER')).toBe(true);
    });

    it('contains date/time functions', () => {
        const names = new Set(SQL_FUNCTIONS.map(f => f.name));
        expect(names.has('DATE_TRUNC')).toBe(true);
        expect(names.has('EPOCH_MS')).toBe(true);
    });
});

// ── keyword groups ────────────────────────────────────────────────────────────

describe('SQL keyword groups', () => {
    it('SQL_KEYWORDS_AT_TOP contains SELECT', () => {
        expect(SQL_KEYWORDS_AT_TOP).toContain('SELECT');
    });

    it('SQL_KEYWORDS_AFTER_SELECT contains DISTINCT', () => {
        expect(SQL_KEYWORDS_AFTER_SELECT).toContain('DISTINCT');
    });

    it('SQL_KEYWORDS_AFTER_FROM contains JOIN variants', () => {
        expect(SQL_KEYWORDS_AFTER_FROM).toContain('LEFT JOIN');
        expect(SQL_KEYWORDS_AFTER_FROM).toContain('INNER JOIN');
        expect(SQL_KEYWORDS_AFTER_FROM).toContain('WHERE');
    });

    it('SQL_KEYWORDS_AFTER_WHERE contains logical operators', () => {
        expect(SQL_KEYWORDS_AFTER_WHERE).toContain('AND');
        expect(SQL_KEYWORDS_AFTER_WHERE).toContain('OR');
        expect(SQL_KEYWORDS_AFTER_WHERE).toContain('NOT');
    });

    it('SQL_KEYWORDS_AFTER_GROUP_BY contains HAVING and ORDER BY', () => {
        expect(SQL_KEYWORDS_AFTER_GROUP_BY).toContain('HAVING');
        expect(SQL_KEYWORDS_AFTER_GROUP_BY).toContain('ORDER BY');
    });

    it('SQL_KEYWORDS_AFTER_ORDER_BY contains ASC and DESC', () => {
        expect(SQL_KEYWORDS_AFTER_ORDER_BY).toContain('ASC');
        expect(SQL_KEYWORDS_AFTER_ORDER_BY).toContain('DESC');
    });

    it('SQL_KEYWORDS_AFTER_JOIN_ON contains AND and OR', () => {
        expect(SQL_KEYWORDS_AFTER_JOIN_ON).toContain('AND');
        expect(SQL_KEYWORDS_AFTER_JOIN_ON).toContain('OR');
    });

    it('all keyword groups are non-empty arrays', () => {
        const groups = [
            SQL_KEYWORDS_AFTER_SELECT,
            SQL_KEYWORDS_AT_TOP,
            SQL_KEYWORDS_AFTER_FROM,
            SQL_KEYWORDS_AFTER_WHERE,
            SQL_KEYWORDS_AFTER_GROUP_BY,
            SQL_KEYWORDS_AFTER_ORDER_BY,
            SQL_KEYWORDS_AFTER_JOIN_ON,
        ];
        for (const group of groups) {
            expect(Array.isArray(group)).toBe(true);
            expect(group.length).toBeGreaterThan(0);
        }
    });
});
