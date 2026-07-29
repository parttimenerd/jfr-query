// P2 — Plot schema discovery subsystem.
//
// When the user edits a plot DSL cell, the autocomplete pipeline calls
// `discover(sql)` asynchronously to learn the result columns of the cell's
// companion SQL block. The result is cached aggressively (LRU keyed by the
// trimmed SQL text) so that subsequent keystrokes consult the cache instead
// of issuing another DuckDB query.
//
// The class is framework-agnostic — the React provider (P2 `schemaProvider.ts`)
// owns one instance per notebook and wires its runners to `DataContext.query`.

import type { ColumnSchema } from '../components/editor/plot/ast';
// NOTE (P1 integration): `ColumnSchema` is exported from `plot/ast.ts` (already
// landed). If the parser refactor relocates it, update this import.

export interface DiscoveryResult {
    status: 'ok' | 'error' | 'empty' | 'parse-error';
    columns?: ColumnSchema[];
    error?: string;
    /** `performance.now()` timestamp — used by callers to gauge staleness. */
    ranAt: number;
}

export interface PlotSchemaDiscoveryOptions {
    /**
     * SQL runner. Must respect the AbortSignal and reject promptly when it
     * fires. The discovery class only uses it as a fallback when
     * `describeQuery` rejects or is omitted.
     */
    runQuery: (sql: string, signal: AbortSignal) => Promise<unknown[]>;
    /**
     * Preferred path: wrap the user's SQL in `DESCRIBE (...)` and return the
     * column list without materialising rows. If omitted, every discovery
     * falls back to `SELECT * FROM (<sql>) LIMIT 1` via `runQuery`.
     */
    describeQuery?: (sql: string, signal: AbortSignal) => Promise<ColumnSchema[]>;
    /** LRU cap. Default 50. */
    maxEntries?: number;
    /** Coalesce keystrokes within this many milliseconds. Default 150. */
    debounceMs?: number;
    /**
     * Optional clock — exposed so tests can synthesise `performance.now()`.
     * Defaults to `() => performance.now()` (or `Date.now()` if unavailable).
     */
    now?: () => number;
}

interface InflightEntry {
    sql: string;
    controller: AbortController;
    promise: Promise<DiscoveryResult>;
    /** Pending debounce timer; `null` once we've actually fired the query. */
    timer: ReturnType<typeof setTimeout> | null;
    /** Resolver used to settle the promise once we have a result. */
    resolve: (result: DiscoveryResult) => void;
}

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_DEBOUNCE_MS = 150;

function defaultNow(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function looksLikeParseError(message: string): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    return (
        lower.includes('parser error') ||
        lower.includes('syntax error') ||
        lower.includes('parser exception')
    );
}

export class PlotSchemaDiscovery {
    private readonly runQuery: PlotSchemaDiscoveryOptions['runQuery'];
    private readonly describeQuery: PlotSchemaDiscoveryOptions['describeQuery'];
    private readonly maxEntries: number;
    private readonly debounceMs: number;
    private readonly now: () => number;

    // Insertion-ordered map — ES Map guarantees we can use it as a tiny LRU
    // by deleting & re-inserting on access. Each cache hit refreshes the
    // entry's position to the end of the iteration order.
    private readonly cache = new Map<string, DiscoveryResult>();
    private readonly inflight = new Map<string, InflightEntry>();

    constructor(opts: PlotSchemaDiscoveryOptions) {
        this.runQuery = opts.runQuery;
        this.describeQuery = opts.describeQuery;
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.now = opts.now ?? defaultNow;
    }

    /**
     * Synchronous read. Used by the editor's completion source on every
     * keystroke — must not perform I/O.
     */
    getCached(sql: string): DiscoveryResult | null {
        const key = normalise(sql);
        if (!key) return null;
        const hit = this.cache.get(key);
        if (!hit) return null;
        // LRU bump: refresh insertion order.
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit;
    }

