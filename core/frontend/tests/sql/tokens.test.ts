import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeSignificant, isKeyword, isPunct, type Token } from '../../components/editor/sql/tokens';

// Helper: significant tokens only (drop whitespace + comments + eof) and
// stringify as "kind:value" so we can write compact expectations.
function sig(input: string): string[] {
    return tokenize(input)
        .filter(t => t.kind !== 'whitespace' && t.kind !== 'comment' && t.kind !== 'eof')
        .map(t => `${t.kind}:${t.value}`);
}

describe('tokenize — basic', () => {
    it('emits an EOF sentinel for empty input', () => {
        const ts = tokenize('');
        expect(ts).toHaveLength(1);
        expect(ts[0].kind).toBe('eof');
        expect(ts[0].from).toBe(0);
        expect(ts[0].to).toBe(0);
    });

    it('keyword tokens carry uppercase canonical value', () => {
        const ts = tokenizeSignificant('Select FROM where');
        expect(ts.map(t => `${t.kind}:${t.value}`)).toEqual([
            'keyword:SELECT', 'keyword:FROM', 'keyword:WHERE', 'eof:',
        ]);
    });

    it('non-keyword bare words become idents', () => {
        expect(sig('foo bar_baz _x x1')).toEqual([
            'ident:foo', 'ident:bar_baz', 'ident:_x', 'ident:x1',
        ]);
    });

    it('preserves identifier case', () => {
        const ts = tokenizeSignificant('ActiveRecording.eventType');
        expect(ts[0].value).toBe('ActiveRecording');
        expect(ts[2].value).toBe('eventType');
    });
});

describe('tokenize — strings and idents', () => {
    it('single-quoted strings include the quotes in text/value', () => {
        expect(sig("a = 'hello'")).toEqual([
            'ident:a', 'op:=', "string:'hello'",
        ]);
    });

    it("doubles up '' inside single-quoted strings", () => {
        expect(sig("'it''s fine'")).toEqual(["string:'it''s fine'"]);
    });

    it('unterminated string consumes to end-of-input', () => {
        const ts = tokenize("'oops");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'oops");
        expect(ts[0].to).toBe(5);
    });

    it('quoted identifiers preserve case and spaces', () => {
        const ts = tokenizeSignificant('"My Col" + 1');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].value).toBe('"My Col"');
    });

    it('quoted identifier with escaped quotes', () => {
        const ts = tokenizeSignificant('"a""b"');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"a""b"');
    });
});

describe('tokenize — numbers', () => {
    it('integer', () => {
        expect(sig('42')).toEqual(['number:42']);
    });

    it('decimal', () => {
        expect(sig('3.14')).toEqual(['number:3.14']);
    });

    it('leading-dot decimal', () => {
        expect(sig('.5')).toEqual(['number:.5']);
    });

    it('scientific notation', () => {
        expect(sig('1.5e-3')).toEqual(['number:1.5e-3']);
        expect(sig('2E10')).toEqual(['number:2E10']);
    });

    it('hex literal', () => {
        expect(sig('0xFF')).toEqual(['number:0xFF']);
    });

    it('digit grouping with underscores', () => {
        expect(sig('1_000_000')).toEqual(['number:1_000_000']);
    });

    it('lone dot is punctuation, not a number', () => {
        expect(sig('a.b')).toEqual(['ident:a', 'punct:.', 'ident:b']);
    });
});

describe('tokenize — operators and punctuation', () => {
    it('binary operators', () => {
        expect(sig('a + b - c * d / e % f')).toEqual([
            'ident:a', 'op:+', 'ident:b', 'op:-', 'ident:c',
            'op:*', 'ident:d', 'op:/', 'ident:e', 'op:%', 'ident:f',
        ]);
    });

    it('comparison operators (longest-first match)', () => {
        expect(sig('<= < >= > <> != =')).toEqual([
            'op:<=', 'op:<', 'op:>=', 'op:>', 'op:<>', 'op:!=', 'op:=',
        ]);
    });

    it('cast operator ::', () => {
        expect(sig("x::INTEGER")).toEqual([
            'ident:x', 'cast:::', 'keyword:INTEGER',
        ]);
    });

    it('concat ||', () => {
        expect(sig("'a' || 'b'")).toEqual(["string:'a'", 'concat:||', "string:'b'"]);
    });

    it('lambda arrow -> and =>', () => {
        expect(sig('x -> x+1')).toEqual([
            'ident:x', 'arrow:->', 'ident:x', 'op:+', 'number:1',
        ]);
        expect(sig('(x) => x')).toEqual([
            'punct:(', 'ident:x', 'punct:)', 'arrow:=>', 'ident:x',
        ]);
    });

    it('punctuation: parens, commas, semicolons, brackets', () => {
        expect(sig('f(a, b); [1, 2]')).toEqual([
            'ident:f', 'punct:(', 'ident:a', 'punct:,', 'ident:b', 'punct:)',
            'punct:;', 'punct:[', 'number:1', 'punct:,', 'number:2', 'punct:]',
        ]);
    });
});

