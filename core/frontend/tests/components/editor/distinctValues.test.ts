import { describe, it, expect, beforeEach } from 'vitest';
import {
    isHighCardinality,
    getCachedValues,
    clearDistinctValueCache,
    requestDistinctValues,
    lookupCachedValues,
} from '../../../components/editor/distinctValues';
import type { SchemaForCompletion } from '../../../components/editor/completions';

// Minimal schema factory for tests
function makeSchema(tables: { name: string; columns: { name: string; type: string }[] }[] = []): SchemaForCompletion {
    const tableMap = new Map(tables.map(t => [t.name.toLowerCase(), t]));
    return { tableMap, viewMap: new Map(), functionNames: [], keywords: [] } as unknown as SchemaForCompletion;
}

beforeEach(() => {
    clearDistinctValueCache();
});

// ─── isHighCardinality ────────────────────────────────────────────────────────

describe('isHighCardinality', () => {
    it('returns true for TIMESTAMP', () => expect(isHighCardinality('TIMESTAMP')).toBe(true));
    it('returns true for TIMESTAMP_NS', () => expect(isHighCardinality('TIMESTAMP_NS')).toBe(true));
    it('returns true for TIMESTAMP_MS', () => expect(isHighCardinality('TIMESTAMP_MS')).toBe(true));
    it('returns true for TIMESTAMP_S', () => expect(isHighCardinality('TIMESTAMP_S')).toBe(true));
    it('returns true for TIMESTAMPTZ', () => expect(isHighCardinality('TIMESTAMPTZ')).toBe(true));
    it('returns true for DATE', () => expect(isHighCardinality('DATE')).toBe(true));
    it('returns true for TIME', () => expect(isHighCardinality('TIME')).toBe(true));
    it('returns true for INTERVAL', () => expect(isHighCardinality('INTERVAL')).toBe(true));
    it('returns true for BIGINT', () => expect(isHighCardinality('BIGINT')).toBe(true));
    it('returns true for HUGEINT', () => expect(isHighCardinality('HUGEINT')).toBe(true));
    it('returns true for UBIGINT', () => expect(isHighCardinality('UBIGINT')).toBe(true));
    it('returns true for DOUBLE', () => expect(isHighCardinality('DOUBLE')).toBe(true));
    it('returns true for FLOAT', () => expect(isHighCardinality('FLOAT')).toBe(true));
    it('returns true for REAL', () => expect(isHighCardinality('REAL')).toBe(true));
    it('returns true for DECIMAL', () => expect(isHighCardinality('DECIMAL')).toBe(true));
    it('returns true for BLOB', () => expect(isHighCardinality('BLOB')).toBe(true));
    it('returns true for JSON', () => expect(isHighCardinality('JSON')).toBe(true));

    it('returns false for VARCHAR', () => expect(isHighCardinality('VARCHAR')).toBe(false));
    it('returns false for BOOLEAN', () => expect(isHighCardinality('BOOLEAN')).toBe(false));
    it('returns false for INTEGER', () => expect(isHighCardinality('INTEGER')).toBe(false));
    it('returns false for INT', () => expect(isHighCardinality('INT')).toBe(false));
    it('returns false for SMALLINT', () => expect(isHighCardinality('SMALLINT')).toBe(false));
    it('returns false for empty string', () => expect(isHighCardinality('')).toBe(false));

    it('is case-insensitive (lowercase bigint)', () => expect(isHighCardinality('bigint')).toBe(true));
    it('is case-insensitive (mixed case)', () => expect(isHighCardinality('BigInt')).toBe(true));

    it('returns true when type contains a high-cardinality keyword (e.g. DECIMAL(10,2))', () => {
        expect(isHighCardinality('DECIMAL(10,2)')).toBe(true);
    });
});

// ─── getCachedValues ──────────────────────────────────────────────────────────

