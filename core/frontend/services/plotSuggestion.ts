/**
 * Plot suggestion service (C5).
 *
 * Routes a plot-suggestion request to either the local-trained model or a
 * cloud tier based on `Settings.plotSuggestSource`:
 *
 *   - `local-trained`: PlotGenerationService (in-tree ONNX or HF hub fallback).
 *   - `cloud-tiny`:    AiService.getAiSuggestPlot(..., tier='tiny').
 *   - `cloud-basic`:   AiService.getAiSuggestPlot(..., tier='basic').
 *   - `auto`:          local if `plotModelLoader.getActivePlotModel()` returns
 *                      kind === 'local-onnx' (promoted artifact), else cloud
 *                      `tiny`. Cloud is gated by `plotSuggestOfflineOnly` --
 *                      when offline-only is on and active provider is not
 *                      local/browser, returns a degraded result instead of
 *                      throwing.
 *
 * Caches results keyed on `(sql + columns + rowCountBucket)` where
 *   rowCountBucket = floor(log10(rowCount + 1))
 * so trivially-similar queries reuse the same suggestion across re-runs.
 *
 * Debounces calls to `suggestPlot()` by 500ms.
 *
 * Exposes `cancel()` to flush pending timers.
 */

import { aiService, AiOfflineEnforcedError } from './AiService';
import type { Settings } from '../context/SettingsContext';
import { getActivePlotModel } from './ml/plotModelLoader';
import type { TypedColumn, TableSchema } from './ml/candidates';

export type PlotSuggestionSource = 'local-trained' | 'cloud-tiny' | 'cloud-basic';

export interface PlotSuggestionResult {
    config: string;
    source: PlotSuggestionSource;
    degraded?: 'offline-only';
}

export interface SuggestPlotRequest {
    sql: string;
    columns: string[];
    /** Optional typed columns (name + DuckDB type). When present, the v2 plot
     * model gets richer input; falls back to plain `columns` if absent. */
    typedColumns?: TypedColumn[];
    /** Optional schema slice (3 tables × 12 cols cap enforced at build time).
     * Lets the model see related tables even when SQL only selects from one. */
    schema?: TableSchema[];
    rowCount: number;
    visibility?: 'no-data' | 'sanitized' | 'full';
    signal?: AbortSignal;
}

export interface PlotSuggestionDeps {
    settings: Pick<
        Settings,
        | 'plotSuggestSource'
        | 'plotSuggestOfflineOnly'
        | 'aiProvider'
    >;
    localGenerate?: (
        sql: string,
        columns: string[] | TypedColumn[],
        schema?: TableSchema[],
    ) => Promise<string>;
    cloudSuggest?: (
        sql: string,
        tier: 'tiny' | 'basic',
        signal?: AbortSignal,
        context?: { columns: TypedColumn[]; schema?: TableSchema[] },
    ) => Promise<string | null>;
    resolveActiveModel?: () => Promise<{ kind: 'local-onnx' | 'hf-hub' | 'cloud-tiny' }>;
}

const DEBOUNCE_MS = 500;
const MAX_CACHE_SIZE = 64;

const _cache = new Map<string, PlotSuggestionResult | null>();

// Per-key inflight state so concurrent calls for different SQL blocks don't
// cancel each other — each key gets its own debounce slot.
interface _Slot {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: ((v: PlotSuggestionResult | null) => void) | null;
}
const _slots = new Map<string, _Slot>();

function _getSlot(key: string): _Slot {
    let s = _slots.get(key);
    if (!s) { s = { timer: null, resolve: null }; _slots.set(key, s); }
    return s;
}

function _clearSlot(key: string): void {
    const s = _slots.get(key);
    if (!s) return;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.resolve) { s.resolve(null); s.resolve = null; }
}

export function rowCountBucket(rowCount: number): number {
    const n = Math.max(0, Number.isFinite(rowCount) ? rowCount : 0);
    return Math.floor(Math.log10(n + 1));
}

export function cacheKey(req: Pick<SuggestPlotRequest, 'sql' | 'columns' | 'rowCount'>): string {
    return [req.sql, req.columns.join('|'), String(rowCountBucket(req.rowCount))].join('::');
}

export function _resetPlotSuggestionForTests(): void {
    _cache.clear();
    for (const key of Array.from(_slots.keys())) _clearSlot(key);
    _slots.clear();
}

export function cancel(): void {
    for (const key of Array.from(_slots.keys())) _clearSlot(key);
    _slots.clear();
}

