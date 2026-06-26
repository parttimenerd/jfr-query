import { describe, it, expect, beforeEach } from 'vitest';
import { AutocompleteRanker } from '../../services/ml/AutocompleteRanker';
import {
    featurize,
    score as scoreFeatures,
    extractCursorWord,
} from '../../scripts/training/trainAutocompleteRanker';
import type { Weights } from '../../scripts/training/trainAutocompleteRanker';

const W: Weights = {
    prefixMatch: 3,
    substringMatch: 1,
    scenarioBoost: 2,
    lengthPenalty: 0.1,
    isKeyword: 0.2,
    isColumn: 0.5,
    isFunction: 0.1,
};

describe('extractCursorWord', () => {
    it('returns the word ending at the cursor', () => {
        expect(extractCursorWord('SELECT ca', 9)).toBe('ca');
        expect(extractCursorWord('SELECT cause FROM ', 18)).toBe('');
        expect(extractCursorWord('WHERE $$x', 9)).toBe('$$x');
    });
});

describe('featurize / score', () => {
    it('flags prefix matches and column-like candidates', () => {
        const f = featurize('SELECT ca', 9, 'cause', 'select');
        expect(f.prefixMatch).toBe(1);
        expect(f.substringMatch).toBe(1);
        expect(f.isColumn).toBe(1);
        expect(f.isKeyword).toBe(0);
        expect(scoreFeatures(f, W)).toBeGreaterThan(0);
    });

    it('penalises keywords inside WHERE column slot vs columns', () => {
        const colF = featurize('SELECT * FROM t WHERE ', 22, 'cause', 'where');
        const kwF = featurize('SELECT * FROM t WHERE ', 22, 'SELECT', 'where');
        expect(scoreFeatures(colF, W)).toBeGreaterThan(scoreFeatures(kwF, W));
    });

    it('rewards dollar candidates in dollar scenario', () => {
        const dol = featurize('WHERE id = $', 12, '${gcId}', 'dollar');
        const plain = featurize('WHERE id = $', 12, 'gcId', 'dollar');
        expect(scoreFeatures(dol, W)).toBeGreaterThan(scoreFeatures(plain, W));
    });
});

describe('AutocompleteRanker loader', () => {
    beforeEach(() => {
        AutocompleteRanker._setWeightsForTest(null);
    });

    it('returns the input unchanged when artifact is missing', () => {
        const out = AutocompleteRanker.rank('SELECT ca', 9, ['cause', 'SELECT', 'x'], 'select');
        expect(out).toEqual(['cause', 'SELECT', 'x']);
        expect(AutocompleteRanker.isAvailable()).toBe(false);
        expect(AutocompleteRanker.score('SELECT ca', 9, 'cause', 'select')).toBe(0);
    });

    it('ranks columns above keywords in a WHERE slot', () => {
        AutocompleteRanker._setWeightsForTest(W);
        const out = AutocompleteRanker.rank(
            'SELECT * FROM ActiveRecording WHERE ',
            36,
            ['SELECT', 'cause', 'duration'],
            'where',
        );
        expect(out[0]).not.toBe('SELECT');
        expect(out).toContain('cause');
        expect(out).toContain('duration');
    });

    it('ranks prefix matches first', () => {
        AutocompleteRanker._setWeightsForTest(W);
        const out = AutocompleteRanker.rank(
            'SELECT dur',
            10,
            ['cause', 'duration', 'gcId'],
            'select',
        );
        expect(out[0]).toBe('duration');
    });
});