describe('getCachedValues', () => {
    it('returns null when nothing is cached', () => {
        expect(getCachedValues('events', 'cause')).toBeNull();
    });

    it('returns values after requestDistinctValues resolves', async () => {
        const schema = makeSchema([{ name: 'events', columns: [{ name: 'cause', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'GC' }, { v: 'JIT' }];
        requestDistinctValues(runner, schema, 'events', 'cause', new Set());
        // Wait for the async runner to complete
        await new Promise(resolve => setTimeout(resolve, 10));
        const values = getCachedValues('events', 'cause');
        expect(values).toEqual(['GC', 'JIT']);
    });

    it('is case-insensitive for table and column keys', async () => {
        const schema = makeSchema([{ name: 'Events', columns: [{ name: 'Cause', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'Z' }];
        requestDistinctValues(runner, schema, 'Events', 'Cause', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        // lookup with different case
        expect(getCachedValues('events', 'cause')).toEqual(['Z']);
    });

    it('returns null for pending entry', () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        // Never-resolving runner
        const runner = () => new Promise<any[]>(() => {});
        requestDistinctValues(runner as any, schema, 'tbl', 'col', new Set());
        // Cache entry is pending, not ready
        expect(getCachedValues('tbl', 'col')).toBeNull();
    });
});

// ─── clearDistinctValueCache ──────────────────────────────────────────────────

describe('clearDistinctValueCache', () => {
    it('removes all cached entries', async () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'x' }];
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(getCachedValues('tbl', 'col')).not.toBeNull();
        clearDistinctValueCache();
        expect(getCachedValues('tbl', 'col')).toBeNull();
    });
});

// ─── requestDistinctValues ────────────────────────────────────────────────────

describe('requestDistinctValues', () => {
    it('does not query for high-cardinality types', () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'ts', type: 'TIMESTAMP' }] }]);
        let called = false;
        const runner = async () => { called = true; return []; };
        requestDistinctValues(runner, schema, 'tbl', 'ts', new Set());
        expect(called).toBe(false);
    });

    it('does not query when column not found in schema', () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'cause', type: 'VARCHAR' }] }]);
        let called = false;
        const runner = async () => { called = true; return []; };
        requestDistinctValues(runner, schema, 'tbl', 'nonexistent', new Set());
        expect(called).toBe(false);
    });

    it('does not re-request when already cached', async () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        let callCount = 0;
        const runner = async () => { callCount++; return [{ v: 'x' }]; };
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(callCount).toBe(1);
    });

    it('calls onReady after values are stored', async () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        let readyCalled = false;
        const runner = async () => [{ v: 'a' }];
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set(), () => { readyCalled = true; });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(readyCalled).toBe(true);
    });

    it('resolves column without table using referenced set', async () => {
        const schema = makeSchema([{ name: 'events', columns: [{ name: 'cause', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'GC' }];
        requestDistinctValues(runner, schema, null, 'cause', new Set(['events']));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(getCachedValues('events', 'cause')).toEqual(['GC']);
    });

    it('stores error entry when runner throws', async () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        const runner = async () => { throw new Error('DB error'); };
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        // After error, getCachedValues still returns null (error entry != ready)
        expect(getCachedValues('tbl', 'col')).toBeNull();
    });
});

// ─── lookupCachedValues ───────────────────────────────────────────────────────

describe('lookupCachedValues', () => {
    it('returns null when nothing cached', () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        expect(lookupCachedValues(schema, 'tbl', 'col', new Set())).toBeNull();
    });

    it('returns cached values after they are loaded', async () => {
        const schema = makeSchema([{ name: 'tbl', columns: [{ name: 'col', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'hello' }];
        requestDistinctValues(runner, schema, 'tbl', 'col', new Set());
        await new Promise(resolve => setTimeout(resolve, 10));
        const result = lookupCachedValues(schema, 'tbl', 'col', new Set());
        expect(result).toEqual(['hello']);
    });

    it('returns null when column not in schema', () => {
        const schema = makeSchema([]);
        expect(lookupCachedValues(schema, 'tbl', 'col', new Set())).toBeNull();
    });

    it('resolves via referenced set when table is null', async () => {
        const schema = makeSchema([{ name: 'events', columns: [{ name: 'cause', type: 'VARCHAR' }] }]);
        const runner = async () => [{ v: 'JIT' }];
        requestDistinctValues(runner, schema, null, 'cause', new Set(['events']));
        await new Promise(resolve => setTimeout(resolve, 10));
        const result = lookupCachedValues(schema, null, 'cause', new Set(['events']));
        expect(result).toEqual(['JIT']);
    });
});
