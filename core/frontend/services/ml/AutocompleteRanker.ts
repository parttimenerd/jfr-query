// Runtime loader for the linear autocomplete ranker. Loads weights from
// autocompleteRanker.json on demand. When the artifact is missing, score()
// falls back to a no-op (returns 0) so callers can blend it in safely.
// No env flag needed: the JSON artifact is committed in-tree and loading it
// is free (no network, no large binary).

import { featurize, score as scoreFeatures } from '../../scripts/training/rankerCore';
import type { RankerFeatures, Weights } from '../../scripts/training/rankerCore';

export type { RankerFeatures, Weights };

interface RankerArtifact {
    version: number;
    weights: Weights;
    mrr?: number;
    trainedAt?: string;
}

let _weights: Weights | null = null;
let _loadAttempted = false;

async function tryLoad(): Promise<void> {
    if (_loadAttempted) return;
    _loadAttempted = true;
    try {
        const mod = await import('./autocompleteRanker.json');
        const data = (mod.default ?? mod) as RankerArtifact;
        if (data && data.weights) _weights = data.weights;
    } catch {
        // Artifact absent — stay disabled.
        _weights = null;
    }
}

export class AutocompleteRanker {
    static async ensureLoaded(): Promise<void> {
        await tryLoad();
    }

    static isAvailable(): boolean {
        return _weights !== null;
    }

    /**
     * Score a single candidate. Returns 0 if the ranker isn't loaded.
     * Pure function once weights are loaded — safe to call repeatedly.
     */
    static score(
        context: string,
        cursorPos: number,
        candidate: string,
        scenario: string,
    ): number {
        if (!_weights) return 0;
        const f = featurize(context, cursorPos, candidate, scenario);
        return scoreFeatures(f, _weights);
    }

    /** Rank candidates best-first; preserves input order if unavailable. */
    static rank(
        context: string,
        cursorPos: number,
        candidates: string[],
        scenario: string,
    ): string[] {
        if (!_weights || candidates.length <= 1) return candidates;
        return candidates
            .map((c) => ({ c, s: AutocompleteRanker.score(context, cursorPos, c, scenario) }))
            .sort((a, b) => b.s - a.s)
            .map((x) => x.c);
    }

    // Test-only: inject weights without touching the import system.
    static _setWeightsForTest(w: Weights | null): void {
        _weights = w;
        _loadAttempted = true;
    }
}
