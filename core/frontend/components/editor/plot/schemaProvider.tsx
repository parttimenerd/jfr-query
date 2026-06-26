// P2 — React-side provider for the plot schema discovery subsystem.
//
// Owns one `PlotSchemaDiscovery` instance per `DataProvider` consumer (i.e.
// effectively per notebook). Exposes a hook so editors and completion sources
// can read the cache synchronously and request fresh discoveries fire-and-
// forget.

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { DataContext } from '../../../context/DuckDBContext';
import { SettingsContext } from '../../../context/SettingsContext';
import {
    PlotSchemaDiscovery,
    type DiscoveryResult,
} from '../../../services/plotSchemaDiscovery';
import type { ColumnSchema } from './ast';

export interface PlotSchemaProviderValue {
    /** May be null when the feature is disabled in settings. */
    discovery: PlotSchemaDiscovery | null;
    /** Synchronous cache read; null when feature disabled or cache miss. */
    getCellResultColumns: (sql: string) => DiscoveryResult | null;
    /** Fire-and-forget; no-op when feature disabled or SQL is blank. */
    requestSchemaDiscovery: (sql: string) => void;
}

const noopValue: PlotSchemaProviderValue = {
    discovery: null,
    getCellResultColumns: () => null,
    requestSchemaDiscovery: () => {},
};

export const PlotSchemaContext = createContext<PlotSchemaProviderValue>(noopValue);

export const PlotSchemaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { query, schema } = useContext(DataContext);
    const { settings } = useContext(SettingsContext);
    const enabled = settings.plotSchemaDiscoveryEnabled ?? true;

    // `query` is recreated whenever DB state changes; keep a ref so the
    // discovery instance does not need to be torn down.
    const queryRef = useRef(query);
    queryRef.current = query;

    // One discovery instance for the lifetime of this provider. We only
    // recreate it if the feature flag flips on (so the off-state can keep
    // the cache clear of partial data).
    const discoveryRef = useRef<PlotSchemaDiscovery | null>(null);
    if (enabled && !discoveryRef.current) {
        discoveryRef.current = new PlotSchemaDiscovery({
            runQuery: async (sql, signal) => {
                if (signal.aborted) throw new DOMException('aborted', 'AbortError');
                // The base DataContext.query does not currently honour
                // AbortSignal; we wrap it in a race so the discovery class
                // can release its promise promptly when cancelled. The query
                // itself will still run to completion in DuckDB-WASM but the
                // discovery promise resolves immediately.
                return await raceWithAbort(queryRef.current(sql), signal);
            },
            describeQuery: async (sql, signal) => {
                if (signal.aborted) throw new DOMException('aborted', 'AbortError');
                const wrapped = `DESCRIBE (${sql})`;
                const rows = await raceWithAbort(queryRef.current(wrapped), signal);
                return rowsToColumns(rows);
            },
        });
    }
    if (!enabled && discoveryRef.current) {
        discoveryRef.current.reset();
        discoveryRef.current = null;
    }

    // Reset the cache on schema reloads (DROP TABLE, file reload, etc.).
    useEffect(() => {
        discoveryRef.current?.reset();
    }, [schema]);

    // Tear down on unmount so any in-flight DuckDB calls release their
    // promise references.
    useEffect(() => {
        return () => {
            discoveryRef.current?.cancelAll();
        };
    }, []);

    const value = useMemo<PlotSchemaProviderValue>(() => {
        if (!enabled) return noopValue;
        return {
            discovery: discoveryRef.current,
            getCellResultColumns: (sql: string) => {
                const inst = discoveryRef.current;
                if (!inst || !sql || !sql.trim()) return null;
                return inst.getCached(sql);
            },
            requestSchemaDiscovery: (sql: string) => {
                const inst = discoveryRef.current;
                if (!inst || !sql || !sql.trim()) return;
                // Fire and forget; errors are surfaced via cache.
                void inst.discover(sql);
            },
        };
    }, [enabled]);

    return <PlotSchemaContext.Provider value={value}>{children}</PlotSchemaContext.Provider>;
};

/**
 * React hook for editor extensions / components.
 *
 * Returns the stable provider value. Callers should keep their reference in a
 * ref if they want to call it from CodeMirror extensions (which mount once).
 */
export function usePlotSchemaDiscovery(): PlotSchemaProviderValue {
    return useContext(PlotSchemaContext);
}

// -----------------------------------------------------------------------------

function rowsToColumns(rows: unknown[]): ColumnSchema[] {
    if (!Array.isArray(rows)) return [];
    const out: ColumnSchema[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        // `DESCRIBE (...)` returns columns named column_name, column_type,
        // null, key, default, extra (DuckDB ≥ 0.9). We accept the canonical
        // names plus a couple of historical fallbacks for safety.
        const name = (r.column_name ?? r.name ?? r.field) as string | undefined;
        if (!name || typeof name !== 'string') continue;
        const dataType = (r.column_type ?? r.type ?? r.data_type) as string | undefined;
        const nullableRaw = r.null ?? r.nullable;
        const nullable = typeof nullableRaw === 'string'
            ? nullableRaw.toUpperCase() === 'YES'
            : typeof nullableRaw === 'boolean'
                ? nullableRaw
                : undefined;
        out.push({
            name,
            dataType: typeof dataType === 'string' ? dataType : undefined,
            nullable,
        });
    }
    return out;
}

/**
 * Resolve `promise` or reject as soon as `signal` aborts. Does not actually
 * cancel the underlying work — DuckDB-WASM queries are not abortable through
 * the high-level `DataContext.query` API.
 */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new DOMException('aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            v => { signal.removeEventListener('abort', onAbort); resolve(v); },
            e => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
    });
}
