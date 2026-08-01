import { describe, it, expect } from 'vitest';
import { cellHandle, sanitizeForDuckDB, quoteIdent, quoteLiteral } from '../../utils/cellHandle';

describe('cellHandle', () => {
    it('returns name when cell has a non-empty name', () => {
        expect(cellHandle({ name: 'my_analysis' }, 0)).toBe('my_analysis');
    });

    it('trims whitespace from name', () => {
        expect(cellHandle({ name: '  gc_report  ' }, 0)).toBe('gc_report');
    });

    it('returns "cell_<1-based-index>" when name is empty', () => {
        expect(cellHandle({ name: '' }, 0)).toBe('cell_1');
        expect(cellHandle({ name: '' }, 2)).toBe('cell_3');
    });

    it('returns "cell_<1-based-index>" when name is whitespace-only', () => {
        expect(cellHandle({ name: '   ' }, 4)).toBe('cell_5');
    });

    it('returns "cell_<1-based-index>" when name is undefined', () => {
        expect(cellHandle({ name: undefined as any }, 0)).toBe('cell_1');
    });
});

describe('sanitizeForDuckDB', () => {
    it('replaces hyphens with underscores', () => {
        expect(sanitizeForDuckDB('my-cell-id')).toBe('my_cell_id');
    });

    it('strips characters that are not alphanumeric or underscore', () => {
        expect(sanitizeForDuckDB('hello.world!')).toBe('hello_world_');
    });

    it('preserves valid identifiers unchanged', () => {
        expect(sanitizeForDuckDB('cell_123_abc')).toBe('cell_123_abc');
    });

    it('handles empty string', () => {
        expect(sanitizeForDuckDB('')).toBe('');
    });
});

describe('quoteIdent', () => {
    it('wraps identifier in double quotes', () => {
        expect(quoteIdent('my_table')).toBe('"my_table"');
    });

    it('escapes embedded double quotes', () => {
        expect(quoteIdent('has"quote')).toBe('"has""quote"');
    });

    it('handles empty string', () => {
        expect(quoteIdent('')).toBe('""');
    });
});

describe('quoteLiteral', () => {
    it('wraps value in single quotes', () => {
        expect(quoteLiteral('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes', () => {
        expect(quoteLiteral("it's")).toBe("'it''s'");
    });

    it('handles empty string', () => {
        expect(quoteLiteral('')).toBe("''");
    });
});
