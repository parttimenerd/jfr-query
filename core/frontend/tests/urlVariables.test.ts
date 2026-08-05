import { describe, it, expect } from 'vitest';

// Extract the URL var parsing logic to test it independently.
function parseUrlVars(searchString: string): Record<string, string> {
    const params = new URLSearchParams(searchString);
    const urlVars: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        if (key.startsWith('var.')) {
            const varName = key.slice(4);
            urlVars[varName.startsWith('$') ? varName : `$${varName}`] = value;
        }
    }
    return urlVars;
}

describe('URL variable parameters', () => {
    it('parses ?var.n=50 to $n=50', () => {
        const result = parseUrlVars('var.n=50');
        expect(result['$n']).toBe('50');
    });

    it('parses ?var.$n=50 (with dollar sign) to $n=50', () => {
        const result = parseUrlVars('var.$n=50');
        expect(result['$n']).toBe('50');
    });

    it('parses multiple vars', () => {
        const result = parseUrlVars('var.start=2024-01-01&var.end=2024-12-31');
        expect(result['$start']).toBe('2024-01-01');
        expect(result['$end']).toBe('2024-12-31');
    });

    it('ignores non-var params', () => {
        const result = parseUrlVars('notebook=foo&var.n=10&run=true');
        expect(Object.keys(result)).toEqual(['$n']);
        expect(result['$n']).toBe('10');
    });

    it('returns empty object when no var params', () => {
        const result = parseUrlVars('notebook=foo&run=true');
        expect(result).toEqual({});
    });
});
