import { describe, it, expect, vi } from 'vitest';
import { QUERY_DATA_TOOL, handleQueryData } from '../../services/ai/tools/queryData';

describe('QUERY_DATA_TOOL definition', () => {
    it('has kind read', () => {
        expect(QUERY_DATA_TOOL.kind).toBe('read');
    });

    it('has required sql, reason, tables parameters', () => {
        const { properties, required } = QUERY_DATA_TOOL.inputSchema;
        expect(properties).toHaveProperty('sql');
        expect(properties).toHaveProperty('reason');
        expect(properties).toHaveProperty('tables');
        expect(required).toContain('sql');
        expect(required).toContain('reason');
        expect(required).toContain('tables');
    });

    it('tables parameter is an array of strings', () => {
        const tables = QUERY_DATA_TOOL.inputSchema.properties!.tables;
        expect(tables.type).toBe('array');
        expect((tables as any).items?.type).toBe('string');
    });
});

describe('handleQueryData', () => {
    it('runs the sql via deps and returns JSON result', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockResolvedValue({
                columns: [{ name: 'n', type: 'INTEGER' }],
                rows: [[42]],
            }),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT 42 AS n', reason: 'test', tables: ['t'] },
            mockDeps,
        );
        expect(mockDeps.duckdbQuery).toHaveBeenCalledWith('SELECT 42 AS n');
        const parsed = JSON.parse(result);
        expect(parsed.columns).toEqual(['n']);
        expect(parsed.rows[0]).toEqual([42]);
    });

    it('returns error JSON on failure', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockRejectedValue(new Error('Table not found')),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT * FROM bad', reason: 'test', tables: ['bad'] },
            mockDeps,
        );
        const parsed = JSON.parse(result);
        expect(parsed.error).toContain('Table not found');
    });

    it('caps rows at 100 in the returned result', async () => {
        const rows = Array.from({ length: 200 }, (_, i) => [i]);
        const mockDeps = {
            duckdbQuery: vi.fn().mockResolvedValue({
                columns: [{ name: 'i', type: 'INTEGER' }],
                rows,
            }),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT i FROM t', reason: 'test', tables: ['t'] },
            mockDeps,
        );
        const parsed = JSON.parse(result);
        expect(parsed.rows.length).toBe(100);
        expect(parsed.totalRows).toBe(200);
    });
});
