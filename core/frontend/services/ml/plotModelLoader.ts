/**
 * Plot model loader — resolves the best available plot-suggestion model:
 *
 *   1. In-tree ONNX artifact (services/ml/models/plot-suggester/) when present
 *      AND eval.json metrics meet the promotion gate (≥95% family accuracy
 *      AND ≥85% column-match accuracy).
 *   2. Cloud `tiny` model (kept as default fallback when the in-tree artifact
 *      is missing or below threshold).
 *
 * The loader is lazy: artifact metadata is only read on the first call. The
 * result is memoized for the lifetime of the JS context.
 *
 * Exposes `getActivePlotModel()` which returns a discriminated union the
 * caller (`PlotGenerationService`, `services/plotSuggestion.ts`) can switch on.
 */

import { CANDIDATES, DEFAULT_MODEL_ID, type CandidateModel } from './candidates';

export type PlotModelKind = 'local-onnx' | 'hf-hub' | 'cloud-tiny';

export interface PlotEvalMetrics {
    accuracy: number;            // exact-match accuracy on held-out split
    plotShapeAccuracy: number;   // plot-family (LINE_CHART/BAR_CHART/...) match
    columnMatchAccuracy: number; // accuracy of column-name selection
    sampledAt?: string;
    sampleSize?: number;
}

export interface ActivePlotModel {
    kind: PlotModelKind;
    /** Candidate id in candidates.ts (when kind !== 'cloud-tiny'). */
    candidateId?: string;
    /** Filesystem path to the in-tree ONNX artifact, when kind === 'local-onnx'. */
    artifactPath?: string;
    /** Metrics from eval.json, when available. */
    metrics?: PlotEvalMetrics;
    /** Human-readable badge label (e.g. "trained locally · 96% acc"). */
    badge?: string;
    /** True when the model passed the promotion gate and may be the default. */
    promoted: boolean;
}

/** Promotion thresholds. Below this the cloud `tiny` model is kept as default. */
export const PROMOTION_THRESHOLD = {
    plotShapeAccuracy: 0.95,
    columnMatchAccuracy: 0.85,
} as const;

/**
 * Path to the in-tree artifact directory. Resolved relative to this module so
 * it works in both Vite (dev/build) and a Node training/eval context.
 */
export const IN_TREE_ARTIFACT_DIR = 'services/ml/models/plot-suggester-v2';
export const IN_TREE_EVAL_PATH = `${IN_TREE_ARTIFACT_DIR}/eval.json`;

const LOCAL_CANDIDATE_ID = 'plot-suggester-local';
const HF_FALLBACK_CANDIDATE_ID = 'flan-t5-small';

let _cached: ActivePlotModel | null = null;

/** Reset memoization. Test-only. */
export function _resetPlotModelLoaderForTests(): void {
    _cached = null;
}

/**
 * Returns the active plot-suggestion model. Lazy + memoized.
 *
 * Resolution order:
 *   1. If candidates.ts has `plot-suggester-local` AND eval.json exists AND
 *      metrics ≥ promotion thresholds → use the in-tree ONNX artifact.
 *   2. Else if the HF fallback (`flan-t5-small`) is available in candidates →
 *      use the HF Hub.
 *   3. Else fall back to cloud `tiny` model (PlotGenerationService callers
 *      then route through AiService instead of the local model).
 */
export async function getActivePlotModel(): Promise<ActivePlotModel> {
    if (_cached) return _cached;
    _cached = await _resolve();
    return _cached;
}

async function _resolve(): Promise<ActivePlotModel> {
    const localCandidate: CandidateModel | undefined = CANDIDATES[LOCAL_CANDIDATE_ID];

    if (localCandidate) {
        const metrics = await _readEvalMetrics();
        const promoted =
            !!metrics &&
            metrics.plotShapeAccuracy >= PROMOTION_THRESHOLD.plotShapeAccuracy &&
            metrics.columnMatchAccuracy >= PROMOTION_THRESHOLD.columnMatchAccuracy;
        if (promoted) {
            return {
                kind: 'local-onnx',
                candidateId: LOCAL_CANDIDATE_ID,
                artifactPath: IN_TREE_ARTIFACT_DIR,
                metrics: metrics ?? undefined,
                badge: _formatBadge('trained locally', metrics),
                promoted: true,
            };
        }
        // Local exists but below promotion gate — keep it visible but not the default.
        if (metrics) {
            return {
                kind: 'cloud-tiny',
                candidateId: LOCAL_CANDIDATE_ID,
                metrics,
                badge: _formatBadge('below promotion gate', metrics),
                promoted: false,
            };
        }
    }

    // No in-tree artifact at all — try HF Hub fallback for the existing default.
    if (CANDIDATES[DEFAULT_MODEL_ID]) {
        return {
            kind: 'hf-hub',
            candidateId: DEFAULT_MODEL_ID,
            promoted: false,
        };
    }

    if (CANDIDATES[HF_FALLBACK_CANDIDATE_ID]) {
        return {
            kind: 'hf-hub',
            candidateId: HF_FALLBACK_CANDIDATE_ID,
            promoted: false,
        };
    }

    return { kind: 'cloud-tiny', promoted: false };
}

async function _readEvalMetrics(): Promise<PlotEvalMetrics | null> {
    // Browser-safe path: no `node:fs`. In Vite the artifact is bundled or
    // served as a static asset; in Node (eval/training) we use fs.
    if (typeof window === 'undefined') {
        try {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            // Resolve relative to repository frontend root.
            const candidates = [
                path.resolve(process.cwd(), IN_TREE_EVAL_PATH),
                path.resolve(process.cwd(), 'core/frontend', IN_TREE_EVAL_PATH),
            ];
            for (const p of candidates) {
                try {
                    const raw = await fs.readFile(p, 'utf-8');
                    return _parseMetrics(JSON.parse(raw));
                } catch {
                    /* try next */
                }
            }
            return null;
        } catch {
            return null;
        }
    }
    // Browser: attempt fetch of the static asset.
    try {
        const resp = await fetch(`/${IN_TREE_EVAL_PATH}`);
        if (!resp.ok) return null;
        const json = await resp.json();
        return _parseMetrics(json);
    } catch {
        return null;
    }
}

function _parseMetrics(json: unknown): PlotEvalMetrics | null {
    if (!json || typeof json !== 'object') return null;
    const j = json as Record<string, unknown>;
    const accuracy = Number(j.accuracy);
    const plotShapeAccuracy = Number(j.plotShapeAccuracy);
    const columnMatchAccuracy = Number(j.columnMatchAccuracy);
    if (!Number.isFinite(accuracy) || !Number.isFinite(plotShapeAccuracy) || !Number.isFinite(columnMatchAccuracy)) {
        return null;
    }
    return {
        accuracy,
        plotShapeAccuracy,
        columnMatchAccuracy,
        sampledAt: typeof j.sampledAt === 'string' ? j.sampledAt : undefined,
        sampleSize: typeof j.sampleSize === 'number' ? j.sampleSize : undefined,
    };
}

function _formatBadge(prefix: string, metrics: PlotEvalMetrics | null | undefined): string {
    if (!metrics) return prefix;
    const pct = Math.round(metrics.plotShapeAccuracy * 100);
    return `${prefix} · ${pct}% acc`;
}