    /**
     * Asynchronous discovery. Identical SQL within the debounce window returns
     * the same in-flight promise (de-duplication). Distinct SQL cancels the
     * older request only if it's still in its debounce phase — once the query
     * has actually been dispatched we let it complete and populate the cache.
     */
    discover(sql: string): Promise<DiscoveryResult> {
        const trimmed = sql.trim();
        if (!trimmed) {
            return Promise.resolve({ status: 'empty', ranAt: this.now() });
        }
        const key = normalise(sql);

        // Dedupe in-flight calls for the same SQL.
        const existing = this.inflight.get(key);
        if (existing) return existing.promise;

        // Cached → resolve synchronously. The completion source will still
        // observe this via `getCached`, but returning the promise is useful
        // for tests and the `requestSchemaDiscovery` consumer.
        const cached = this.cache.get(key);
        if (cached) {
            // Touch LRU.
            this.cache.delete(key);
            this.cache.set(key, cached);
            return Promise.resolve(cached);
        }

        const controller = new AbortController();
        let resolveOuter!: (r: DiscoveryResult) => void;
        const promise = new Promise<DiscoveryResult>(r => { resolveOuter = r; });

        const entry: InflightEntry = {
            sql: trimmed,
            controller,
            promise,
            timer: null,
            resolve: resolveOuter,
        };

        // Debounce: defer the actual query until the user pauses typing for
        // `debounceMs`. If the same key arrives again it dedupes onto this
        // promise; if a distinct key arrives we leave this entry alone (its
        // SQL might still be relevant when the user returns to it).
        entry.timer = setTimeout(() => {
            entry.timer = null;
            this.runDiscovery(entry, key).catch(() => {
                /* runDiscovery always settles via entry.resolve */
            });
        }, this.debounceMs);

        this.inflight.set(key, entry);
        return promise;
    }

    /** Cancel everything in flight. Intended for notebook close / unmount. */
    cancelAll(): void {
        for (const entry of this.inflight.values()) {
            if (entry.timer) {
                clearTimeout(entry.timer);
                entry.timer = null;
            }
            entry.controller.abort();
            entry.resolve({
                status: 'error',
                error: 'cancelled',
                ranAt: this.now(),
            });
        }
        this.inflight.clear();
    }

    /** Forget every cached entry. Called after DROP TABLE / schema reloads. */
    reset(): void {
        this.cancelAll();
        this.cache.clear();
    }

    // -------------------------------------------------------------------------

    private async runDiscovery(entry: InflightEntry, key: string): Promise<void> {
        const { sql, controller } = entry;
        const signal = controller.signal;

        try {
            const columns = await this.fetchColumns(sql, signal);
            if (signal.aborted) {
                // Cancellation path is handled in cancelAll(); don't pollute
                // the cache with stale data.
                return;
            }
            const result: DiscoveryResult = {
                status: 'ok',
                columns,
                ranAt: this.now(),
            };
            this.storeResult(key, result);
            entry.resolve(result);
        } catch (err: any) {
            if (signal.aborted) return; // cancelAll() already settled it.
            const message = err?.message ? String(err.message) : String(err ?? 'unknown error');
            const status: DiscoveryResult['status'] = looksLikeParseError(message)
                ? 'parse-error'
                : 'error';
            const result: DiscoveryResult = {
                status,
                error: message,
                ranAt: this.now(),
            };
            this.storeResult(key, result);
            entry.resolve(result);
        } finally {
            // Only release the inflight slot if this is still the active
            // entry for the key (a cancelAll() + re-discover sequence may
            // have re-populated it).
            if (this.inflight.get(key) === entry) {
                this.inflight.delete(key);
            }
        }
    }

    private async fetchColumns(sql: string, signal: AbortSignal): Promise<ColumnSchema[]> {
        if (this.describeQuery) {
            try {
                return await this.describeQuery(sql, signal);
            } catch (err: any) {
                if (signal.aborted) throw err;
                // Parse errors should *not* fall back — re-throw so the
                // caller caches the parse-error result.
                const message = err?.message ? String(err.message) : '';
                if (looksLikeParseError(message)) throw err;
                // Else fall through to the LIMIT 1 path.
            }
        }
        return this.runLimitZero(sql, signal);
    }

    private async runLimitZero(sql: string, signal: AbortSignal): Promise<ColumnSchema[]> {
        const wrapped = `SELECT * FROM (${sql}) AS __plot_discover LIMIT 1`;
        const rows = await this.runQuery(wrapped, signal);
        if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
            return Object.keys(rows[0] as object).map<ColumnSchema>(name => ({ name }));
        }
        // Empty result (table has zero rows) — schema is unavailable from data.
        // Return an empty schema rather than throwing; caller can fall back to describeQuery.
        return [];
    }

    private storeResult(key: string, result: DiscoveryResult): void {
        this.cache.set(key, result);
        // LRU eviction — drop the oldest entry once we exceed the cap.
        while (this.cache.size > this.maxEntries) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            this.cache.delete(oldestKey);
        }
    }
}

function normalise(sql: string): string {
    return sql.trim();
}
