import { describe, it, expect, beforeEach, vi } from 'vitest';

// Avoid pulling heavy ML deps. The plotSuggestion service lazy-imports
// `services/ml/PlotGenerationService` only when `deps.localGenerate` is not
// provided, so by always providing test stubs we avoid that import path.
// Still, stub the loader so the auto-mode test branch doesn't reach into
// `node:fs` or `@huggingface/transformers`.
vi.mock('../../services/ml/plotModelLoader', () => ({
    getActivePlotModel: vi.fn(async () => ({ kind: 'cloud-tiny' as const, promoted: false })),
}));

// AiService is imported for its AiOfflineEnforcedError class. Mock the plot
// registry transitive dependency (same trick used by the model-resolution test).
vi.mock('../../components/plots/plotRegistry', () => ({
    plotRegistry: {},
}));
vi.mock('../../context/SettingsContext', () => ({
    SettingsContext: {} as any,
    SettingsProvider: ({ children }: any) => children,
}));

import {
    suggestPlot,
    cancel,
    cacheKey,
    rowCountBucket,
    _resetPlotSuggestionForTests,
    type PlotSuggestionDeps,
} from '../../services/plotSuggestion';
import { AiOfflineEnforcedError } from '../../services/AiService';
import { getActivePlotModel } from '../../services/ml/plotModelLoader';

type DepsSettings = PlotSuggestionDeps['settings'];

function makeSettings(overrides: Partial<DepsSettings> = {}): DepsSettings {
    return {
        plotSuggestSource: 'auto',
        plotSuggestOfflineOnly: false,
        aiProvider: 'google',
        ...overrides,
    };
}

beforeEach(() => {
    _resetPlotSuggestionForTests();
    vi.useFakeTimers();
    vi.mocked(getActivePlotModel).mockReset();
    vi.mocked(getActivePlotModel).mockResolvedValue({
        kind: 'cloud-tiny',
        promoted: false,
    } as any);
});

describe('rowCountBucket', () => {
    it('buckets row counts by log10(n+1)', () => {
        // bucket = floor(log10(rowCount + 1))
        expect(rowCountBucket(0)).toBe(0);     // log10(1) = 0
        expect(rowCountBucket(1)).toBe(0);     // log10(2) ≈ 0.3
        expect(rowCountBucket(8)).toBe(0);     // log10(9) ≈ 0.95
        expect(rowCountBucket(9)).toBe(1);     // log10(10) = 1
        expect(rowCountBucket(50)).toBe(1);
        expect(rowCountBucket(99)).toBe(2);    // log10(100) = 2
        expect(rowCountBucket(100)).toBe(2);
        expect(rowCountBucket(9999)).toBe(4);  // log10(10000) = 4
    });

    it('handles non-finite input as zero', () => {
        expect(rowCountBucket(NaN)).toBe(0);
        expect(rowCountBucket(-5)).toBe(0);
    });
});

describe('cacheKey', () => {
    it('combines sql + columns + bucket', () => {
        const key = cacheKey({ sql: 'SELECT 1', columns: ['a', 'b'], rowCount: 50 });
        // bucket(50) = floor(log10(51)) = 1
        expect(key).toBe('SELECT 1::a|b::1');
    });

    it('puts queries with row counts in the same bucket on the same key', () => {
        // 100 → log10(101)=2.004... → 2; 500 → log10(501)=2.699... → 2
        const k1 = cacheKey({ sql: 'X', columns: ['c'], rowCount: 100 });
        const k2 = cacheKey({ sql: 'X', columns: ['c'], rowCount: 500 });
        expect(k1).toBe(k2);
    });
});

describe('suggestPlot — routing', () => {
    it('returns null when local source fails', async () => {
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'local-trained' }),
            localGenerate: vi.fn(async () => { throw new Error('no model'); }),
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        expect(await p).toBeNull();
    });

    it('routes plotSuggestSource=cloud-basic via cloud with tier=basic', async () => {
        const cloud = vi.fn(async () => 'LINE_CHART(x: ts, y: count)');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'cloud-basic' }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 5 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result).toEqual({ config: 'LINE_CHART(x: ts, y: count)', source: 'cloud-basic' });
        expect(cloud).toHaveBeenCalledWith('SELECT 1', 'basic', undefined, undefined);
    });

    it('auto mode uses local when active model is local-onnx', async () => {
        vi.mocked(getActivePlotModel).mockResolvedValue({
            kind: 'local-onnx',
            promoted: true,
        } as any);
        const local = vi.fn(async () => 'BAR_CHART(x: cause, y: total)');
        const cloud = vi.fn(async () => 'TABLE()');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'auto' }),
            localGenerate: local,
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT cause', columns: ['cause'], rowCount: 10 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result?.source).toBe('local-trained');
        expect(local).toHaveBeenCalled();
        expect(cloud).not.toHaveBeenCalled();
    });

    it('auto mode falls back to cloud tiny when local model is not present', async () => {
        // Default mock already returns kind: 'cloud-tiny'.
        const cloud = vi.fn(async () => 'LINE_CHART(x: ts, y: count)');
        const local = vi.fn();
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'auto' }),
            localGenerate: local,
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT ts', columns: ['ts'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result).toEqual({ config: 'LINE_CHART(x: ts, y: count)', source: 'cloud-tiny' });
        expect(local).not.toHaveBeenCalled();
        expect(cloud).toHaveBeenCalledWith('SELECT ts', 'tiny', undefined, undefined);
    });
});

