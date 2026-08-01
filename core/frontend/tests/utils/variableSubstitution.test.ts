import { describe, it, expect } from 'vitest';
import {
    substituteVariables,
    toSqlVariables,
    findRemainingVariables,
} from '../../utils/variableSubstitution';

// ─── substituteVariables ──────────────────────────────────────────────────────

describe('substituteVariables', () => {
    it('returns original string when variables map is empty', () => {
        expect(substituteVariables('SELECT $limit', {})).toBe('SELECT $limit');
    });

    it('substitutes a single variable', () => {
        expect(substituteVariables('SELECT $limit', { $limit: '100' })).toBe('SELECT 100');
    });

    it('substitutes variable stored without $ prefix', () => {
        expect(substituteVariables('SELECT $limit', { limit: '50' })).toBe('SELECT 50');
    });

    it('substitutes multiple occurrences', () => {
        expect(substituteVariables('$a + $a', { $a: '1' })).toBe('1 + 1');
    });

    it('substitutes multiple distinct variables', () => {
        expect(substituteVariables('$a + $b', { $a: '1', $b: '2' })).toBe('1 + 2');
    });

    it('does not substitute $v inside $v2 (right boundary)', () => {
        expect(substituteVariables('SELECT $v2', { $v: 'X' })).toBe('SELECT $v2');
    });

    it('does not substitute $x inside $$x (left boundary)', () => {
        expect(substituteVariables('WHERE $$x > 0', { $x: 'bad' })).toBe('WHERE $$x > 0');
    });

    it('substitutes $$global variable', () => {
        expect(substituteVariables('WHERE $$threshold > $val', { $$threshold: '100', $val: '5' }))
            .toBe('WHERE 100 > 5');
    });

    it('handles value containing $ without treating it as backreference', () => {
        expect(substituteVariables('SELECT $pat', { $pat: 'foo$1bar' })).toBe('SELECT foo$1bar');
    });

    it('handles value containing $& without treating it as backreference', () => {
        expect(substituteVariables('SELECT $pat', { $pat: '$&' })).toBe('SELECT $&');
    });

    it('resolves transitive references ($a = $b, $b = 2)', () => {
        const result = substituteVariables('$a', { $a: '$b', $b: '42' });
        expect(result).toBe('42');
    });

    it('leaves unresolved variables unchanged', () => {
        expect(substituteVariables('SELECT $missing', { $other: '1' })).toBe('SELECT $missing');
    });

    it('does not infinite-loop on cyclic references', () => {
        const result = substituteVariables('$a', { $a: '$b', $b: '$a' });
        // Should terminate and leave some $-reference intact
        expect(typeof result).toBe('string');
    });

    it('processes longer keys before shorter to avoid partial matches', () => {
        expect(substituteVariables('$foobar', { $foo: 'X', $foobar: 'Y' })).toBe('Y');
    });

    it('skips null/undefined values (does not substitute "null")', () => {
        const vars: Record<string, string> = { $x: null as any };
        expect(substituteVariables('$x', vars)).toBe('$x');
    });

    it('variable at end of string is substituted', () => {
        expect(substituteVariables('LIMIT $n', { $n: '10' })).toBe('LIMIT 10');
    });
});

// ─── toSqlVariables ───────────────────────────────────────────────────────────

describe('toSqlVariables', () => {
    it('passes through non-datetime values unchanged', () => {
        const result = toSqlVariables({ $limit: '100', $cause: 'GC' });
        expect(result['$limit']).toBe('100');
        expect(result['$cause']).toBe('GC');
    });

    it('wraps ISO datetime in single quotes', () => {
        const result = toSqlVariables({ $start: '2024-03-15T11:00' });
        expect(result['$start']).toBe("'2024-03-15T11:00'");
    });

    it('wraps ISO datetime with seconds', () => {
        const result = toSqlVariables({ $end: '2024-06-01T23:59:59' });
        expect(result['$end']).toBe("'2024-06-01T23:59:59'");
    });

    it('escapes embedded single quotes in datetime values', () => {
        // pathological case — single quote in datetime string
        const result = toSqlVariables({ $t: "2024-01-01T00:00'broken" });
        expect(result['$t']).toBe("'2024-01-01T00:00''broken'");
    });

    it('does not wrap plain date without T separator', () => {
        const result = toSqlVariables({ $d: '2024-03-15' });
        // ISO_DATETIME_RE requires the T and at least HH:mm
        expect(result['$d']).toBe('2024-03-15');
    });

    it('returns empty object for empty input', () => {
        expect(toSqlVariables({})).toEqual({});
    });

    it('skips null values', () => {
        const result = toSqlVariables({ $x: null as any });
        expect('$x' in result).toBe(false);
    });

    it('does not mutate the original object', () => {
        const original = { $start: '2024-01-01T00:00' };
        toSqlVariables(original);
        expect(original['$start']).toBe('2024-01-01T00:00');
    });
});

// ─── findRemainingVariables ───────────────────────────────────────────────────

describe('findRemainingVariables', () => {
    it('returns empty array for string with no $ tokens', () => {
        expect(findRemainingVariables('SELECT * FROM t WHERE x > 0')).toEqual([]);
    });

    it('finds a single $name token', () => {
        expect(findRemainingVariables('SELECT $limit')).toContain('$limit');
    });

    it('finds a $$global token', () => {
        expect(findRemainingVariables('WHERE $$threshold > 0')).toContain('$$threshold');
    });

    it('de-duplicates repeated tokens', () => {
        const result = findRemainingVariables('$a + $a + $b');
        expect(result.filter(t => t === '$a')).toHaveLength(1);
    });

    it('finds multiple distinct tokens', () => {
        const result = findRemainingVariables('$a + $b');
        expect(result).toContain('$a');
        expect(result).toContain('$b');
    });

    it('finds dotted-path variables ($sel.brush)', () => {
        const result = findRemainingVariables('WHERE x > $sel.brush');
        expect(result).toContain('$sel.brush');
    });

    it('finds multi-segment paths ($Overview.start)', () => {
        const result = findRemainingVariables('WHERE t > $Overview.start');
        expect(result).toContain('$Overview.start');
    });

    it('returns empty array for already-substituted SQL', () => {
        expect(findRemainingVariables('SELECT * FROM t WHERE x > 100')).toEqual([]);
    });
});
