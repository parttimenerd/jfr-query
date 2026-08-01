import { describe, it, expect } from 'vitest';
import { extractTableRefs } from '../../../services/sql/parseTableRefs';

describe('extractTableRefs', () => {
    // ─── basic FROM ──────────────────────────────────────────────────────────

    it('extracts a simple FROM table', () => {
        expect(extractTableRefs('SELECT * FROM gc_events')).toContain('gc_events');
    });

    it('strips outer quotes from simple quoted table name', () => {
        // Quoted names without spaces are unquoted and returned
        expect(extractTableRefs('SELECT * FROM "gc_events"')).toContain('gc_events');
    });

    it('extracts schema.table, returning only the table name', () => {
        const refs = extractTableRefs('SELECT * FROM public.gc_events');
        expect(refs).toContain('gc_events');
        expect(refs).not.toContain('public');
    });

    it('extracts multiple comma-separated tables in FROM', () => {
        const refs = extractTableRefs('SELECT * FROM a, b, c');
        expect(refs).toContain('a');
        expect(refs).toContain('b');
        expect(refs).toContain('c');
    });

    // ─── JOIN variants ────────────────────────────────────────────────────────

    it('extracts JOIN table', () => {
        const refs = extractTableRefs('SELECT * FROM a JOIN b ON a.id = b.id');
        expect(refs).toContain('a');
        expect(refs).toContain('b');
    });

    it('extracts LEFT JOIN, RIGHT JOIN, INNER JOIN, OUTER JOIN', () => {
        const sql = `
            SELECT * FROM base
            LEFT JOIN left_t ON base.id = left_t.id
            RIGHT JOIN right_t ON base.id = right_t.id
            INNER JOIN inner_t ON base.id = inner_t.id
        `;
        const refs = extractTableRefs(sql);
        expect(refs).toContain('base');
        expect(refs).toContain('left_t');
        expect(refs).toContain('right_t');
        expect(refs).toContain('inner_t');
    });

    // ─── CTEs ─────────────────────────────────────────────────────────────────

    it('excludes CTE names from results', () => {
        const sql = `
            WITH cte AS (SELECT 1)
            SELECT * FROM cte JOIN real_table ON cte.id = real_table.id
        `;
        const refs = extractTableRefs(sql);
        expect(refs).not.toContain('cte');
        expect(refs).toContain('real_table');
    });

    it('handles multiple CTEs', () => {
        const sql = `
            WITH a AS (SELECT 1), b AS (SELECT 2)
            SELECT * FROM a, b, c
        `;
        const refs = extractTableRefs(sql);
        expect(refs).not.toContain('a');
        expect(refs).not.toContain('b');
        expect(refs).toContain('c');
    });

    // ─── deduplication ────────────────────────────────────────────────────────

    it('deduplicates repeated table names', () => {
        const sql = 'SELECT * FROM t JOIN t ON t.x = t.y';
        const refs = extractTableRefs(sql);
        expect(refs.filter(r => r === 't')).toHaveLength(1);
    });

    // ─── empty / invalid input ────────────────────────────────────────────────

    it('returns [] for empty string', () => {
        expect(extractTableRefs('')).toEqual([]);
    });

    it('returns [] for whitespace-only', () => {
        expect(extractTableRefs('   ')).toEqual([]);
    });

    it('returns [] for SQL with no FROM or JOIN', () => {
        expect(extractTableRefs('SELECT 1 + 1')).toEqual([]);
    });

    // ─── case insensitivity ───────────────────────────────────────────────────

    it('handles lowercase from/join keywords', () => {
        const refs = extractTableRefs('select * from gc_events join heap_stats on 1=1');
        expect(refs).toContain('gc_events');
        expect(refs).toContain('heap_stats');
    });

    it('handles mixed-case FROM', () => {
        expect(extractTableRefs('SELECT * From MyTable')).toContain('MyTable');
    });
});
