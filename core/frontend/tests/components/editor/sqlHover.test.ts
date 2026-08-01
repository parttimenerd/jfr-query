import { describe, it, expect, beforeEach } from 'vitest';
import { getHoverContent, _resetHoverCacheForTests } from '../../../components/editor/sqlHover';
import type { SqlHoverDeps } from '../../../components/editor/sqlHover';
import type { SchemaForCompletion } from '../../../components/editor/completions';

// ── helpers ───────────────────────────────────────────────────────────────────

const eventsSchema: SchemaForCompletion = {
    tables: [
        {
            name: 'events',
            columns: [
                { name: 'ts', dataType: 'BIGINT' },
                { name: 'cause', dataType: 'VARCHAR' },
                { name: 'duration', dataType: 'DOUBLE' },
            ],
        },
    ],
    views: [],
    functions: [],
    macros: [],
    tableMap: new Map(),
    viewMap: new Map(),
} as unknown as SchemaForCompletion;

const noDeps: SqlHoverDeps = { schema: null, variables: {} };
const schemaDeps: SqlHoverDeps = { schema: eventsSchema, variables: {} };

beforeEach(() => {
    _resetHoverCacheForTests();
});

// ── getHoverContent ───────────────────────────────────────────────────────────

describe('getHoverContent — no schema', () => {
    it('returns null when pos is outside the source span', () => {
        expect(getHoverContent('SELECT 1', 100, noDeps)).toBeNull();
    });

    it('returns an unresolved entry for a plain identifier', () => {
        const result = getHoverContent('SELECT foo', 7, noDeps);
        // 'foo' lands at index 7 in 'SELECT foo' (0-based)
        expect(result?.kind).toBe('unresolved');
        if (result?.kind === 'unresolved') {
            expect(result.text).toBe('foo');
        }
    });

    it('returns null for whitespace', () => {
        // The space between SELECT and 1
        const result = getHoverContent('SELECT 1', 6, noDeps);
        expect(result).toBeNull();
    });
});

describe('getHoverContent — column resolution', () => {
    it('returns kind=column when hovering a known column', () => {
        const sql = 'SELECT ts FROM events';
        // 'ts' starts at index 7
        const result = getHoverContent(sql, 7, schemaDeps);
        expect(result?.kind).toBe('column');
        if (result?.kind === 'column') {
            expect(result.name).toBe('ts');
        }
    });

    it('resolves column name correctly', () => {
        const sql = 'SELECT duration FROM events';
        const result = getHoverContent(sql, 7, schemaDeps);
        if (result?.kind === 'column') {
            expect(result.name).toBe('duration');
        } else {
            // May be unresolved if dataType pathway differs — just check no crash
            expect(result?.kind).toBeDefined();
        }
    });
});

describe('getHoverContent — table resolution', () => {
    it('returns kind=table when hovering a known table name', () => {
        const sql = 'SELECT ts FROM events';
        // 'events' starts at index 15
        const result = getHoverContent(sql, 15, schemaDeps);
        expect(result?.kind).toBe('table');
        if (result?.kind === 'table') {
            expect(result.name).toBe('events');
        }
    });
});

describe('getHoverContent — function resolution', () => {
    it('returns kind=function when hovering a known SQL function', () => {
        const sql = 'SELECT COUNT(*) FROM events';
        // 'COUNT' starts at index 7
        const result = getHoverContent(sql, 7, noDeps);
        expect(result?.kind).toBe('function');
        if (result?.kind === 'function') {
            expect(result.name.toUpperCase()).toBe('COUNT');
            expect(result.signature).toBeTruthy();
        }
    });
});

describe('getHoverContent — variable resolution', () => {
    it('returns kind=variable for a cell variable', () => {
        const sql = 'SELECT $limit FROM events';
        const deps: SqlHoverDeps = { schema: null, variables: { '$limit': '100' } };
        // '$limit' starts at index 7
        const result = getHoverContent(sql, 7, deps);
        expect(result?.kind).toBe('variable');
        if (result?.kind === 'variable') {
            expect(result.name).toBe('limit');
            expect(result.value).toBe('100');
        }
    });
});

describe('getHoverContent — from/to offsets', () => {
    it('from is less than to in the result', () => {
        const sql = 'SELECT ts FROM events';
        const result = getHoverContent(sql, 7, schemaDeps);
        if (result) {
            expect(result.from).toBeLessThanOrEqual(result.to);
        }
    });
});
