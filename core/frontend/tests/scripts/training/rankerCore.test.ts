import { describe, it, expect } from 'vitest';
import { extractCursorWord, featurize, score } from '../../../scripts/training/rankerCore';
import type { RankerFeatures, Weights } from '../../../scripts/training/rankerCore';

// ─── extractCursorWord ────────────────────────────────────────────────────────

describe('extractCursorWord', () => {
    it('returns empty string at position 0', () => {
        expect(extractCursorWord('SELECT', 0)).toBe('');
    });

    it('extracts a simple word', () => {
        expect(extractCursorWord('SELECT col', 10)).toBe('col');
    });

    it('extracts word with underscores', () => {
        expect(extractCursorWord('WHERE gc_pause', 14)).toBe('gc_pause');
    });

    it('returns empty string when cursor is after a space', () => {
        expect(extractCursorWord('SELECT ', 7)).toBe('');
    });

    it('extracts a partial word', () => {
        expect(extractCursorWord('SELECT sta', 10)).toBe('sta');
    });

    it('handles $ prefix in word', () => {
        expect(extractCursorWord('WHERE $limit', 12)).toBe('$limit');
    });

    it('extracts word from middle of context', () => {
        expect(extractCursorWord('SELECT * FROM gc_pause WHERE ', 29)).toBe('');
    });

    it('returns the full word when cursor is at end of context', () => {
        const ctx = 'SELECT startTime';
        expect(extractCursorWord(ctx, ctx.length)).toBe('startTime');
    });
});

// ─── featurize ────────────────────────────────────────────────────────────────

describe('featurize — prefix features', () => {
    it('sets prefixMatch=1 when candidate starts with cursor word', () => {
        const f = featurize('SELECT sta', 10, 'startTime', 'select');
        expect(f.prefixMatch).toBe(1);
    });

    it('sets prefixMatch=0 when candidate does not start with cursor word', () => {
        const f = featurize('SELECT cau', 10, 'startTime', 'select');
        expect(f.prefixMatch).toBe(0);
    });

    it('sets substringMatch=1 when cursor word is substring of candidate', () => {
        const f = featurize('SELECT time', 11, 'startTime', 'select');
        expect(f.substringMatch).toBe(1);
    });

    it('sets exactMatch=1 for exact match', () => {
        const f = featurize('SELECT cause', 12, 'cause', 'select');
        expect(f.exactMatch).toBe(1);
    });

    it('sets exactMatch=0 for partial match', () => {
        const f = featurize('SELECT cau', 10, 'cause', 'select');
        expect(f.exactMatch).toBe(0);
    });

    it('sets prefixDepth proportional to match length', () => {
        // 'cau' matches first 3 chars of 'cause' → 3/4 = 0.75
        const f = featurize('SELECT cau', 10, 'cause', 'select');
        expect(f.prefixDepth).toBeCloseTo(3 / 4);
    });

    it('caps prefixDepth at 1 for long matches', () => {
        const f = featurize('SELECT startTime', 16, 'startTime', 'select');
        expect(f.prefixDepth).toBe(1);
    });
});

describe('featurize — candidate type flags', () => {
    it('sets isKeyword=1 for SELECT', () => {
        expect(featurize('', 0, 'SELECT', 'select').isKeyword).toBe(1);
    });

    it('sets isKeyword=1 for WHERE', () => {
        expect(featurize('', 0, 'WHERE', 'select').isKeyword).toBe(1);
    });

    it('sets isKeyword=0 for a column name', () => {
        expect(featurize('', 0, 'gcPause', 'select').isKeyword).toBe(0);
    });

    it('sets isFunction=1 when candidate ends with (', () => {
        expect(featurize('', 0, 'COUNT(', 'select').isFunction).toBe(1);
    });

    it('sets isFunction=0 when candidate is a plain name', () => {
        expect(featurize('', 0, 'cause', 'select').isFunction).toBe(0);
    });

    it('sets isColumn=1 for snake_case identifier', () => {
        const f = featurize('', 0, 'gc_pause', 'select');
        expect(f.isColumn).toBe(1);
    });

    it('sets isColumn=0 for SQL keywords', () => {
        expect(featurize('', 0, 'SELECT', 'select').isColumn).toBe(0);
    });

    it('sets isTable=1 for known JFR table name', () => {
        expect(featurize('', 0, 'GarbageCollection', 'from').isTable).toBe(1);
    });

    it('sets isTable=0 for regular column', () => {
        expect(featurize('', 0, 'cause', 'from').isTable).toBe(0);
    });

    it('sets jfrHint=1 for JFR column pattern (gc prefix)', () => {
        expect(featurize('', 0, 'gcPause', 'select').jfrHint).toBe(1);
    });

    it('sets jfrHint=0 for non-JFR name', () => {
        expect(featurize('', 0, 'firstName', 'select').jfrHint).toBe(0);
    });
});

