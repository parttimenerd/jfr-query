// Runtime loader for the linear autocomplete ranker. Loads weights from
// autocompleteRanker.json on demand. When the artifact is missing, score()
// falls back to a no-op (returns 0) so callers can blend it in safely.
// No env flag needed: the JSON artifact is committed in-tree and loading it
// is free (no network, no large binary).

import { featurize, featurizeCandidate, featurizeCandidateInto, extractContextFeatures, extractContextFeaturesInto, score as scoreFeatures } from '../../scripts/training/rankerCore';
import type { RankerFeatures, Weights } from '../../scripts/training/rankerCore';
import type { Completion } from '@codemirror/autocomplete';

// Reusable scores buffer — avoids one heap allocation per boostItemsInPlace call.
// Single-threaded JS; callers must complete use before the next call.
let _scoresBuf: number[] = [];

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

    /**
     * Score all candidates in one call, pre-computing context-invariant features
     * (cursor word, inValuePos, aggContext) once instead of once per candidate.
     * Returns scores in the same order as `candidates`.
     */
    static scoreAll(
        context: string,
        cursorPos: number,
        candidates: string[],
        scenario: string,
    ): number[] {
        if (!_weights) return new Array(candidates.length).fill(0);
        const cf = extractContextFeaturesInto(context, cursorPos);
        const w = _weights!;
        const out = new Array<number>(candidates.length);
        for (let i = 0; i < candidates.length; i++) {
            out[i] = scoreFeatures(featurizeCandidateInto(cf, candidates[i]!, scenario), w);
        }
        return out;
    }

    /**
     * Apply ranker boosts directly onto items[i].boost in place.
     * Avoids allocating a labels[] array and a scores[] array on each call.
     * Scores are min-max normalized to a [-2, +2] delta (same as the
     * applyAutocompleteRankerBoosts function in dispatcher.ts).
     * Returns true if boosts were applied; false if ranker unavailable or ≤1 item.
     */
    static boostItemsInPlace(
        items: Completion[],
        context: string,
        cursorPos: number,
        scenario: string,
    ): boolean {
        if (!_weights || items.length <= 1) return false;
        const cf = extractContextFeaturesInto(context, cursorPos);
        const w = _weights;
        const n = items.length;
        if (_scoresBuf.length < n) _scoresBuf = new Array<number>(n);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < n; i++) {
            const s = scoreFeatures(featurizeCandidateInto(cf, items[i]!.label, scenario), w);
            _scoresBuf[i] = s;
            if (s < min) min = s;
            if (s > max) max = s;
        }
        const range = max - min;
        if (range === 0) return false;
        for (let i = 0; i < n; i++) {
            const normalized = (_scoresBuf[i]! - min) / range;
            items[i]!.boost = (items[i]!.boost ?? 0) + Math.round(-2 + 4 * normalized);
        }
        return true;
    }

    // Test-only: inject weights without touching the import system.
    static _setWeightsForTest(w: Weights | null): void {
        _weights = w;
        _loadAttempted = true;
    }
}
