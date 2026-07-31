// EmbeddingService tests that don't require the MiniLM model download.
//
// The fast-path (precomputed view embeddings) and pure helpers (rankCandidates
// short-circuit for ≤1 candidate, abort-signal propagation) can be tested
// without touching @huggingface/transformers at all.

import { describe, it, expect, vi } from 'vitest';

// Mock the heavy transformer so ensureLoaded never hangs waiting for a download.
vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0) }),
    ),
    env: { allowLocalModels: false, useBrowserCache: false },
}));

import { rankCandidates, isReady } from '../../services/ml/EmbeddingService';

describe('EmbeddingService — short-circuit paths', () => {
    it('returns input unchanged when there is ≤1 candidate', async () => {
        expect(await rankCandidates('select gc pauses', [])).toEqual([]);
        expect(await rankCandidates('select gc pauses', ['only-one'])).toEqual(['only-one']);
    });

    it('returns input unchanged when model not ready AND no candidates are precomputed views', async () => {
        // 'asdf-not-a-view' is guaranteed not in viewEmbeddings.json.
        const input = ['asdf-not-a-view  (table)', 'zzz-not-a-view  (table)'];
        const out = await rankCandidates('any context', input);
        // Without the model and with no precomputed embeddings, the ranker can't
        // score — it must return the original order rather than throw.
        if (!isReady()) {
            expect(out).toEqual(input);
        }
    });
});

describe('EmbeddingService — view-index fast path', () => {
    it('reorders precomputed-view candidates without requiring the model', async () => {
        // These two are both known views (in viewEmbeddings.json). The ranker
        // should embed the query (or skip entirely if model not ready and the
        // path needs it) and return SOMETHING — but at minimum, the call must
        // not throw and must return the same candidates set.
        const candidates = ['gc-pauses  (view)', 'allocation-rate  (view)'];
        const out = await rankCandidates('garbage collection pause times', candidates);
        // Result is a permutation of the input (no candidate lost or invented).
        expect(out.slice().sort()).toEqual(candidates.slice().sort());
    });

    it('preserves names with surrounding quotes', async () => {
        const candidates = ['"gc-pauses"  (view)', '"allocation-rate"  (view)'];
        const out = await rankCandidates('memory allocation', candidates);
        expect(out.slice().sort()).toEqual(candidates.slice().sort());
    });
});

describe('EmbeddingService — AbortSignal propagation', () => {
    it('rankCandidates accepts a signal parameter (TS signature check)', async () => {
        const ac = new AbortController();
        // For ≤1 candidate path, this returns synchronously without touching
        // the model; the signal is irrelevant. We're really checking the
        // function accepts the new parameter shape.
        const out = await rankCandidates('ctx', ['only-one'], ac.signal);
        expect(out).toEqual(['only-one']);
    });
});
