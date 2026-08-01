import { describe, it, expect } from 'vitest';
import {
    cleanDuckDBError,
    heuristicTip,
    isExpectedMissingTable,
    parseCandidateBindings,
} from '../../utils/sqlErrorMessage';

// ─── cleanDuckDBError ─────────────────────────────────────────────────────────

describe('cleanDuckDBError', () => {
    it('returns empty string unchanged', () => {
        expect(cleanDuckDBError('')).toBe('');
    });

    it('strips outer "Error: " prefix', () => {
        expect(cleanDuckDBError('Error: Binder Error: Column "x" does not exist!')).toBe(
            'Binder Error: Column "x" does not exist!'
        );
    });

    it('strips LINE N: SQL echo', () => {
        const raw = 'Parser Error: syntax error\nLINE 1: SELECT * FORM\n       ^';
        const cleaned = cleanDuckDBError(raw);
        expect(cleaned).not.toContain('LINE 1:');
        expect(cleaned).toContain('Parser Error: syntax error');
    });

    it('strips caret indicator line', () => {
        const raw = 'Parser Error: syntax error\n      ^';
        const cleaned = cleanDuckDBError(raw);
        expect(cleaned).not.toMatch(/^\s*\^/m);
    });

    it('strips dash+caret indicator line', () => {
        const raw = 'Parser Error: syntax error\n------^';
        const cleaned = cleanDuckDBError(raw);
        expect(cleaned).not.toContain('------^');
    });

    it('trims trailing empty lines', () => {
        const raw = 'Binder Error: Column "x" does not exist!\n\n\n';
        const cleaned = cleanDuckDBError(raw);
        expect(cleaned).toBe('Binder Error: Column "x" does not exist!');
    });

    it('drops leading whitespace-only lines', () => {
        const raw = '\n\nBinder Error: Column "x" does not exist!';
        const cleaned = cleanDuckDBError(raw);
        expect(cleaned).toBe('Binder Error: Column "x" does not exist!');
    });

    it('preserves "Did you mean ...?" line', () => {
        const raw = 'Binder Error: Column "fo" does not exist!\nDid you mean "foo"?';
        expect(cleanDuckDBError(raw)).toContain('Did you mean "foo"?');
    });

    it('returns trimmed raw when all lines get filtered', () => {
        // Only a caret line — should fall back to raw trimmed
        const raw = '      ^';
        expect(cleanDuckDBError(raw)).toBe('^');
    });
});

// ─── heuristicTip ─────────────────────────────────────────────────────────────

describe('heuristicTip', () => {
    it('returns empty string for unrecognised message', () => {
        expect(heuristicTip('Some unknown error occurred')).toBe('');
    });

    it('matches syntax error at comma', () => {
        expect(heuristicTip('Parser Error: syntax error at or near ","')).toContain('comma');
    });

    it('matches syntax error at SELECT', () => {
        expect(heuristicTip('Parser Error: syntax error at or near "SELECT"')).toContain('SELECT');
    });

    it('matches syntax error at FROM', () => {
        expect(heuristicTip('Parser Error: syntax error at or near "FROM"')).toContain('FROM');
    });

    it('matches syntax error at WHERE', () => {
        expect(heuristicTip('Parser Error: syntax error at or near "WHERE"')).toContain('WHERE');
    });

    it('matches "must appear in the GROUP BY clause"', () => {
        expect(heuristicTip('Binder Error: Column "x" must appear in the GROUP BY clause')).toContain('GROUP BY');
    });

    it('matches column does not exist', () => {
        expect(heuristicTip('Binder Error: Column "foo" does not exist!')).toContain('column');
    });

    it('matches table does not exist', () => {
        expect(heuristicTip('Catalog Error: Table "my_table" does not exist!')).toContain('table');
    });

    it('matches division by zero', () => {
        expect(heuristicTip('Runtime Error: division by zero')).toContain('NULLIF');
    });

    it('matches ambiguous reference', () => {
        expect(heuristicTip('Binder Error: Ambiguous reference to column name "id"')).toContain('Qualify');
    });

    it('matches catalog error for GCHeapSummary (ZGC tip)', () => {
        const msg = 'Catalog Error: Table with name GCHeapSummary does not exist!';
        expect(heuristicTip(msg)).toContain('ZGC');
    });

    it('matches nested aggregate error', () => {
        expect(heuristicTip('Binder Error: Aggregates cannot be nested')).toContain('nest');
    });

    it('matches LIMIT clause error', () => {
        expect(heuristicTip('Parser Error: LIMIT clause can only contain a constant')).toContain('LIMIT');
    });

    it('returns first-matched tip for multiple patterns', () => {
        // A specific syntax pattern should win over the generic "syntax error" catch-all
        const tip = heuristicTip('Parser Error: syntax error at or near ","');
        expect(tip).toContain('comma');
        expect(tip).not.toContain('typo');  // generic catch-all not reached
    });
});

// ─── isExpectedMissingTable ───────────────────────────────────────────────────

describe('isExpectedMissingTable', () => {
    it('returns true for GCHeapSummary table missing', () => {
        expect(isExpectedMissingTable('Table "GCHeapSummary" does not exist')).toBe(true);
    });

    it('returns true for ObjectAllocationSample table missing', () => {
        expect(isExpectedMissingTable('Table ObjectAllocationSample does not exist')).toBe(true);
    });

    it('returns true for allocation-rate view missing', () => {
        expect(isExpectedMissingTable('table with name "allocation-rate" does not exist')).toBe(true);
    });

    it('returns true for catalog error referencing GCHeapSummary', () => {
        expect(isExpectedMissingTable('Catalog Error: Table GCHeapSummary does not exist')).toBe(true);
    });

    it('returns false for ordinary missing table', () => {
        expect(isExpectedMissingTable('Table "events" does not exist')).toBe(false);
    });

    it('returns false for unrelated error', () => {
        expect(isExpectedMissingTable('Binder Error: Column "x" does not exist')).toBe(false);
    });
});

// ─── parseCandidateBindings ────────────────────────────────────────────────────

describe('parseCandidateBindings', () => {
    it('returns empty array for message with no candidates', () => {
        expect(parseCandidateBindings('Binder Error: Column "x" does not exist')).toEqual([]);
    });

    it('parses "Candidate bindings:" list', () => {
        const msg = 'Binder Error: Column "fo" does not exist\nCandidate bindings: "foo", "bar"';
        expect(parseCandidateBindings(msg)).toEqual(['foo', 'bar']);
    });

    it('parses "Nearby candidates:" list', () => {
        const msg = 'Binder Error: Column "fo" does not exist\nNearby candidates: "foo"';
        expect(parseCandidateBindings(msg)).toEqual(['foo']);
    });

    it('parses "Did you mean" suggestion', () => {
        const msg = 'Binder Error: Column "fo" does not exist\nDid you mean "foo"?';
        expect(parseCandidateBindings(msg)).toEqual(['foo']);
    });

    it('combines bindings and Did-you-mean without duplicates', () => {
        const msg = 'Candidate bindings: "foo"\nDid you mean "foo"?';
        const result = parseCandidateBindings(msg);
        expect(result).toEqual(['foo']);
    });

    it('handles multiple Did-you-mean suggestions', () => {
        const msg = 'Did you mean "col1"?\nDid you mean "col2"?';
        expect(parseCandidateBindings(msg)).toEqual(['col1', 'col2']);
    });
});
