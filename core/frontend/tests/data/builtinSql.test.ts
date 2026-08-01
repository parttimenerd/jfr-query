import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL, CONDITIONAL_VIEWS_SQL } from '../../data/builtinSql';

// ── BUILTIN_MACROS_SQL ────────────────────────────────────────────────────────

describe('BUILTIN_MACROS_SQL', () => {
    it('is a non-empty array', () => {
        expect(BUILTIN_MACROS_SQL.length).toBeGreaterThan(0);
    });

    it('every entry is a non-empty string starting with CREATE', () => {
        for (const sql of BUILTIN_MACROS_SQL) {
            expect(typeof sql).toBe('string');
            expect(sql.trim().toUpperCase().startsWith('CREATE')).toBe(true);
        }
    });

    it('contains expected statistical macros', () => {
        const joined = BUILTIN_MACROS_SQL.join('\n');
        expect(joined).toContain('P90');
        expect(joined).toContain('P99');
        expect(joined).toContain('format_memory');
    });
});

// ── BUILTIN_VIEWS_SQL ─────────────────────────────────────────────────────────

describe('BUILTIN_VIEWS_SQL', () => {
    it('is a non-empty array', () => {
        expect(BUILTIN_VIEWS_SQL.length).toBeGreaterThan(0);
    });

    it('every entry is a non-empty string starting with CREATE', () => {
        for (const sql of BUILTIN_VIEWS_SQL) {
            expect(typeof sql).toBe('string');
            expect(sql.trim().toUpperCase().startsWith('CREATE')).toBe(true);
        }
    });
});

// ── CONDITIONAL_VIEWS_SQL ─────────────────────────────────────────────────────

describe('CONDITIONAL_VIEWS_SQL', () => {
    it('is a non-empty array', () => {
        expect(CONDITIONAL_VIEWS_SQL.length).toBeGreaterThan(0);
    });

    it('every entry has a non-empty requires string', () => {
        for (const entry of CONDITIONAL_VIEWS_SQL) {
            expect(typeof entry.requires).toBe('string');
            expect(entry.requires.length).toBeGreaterThan(0);
        }
    });

    it('every entry has either sql or buildSql (not both undefined)', () => {
        for (const entry of CONDITIONAL_VIEWS_SQL) {
            expect(entry.sql !== undefined || entry.buildSql !== undefined).toBe(true);
        }
    });

    it('entries with sql are non-empty CREATE statements', () => {
        for (const entry of CONDITIONAL_VIEWS_SQL) {
            if (entry.sql !== undefined) {
                expect(entry.sql.trim().toUpperCase().startsWith('CREATE')).toBe(true);
            }
        }
    });

    it('entries with buildSql return a string or null when called', () => {
        const allTables = new Set(CONDITIONAL_VIEWS_SQL.map(e => e.requires));
        for (const entry of CONDITIONAL_VIEWS_SQL) {
            if (entry.buildSql) {
                const result = entry.buildSql(allTables);
                expect(result === null || typeof result === 'string').toBe(true);
            }
        }
    });
});
