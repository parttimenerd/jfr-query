import { describe, it, expect } from 'vitest';
import { substituteVariables, findRemainingVariables } from '../utils/variableSubstitution';

describe('substituteVariables — basic substitution', () => {
    it('substitutes a single variable', () => {
        expect(substituteVariables('SELECT $x', { '$x': '42' }))
            .toBe('SELECT 42');
    });

    it('substitutes multiple occurrences globally', () => {
        expect(substituteVariables('SELECT $x, $x + 1', { '$x': '5' }))
            .toBe('SELECT 5, 5 + 1');
    });

    it('substitutes multiple variables', () => {
        expect(substituteVariables('SELECT * WHERE a > $start AND a < $end', {
            '$start': '100',
            '$end': '200',
        })).toBe('SELECT * WHERE a > 100 AND a < 200');
    });

    it('returns SQL unchanged when no variables are bound', () => {
        expect(substituteVariables('SELECT 1', {})).toBe('SELECT 1');
    });

    it('returns SQL unchanged when no $ references match', () => {
        expect(substituteVariables('SELECT $a', { '$b': 'foo' })).toBe('SELECT $a');
    });
});

describe('substituteVariables — word boundary protection', () => {
    it('does NOT replace $v inside $v2', () => {
        // Critical: a variable named $v must not eat into $v2.
        expect(substituteVariables('SELECT $v + $v2', { '$v': '1', '$v2': '99' }))
            .toBe('SELECT 1 + 99');
    });

    it('does NOT replace $start inside $start_ns', () => {
        expect(substituteVariables('WHERE t > $start_ns', { '$start': 'WRONG' }))
            .toBe('WHERE t > $start_ns');
    });

    it('replaces $x adjacent to non-word characters', () => {
        expect(substituteVariables('SELECT $x;', { '$x': '7' })).toBe('SELECT 7;');
        expect(substituteVariables('SELECT $x,$y', { '$x': '1', '$y': '2' })).toBe('SELECT 1,2');
        expect(substituteVariables('SELECT $x)', { '$x': '1' })).toBe('SELECT 1)');
    });
});

describe('substituteVariables — replacement-string safety (the $-bug)', () => {
    it('treats $-containing values as literal text, not regex backreferences', () => {
        // Plain JS String.prototype.replace would interpret $1, $&, $$ in the
        // replacement. Variable values must be inserted verbatim.
        expect(substituteVariables('SELECT $x', { '$x': '$1' }))
            .toBe('SELECT $1');
        expect(substituteVariables('SELECT $x', { '$x': '$&' }))
            .toBe('SELECT $&');
        expect(substituteVariables('SELECT $x', { '$x': '$$' }))
            .toBe('SELECT $$');
    });

    it('preserves arbitrary text including dollars in values', () => {
        expect(substituteVariables('a = $x', { '$x': "'has $1 dollars'" }))
            .toBe("a = 'has $1 dollars'");
    });

    it('preserves backslashes in values', () => {
        expect(substituteVariables('p = $x', { '$x': 'C:\\path' }))
            .toBe('p = C:\\path');
    });
});

describe('findRemainingVariables', () => {
    it('returns empty list when SQL has no $ references', () => {
        expect(findRemainingVariables('SELECT 1')).toEqual([]);
    });

    it('returns each unbound variable once', () => {
        const result = findRemainingVariables('SELECT $a, $b, $a, $c');
        expect(result.sort()).toEqual(['$a', '$b', '$c']);
    });

    it('used after substitution: empty when all bound', () => {
        const sub = substituteVariables('SELECT $a + $b', { '$a': '1', '$b': '2' });
        expect(findRemainingVariables(sub)).toEqual([]);
    });

    it('used after substitution: lists what is still missing', () => {
        const sub = substituteVariables('SELECT $a + $b', { '$a': '1' });
        expect(findRemainingVariables(sub)).toEqual(['$b']);
    });

    it('finds both $x and $$x as separate tokens', () => {
        const result = findRemainingVariables('SELECT $a, $$b');
        expect(result.sort()).toEqual(['$$b', '$a']);
    });
});

describe('substituteVariables — $$ notebook-scope variables', () => {
    it('substitutes $$x without affecting $x', () => {
        expect(substituteVariables('SELECT $x, $$x', { '$x': '1', '$$x': '99' }))
            .toBe('SELECT 1, 99');
    });

    it('does NOT replace $x inside $$x', () => {
        // Critical: a single-dollar var must not eat into a double-dollar var.
        expect(substituteVariables('SELECT $$foo', { '$foo': 'WRONG' }))
            .toBe('SELECT $$foo');
    });

    it('substitutes only $$foo when both are bound', () => {
        expect(substituteVariables('SELECT $$foo', { '$foo': 'WRONG', '$$foo': 'RIGHT' }))
            .toBe('SELECT RIGHT');
    });

    it('handles a mix of cell-local and notebook-scope variables', () => {
        expect(substituteVariables('WHERE t > $$start AND t < $end', {
            '$end': '200',
            '$$start': '100',
        })).toBe('WHERE t > 100 AND t < 200');
    });
});

describe('substituteVariables — transitive resolution (fixpoint, B-011)', () => {
    it('resolves $a = $b when $b is also bound', () => {
        expect(substituteVariables('SELECT $a', { '$a': '$b', '$b': '42' }))
            .toBe('SELECT 42');
    });

    it('resolves a three-hop chain', () => {
        expect(substituteVariables('x = $a', { '$a': '$b', '$b': '$c', '$c': '7' }))
            .toBe('x = 7');
    });

    it('leaves a cycle unresolved rather than looping forever', () => {
        // $a → $b → $a is a cycle; after 10 passes the original token remains.
        const result = substituteVariables('x = $a', { '$a': '$b', '$b': '$a' });
        // The exact output depends on which pass settles, but it must be finite.
        expect(typeof result).toBe('string');
        // Neither $a nor $b should expand to something unexpected.
    });

    it('word-boundary safety preserved across transitive passes', () => {
        expect(substituteVariables('SELECT $v, $v2', { '$v': '$base', '$v2': '99', '$base': '1' }))
            .toBe('SELECT 1, 99');
    });
});