describe('tokenize — comments and whitespace', () => {
    it('line comment runs to newline, not past it', () => {
        const ts = tokenize('a -- comment\nb');
        const kinds = ts.map(t => t.kind);
        expect(kinds).toContain('comment');
        const comment = ts.find(t => t.kind === 'comment')!;
        expect(comment.text).toBe('-- comment');
    });

    it('block comment /* ... */', () => {
        const ts = tokenize('a /* hi */ b');
        const c = ts.find(t => t.kind === 'comment')!;
        expect(c.text).toBe('/* hi */');
    });

    it('unterminated block comment consumes to EOF', () => {
        const ts = tokenize('/* oops');
        expect(ts[0].kind).toBe('comment');
        expect(ts[0].to).toBe(7);
    });

    it('tokenizeSignificant strips whitespace and comments', () => {
        const ts = tokenizeSignificant('SELECT 1 -- c\n  FROM t');
        expect(ts.map(t => t.value)).toEqual(['SELECT', '1', 'FROM', 't', '']);
    });
});

describe('tokenize — dollar refs', () => {
    it('plain $var', () => {
        const ts = tokenizeSignificant('$foo');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].value).toBe('$foo');
    });

    it('double $$var', () => {
        const ts = tokenizeSignificant('$$foo');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].value).toBe('$$foo');
    });

    it('dotted brush ref $plot.brush', () => {
        const ts = tokenizeSignificant('$plot.brush');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].value).toBe('$plot.brush');
    });
});

describe('tokenize — round-trip span coverage', () => {
    // Every token's text must match the source slice at [from, to). This is
    // the contract the parser relies on for producing node.text from spans.
    const samples = [
        'SELECT 1',
        'SELECT * FROM t WHERE x = $foo',
        "SELECT count(*) FILTER (WHERE x > 0) FROM t",
        "WITH RECURSIVE foo(n) AS (SELECT 1 UNION SELECT n+1 FROM foo) SELECT * FROM foo",
        "x::INTEGER + y::DOUBLE",
        "'a' || 'b' || c",
        "/* hdr */\n-- line\nSELECT 1",
        "list_transform(xs, x -> x * 2)",
        '"My Col" / 2.5e10',
        "COLUMNS('amount.*')",
    ];

    for (const s of samples) {
        it(`spans cover source for: ${JSON.stringify(s).slice(0, 50)}`, () => {
            const ts = tokenize(s);
            for (const t of ts) {
                if (t.kind === 'eof') {
                    expect(t.from).toBe(s.length);
                    expect(t.to).toBe(s.length);
                } else {
                    expect(s.slice(t.from, t.to)).toBe(t.text);
                }
            }
            // Last non-eof token's `to` plus any trailing whitespace = s.length.
            // Simpler invariant: tokens cover the input without gaps.
            const nonEof = ts.filter(t => t.kind !== 'eof');
            let cursor = 0;
            for (const t of nonEof) {
                expect(t.from).toBe(cursor);
                cursor = t.to;
            }
            expect(cursor).toBe(s.length);
        });
    }
});

describe('helpers', () => {
    it('isKeyword matches case-insensitively against canonical', () => {
        const t: Token = { kind: 'keyword', text: 'select', value: 'SELECT', from: 0, to: 6 };
        expect(isKeyword(t, 'select')).toBe(true);
        expect(isKeyword(t, 'SELECT')).toBe(true);
        expect(isKeyword(t, 'from')).toBe(false);
    });

    it('isPunct matches exact char', () => {
        const t: Token = { kind: 'punct', text: '(', value: '(', from: 0, to: 1 };
        expect(isPunct(t, '(')).toBe(true);
        expect(isPunct(t, ')')).toBe(false);
    });
});
