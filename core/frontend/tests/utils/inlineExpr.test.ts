import { describe, it, expect } from 'vitest';
import { splitInlineExprs } from '../../utils/inlineExpr';
import type { ProseSegment } from '../../utils/inlineExpr';

// ─── basic splits ─────────────────────────────────────────────────────────────

describe('splitInlineExprs — basic', () => {
    it('returns empty array for empty string', () => {
        expect(splitInlineExprs('')).toEqual([]);
    });

    it('returns single text segment for plain prose', () => {
        expect(splitInlineExprs('Hello, world!')).toEqual([
            { type: 'text', value: 'Hello, world!' },
        ]);
    });

    it('returns single expr segment for bare expression', () => {
        const result = splitInlineExprs('${SELECT 1}');
        expect(result).toEqual([
            { type: 'expr', sql: 'SELECT 1' },
        ]);
    });

    it('splits text before expression', () => {
        const result = splitInlineExprs('Value: ${SELECT 42}');
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', value: 'Value: ' });
        expect(result[1]).toEqual({ type: 'expr', sql: 'SELECT 42' });
    });

    it('splits text after expression', () => {
        const result = splitInlineExprs('${SELECT 1} items');
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'expr', sql: 'SELECT 1' });
        expect(result[1]).toEqual({ type: 'text', value: ' items' });
    });

    it('splits text around multiple expressions', () => {
        const result = splitInlineExprs('a ${SELECT 1} b ${SELECT 2} c');
        expect(result).toHaveLength(5);
        expect(result[0]).toEqual({ type: 'text', value: 'a ' });
        expect(result[1]).toEqual({ type: 'expr', sql: 'SELECT 1' });
        expect(result[2]).toEqual({ type: 'text', value: ' b ' });
        expect(result[3]).toEqual({ type: 'expr', sql: 'SELECT 2' });
        expect(result[4]).toEqual({ type: 'text', value: ' c' });
    });
});

// ─── format hints ─────────────────────────────────────────────────────────────

describe('splitInlineExprs — format hints', () => {
    it('extracts accepted format from trailing | ident', () => {
        const result = splitInlineExprs('${SELECT bytes | bytes}');
        expect(result).toEqual([{ type: 'expr', sql: 'SELECT bytes', format: 'bytes' }]);
    });

    it('accepts all documented format keywords', () => {
        const formats = ['duration_ms', 'duration_ns', 'bytes', 'pct', 'int', 'float', 'time', 'raw'];
        for (const fmt of formats) {
            const result = splitInlineExprs(`\${SELECT v | ${fmt}}`);
            expect(result[0]).toMatchObject({ type: 'expr', format: fmt });
        }
    });

    it('does NOT treat unknown ident after | as format — leaves | in SQL', () => {
        const result = splitInlineExprs('${SELECT a | b WHERE 1}');
        const expr = result[0] as Extract<ProseSegment, { type: 'expr' }>;
        expect(expr.type).toBe('expr');
        expect(expr.format).toBeUndefined();
        // The pipe stays in the SQL as-is (bitwise-or semantics preserved)
        expect(expr.sql).toContain('|');
    });

    it('trims whitespace from sql and format', () => {
        const result = splitInlineExprs('${ SELECT 1  |  bytes  }');
        expect(result[0]).toMatchObject({ type: 'expr', sql: 'SELECT 1', format: 'bytes' });
    });
});

// ─── code span protection ─────────────────────────────────────────────────────

describe('splitInlineExprs — code span protection', () => {
    it('ignores ${…} inside single-backtick code span', () => {
        const result = splitInlineExprs('Use `${SELECT 1}` here');
        // The whole string should come back as a single text segment since
        // the ${…} is inside a code span
        const text = result.map(s => s.value ?? '').join('');
        expect(text).toContain('${SELECT 1}');
        // No expr segments
        expect(result.every(s => s.type === 'text')).toBe(true);
    });

    it('ignores ${…} inside triple-backtick fence', () => {
        const md = '```\n${SELECT 1}\n```';
        const result = splitInlineExprs(md);
        expect(result.every(s => s.type === 'text')).toBe(true);
    });

    it('resumes lexing after closing fence', () => {
        const md = '```\n${ignore}\n```\nAfter: ${SELECT 1}';
        const result = splitInlineExprs(md);
        const exprs = result.filter(s => s.type === 'expr');
        expect(exprs).toHaveLength(1);
        expect(exprs[0]).toMatchObject({ type: 'expr', sql: 'SELECT 1' });
    });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('splitInlineExprs — edge cases', () => {
    it('treats unclosed ${ as text from that point', () => {
        const result = splitInlineExprs('prefix ${unclosed');
        const reconstructed = result.map(s => 'value' in s ? s.value : '').join('');
        // The whole remaining string including ${ appears in text
        expect(reconstructed).toContain('${unclosed');
    });

    it('handles consecutive expressions without text between', () => {
        const result = splitInlineExprs('${SELECT 1}${SELECT 2}');
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ type: 'expr', sql: 'SELECT 1' });
        expect(result[1]).toMatchObject({ type: 'expr', sql: 'SELECT 2' });
    });

    it('handles newlines in text segments', () => {
        const result = splitInlineExprs('line1\nline2\n${SELECT 1}');
        expect(result[0]).toEqual({ type: 'text', value: 'line1\nline2\n' });
        expect(result[1]).toMatchObject({ type: 'expr', sql: 'SELECT 1' });
    });
});