describe('suggestPlot — offline gating', () => {
    it('degrades to offline-only when plotSuggestOfflineOnly + cloud provider in auto mode', async () => {
        const cloud = vi.fn();
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({
                plotSuggestSource: 'auto',
                plotSuggestOfflineOnly: true,
                aiProvider: 'anthropic',
            }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result?.degraded).toBe('offline-only');
        expect(cloud).not.toHaveBeenCalled();
    });

    it('no-ops cloud when explicit cloud-tiny + offline-only + cloud provider', async () => {
        const cloud = vi.fn();
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({
                plotSuggestSource: 'cloud-tiny',
                plotSuggestOfflineOnly: true,
                aiProvider: 'openai',
            }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result).toEqual({ config: '', source: 'cloud-tiny', degraded: 'offline-only' });
        expect(cloud).not.toHaveBeenCalled();
    });

    it('does not degrade when provider is browser even with offline-only on', async () => {
        const cloud = vi.fn(async () => 'TABLE()');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({
                plotSuggestSource: 'cloud-tiny',
                plotSuggestOfflineOnly: true,
                aiProvider: 'browser',
            }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result?.degraded).toBeUndefined();
        expect(result?.source).toBe('cloud-tiny');
    });

    it('treats AiOfflineEnforcedError thrown by cloudSuggest as degraded', async () => {
        const cloud = vi.fn(async () => { throw new AiOfflineEnforcedError('blocked'); });
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({
                plotSuggestSource: 'cloud-tiny',
                plotSuggestOfflineOnly: false,
                aiProvider: 'google',
            }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        const result = await p;
        expect(result?.degraded).toBe('offline-only');
    });
});

describe('suggestPlot — caching', () => {
    it('returns cached result on identical (sql, columns, bucket)', async () => {
        const cloud = vi.fn(async () => 'TABLE()');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'cloud-tiny' }),
            cloudSuggest: cloud,
        };
        const req = { sql: 'SELECT 1', columns: ['x'], rowCount: 50 };
        const p1 = suggestPlot(req, deps);
        await vi.advanceTimersByTimeAsync(500);
        await p1;
        // Second call with same key — should hit cache, no new cloud call.
        const result2 = await suggestPlot(req, deps);
        expect(result2?.config).toBe('TABLE()');
        expect(cloud).toHaveBeenCalledTimes(1);
    });

    it('row counts in the same log10 bucket share a cache entry', async () => {
        const cloud = vi.fn(async () => 'BAR_CHART(...)');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'cloud-tiny' }),
            cloudSuggest: cloud,
        };
        // 100 → log10(101)=2.004 → bucket 2; 500 → log10(501)=2.699 → bucket 2
        const p1 = suggestPlot({ sql: 'X', columns: ['c'], rowCount: 100 }, deps);
        await vi.advanceTimersByTimeAsync(500);
        await p1;
        const result2 = await suggestPlot({ sql: 'X', columns: ['c'], rowCount: 500 }, deps);
        expect(result2?.config).toBe('BAR_CHART(...)');
        expect(cloud).toHaveBeenCalledTimes(1);
    });
});

describe('suggestPlot — debounce', () => {
    it('debounces by 500ms', async () => {
        const cloud = vi.fn(async () => 'TABLE()');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'cloud-tiny' }),
            cloudSuggest: cloud,
        };
        const p = suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        await vi.advanceTimersByTimeAsync(300);
        expect(cloud).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(250);
        await p;
        expect(cloud).toHaveBeenCalledTimes(1);
    });

    it('cancel() clears a pending debounce', async () => {
        const cloud = vi.fn(async () => 'TABLE()');
        const deps: PlotSuggestionDeps = {
            settings: makeSettings({ plotSuggestSource: 'cloud-tiny' }),
            cloudSuggest: cloud,
        };
        suggestPlot({ sql: 'SELECT 1', columns: ['x'], rowCount: 1 }, deps);
        cancel();
        await vi.advanceTimersByTimeAsync(1000);
        expect(cloud).not.toHaveBeenCalled();
    });
});
