// P2 — Tests for the plot schema discovery service.
//
// Covers the eight scenarios called out in the implementation plan:
//   1. ok result, caching
//   2. empty SQL → empty status, not cached
//   3. parse error → cached as parse-error
//   4. dedupe of in-flight identical SQL
//   5. cancelAll() resolves promise with 'error' / 'cancelled'
//   6. LRU eviction at maxEntries + 1
//   7. reset() clears cache
//   8. abort during reset() does not pollute cache

import { describe, it, expect, vi } from 'vitest';
import { PlotSchemaDiscovery } from '../../services/plotSchemaDiscovery';
import type { ColumnSchema } from '../../components/editor/plot/ast';

function makeDescribe(columns: ColumnSchema[]) {
    return vi.fn(async (_sql: string, _signal: AbortSignal) => columns);
}

function makeRunQuery() {
    return vi.fn(async (_sql: string, _signal: AbortSignal) => [] as unknown[]);
}

function fastDiscovery(opts?: {
    columns?: ColumnSchema[];
    describeImpl?: (sql: string, signal: AbortSignal) => Promise<ColumnSchema[]>;
    runImpl?: (sql: string, signal: AbortSignal) => Promise<unknown[]>;
    maxEntries?: number;
}) {
    const cols = opts?.columns ?? [{ name: 'x', dataType: 'INTEGER' }];
    return new PlotSchemaDiscovery({
        runQuery: opts?.runImpl ?? makeRunQuery(),
        describeQuery: opts?.describeImpl ?? makeDescribe(cols),
        debounceMs: 0,            // tests don't need a debounce window
        maxEntries: opts?.maxEntries,
        now: () => 0,
    });
}

describe('PlotSchemaDiscovery', () => {
    it('1. resolves ok and caches the result', async () => {
        const d = fastDiscovery({ columns: [{ name: 'x', dataType: 'INTEGER' }] });
        const r = await d.discover('SELECT 1 AS x');
        expect(r.status).toBe('ok');
        expect(r.columns).toEqual([{ name: 'x', dataType: 'INTEGER' }]);
        expect(d.getCached('SELECT 1 AS x')?.status).toBe('ok');
    });

    it('2. returns empty for whitespace-only SQL and does not cache', async () => {
        const d = fastDiscovery();
        const r = await d.discover('   \n\t');
        expect(r.status).toBe('empty');
        expect(d.getCached('   \n\t')).toBeNull();
    });

    it('3. caches parser errors as parse-error', async () => {
        const describe = vi.fn(async () => {
            throw new Error('Parser Error: syntax error at or near "FROM"');
        });
        const d = fastDiscovery({ describeImpl: describe });
        const r = await d.discover('SELECT FROM');
        expect(r.status).toBe('parse-error');
        expect(r.error).toMatch(/parser error/i);
        expect(d.getCached('SELECT FROM')?.status).toBe('parse-error');
    });

    it('4. dedupes concurrent discoveries of the same SQL', async () => {
        const describe = vi.fn(async () => [{ name: 'a' }]);
        const d = new PlotSchemaDiscovery({
            runQuery: makeRunQuery(),
            describeQuery: describe,
            debounceMs: 0,
        });
        const p1 = d.discover('SELECT 1 AS a');
        const p2 = d.discover('SELECT 1 AS a');
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(r2);                    // identical reference
        expect(describe).toHaveBeenCalledTimes(1);
    });

    it('5. cancelAll() resolves in-flight promise with cancelled error and clears cache', async () => {
        // Discovery that hangs forever — only resolves after the test calls cancelAll().
        const describe = vi.fn(
            (_sql: string, signal: AbortSignal) =>
                new Promise<ColumnSchema[]>((_, reject) => {
                    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        const d = new PlotSchemaDiscovery({
            runQuery: makeRunQuery(),
            describeQuery: describe,
            debounceMs: 0,
        });

        const p = d.discover('SELECT slow()');
        // Yield to let the discover() timer fire.
        await new Promise(r => setTimeout(r, 5));

        d.cancelAll();
        const r = await p;
        expect(r.status).toBe('error');
        expect(r.error).toBe('cancelled');
        expect(d.getCached('SELECT slow()')).toBeNull();
    });

    it('6. evicts oldest entry when cache exceeds maxEntries', async () => {
        const d = fastDiscovery({ maxEntries: 2 });
        await d.discover('SELECT 1 AS a');
        await d.discover('SELECT 2 AS b');
        await d.discover('SELECT 3 AS c');
        expect(d.getCached('SELECT 1 AS a')).toBeNull();
        expect(d.getCached('SELECT 2 AS b')).not.toBeNull();
        expect(d.getCached('SELECT 3 AS c')).not.toBeNull();
    });

    it('7. reset() clears the cache', async () => {
        const d = fastDiscovery();
        await d.discover('SELECT 1 AS x');
        expect(d.getCached('SELECT 1 AS x')).not.toBeNull();
        d.reset();
        expect(d.getCached('SELECT 1 AS x')).toBeNull();
    });

    it('8. abort during reset() does not pollute cache', async () => {
        let resolveLater!: (cols: ColumnSchema[]) => void;
        const describe = vi.fn(
            (_sql: string, signal: AbortSignal) =>
                new Promise<ColumnSchema[]>((resolve, reject) => {
                    resolveLater = resolve;
                    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        const d = new PlotSchemaDiscovery({
            runQuery: makeRunQuery(),
            describeQuery: describe,
            debounceMs: 0,
        });

        const p = d.discover('SELECT slow()');
        await new Promise(r => setTimeout(r, 5));
        d.reset();
        // Late resolve must not write into the cache (entry was already
        // cancelled).
        resolveLater([{ name: 'late' }]);
        const r = await p;
        expect(r.status).toBe('error');
        expect(d.getCached('SELECT slow()')).toBeNull();
    });

    it('falls back to LIMIT 1 query when describeQuery is omitted', async () => {
        const runQuery = vi.fn(async (sql: string) => {
            expect(sql).toMatch(/^SELECT \* FROM \(.*\) AS __plot_discover LIMIT 1$/);
            return [{ x: 1, y: 2 }];
        });
        const d = new PlotSchemaDiscovery({ runQuery, debounceMs: 0 });
        const r = await d.discover('SELECT 1 AS x, 2 AS y');
        expect(r.status).toBe('ok');
        expect(r.columns?.map(c => c.name)).toEqual(['x', 'y']);
    });

    it('getCached returns null for unknown sql', () => {
        const d = fastDiscovery();
        expect(d.getCached('SELECT never_seen')).toBeNull();
    });

    it('cached entries bubble back to LRU front on read (touch on access)', async () => {
        const d = fastDiscovery({ maxEntries: 2 });
        await d.discover('A');
        await d.discover('B');
        // Touch A so B becomes the LRU victim.
        d.getCached('A');
        await d.discover('C');
        expect(d.getCached('A')).not.toBeNull();
        expect(d.getCached('B')).toBeNull();
        expect(d.getCached('C')).not.toBeNull();
    });
});
