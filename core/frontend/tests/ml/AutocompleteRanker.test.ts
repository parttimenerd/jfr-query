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
    prefixDepth: 0.5,
    jfrHint: 0.3,
    exactMatch: 1.5,
    isTable: 0.2,
    aggContext: 0.2,
    inValuePos: 0,
    isViewName: 0.3,
    plotClause: 0.3,
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

    it('suppresses column scenarioBoost in WHERE value position (after =)', () => {
        const colInValPos = featurize('SELECT * FROM t WHERE cause = ', 30, 'duration', 'where');
        const colInColPos = featurize('SELECT * FROM t WHERE ', 22, 'duration', 'where');
        // Column in value position should get scenarioBoost = 0
        expect(colInValPos.scenarioBoost).toBe(0);
        // Column in column position should get scenarioBoost = 1
        expect(colInColPos.scenarioBoost).toBe(1);
        // Score in value pos must be lower
        expect(scoreFeatures(colInValPos, W)).toBeLessThan(scoreFeatures(colInColPos, W));
    });

    it('suppresses column scenarioBoost in WHERE value position (after LIKE)', () => {
        const f = featurize('SELECT * FROM t WHERE name LIKE ', 32, 'cause', 'where');
        expect(f.scenarioBoost).toBe(0);
        expect(f.inValuePos).toBe(1);
    });

    it('suppresses column scenarioBoost in WHERE value position (after BETWEEN)', () => {
        const f = featurize('SELECT * FROM t WHERE ts BETWEEN ', 33, 'ts', 'where');
        expect(f.scenarioBoost).toBe(0);
        expect(f.inValuePos).toBe(1);
    });

    it('does NOT suppress scenarioBoost in WHERE after AND (new column expected)', () => {
        const f = featurize('SELECT * FROM t WHERE ts > 0 AND ', 33, 'cause', 'where');
        expect(f.scenarioBoost).toBe(1);
        expect(f.inValuePos).toBe(0);
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
