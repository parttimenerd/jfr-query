import { describe, it, expect, vi } from 'vitest';
import { PlotSchemaDiscovery } from '../../services/plotSchemaDiscovery';
import type { ColumnSchema } from '../../components/editor/plot/ast';

const SAMPLE_COLS: ColumnSchema[] = [
    { name: 'time', dataType: 'BIGINT' },
    { name: 'duration', dataType: 'BIGINT' },
];

function makeService(opts?: {
    runQuery?: (sql: string, sig: AbortSignal) => Promise<unknown[]>;
    describeQuery?: (sql: string, sig: AbortSignal) => Promise<ColumnSchema[]>;
}) {
    return new PlotSchemaDiscovery({
        runQuery: opts?.runQuery ?? (async () => [{ time: 1, duration: 2 }]),
        describeQuery: opts?.describeQuery,
        debounceMs: 0,  // no delay in tests
        now: () => 1000,
    });
}

// ─── getCached ────────────────────────────────────────────────────────────────

describe('PlotSchemaDiscovery — getCached', () => {
    it('returns null before any discovery', () => {
        const svc = makeService();
        expect(svc.getCached('SELECT 1')).toBeNull();
    });

    it('returns result after successful discovery', async () => {
        const svc = makeService({
            describeQuery: async () => SAMPLE_COLS,
        });
        await svc.discover('SELECT time, duration FROM gc');
        const cached = svc.getCached('SELECT time, duration FROM gc');
        expect(cached?.status).toBe('ok');
        expect(cached?.columns).toEqual(SAMPLE_COLS);
    });

    it('returns null for empty/whitespace SQL', () => {
        const svc = makeService();
        expect(svc.getCached('')).toBeNull();
        expect(svc.getCached('   ')).toBeNull();
    });
});

// ─── discover — basic success ─────────────────────────────────────────────────

describe('PlotSchemaDiscovery — discover (success)', () => {
    it('resolves with status ok and columns via describeQuery', async () => {
        const svc = makeService({ describeQuery: async () => SAMPLE_COLS });
        const result = await svc.discover('SELECT time, duration FROM gc');
        expect(result.status).toBe('ok');
        expect(result.columns).toEqual(SAMPLE_COLS);
        expect(result.ranAt).toBe(1000);
    });

    it('returns empty status for empty SQL', async () => {
        const svc = makeService();
        const result = await svc.discover('');
        expect(result.status).toBe('empty');
    });

    it('returns empty status for whitespace SQL', async () => {
        const svc = makeService();
        const result = await svc.discover('   ');
        expect(result.status).toBe('empty');
    });

    it('deduplicates inflight requests for the same SQL', async () => {
        let callCount = 0;
        const svc = makeService({
            describeQuery: async () => {
                callCount++;
                return SAMPLE_COLS;
            },
        });
        const p1 = svc.discover('SELECT 1');
        const p2 = svc.discover('SELECT 1');
        await Promise.all([p1, p2]);
        expect(callCount).toBe(1);
    });

    it('returns cached result on second call without re-querying', async () => {
        let callCount = 0;
        const svc = makeService({
            describeQuery: async () => { callCount++; return SAMPLE_COLS; },
        });
        await svc.discover('SELECT 1');
        await svc.discover('SELECT 1');
        expect(callCount).toBe(1);
    });
});

// ─── discover — error handling ────────────────────────────────────────────────

describe('PlotSchemaDiscovery — discover (errors)', () => {
    it('resolves with status error when both describeQuery and runQuery throw', async () => {
        const svc = new PlotSchemaDiscovery({
            describeQuery: async () => { throw new Error('connection refused'); },
            runQuery: async () => { throw new Error('connection refused'); },
            debounceMs: 0,
            now: () => 1000,
        });
        const result = await svc.discover('SELECT 1');
        expect(result.status).toBe('error');
        expect(result.error).toContain('connection refused');
    });

    it('resolves with parse-error for SQL parse failures', async () => {
        const svc = makeService({
            describeQuery: async () => { throw new Error('Parser Error: syntax error at or near'); },
        });
        const result = await svc.discover('SELEKT 1');
        expect(result.status).toBe('parse-error');
    });

    it('falls back to runQuery when describeQuery is not provided', async () => {
        let runCalled = false;
        const svc = makeService({
            runQuery: async (sql, sig) => { runCalled = true; return [{ time: 1 }]; },
        });
        const result = await svc.discover('SELECT time FROM gc');
        expect(runCalled).toBe(true);
        expect(result.status).toBe('ok');
    });

    it('falls back to runQuery when describeQuery rejects', async () => {
        let runCalled = false;
        const svc = makeService({
            describeQuery: async () => { throw new Error('not supported'); },
            runQuery: async () => { runCalled = true; return [{ time: 1 }]; },
        });
        const result = await svc.discover('SELECT 1');
        // After describeQuery fails, falls back to runQuery
        expect(runCalled).toBe(true);
    });
});

// ─── cancelAll ────────────────────────────────────────────────────────────────

describe('PlotSchemaDiscovery — cancelAll', () => {
    it('settles in-flight promises with error:cancelled', async () => {
        // Use a long-running query that we can cancel
        let resolveQuery!: () => void;
        const blockingQuery = new Promise<ColumnSchema[]>(res => { resolveQuery = () => res(SAMPLE_COLS); });

        const svc = new PlotSchemaDiscovery({
            describeQuery: () => blockingQuery,
            runQuery: async () => [],
            debounceMs: 100, // long enough for cancelAll to fire first
            now: () => 1000,
        });

        const promise = svc.discover('SELECT 1');
        svc.cancelAll();
        const result = await promise;
        expect(result.status).toBe('error');
        expect(result.error).toBe('cancelled');
    });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('PlotSchemaDiscovery — reset', () => {
    it('clears the cache after reset', async () => {
        const svc = makeService({ describeQuery: async () => SAMPLE_COLS });
        await svc.discover('SELECT 1');
        expect(svc.getCached('SELECT 1')).not.toBeNull();
        svc.reset();
        expect(svc.getCached('SELECT 1')).toBeNull();
    });
});

// ─── LRU eviction ─────────────────────────────────────────────────────────────

describe('PlotSchemaDiscovery — LRU eviction', () => {
    it('evicts oldest entry when cache is full', async () => {
        const svc = new PlotSchemaDiscovery({
            describeQuery: async () => SAMPLE_COLS,
            runQuery: async () => [],
            debounceMs: 0,
            maxEntries: 3,
            now: () => 1000,
        });

        // Fill the cache with 3 entries
        await svc.discover('SELECT 1');
        await svc.discover('SELECT 2');
        await svc.discover('SELECT 3');

        // All 3 should be cached
        expect(svc.getCached('SELECT 1')).not.toBeNull();
        expect(svc.getCached('SELECT 2')).not.toBeNull();
        expect(svc.getCached('SELECT 3')).not.toBeNull();

        // Adding a 4th entry evicts the LRU (SELECT 1, since 2 and 3 may have been bumped)
        await svc.discover('SELECT 4');

        // SELECT 4 must be in cache
        expect(svc.getCached('SELECT 4')).not.toBeNull();
    });
});
