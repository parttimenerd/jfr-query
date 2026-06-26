import { describe, it, expect, beforeEach } from 'vitest';
import { PromptSuggester } from '../../services/ml/PromptSuggester';

const DIM = 384;

function unitVector(seed: number): Float32Array {
    // Deterministic pseudo-random vector, L2-normalised.
    const v = new Float32Array(DIM);
    let s = 0;
    let x = seed;
    for (let i = 0; i < DIM; i++) {
        x = (x * 9301 + 49297) % 233280;
        v[i] = (x / 233280) - 0.5;
        s += v[i] * v[i];
    }
    const norm = Math.sqrt(s) || 1;
    for (let i = 0; i < DIM; i++) v[i] /= norm;
    return v;
}

describe('PromptSuggester', () => {
    beforeEach(() => {
        PromptSuggester._setForTest(null, null);
    });

    it('returns [] when artifacts are missing', async () => {
        const out = await PromptSuggester.suggest('any context', 3);
        expect(out).toEqual([]);
        expect(PromptSuggester.isAvailable()).toBe(false);
    });

    it('returns top-k nearest by cosine similarity', async () => {
        const v0 = unitVector(1);
        const v1 = unitVector(7);
        const v2 = unitVector(42);
        const matrix = new Float32Array(3 * DIM);
        matrix.set(v0, 0);
        matrix.set(v1, DIM);
        matrix.set(v2, 2 * DIM);
        const prompts = [
            { suggestedPrompt: 'P0', category: 'explore' },
            { suggestedPrompt: 'P1', category: 'aggregate' },
            { suggestedPrompt: 'P2', category: 'visualize' },
        ];
        // Embed function returns the exact vector for v1 → P1 should win.
        PromptSuggester._setForTest(matrix, prompts, async () => v1);

        expect(PromptSuggester.isAvailable()).toBe(true);
        const out = await PromptSuggester.suggest('whatever', 2);
        expect(out).toHaveLength(2);
        expect(out[0].prompt).toBe('P1');
        expect(out[0].score).toBeCloseTo(1, 5);
        expect(out[0].category).toBe('aggregate');
    });

    it('handles k larger than the corpus', async () => {
        const v0 = unitVector(3);
        const matrix = new Float32Array(DIM);
        matrix.set(v0, 0);
        PromptSuggester._setForTest(
            matrix,
            [{ suggestedPrompt: 'only', category: 'debug' }],
            async () => v0,
        );
        const out = await PromptSuggester.suggest('ctx', 5);
        expect(out).toHaveLength(1);
        expect(out[0].prompt).toBe('only');
    });

    it('returns [] when the embedder fails', async () => {
        const matrix = new Float32Array(DIM);
        PromptSuggester._setForTest(
            matrix,
            [{ suggestedPrompt: 'x', category: 'explore' }],
            async () => null,
        );
        const out = await PromptSuggester.suggest('ctx', 3);
        expect(out).toEqual([]);
    });
});
