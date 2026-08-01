import { describe, it, expect } from 'vitest';
import { wrap, truncate, VALID_FOR_IDENT, VALID_FOR_DOLLAR, VALID_FOR_AT } from '../../../../../components/editor/sql/completion/helpers';

// ── wrap ──────────────────────────────────────────────────────────────────────

describe('wrap', () => {
    it('returns the name unquoted when force=false and name is a bare identifier', () => {
        expect(wrap('column_name', false)).toBe('column_name');
        expect(wrap('_name', false)).toBe('_name');
        expect(wrap('abc123', false)).toBe('abc123');
    });

    it('double-quotes the name when force=false and name contains special chars', () => {
        expect(wrap('my column', false)).toBe('"my column"');
        expect(wrap('count(*)', false)).toBe('"count(*)"');
        expect(wrap('col-name', false)).toBe('"col-name"');
    });

    it('double-quotes numeric-leading names when force=false', () => {
        expect(wrap('123abc', false)).toBe('"123abc"');
    });

    it('always double-quotes when force=true regardless of content', () => {
        expect(wrap('plain', true)).toBe('"plain"');
        expect(wrap('already_bare', true)).toBe('"already_bare"');
    });

    it('returns empty string unquoted when force=false', () => {
        // Empty string fails /^[a-zA-Z_]\w*$/ so it gets quoted
        expect(wrap('', false)).toBe('""');
    });
});

// ── truncate ──────────────────────────────────────────────────────────────────

describe('truncate', () => {
    it('returns the string unchanged when it is shorter than max', () => {
        expect(truncate('hello', 10)).toBe('hello');
    });

    it('returns the string unchanged when it equals max', () => {
        expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates and appends ellipsis when string exceeds max', () => {
        const result = truncate('hello world', 5);
        expect(result).toBe('hello…');
        expect(result.length).toBe(6); // 5 chars + 1 ellipsis char
    });

    it('truncates to 0 chars with just an ellipsis when max=0', () => {
        expect(truncate('hi', 0)).toBe('…');
    });

    it('handles empty string', () => {
        expect(truncate('', 5)).toBe('');
    });
});

// ── VALID_FOR_* regexes ───────────────────────────────────────────────────────

describe('VALID_FOR_IDENT', () => {
    it('matches bare identifiers', () => {
        expect(VALID_FOR_IDENT.test('col')).toBe(true);
        expect(VALID_FOR_IDENT.test('my_col')).toBe(true);
        expect(VALID_FOR_IDENT.test('')).toBe(true);
    });

    it('matches a partial quoted identifier starting with "', () => {
        expect(VALID_FOR_IDENT.test('"col')).toBe(true);
    });

    it('does not match identifiers containing dots or hyphens', () => {
        expect(VALID_FOR_IDENT.test('a.b')).toBe(false);
        expect(VALID_FOR_IDENT.test('col-name')).toBe(false);
    });
});

describe('VALID_FOR_DOLLAR', () => {
    it('matches $ and $$ variable prefixes', () => {
        expect(VALID_FOR_DOLLAR.test('$var')).toBe(true);
        expect(VALID_FOR_DOLLAR.test('$$var')).toBe(true);
        expect(VALID_FOR_DOLLAR.test('$')).toBe(true);
        expect(VALID_FOR_DOLLAR.test('$$')).toBe(true);
    });

    it('matches dotted dollar variables', () => {
        expect(VALID_FOR_DOLLAR.test('$scope.name')).toBe(true);
    });

    it('does not match bare identifiers without $', () => {
        expect(VALID_FOR_DOLLAR.test('var')).toBe(false);
    });
});

describe('VALID_FOR_AT', () => {
    it('matches @ variable prefix', () => {
        expect(VALID_FOR_AT.test('@var')).toBe(true);
        expect(VALID_FOR_AT.test('@')).toBe(true);
    });

    it('matches @ variables with hyphens', () => {
        expect(VALID_FOR_AT.test('@my-var')).toBe(true);
    });

    it('does not match bare strings without @', () => {
        expect(VALID_FOR_AT.test('var')).toBe(false);
    });
});
