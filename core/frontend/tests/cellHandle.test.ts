import { describe, it, expect } from 'vitest';
import { cellHandle, sanitizeForDuckDB, quoteIdent, quoteLiteral } from '../utils/cellHandle';

describe('cellHandle', () => {
    it('returns the name when present', () => {
        expect(cellHandle({ name: 'gc-overview' }, 0)).toBe('gc-overview');
    });

    it('falls back to cell_<1-based-index>', () => {
        expect(cellHandle({}, 0)).toBe('cell_1');
        expect(cellHandle({}, 2)).toBe('cell_3');
    });

    it('treats whitespace-only names as missing', () => {
        expect(cellHandle({ name: '   ' }, 5)).toBe('cell_6');
    });

    it('trims surrounding whitespace from names', () => {
        expect(cellHandle({ name: '  foo  ' }, 0)).toBe('foo');
    });
});

describe('sanitizeForDuckDB', () => {
    it('replaces hyphens with underscores', () => {
        expect(sanitizeForDuckDB('gc-overview')).toBe('gc_overview');
    });

    it('keeps letters, digits, and underscores intact', () => {
        expect(sanitizeForDuckDB('cell_1_abc')).toBe('cell_1_abc');
    });

    it('strips special characters to underscores', () => {
        expect(sanitizeForDuckDB('a.b!c')).toBe('a_b_c');
    });
});

describe('quoteIdent', () => {
    it('wraps in double quotes', () => {
        expect(quoteIdent('foo')).toBe('"foo"');
    });
    it('escapes embedded double quotes', () => {
        expect(quoteIdent('foo"bar')).toBe('"foo""bar"');
    });
});

describe('quoteLiteral', () => {
    it('wraps a plain value in single quotes', () => {
        expect(quoteLiteral('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes by doubling them', () => {
        expect(quoteLiteral("it's")).toBe("'it''s'");
    });

    it('handles multiple embedded single quotes', () => {
        expect(quoteLiteral("a'b'c")).toBe("'a''b''c'");
    });

    it('handles an empty string', () => {
        expect(quoteLiteral('')).toBe("''");
    });
});
