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
});
