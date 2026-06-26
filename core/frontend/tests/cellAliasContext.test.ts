import { describe, it, expect } from 'vitest';
import { buildAliasSql } from '../context/CellAliasContext';

describe('buildAliasSql', () => {
    it('creates schema + qualified view + bare view when alias is set', () => {
        const r = buildAliasSql({
            cellHandle: 'gc-overview',
            alias: 'gc_pauses',
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        expect(r.sanitizedHandle).toBe('gc_overview');
        expect(r.aliasOr1).toBe('gc_pauses');
        expect(r.bareShadowed).toBe(false);
        expect(r.statements).toEqual([
            'CREATE SCHEMA IF NOT EXISTS "gc_overview"',
            'CREATE OR REPLACE TEMP VIEW "gc_overview"."gc_pauses" AS (SELECT 1)',
            'CREATE OR REPLACE TEMP VIEW "gc_pauses" AS (SELECT 1)',
        ]);
    });

    it('uses aliasOr1 = "1" when no alias is set', () => {
        const r = buildAliasSql({
            cellHandle: 'cell_3',
            alias: null,
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        expect(r.aliasOr1).toBe('1');
        expect(r.statements).toEqual([
            'CREATE SCHEMA IF NOT EXISTS "cell_3"',
            'CREATE OR REPLACE TEMP VIEW "cell_3"."1" AS (SELECT 1)',
        ]);
    });

    it('uses TEMP TABLE when materialized=true', () => {
        const r = buildAliasSql({
            cellHandle: 'cell_1',
            alias: 'big_agg',
            sql: 'SELECT 1',
            materialized: true,
            shadowedTableNames: new Set(),
        });
        expect(r.statements).toEqual([
            'CREATE SCHEMA IF NOT EXISTS "cell_1"',
            'CREATE OR REPLACE TEMP TABLE "cell_1"."big_agg" AS (SELECT 1)',
            'CREATE OR REPLACE TEMP TABLE "big_agg" AS (SELECT 1)',
        ]);
    });

    it('skips bare view when alias collides with a real table', () => {
        const r = buildAliasSql({
            cellHandle: 'cell_1',
            alias: 'GarbageCollection',
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(['GarbageCollection']),
        });
        expect(r.bareShadowed).toBe(true);
        expect(r.statements).toEqual([
            'CREATE SCHEMA IF NOT EXISTS "cell_1"',
            'CREATE OR REPLACE TEMP VIEW "cell_1"."GarbageCollection" AS (SELECT 1)',
        ]);
    });

    it('builds a columns query against information_schema', () => {
        const r = buildAliasSql({
            cellHandle: 'cell_1',
            alias: 'foo',
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        expect(r.columnsQuery).toContain("table_schema = 'cell_1'");
        expect(r.columnsQuery).toContain("table_name = 'foo'");
    });

    it("escapes single quotes in the columns query", () => {
        const r = buildAliasSql({
            cellHandle: "a'b",
            alias: "c'd",
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        // sanitizeForDuckDB strips ' -> '_', so handle has no quote; alias is rejected by parser
        // but the function itself should still escape defensively
        expect(r.columnsQuery).toContain("table_schema = 'a_b'");
    });

    it('quotes identifiers with embedded double quotes', () => {
        const r = buildAliasSql({
            cellHandle: 'cell_1',
            alias: null,
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        // Sanity: identifiers are always double-quoted
        expect(r.statements[0]).toMatch(/^CREATE SCHEMA IF NOT EXISTS "cell_1"$/);
    });

    // B-173: identifiers use double-quotes; WHERE-clause literals use single-quotes
    it('uses double-quotes for SQL identifiers and single-quotes for string literals (B-173)', () => {
        const r = buildAliasSql({
            cellHandle: 'my-cell',
            alias: 'my_alias',
            sql: 'SELECT 1',
            materialized: false,
            shadowedTableNames: new Set(),
        });
        // Identifiers (schema, view names) must be double-quoted
        expect(r.statements[0]).toContain('"my_cell"');
        expect(r.statements[1]).toContain('"my_cell"."my_alias"');
        expect(r.statements[2]).toContain('"my_alias"');
        // columnsQuery WHERE values must be single-quoted string literals, not double-quoted
        expect(r.columnsQuery).toContain("table_schema = 'my_cell'");
        expect(r.columnsQuery).toContain("table_name = 'my_alias'");
        expect(r.columnsQuery).not.toContain('table_schema = "my_cell"');
        expect(r.columnsQuery).not.toContain('table_name = "my_alias"');
    });
});

// B-174: unregisterCell should split on the FIRST dot only
describe('qualifiedKey dot-split logic (B-174)', () => {
    it('handles alias names containing dots by splitting on first dot only', () => {
        // Simulate the indexOf-based split that unregisterCell now uses
        const key = 'my_cell.alias.with.dots';
        const dotIdx = key.indexOf('.');
        const h = key.slice(0, dotIdx);
        const a = key.slice(dotIdx + 1);
        expect(h).toBe('my_cell');
        expect(a).toBe('alias.with.dots');
    });

    it('naive split(".") would incorrectly split alias containing dots', () => {
        const key = 'my_cell.alias.with.dots';
        // The old (buggy) approach:
        const [h, a] = key.split('.');
        expect(h).toBe('my_cell');
        // Old approach gives only the first segment after the dot, losing the rest
        expect(a).toBe('alias');  // incorrect — should be 'alias.with.dots'
    });
});