export function suggestPlot(
    req: SuggestPlotRequest,
    deps: PlotSuggestionDeps,
): Promise<PlotSuggestionResult | null> {
    const key = cacheKey(req);
    if (_cache.has(key)) {
        return Promise.resolve(_cache.get(key) ?? null);
    }

    // Supersede any pending call for the same key — resolve its promise to
    // null so the previous caller isn't left waiting forever. Calls for
    // different keys are independent and must NOT cancel each other.
    _clearSlot(key);

    return new Promise((resolve) => {
        const slot = _getSlot(key);
        slot.resolve = resolve;
        const onAbort = () => {
            const s = _slots.get(key);
            if (s?.timer) { clearTimeout(s.timer); s.timer = null; }
            if (s?.resolve === resolve) {
                s.resolve = null;
                resolve(null);
            }
        };
        req.signal?.addEventListener('abort', onAbort, { once: true });

        slot.timer = setTimeout(async () => {
            const s = _slots.get(key);
            if (s) s.timer = null;
            if (req.signal?.aborted) {
                req.signal.removeEventListener('abort', onAbort);
                if (s?.resolve === resolve) s.resolve = null;
                resolve(null);
                return;
            }
            try {
                const result = await _route(req, deps);
                _setCache(key, result);
                if (s?.resolve === resolve) s.resolve = null;
                req.signal?.removeEventListener('abort', onAbort);
                resolve(result);
            } catch (err) {
                if (err instanceof AiOfflineEnforcedError) {
                    const degraded: PlotSuggestionResult = {
                        config: '',
                        source: 'cloud-tiny',
                        degraded: 'offline-only',
                    };
                    _setCache(key, degraded);
                    if (s?.resolve === resolve) s.resolve = null;
                    req.signal?.removeEventListener('abort', onAbort);
                    resolve(degraded);
                    return;
                }
                if (s?.resolve === resolve) s.resolve = null;
                req.signal?.removeEventListener('abort', onAbort);
                resolve(null);
            }
        }, DEBOUNCE_MS);
    });
}

function _setCache(key: string, value: PlotSuggestionResult | null): void {
    if (_cache.size >= MAX_CACHE_SIZE) {
        const firstKey = _cache.keys().next().value;
        if (firstKey !== undefined) _cache.delete(firstKey);
    }
    _cache.set(key, value);
}

async function _route(
    req: SuggestPlotRequest,
    deps: PlotSuggestionDeps,
): Promise<PlotSuggestionResult | null> {
    const { settings } = deps;
    const provider = settings.aiProvider;
    const isCloudProvider = provider !== 'browser' && provider !== 'local';
    const offlineGate = settings.plotSuggestOfflineOnly && isCloudProvider;

    const source = settings.plotSuggestSource;

    // Prefer typed columns when callers supply them; fall back to bare names
    // for backwards compat. The v2 input format gracefully handles both.
    const localCols: string[] | TypedColumn[] = req.typedColumns ?? req.columns;
    const cloudCtx = req.typedColumns
        ? { columns: req.typedColumns, schema: req.schema }
        : undefined;

    if (source === 'cloud-tiny' || source === 'cloud-basic') {
        if (offlineGate) {
            return { config: '', source, degraded: 'offline-only' };
        }
        const tier = source === 'cloud-tiny' ? 'tiny' : 'basic';
        const cfg = await _callCloud(deps, req.sql, tier, req.signal, cloudCtx);
        if (!cfg) return null;
        return { config: cfg, source };
    }

    if (source === 'local-trained') {
        const cfg = await _callLocal(deps, req.sql, localCols, req.schema, req.signal);
        if (!cfg) return null;
        return { config: cfg, source: 'local-trained' };
    }

    const resolve = deps.resolveActiveModel ?? getActivePlotModel;
    let active: { kind: 'local-onnx' | 'hf-hub' | 'cloud-tiny' };
    try {
        active = await resolve();
    } catch {
        active = { kind: 'cloud-tiny' };
    }

    if (active.kind === 'local-onnx') {
        const cfg = await _callLocal(deps, req.sql, localCols, req.schema, req.signal);
        if (cfg) return { config: cfg, source: 'local-trained' };
    }

    if (offlineGate) {
        return { config: '', source: 'cloud-tiny', degraded: 'offline-only' };
    }
    const cfg = await _callCloud(deps, req.sql, 'tiny', req.signal, cloudCtx);
    if (!cfg) return null;
    return { config: cfg, source: 'cloud-tiny' };
}

async function _callLocal(
    deps: PlotSuggestionDeps,
    sql: string,
    columns: string[] | TypedColumn[],
    schema?: TableSchema[],
    signal?: AbortSignal,
): Promise<string | null> {
    if (deps.localGenerate) {
        try {
            return await deps.localGenerate(sql, columns, schema);
        } catch {
            return null;
        }
    }
    try {
        const mod = await import('./ml/PlotGenerationService');
        return await mod.generate(sql, columns, undefined, signal, schema);
    } catch {
        return null;
    }
}

async function _callCloud(
    deps: PlotSuggestionDeps,
    sql: string,
    tier: 'tiny' | 'basic',
    signal?: AbortSignal,
    context?: { columns: TypedColumn[]; schema?: TableSchema[] },
): Promise<string | null> {
    if (deps.cloudSuggest) {
        return await deps.cloudSuggest(sql, tier, signal, context);
    }
    // Cloud providers receive typed columns + sample-free context via the
    // existing PlotSuggestContext shape on AiService.
    const ctxArg = context
        ? { columns: context.columns.map(c => ({ name: c.name, type: c.type ?? 'VARCHAR' })), sample: [] }
        : undefined;
    return await aiService.getAiSuggestPlot(sql, undefined, ctxArg, tier);
}
