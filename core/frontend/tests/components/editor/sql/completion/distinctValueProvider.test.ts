import { describe, it, expect, vi } from 'vitest';
import { distinctValueProvider } from '../../../../../components/editor/sql/completion/providers/distinctValue';
import { requestDistinctValues } from '../../../../../components/editor/distinctValues';
import type { ProviderContext } from '../../../../../components/editor/sql/completion/types';
import type { SchemaForCompletion } from '../../../../../components/editor/completions';

function makeSchema(tableName = 'events', colName = 'cause'): SchemaForCompletion {
    const table = { name: tableName, columns: [{ name: colName, type: 'VARCHAR' }] };
    return {
        tables: [table as any],
        views: [],
        macros: [],
        tableMap: new Map([[tableName.toLowerCase(), table as any]]),
        viewMap: new Map(),
    };
}

const DUMMY_NODE = { kind: 'identifier', text: '', from: 0, to: 0, src: '', children: [], annotations: {} } as any;

function makeCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
    return {
        schema: makeSchema(),
        variables: {},
        runner: null,
        source: '',
        upTo: '',
        pos: 0,
        root: DUMMY_NODE,
        scopes: new Map(),
        cursorNode: DUMMY_NODE,
        scope: null,
        token: '',
        tokenFrom: 0,
        explicit: false,
        enclosingClause: 'where' as any,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// distinctValueProvider — matches (detectStringValueColumn logic)
// ---------------------------------------------------------------------------

describe('distinctValueProvider — matches', () => {
    it('matches when cursor is inside an open string literal after col =', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: "WHERE cause = '" }))).toBe(true);
    });

    it('matches for LIKE operator', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: "WHERE cause LIKE '" }))).toBe(true);
    });

    it('does not match when the string literal is closed (even quote count)', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: "WHERE cause = 'G1 GC' AND " }))).toBe(false);
    });

    it('does not match when there is no comparison operator before the quote', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: "SELECT '" }))).toBe(false);
    });

    it('does not match when upTo is empty', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: '' }))).toBe(false);
    });

    it('matches qualified col (tbl.col = \')', () => {
        expect(distinctValueProvider.matches(DUMMY_NODE, makeCtx({ upTo: "WHERE e.cause = '" }))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// distinctValueProvider — provide
// ---------------------------------------------------------------------------

describe('distinctValueProvider — provide', () => {
    it('returns empty items when cache is empty and no runner', () => {
        const ctx = makeCtx({ upTo: "WHERE cause = '", runner: null });
        expect(distinctValueProvider.provide(DUMMY_NODE, ctx).items).toHaveLength(0);
    });

    it('calls runner to kick off async cache population', async () => {
        // Use a unique table+col per test to avoid inflight/cache key collisions.
        // Use qualified tbl.col form so distinctValues resolves via findColumn directly.
        const schema = makeSchema('tbl_run_test', 'col_r');
        const runner = vi.fn().mockResolvedValue([{ v: 'alpha' }]);
        const onReady = vi.fn();
        const ctx = makeCtx({
            upTo: "WHERE tbl_run_test.col_r = '",
            schema,
            runner,
            onDistinctValuesReady: onReady,
        });
        distinctValueProvider.provide(DUMMY_NODE, ctx);
        expect(runner).toHaveBeenCalled();
        await new Promise(r => setTimeout(r, 80));
        expect(onReady).toHaveBeenCalled();
    });

    it('surfaces cached values as completions after cache warm-up', async () => {
        const schema = makeSchema('tbl_cache_test', 'col_c');
        const runner = vi.fn().mockResolvedValue([{ v: 'G1 GC' }, { v: 'G1 Old Gen' }]);
        // Warm the cache with the qualified table/col key.
        await new Promise<void>(resolve => {
            requestDistinctValues(runner, schema, 'tbl_cache_test', 'col_c', new Set(['tbl_cache_test']), resolve);
        });
        // Use the same qualified form so the cache key matches.
        const ctx = makeCtx({ upTo: "WHERE tbl_cache_test.col_c = '", schema, runner: null });
        const labels = distinctValueProvider.provide(DUMMY_NODE, ctx).items.map(i => i.label);
        expect(labels).toContain('G1 GC');
        expect(labels).toContain('G1 Old Gen');
    });

    it('filters cached values by typed prefix', async () => {
        const schema = makeSchema('tbl_filter_test', 'col_f');
        const runner = vi.fn().mockResolvedValue([{ v: 'G1 GC' }, { v: 'G1 Old Gen' }]);
        await new Promise<void>(resolve => {
            requestDistinctValues(runner, schema, 'tbl_filter_test', 'col_f', new Set(['tbl_filter_test']), resolve);
        });
        const ctx = makeCtx({ upTo: "WHERE tbl_filter_test.col_f = 'G1 Old", schema, runner: null });
        const labels = distinctValueProvider.provide(DUMMY_NODE, ctx).items.map(i => i.label);
        expect(labels).toContain('G1 Old Gen');
        expect(labels).not.toContain('G1 GC');
    });

    it('sets from to position after the opening quote when values are returned', async () => {
        const schema = makeSchema('tbl_from_test', 'col_from');
        const runner = vi.fn().mockResolvedValue([{ v: 'val1' }]);
        await new Promise<void>(resolve => {
            requestDistinctValues(runner, schema, 'tbl_from_test', 'col_from', new Set(['tbl_from_test']), resolve);
        });
        const upTo = "WHERE tbl_from_test.col_from = '";
        const ctx = makeCtx({ upTo, schema, runner: null });
        const result = distinctValueProvider.provide(DUMMY_NODE, ctx);
        expect(result.from).toBe(upTo.lastIndexOf("'") + 1);
    });
});