describe('featurize — scenario boosts', () => {
    it('boosts column in where scenario (not value position)', () => {
        const f = featurize('SELECT * FROM t WHERE ', 21, 'cause', 'where');
        expect(f.scenarioBoost).toBeGreaterThan(0);
    });

    it('suppresses column boost in where scenario at value position', () => {
        const f = featurize('SELECT * FROM t WHERE cause = ', 30, 'GC', 'where');
        expect(f.scenarioBoost).toBe(0);
    });

    it('boosts column in select scenario', () => {
        const f = featurize('SELECT ', 7, 'gcPause', 'select');
        expect(f.scenarioBoost).toBeGreaterThan(0);
    });

    it('boosts $ candidate in dollar scenario', () => {
        const f = featurize('WHERE x > ', 10, '$limit', 'dollar');
        expect(f.scenarioBoost).toBe(1);
    });

    it('does not boost non-$ in dollar scenario', () => {
        const f = featurize('WHERE x > ', 10, 'limit', 'dollar');
        expect(f.scenarioBoost).toBe(0);
    });
});

describe('featurize — context signals', () => {
    it('sets aggContext=1 when aggregate function precedes cursor', () => {
        const ctx = 'SELECT COUNT( ';
        const f = featurize(ctx, ctx.length, 'events', 'select');
        expect(f.aggContext).toBe(1);
    });

    it('sets aggContext=0 without aggregate function', () => {
        const ctx = 'SELECT * FROM t WHERE ';
        const f = featurize(ctx, ctx.length, 'cause', 'where');
        expect(f.aggContext).toBe(0);
    });

    it('sets inValuePos=1 after = operator', () => {
        const ctx = 'WHERE cause = ';
        const f = featurize(ctx, ctx.length, 'GC', 'where');
        expect(f.inValuePos).toBe(1);
    });

    it('sets inValuePos=1 after LIKE', () => {
        const ctx = 'WHERE name LIKE ';
        const f = featurize(ctx, ctx.length, 'G1%', 'where');
        expect(f.inValuePos).toBe(1);
    });

    it('sets inValuePos=0 before comparison', () => {
        const ctx = 'WHERE ';
        const f = featurize(ctx, ctx.length, 'cause', 'where');
        expect(f.inValuePos).toBe(0);
    });
});

// ─── score ────────────────────────────────────────────────────────────────────

describe('score', () => {
    const allOnes: Weights = {
        prefixMatch: 1, substringMatch: 1, scenarioBoost: 1,
        lengthPenalty: 1, isKeyword: 1, isColumn: 1, isFunction: 1,
        prefixDepth: 1, jfrHint: 1, exactMatch: 1, isTable: 1,
        aggContext: 1, inValuePos: 1, isViewName: 1, plotClause: 1,
    };

    it('returns 0 when all features are 0', () => {
        const features: RankerFeatures = {
            prefixMatch: 0, substringMatch: 0, scenarioBoost: 0,
            lengthPenalty: 0, isKeyword: 0, isColumn: 0, isFunction: 0,
            prefixDepth: 0, jfrHint: 0, exactMatch: 0, isTable: 0,
            aggContext: 0, inValuePos: 0, isViewName: 0, plotClause: 0,
        };
        expect(score(features, allOnes)).toBe(0);
    });

    it('returns sum of active features when weights are all 1', () => {
        const features: RankerFeatures = {
            prefixMatch: 1, substringMatch: 1, scenarioBoost: 0,
            lengthPenalty: 0.5, isKeyword: 0, isColumn: 1, isFunction: 0,
            prefixDepth: 0.75, jfrHint: 1, exactMatch: 0, isTable: 0,
            aggContext: 0, inValuePos: 0, isViewName: 0, plotClause: 0,
        };
        const expected = 1 + 1 + 0.5 + 1 + 0.75 + 1;
        expect(score(features, allOnes)).toBeCloseTo(expected);
    });

    it('scales features by their weights', () => {
        const features: RankerFeatures = {
            prefixMatch: 1, substringMatch: 0, scenarioBoost: 0,
            lengthPenalty: 0, isKeyword: 0, isColumn: 0, isFunction: 0,
            prefixDepth: 0, jfrHint: 0, exactMatch: 0, isTable: 0,
            aggContext: 0, inValuePos: 0, isViewName: 0, plotClause: 0,
        };
        const weights: Weights = { ...allOnes, prefixMatch: 3 };
        expect(score(features, weights)).toBe(3);
    });

    it('returns higher score for prefix match than no match', () => {
        const ctx = 'SELECT sta';
        const pos = ctx.length;
        const fMatch = featurize(ctx, pos, 'startTime', 'select');
        const fNoMatch = featurize(ctx, pos, 'cause', 'select');
        const w = allOnes;
        expect(score(fMatch, w)).toBeGreaterThan(score(fNoMatch, w));
    });
});
