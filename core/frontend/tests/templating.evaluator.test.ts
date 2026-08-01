import { describe, it, expect } from 'vitest';
import { splitInlineExprs } from '../utils/inlineExpr';
import { formatValue } from '../services/templating/formatValue';
import { evaluateCondition, evaluateScalar } from '../services/templating/evaluators';
import { tokenizeCellContent, reconstructCellContent } from '../utils/notebookParser';

describe('splitInlineExprs', () => {
    it('returns a single text segment when no `${...}`', () => {
        expect(splitInlineExprs('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
    });

    it('extracts a single inline expression', () => {
        const r = splitInlineExprs('Total: ${SELECT count(*) FROM gc}.');
        expect(r).toEqual([
            { type: 'text', value: 'Total: ' },
            { type: 'expr', sql: 'SELECT count(*) FROM gc', format: undefined },
            { type: 'text', value: '.' },
        ]);
    });

    it('extracts a format hint from `| <ident>`', () => {
        const r = splitInlineExprs('Max: ${SELECT max(d) FROM gc | duration_ms}.');
        expect(r[1]).toEqual({ type: 'expr', sql: 'SELECT max(d) FROM gc', format: 'duration_ms' });
    });

    it('treats `| bitwise_or_expr` as SQL (unknown format)', () => {
        const r = splitInlineExprs('${SELECT a | b FROM t}');
        expect(r[0]).toEqual({ type: 'expr', sql: 'SELECT a | b FROM t', format: undefined });
    });

    it('ignores ${...} inside an inline code span', () => {
        const r = splitInlineExprs('use `${SELECT 1}` in prose');
        expect(r).toHaveLength(1);
        expect(r[0]).toEqual({ type: 'text', value: 'use `${SELECT 1}` in prose' });
    });

    it('ignores ${...} inside a triple-backtick fence', () => {
        const md = 'before\n```\n${SELECT 1}\n```\nafter ${SELECT 2}';
        const r = splitInlineExprs(md);
        const exprs = r.filter(s => s.type === 'expr');
        expect(exprs).toHaveLength(1);
        expect((exprs[0] as any).sql).toBe('SELECT 2');
    });

    it('handles a malformed unclosed expression by emitting it as text', () => {
        const r = splitInlineExprs('oops: ${SELECT 1 no close');
        expect(r).toEqual([
            { type: 'text', value: 'oops: ' },
            { type: 'text', value: '${SELECT 1 no close' },
        ]);
    });

    it('ignores ${...} inside a double-backtick code span', () => {
        const r = splitInlineExprs('see ``${SELECT 1}`` inline');
        expect(r).toHaveLength(1);
        expect(r[0]).toEqual({ type: 'text', value: 'see ``${SELECT 1}`` inline' });
    });

    it('returns [] for empty string input', () => {
        expect(splitInlineExprs('')).toEqual([]);
    });

    it('handles multiple adjacent expressions with no text between', () => {
        const r = splitInlineExprs('${SELECT 1}${SELECT 2}');
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ type: 'expr', sql: 'SELECT 1' });
        expect(r[1]).toMatchObject({ type: 'expr', sql: 'SELECT 2' });
    });

    it('accepts all known format hints', () => {
        const formats = ['duration_ms', 'duration_ns', 'bytes', 'pct', 'int', 'float', 'time', 'raw'];
        for (const fmt of formats) {
            const r = splitInlineExprs(`\${SELECT 1 | ${fmt}}`);
            expect(r[0]).toMatchObject({ type: 'expr', format: fmt });
        }
    });
});

describe('tokenizeCellContent — `{if ...}` fences', () => {
    it('recognizes `{if <sql>}` fences and round-trips them', () => {
        const md = '```{if SELECT 1 > 0}\nshown when true\n```';
        const segs = tokenizeCellContent(md);
        expect(segs).toHaveLength(1);
        expect(segs[0]).toEqual({
            type: 'if',
            condition: 'SELECT 1 > 0',
            body: '\nshown when true\n',
        });
        expect(reconstructCellContent(segs)).toBe(md);
    });

    it('mixes plain markdown and an `{if ...}` block', () => {
        const md = '# Title\n\n```{if SELECT max(d) > $$t FROM gc}\n### Long pauses\n```\n\nfooter';
        const segs = tokenizeCellContent(md);
        // [markdown, if, markdown]
        expect(segs.map(s => s.type)).toEqual(['markdown', 'if', 'markdown']);
        expect(reconstructCellContent(segs)).toBe(md);
    });
});

describe('formatValue', () => {
    it('returns em dash for null', () => {
        expect(formatValue(null, undefined, {})).toBe('—');
    });

    it('formats bytes', () => {
        expect(formatValue(1024, 'bytes', {})).toMatch(/KiB/);
        expect(formatValue(0, 'bytes', {})).toBe('0 B');
    });

    it('formats duration_ms across magnitudes', () => {
        expect(formatValue(500, 'duration_ms', {})).toBe('500 ms');
        expect(formatValue(2_000, 'duration_ms', {})).toBe('2.00 s');
        expect(formatValue(0.5, 'duration_ms', {})).toBe('500 µs');
    });

    it('formats pct as percentage', () => {
        expect(formatValue(0.5, 'pct', {})).toBe('50.00%');
    });

    it('uses decimalPlaces for float', () => {
        expect(formatValue(3.14159, 'float', { decimalPlaces: 3 })).toBe('3.142');
    });

    it('infers int format for integer values', () => {
        expect(formatValue(1234, undefined, {})).toBe('1,234');
    });

    it("honors 'raw' format", () => {
        expect(formatValue({ a: 1 }, 'raw', {})).toBe('{"a":1}');
    });
});

describe('evaluateCondition', () => {
    it('returns true for a truthy first scalar', async () => {
        const q = async () => [{ x: 1 }];
        await expect(evaluateCondition(q, 'SELECT 1')).resolves.toEqual({ kind: 'ok', value: true });
    });

    it('returns false for 0', async () => {
        const q = async () => [{ x: 0 }];
        await expect(evaluateCondition(q, 'SELECT 0')).resolves.toEqual({ kind: 'ok', value: false });
    });

    it('returns false for empty result set', async () => {
        const q = async () => [];
        await expect(evaluateCondition(q, 'SELECT 1')).resolves.toEqual({ kind: 'ok', value: false });
    });

    it('surfaces errors', async () => {
        const q = async () => { throw new Error('parse fail'); };
        await expect(evaluateCondition(q, 'BAD SQL')).resolves.toEqual({
            kind: 'error', message: 'parse fail',
        });
    });

    it('treats string "false" as false', async () => {
        const q = async () => [{ x: 'false' }];
        await expect(evaluateCondition(q, "SELECT 'false'")).resolves.toEqual({ kind: 'ok', value: false });
    });
});

describe('evaluateScalar', () => {
    it('returns the first scalar', async () => {
        const q = async () => [{ count: 42 }];
        await expect(evaluateScalar(q, 'SELECT count(*) FROM t')).resolves.toEqual({
            kind: 'ok', value: 42,
        });
    });

    it('returns empty for 0 rows', async () => {
        const q = async () => [];
        await expect(evaluateScalar(q, 'SELECT 1 WHERE false')).resolves.toEqual({ kind: 'empty' });
    });
});
