import { describe, it, expect } from 'vitest';
import {
    buildContextPayload,
    stripProtected,
    DEFAULT_FULL_ROW_LIMIT,
    MAX_FULL_ROW_LIMIT,
    type SchemaBundle,
    type RecentResult,
} from '../../services/ai/visibility';

const schema: SchemaBundle = {
    tables: [
        {
            name: 'GarbageCollection',
            columns: [
                { name: 'startTime', type: 'TIMESTAMP_NS' },
                { name: 'duration', type: 'BIGINT' },
                { name: 'cause', type: 'VARCHAR' },
            ],
        },
    ],
    views: [],
    macros: [],
};

const numericResult: RecentResult = {
    columns: [
        { name: 'duration', type: 'BIGINT' },
        { name: 'cause', type: 'VARCHAR' },
    ],
    rows: [
        { duration: 10, cause: 'G1 Pause' },
        { duration: 50, cause: 'G1 Pause' },
        { duration: 30, cause: 'Allocation Failure' },
        { duration: 70, cause: 'System.gc()' },
        { duration: 20, cause: 'G1 Pause' },
    ],
};

describe('buildContextPayload', () => {
    it('no-data mode: includes schema but never raw rows or column aggregates', () => {
        const out = buildContextPayload('no-data', schema, numericResult);
        expect(out).toContain('GarbageCollection');
        expect(out).toContain('no-data');
        expect(out).not.toContain('"G1 Pause"');
        expect(out).not.toContain('min=');
        expect(out).not.toContain('ROWS:');
    });

    it('no-data mode: still works when lastResult is null', () => {
        const out = buildContextPayload('no-data', schema, null);
        expect(out).toContain('GarbageCollection');
        expect(out).toContain('no-data');
    });

    it('sanitized mode: numeric columns get min/median/max aggregates', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).toContain('duration');
        expect(out).toContain('min=10');
        expect(out).toContain('max=70');
        expect(out).toMatch(/median=\d+/);
    });

    it('sanitized mode: string columns get up to 3 sample distinct values', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).toContain('cause');
        expect(out).toContain('sample=');
        // G1 Pause is the most common — must appear; 3 distinct cap
        expect(out).toContain('"G1 Pause"');
        expect(out).toContain('"Allocation Failure"');
        expect(out).toContain('"System.gc()"');
    });

    it('sanitized mode: row count exposed but no raw row JSON', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).toContain('ROW COUNT: 5');
        expect(out).not.toContain('ROWS:');
        // Ensure no full row JSON object leaks through
        expect(out).not.toMatch(/\{"duration":10/);
    });

    it('sanitized mode: handles all-null numeric column', () => {
        const result: RecentResult = {
            columns: [{ name: 'x', type: 'INTEGER' }],
            rows: [{ x: null }, { x: null }],
        };
        const out = buildContextPayload('sanitized', schema, result);
        expect(out).toContain('all null');
    });

    it('sanitized mode: no recent result is handled gracefully', () => {
        const out = buildContextPayload('sanitized', schema, null);
        expect(out).toContain('no recent query result');
    });

    it('full mode: includes raw row JSON capped by rowCap', () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ duration: i, cause: 'X' }));
        const result: RecentResult = { columns: numericResult.columns, rows };
        const out = buildContextPayload('full', schema, result, 10);
        expect(out).toContain('ROWS:');
        expect(out).toContain('first 10 of 200 rows');
        // First few rows should appear
        expect(out).toContain('"duration":0');
        expect(out).toContain('"duration":9');
        // Capped — row index 50 should NOT appear
        expect(out).not.toContain('"duration":50');
    });

    it('full mode: rowCap defaults to DEFAULT_FULL_ROW_LIMIT when undefined', () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ duration: i, cause: 'X' }));
        const result: RecentResult = { columns: numericResult.columns, rows };
        const out = buildContextPayload('full', schema, result);
        expect(out).toContain(`first ${DEFAULT_FULL_ROW_LIMIT} of 200 rows`);
    });

    it('full mode: rowCap is clamped to MAX_FULL_ROW_LIMIT', () => {
        const rows = Array.from({ length: 1000 }, (_, i) => ({ duration: i, cause: 'X' }));
        const result: RecentResult = { columns: numericResult.columns, rows };
        const out = buildContextPayload('full', schema, result, 99999);
        expect(out).toContain(`cap=${MAX_FULL_ROW_LIMIT}`);
        expect(out).toContain(`first ${MAX_FULL_ROW_LIMIT} of 1000 rows`);
    });

    it('full mode: empty result produces a "no recent query result" notice', () => {
        const out = buildContextPayload('full', schema, { columns: [], rows: [] });
        expect(out).toContain('no recent query result');
    });

    it('strips $ai_providers references from any visibility mode output', () => {
        // Simulate a result whose string column accidentally contains the
        // protected token.
        const result: RecentResult = {
            columns: [{ name: 'note', type: 'VARCHAR' }],
            rows: [{ note: 'see $ai_providers.openai_key' }],
        };
        const sanitized = buildContextPayload('sanitized', schema, result);
        const full = buildContextPayload('full', schema, result);
        expect(sanitized).not.toMatch(/\$ai_providers\b/i);
        expect(full).not.toMatch(/\$ai_providers\b/i);
        // Inverse: stripProtected helper test
        expect(stripProtected('hello $ai_providers.foo world')).toBe('hello [REDACTED].foo world');
    });

    it('null/empty schema is handled without throwing', () => {
        const out1 = buildContextPayload('no-data', null, null);
        const out2 = buildContextPayload('sanitized', { tables: [], views: [], macros: [] }, null);
        expect(out1).toContain('No schema available');
        expect(out2).toContain('TABLES: (none)');
    });
});
