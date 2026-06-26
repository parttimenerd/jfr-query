// W9 — Plot model input enrichment: v2 builds typed-column + schema preamble.

import { describe, it, expect } from 'vitest';
import { CANDIDATES, type TypedColumn, type TableSchema } from '../../../services/ml/candidates';
import { extractTableRefs } from '../../../services/sql/parseTableRefs';

describe('v1 input format — name-only columns (legacy)', () => {
    it('builds a name-only input string', () => {
        const c = CANDIDATES['t5-small-finetuned'];
        const out = c.buildInput('SELECT a, b FROM t', ['a', 'b']);
        expect(out).toBe('sql: SELECT a, b FROM t\ncolumns: a, b');
    });

    it('accepts TypedColumn[] but ignores types', () => {
        const c = CANDIDATES['t5-small-finetuned'];
        const typed: TypedColumn[] = [{ name: 'a', type: 'BIGINT' }, { name: 'b' }];
        const out = c.buildInput('SELECT a, b FROM t', typed);
        expect(out).toBe('sql: SELECT a, b FROM t\ncolumns: a, b');
    });
});

describe('v2 input format — typed columns + optional schema', () => {
    const c = CANDIDATES['t5-small-finetuned-v2'];

    it('emits typed columns', () => {
        const out = c.buildInput('SELECT a, b FROM t', [
            { name: 'a', type: 'BIGINT' },
            { name: 'b', type: 'VARCHAR' },
        ]);
        expect(out).toContain('columns: "a" BIGINT, "b" VARCHAR');
    });

    it('appends a schema preamble', () => {
        const schema: TableSchema[] = [
            { name: 'gc_events', columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'pauseMs', type: 'DOUBLE' },
            ] },
        ];
        const out = c.buildInput('SELECT ts, pauseMs FROM gc_events', [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'pauseMs', type: 'DOUBLE' },
        ], schema);
        expect(out).toContain('schema:');
        expect(out).toContain('- "gc_events": ("ts" TIMESTAMP, "pauseMs" DOUBLE)');
    });

    it('caps schema preamble at 3 tables × 12 cols', () => {
        const schema: TableSchema[] = Array.from({ length: 5 }, (_, i) => ({
            name: `t${i}`,
            columns: Array.from({ length: 20 }, (_, j) => ({ name: `c${j}`, type: 'INT' })),
        }));
        const out = c.buildInput('SELECT * FROM t0', [{ name: 'c0', type: 'INT' }], schema);
        // 3 tables only
        expect(out).toContain('"t0"');
        expect(out).toContain('"t1"');
        expect(out).toContain('"t2"');
        expect(out).not.toContain('"t3"');
        // 12 cols per table
        expect(out).toContain('"c11"');
        expect(out).not.toContain('"c12"');
    });

    it('omits schema preamble when none provided', () => {
        const out = c.buildInput('SELECT a FROM t', [{ name: 'a', type: 'INT' }]);
        expect(out).not.toContain('schema:');
    });

    it('stays under ~480 tokens for typical inputs (heuristic: char/4 ≈ tokens)', () => {
        const schema: TableSchema[] = [
            { name: 'gc_events', columns: Array.from({ length: 12 }, (_, i) => ({ name: `col${i}`, type: 'DOUBLE' })) },
            { name: 'allocations', columns: Array.from({ length: 12 }, (_, i) => ({ name: `alloc${i}`, type: 'BIGINT' })) },
            { name: 'threads', columns: Array.from({ length: 12 }, (_, i) => ({ name: `thr${i}`, type: 'VARCHAR' })) },
        ];
        const out = c.buildInput(
            'SELECT ts, pauseMs FROM gc_events JOIN threads USING (thread_id) WHERE pauseMs > 100',
            [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'pauseMs', type: 'DOUBLE' }],
            schema,
        );
        const approxTokens = out.length / 4;
        expect(approxTokens).toBeLessThan(480);
    });

    it('candidate is marked inputFormat: "v2"', () => {
        expect(c.inputFormat).toBe('v2');
    });
});

describe('extractTableRefs', () => {
    it('extracts a single table from FROM', () => {
        expect(extractTableRefs('SELECT * FROM gc_events')).toEqual(['gc_events']);
    });

    it('handles quoted identifiers without spaces', () => {
        expect(extractTableRefs('SELECT * FROM "gc_events"')).toEqual(['gc_events']);
    });

    it('handles schema.table — keeps last segment', () => {
        expect(extractTableRefs('SELECT * FROM main.gc_events')).toEqual(['gc_events']);
    });

    it('extracts both sides of a JOIN', () => {
        const out = extractTableRefs('SELECT * FROM a JOIN b ON a.id = b.id');
        expect(out.sort()).toEqual(['a', 'b']);
    });

    it('handles comma-separated tables in FROM', () => {
        const out = extractTableRefs('SELECT * FROM a, b');
        expect(out.sort()).toEqual(['a', 'b']);
    });

    it('excludes CTE names', () => {
        const sql = `WITH cte_a AS (SELECT 1), cte_b AS (SELECT 2)
                     SELECT * FROM cte_a JOIN real_table ON cte_a.x = real_table.x`;
        const out = extractTableRefs(sql);
        expect(out).toContain('real_table');
        expect(out).not.toContain('cte_a');
    });

    it('returns empty array on empty/garbage SQL', () => {
        expect(extractTableRefs('')).toEqual([]);
        expect(extractTableRefs('not really sql')).toEqual([]);
    });

    it('dedupes repeated tables', () => {
        const out = extractTableRefs('SELECT * FROM a JOIN a a2 ON a.id = a2.id');
        expect(out).toEqual(['a']);
    });
});
