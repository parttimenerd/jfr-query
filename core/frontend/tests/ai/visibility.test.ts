import { describe, it, expect } from 'vitest';
import {
    buildContextPayload,
    stripProtected,
    DEFAULT_FULL_ROW_LIMIT,
    MAX_FULL_ROW_LIMIT,
} from '../../services/ai/visibility';
import type { RecentResult, SchemaBundle } from '../../services/ai/visibility';

const schema: SchemaBundle = {
    tables: [
        {
            name: 'gc_events',
            columns: [
                { name: 'duration_ms', type: 'DOUBLE' },
                { name: 'cause', type: 'VARCHAR' },
            ],
        },
    ],
    views: [],
    macros: [],
};

const numericResult: RecentResult = {
    columns: [{ name: 'duration_ms', type: 'DOUBLE' }],
    rows: [
        { duration_ms: 10 },
        { duration_ms: 20 },
        { duration_ms: 30 },
    ],
};

const stringResult: RecentResult = {
    columns: [{ name: 'cause', type: 'VARCHAR' }],
    rows: [
        { cause: 'G1 Young Generation' },
        { cause: 'G1 Humongous Allocation' },
        { cause: 'G1 Young Generation' },
    ],
};

// ─── stripProtected ──────────────────────────────────────────────────────────

describe('stripProtected', () => {
    it('redacts $ai_providers', () => {
        expect(stripProtected('use $ai_providers in config')).toBe('use [REDACTED] in config');
    });

    it('is case-insensitive', () => {
        expect(stripProtected('$AI_PROVIDERS')).toBe('[REDACTED]');
    });

    it('redacts multiple occurrences', () => {
        const r = stripProtected('a: $ai_providers, b: $ai_providers');
        expect(r).toBe('a: [REDACTED], b: [REDACTED]');
    });

    it('does not alter unrelated text', () => {
        expect(stripProtected('hello world')).toBe('hello world');
    });

    it('returns empty string unchanged', () => {
        expect(stripProtected('')).toBe('');
    });
});

// ─── buildContextPayload — no-data ───────────────────────────────────────────

describe('buildContextPayload — no-data', () => {
    it('includes schema tables', () => {
        const out = buildContextPayload('no-data', schema, null);
        expect(out).toContain('gc_events');
        expect(out).toContain('duration_ms');
    });

    it('mentions no-data in the payload', () => {
        const out = buildContextPayload('no-data', schema, null);
        expect(out).toContain('no-data');
    });

    it('does NOT include row data', () => {
        const out = buildContextPayload('no-data', schema, numericResult);
        expect(out).not.toContain('10');
        expect(out).not.toContain('ROWS');
    });

    it('strips protected tokens from schema names', () => {
        const poisoned: SchemaBundle = {
            tables: [{ name: '$ai_providers', columns: [] }],
            views: [],
            macros: [],
        };
        const out = buildContextPayload('no-data', poisoned, null);
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('$ai_providers');
    });

    it('handles null schema gracefully', () => {
        const out = buildContextPayload('no-data', null, null);
        expect(out).toContain('No schema available');
    });
});

// ─── buildContextPayload — sanitized ─────────────────────────────────────────

describe('buildContextPayload — sanitized', () => {
    it('shows row count', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).toContain('ROW COUNT: 3');
    });

    it('summarizes numeric column with min/median/max', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).toContain('min=10');
        expect(out).toContain('max=30');
    });

    it('summarizes string column with sample distinct values', () => {
        const out = buildContextPayload('sanitized', schema, stringResult);
        expect(out).toContain('sample=');
        expect(out).toContain('G1 Young Generation');
    });

    it('does NOT include raw rows', () => {
        const out = buildContextPayload('sanitized', schema, numericResult);
        expect(out).not.toContain('"ROWS"');
        expect(out).not.toContain('"duration_ms":10');
    });

    it('handles no recent result gracefully', () => {
        const out = buildContextPayload('sanitized', schema, null);
        expect(out).toContain('no recent query result available');
    });

    it('handles result with empty rows', () => {
        const empty: RecentResult = { columns: [{ name: 'n', type: 'BIGINT' }], rows: [] };
        const out = buildContextPayload('sanitized', schema, empty);
        expect(out).toContain('ROW COUNT: 0');
        expect(out).toContain('all null');
    });
});

// ─── buildContextPayload — full ───────────────────────────────────────────────

describe('buildContextPayload — full', () => {
    it('includes raw rows JSON', () => {
        const out = buildContextPayload('full', schema, numericResult);
        expect(out).toContain('"duration_ms"');
        expect(out).toContain('ROWS');
    });

    it('defaults to DEFAULT_FULL_ROW_LIMIT rows', () => {
        const manyRows: RecentResult = {
            columns: [{ name: 'n', type: 'BIGINT' }],
            rows: Array.from({ length: 200 }, (_, i) => ({ n: i })),
        };
        const out = buildContextPayload('full', schema, manyRows);
        expect(out).toContain(`cap=${DEFAULT_FULL_ROW_LIMIT}`);
        // only first DEFAULT_FULL_ROW_LIMIT rows included
        expect(out).not.toContain(`"n":${DEFAULT_FULL_ROW_LIMIT + 1}`);
    });

    it('respects custom rowCap up to MAX_FULL_ROW_LIMIT', () => {
        const manyRows: RecentResult = {
            columns: [{ name: 'n', type: 'BIGINT' }],
            rows: Array.from({ length: 600 }, (_, i) => ({ n: i })),
        };
        const out = buildContextPayload('full', schema, manyRows, 300);
        expect(out).toContain(`cap=300`);
    });

    it('clamps rowCap to MAX_FULL_ROW_LIMIT', () => {
        const manyRows: RecentResult = {
            columns: [{ name: 'n', type: 'BIGINT' }],
            rows: Array.from({ length: 600 }, (_, i) => ({ n: i })),
        };
        const out = buildContextPayload('full', schema, manyRows, 9999);
        expect(out).toContain(`cap=${MAX_FULL_ROW_LIMIT}`);
    });

    it('handles no recent result gracefully', () => {
        const out = buildContextPayload('full', schema, null);
        expect(out).toContain('no recent query result available');
    });

    it('strips $ai_providers from row data', () => {
        const sensitive: RecentResult = {
            columns: [{ name: 'key', type: 'VARCHAR' }],
            rows: [{ key: '$ai_providers' }],
        };
        const out = buildContextPayload('full', schema, sensitive);
        expect(out).not.toContain('$ai_providers');
        expect(out).toContain('[REDACTED]');
    });
});

// ─── schema description ───────────────────────────────────────────────────────

describe('buildContextPayload — schema description', () => {
    it('lists views when present', () => {
        const withViews: SchemaBundle = {
            tables: [],
            views: [{ name: 'heap_summary', query: 'SELECT 1', columns: [] }],
            macros: [],
        };
        const out = buildContextPayload('no-data', withViews, null);
        expect(out).toContain('heap_summary');
        expect(out).toContain('VIEWS');
    });

    it('lists macros when present', () => {
        const withMacros: SchemaBundle = {
            tables: [],
            views: [],
            macros: [{ name: 'topN', parameters: ['n', 'col'], sql: 'SELECT ...', returnType: 'TABLE' }],
        };
        const out = buildContextPayload('no-data', withMacros, null);
        expect(out).toContain('topN(n, col)');
        expect(out).toContain('MACROS');
    });

    it('shows "(none)" when there are no tables', () => {
        const empty: SchemaBundle = { tables: [], views: [], macros: [] };
        const out = buildContextPayload('no-data', empty, null);
        expect(out).toContain('(none)');
    });
});
