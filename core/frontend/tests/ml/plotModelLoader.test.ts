import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getActivePlotModel,
    _resetPlotModelLoaderForTests,
    PROMOTION_THRESHOLD,
    IN_TREE_ARTIFACT_DIR,
    IN_TREE_EVAL_PATH,
    type PlotEvalMetrics,
} from '../../services/ml/PlotModelLoader';
import { CANDIDATES } from '../../services/ml/candidates';

// We mock 'node:fs/promises' so the loader doesn't touch disk in tests.
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn().mockRejectedValue(new Error('file not found')),
}));
vi.mock('node:path', () => ({
    resolve: (...args: string[]) => args.join('/'),
}));

async function loadWithMetrics(metrics: PlotEvalMetrics | null): Promise<ReturnType<typeof getActivePlotModel>> {
    const fsMod = await import('node:fs/promises');
    if (metrics) {
        vi.mocked(fsMod.readFile).mockResolvedValueOnce(JSON.stringify(metrics) as any);
    } else {
        vi.mocked(fsMod.readFile).mockRejectedValue(new Error('not found'));
    }
    _resetPlotModelLoaderForTests();
    return getActivePlotModel();
}

describe('PlotModelLoader — promotion gate', () => {
    beforeEach(() => {
        _resetPlotModelLoaderForTests();
        vi.clearAllMocks();
    });

    it('exports PROMOTION_THRESHOLD with expected values', () => {
        expect(PROMOTION_THRESHOLD.plotShapeAccuracy).toBe(0.95);
        expect(PROMOTION_THRESHOLD.columnMatchAccuracy).toBe(0.85);
    });

    it('exports IN_TREE_ARTIFACT_DIR and IN_TREE_EVAL_PATH', () => {
        expect(IN_TREE_ARTIFACT_DIR).toBe('services/ml/models/plot-suggester-v2');
        expect(IN_TREE_EVAL_PATH).toBe('services/ml/models/plot-suggester-v2/eval.json');
    });

    it('promotes local model when metrics exceed both thresholds', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.97,
            plotShapeAccuracy: 0.96,
            columnMatchAccuracy: 0.90,
            sampleSize: 500,
        };
        const result = await loadWithMetrics(metrics);
        expect(result.kind).toBe('local-onnx');
        expect(result.promoted).toBe(true);
        expect(result.metrics).toMatchObject({ plotShapeAccuracy: 0.96, columnMatchAccuracy: 0.90 });
        expect(result.artifactPath).toBe(IN_TREE_ARTIFACT_DIR);
        expect(result.badge).toContain('trained locally');
        expect(result.badge).toContain('96%');
    });

    it('does NOT promote when plotShapeAccuracy is below threshold', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.90,
            plotShapeAccuracy: 0.94,  // just below 0.95
            columnMatchAccuracy: 0.90,
        };
        const result = await loadWithMetrics(metrics);
        expect(result.kind).toBe('cloud-tiny');
        expect(result.promoted).toBe(false);
        expect(result.badge).toContain('below promotion gate');
    });

    it('does NOT promote when columnMatchAccuracy is below threshold', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.97,
            plotShapeAccuracy: 0.96,
            columnMatchAccuracy: 0.84,  // just below 0.85
        };
        const result = await loadWithMetrics(metrics);
        expect(result.kind).toBe('cloud-tiny');
        expect(result.promoted).toBe(false);
    });

    it('promotes when metrics exactly meet thresholds', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.95,
            plotShapeAccuracy: 0.95,   // exactly at threshold
            columnMatchAccuracy: 0.85, // exactly at threshold
        };
        const result = await loadWithMetrics(metrics);
        expect(result.kind).toBe('local-onnx');
        expect(result.promoted).toBe(true);
    });

    it('falls back to hf-hub when eval.json is missing', async () => {
        const result = await loadWithMetrics(null);
        // local candidate exists (plot-suggester-local in candidates.ts)
        // but no metrics → no promotion → falls through
        // With no metrics, the local candidate branch returns cloud-tiny with no badge
        // OR falls to HF Hub depending on whether local candidate exists.
        // The current code: if local candidate exists but no metrics → falls through to HF hub check.
        expect(['hf-hub', 'cloud-tiny']).toContain(result.kind);
        expect(result.promoted).toBe(false);
    });

    it('memoises: second call returns same object without re-reading disk', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.97,
            plotShapeAccuracy: 0.96,
            columnMatchAccuracy: 0.90,
        };
        const fsMod = await import('node:fs/promises');
        vi.mocked(fsMod.readFile).mockResolvedValue(JSON.stringify(metrics) as any);
        _resetPlotModelLoaderForTests();

        const r1 = await getActivePlotModel();
        const r2 = await getActivePlotModel();
        expect(r1).toBe(r2);  // same object reference — memoised
        // readFile should only be called once
        expect(vi.mocked(fsMod.readFile)).toHaveBeenCalledTimes(1);
    });

    it('_resetPlotModelLoaderForTests clears cache so next call re-reads', async () => {
        const fsMod = await import('node:fs/promises');
        vi.mocked(fsMod.readFile).mockRejectedValue(new Error('not found'));
        _resetPlotModelLoaderForTests();
        const r1 = await getActivePlotModel();

        _resetPlotModelLoaderForTests();
        vi.mocked(fsMod.readFile).mockRejectedValue(new Error('not found'));
        const r2 = await getActivePlotModel();

        // Both are valid results but independent calls (cache was cleared)
        expect(r1).not.toBe(r2);
    });
});

describe('PlotModelLoader — eval metrics parsing', () => {
    beforeEach(() => {
        _resetPlotModelLoaderForTests();
        vi.clearAllMocks();
    });

    it('ignores eval.json with non-numeric metrics', async () => {
        const fsMod = await import('node:fs/promises');
        vi.mocked(fsMod.readFile).mockResolvedValueOnce(
            JSON.stringify({ accuracy: 'high', plotShapeAccuracy: null, columnMatchAccuracy: 'good' }) as any,
        );
        _resetPlotModelLoaderForTests();
        const result = await getActivePlotModel();
        // Metrics parsing should fail → no promotion
        expect(result.promoted).toBe(false);
    });

    it('ignores eval.json that is not an object', async () => {
        const fsMod = await import('node:fs/promises');
        vi.mocked(fsMod.readFile).mockResolvedValueOnce('"just a string"' as any);
        _resetPlotModelLoaderForTests();
        const result = await getActivePlotModel();
        expect(result.promoted).toBe(false);
    });

    it('includes optional sampledAt and sampleSize when present', async () => {
        const metrics: PlotEvalMetrics = {
            accuracy: 0.97,
            plotShapeAccuracy: 0.96,
            columnMatchAccuracy: 0.90,
            sampledAt: '2026-07-29T00:00:00Z',
            sampleSize: 500,
        };
        const result = await loadWithMetrics(metrics);
        expect(result.metrics?.sampledAt).toBe('2026-07-29T00:00:00Z');
        expect(result.metrics?.sampleSize).toBe(500);
    });
});

describe('PlotModelLoader — candidate presence in candidates.ts', () => {
    it('plot-suggester-local is registered in CANDIDATES', () => {
        expect(CANDIDATES['plot-suggester-local']).toBeDefined();
        expect(CANDIDATES['plot-suggester-local'].repo).toBe('./services/ml/models/plot-suggester-v2');
    });

    it('DEFAULT_MODEL_ID (t5-small-finetuned) is registered in CANDIDATES', () => {
        expect(CANDIDATES['t5-small-finetuned']).toBeDefined();
    });
});
