import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeSignificant, isKeyword, isPunct, KEYWORDS, type Token } from '../../components/editor/sql/tokens';

// ----- shared helpers -----

function kinds(s: string): string[] {
    return tokenize(s).filter(t => t.kind !== 'eof').map(t => t.kind);
}

function sig(input: string): string[] {
    return tokenize(input)
        .filter(t => t.kind !== 'whitespace' && t.kind !== 'comment' && t.kind !== 'eof')
        .map(t => `${t.kind}:${t.value}`);
}

// Asserts the core tokenizer contract: every non-EOF token's text matches the
// source slice [from, to), tokens cover the input gaplessly, and EOF sits at
// [length, length).
function assertCoverage(s: string): void {
    const ts = tokenize(s);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[ts.length - 1].kind).toBe('eof');
    expect(ts[ts.length - 1].from).toBe(s.length);
    expect(ts[ts.length - 1].to).toBe(s.length);
    let cursor = 0;
    for (const t of ts) {
        if (t.kind === 'eof') continue;
        expect(s.slice(t.from, t.to)).toBe(t.text);
        expect(t.from).toBe(cursor);
        expect(t.to).toBeGreaterThanOrEqual(t.from);
        cursor = t.to;
    }
    expect(cursor).toBe(s.length);
}

// =========================================================================
// COVERAGE INVARIANTS — broad fuzz-like sweep across many SQL shapes
// =========================================================================

describe('tokenize coverage invariant — gapless spans + text matches slice', () => {
    const samples: string[] = [
        // Empty / whitespace-only
        '',
        ' ',
        '\n',
        '\r\n',
        '\t  \n\r',
        '   \n  ',

        // Comment-only
        '--',
        '-- nothing',
        '-- nothing\n',
        '/* */',
        '/**/',
        '/*',
        '/*****/',

        // Real-ish DuckDB queries
        'SELECT 1',
        'SELECT 1;',
        'SELECT 1; SELECT 2;',
        'SELECT * FROM t WHERE x = $foo AND y < 100',
        "SELECT count(*) FILTER (WHERE x > 0) FROM t",
        "WITH RECURSIVE foo(n) AS (SELECT 1 UNION SELECT n+1 FROM foo) SELECT * FROM foo",
        "SELECT list_transform([1,2,3], x -> x * 2)",
        "SELECT a, b::INTEGER, c::DOUBLE FROM mytable",
        "SELECT t.* EXCLUDE (private) REPLACE (upper(name) AS name) FROM t",
        "SELECT 'a' || 'b' || c FROM t",
        "SELECT COLUMNS('amount.*') FROM t PIVOT (sum(amount) FOR month IN ('jan','feb'))",

        // Broken / partial inputs that the parser will see during typing
        'SELECT ',
        'SELECT *',
        'SELECT * FRO',
        'SELECT * FROM',
        'SELECT * FROM t WHERE',
        'SELECT 1 +',
        'SELECT (',
        "SELECT 'unterm",
        'SELECT "ident',
        'WITH foo AS (SELECT',

        // Malformed
        '????',
        '@@@@',
        '\\\\\\',
        '   $   ',
        '...',

        // Unicode and high-bit content
        'SELECT é FROM t',
        'SELECT 你好 FROM 表',
        'SELECT "𝕏" FROM t',  // astral plane inside quoted ident

        // Very long input (10k chars)
        'a '.repeat(5000),

        // Mixed comment + code
        '/* hdr */\n-- line\nSELECT 1',
        '/* a */ /* b */ -- c',
        'a-->b',           // looks like an arrow but the second `-` starts a line comment
    ];

    for (const s of samples) {
        const label = JSON.stringify(s).slice(0, 60);
        it(`covers source: ${label}`, () => assertCoverage(s));
    }
});

// =========================================================================
// NUMBERS
// =========================================================================

describe('tokenize — numbers (edge cases)', () => {
    it('"1e" with no exponent digits still produces a single number token', () => {
        expect(sig('1e')).toEqual(['number:1e']);
        assertCoverage('1e');
    });

    it('"1e+" with sign but no digits is still one number token', () => {
        expect(sig('1e+')).toEqual(['number:1e+']);
        assertCoverage('1e+');
    });

    it('"1." trailing dot is part of the number', () => {
        expect(sig('1.')).toEqual(['number:1.']);
        assertCoverage('1.');
    });

    it('".5e" leading-dot with no exponent digit is one number', () => {
        expect(sig('.5e')).toEqual(['number:.5e']);
        assertCoverage('.5e');
    });

    it('"0x" alone is a number (hex with no digits)', () => {
        expect(sig('0x')).toEqual(['number:0x']);
        assertCoverage('0x');
    });

    it('"0xZZ" only consumes "0x" then ZZ is an ident', () => {
        expect(sig('0xZZ')).toEqual(['number:0x', 'ident:ZZ']);
    });

    it('"1e1e1" is "1e1" then ident "e1"', () => {
        expect(sig('1e1e1')).toEqual(['number:1e1', 'ident:e1']);
    });

    it('"1..5" produces two numbers "1." and ".5"', () => {
        expect(sig('1..5')).toEqual(['number:1.', 'number:.5']);
    });

    it('"3..5" produces two numbers "3." and ".5"', () => {
        expect(sig('3..5')).toEqual(['number:3.', 'number:.5']);
    });

    it('"3.0.5" produces "3.0" then ".5"', () => {
        expect(sig('3.0.5')).toEqual(['number:3.0', 'number:.5']);
    });

    it('"12.34.56" produces "12.34" then ".56"', () => {
        expect(sig('12.34.56')).toEqual(['number:12.34', 'number:.56']);
    });

    it('leading zeros are kept as part of the integer', () => {
        expect(sig('00123')).toEqual(['number:00123']);
    });

    it('hex with underscores is one number', () => {
        expect(sig('0xABC_DEF')).toEqual(['number:0xABC_DEF']);
        expect(sig('0xff_aa_bb')).toEqual(['number:0xff_aa_bb']);
    });

    it('uppercase 0X hex prefix is accepted', () => {
        expect(sig('0X10')).toEqual(['number:0X10']);
    });

    it('hex followed by dot does NOT extend into a decimal', () => {
        // 0xFF.AA -> number "0xFF" then punct "." then ident "AA"
        expect(sig('0xFF.AA')).toEqual(['number:0xFF', 'punct:.', 'ident:AA']);
    });

    it('"0x1.5" -> "0x1" then ".5" (no decimals on hex)', () => {
        expect(sig('0x1.5')).toEqual(['number:0x1', 'number:.5']);
    });

    it('"1.e" still parses as one number (e with no digit)', () => {
        expect(sig('1.e')).toEqual(['number:1.e']);
    });

    it('".e5" — leading "." is NOT a number because next char is not a digit', () => {
        // The leading-dot path only fires when the next char is [0-9].
        expect(sig('.e5')).toEqual(['punct:.', 'ident:e5']);
    });

    it('underscores group digits', () => {
        expect(sig('1_2_3')).toEqual(['number:1_2_3']);
        expect(sig('12_345.678_9')).toEqual(['number:12_345.678_9']);
    });

    it('trailing underscore is consumed by the number', () => {
        expect(sig('1_')).toEqual(['number:1_']);
    });

    it('"_1" is an ident, not a number', () => {
        expect(sig('_1')).toEqual(['ident:_1']);
    });

    it('exponent followed by another decimal: "1e1.5" -> "1e1" then ".5"', () => {
        expect(sig('1e1.5')).toEqual(['number:1e1', 'number:.5']);
    });
});

// =========================================================================
// STRINGS
// =========================================================================

describe('tokenize — strings (edge cases)', () => {
    it('empty string \'\' is a complete two-char string', () => {
        const ts = tokenize("''");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("''");
        expect(ts[0].to).toBe(2);
    });

    it("''' (three quotes) is a single unterminated string", () => {
        // The first '' is treated as an escaped quote, then the third ' has no
        // closer, so the token runs to EOF.
        const ts = tokenize("'''");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'''");
        expect(ts[0].to).toBe(3);
    });

    it("'''' (four quotes) is one closed string containing one escaped quote", () => {
        const ts = tokenize("''''");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("''''");
        expect(ts[0].to).toBe(4);
    });

    it("''''' (five quotes) is a single unterminated string of length 5", () => {
        const ts = tokenize("'''''");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].to).toBe(5);
    });

    it('unclosed string at EOF still produces a token', () => {
        const ts = tokenize("'oops");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'oops");
    });

    it('string with embedded newline keeps newline inside the token', () => {
        const ts = tokenize("'a\nb'");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'a\nb'");
    });

    it('string containing /* */ markers stays a string, no comment emitted', () => {
        const ts = tokenizeSignificant("'/* not */'");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'/* not */'");
        expect(ts.filter(t => t.kind === 'comment')).toHaveLength(0);
    });

    it('string containing -- markers stays a string', () => {
        const ts = tokenizeSignificant("'-- not'");
        expect(ts[0].kind).toBe('string');
        expect(ts[0].text).toBe("'-- not'");
    });
});

// =========================================================================
// QUOTED IDENTIFIERS
// =========================================================================

describe('tokenize — quoted identifiers (edge cases)', () => {
    it('"" is an empty quoted_ident', () => {
        const ts = tokenize('""');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('""');
        expect(ts[0].to).toBe(2);
    });

    it('"  " (whitespace inside) is a single quoted_ident', () => {
        const ts = tokenize('"  "');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"  "');
    });

    it('unclosed quoted ident runs to EOF', () => {
        const ts = tokenize('"oops');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"oops');
        expect(ts[0].to).toBe(5);
    });

    it('quoted ident with back-to-back "" escapes', () => {
        const ts = tokenize('"a""b""c"');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"a""b""c"');
        expect(ts[0].to).toBe(9);
    });

    it('quoted ident containing a dot remains a single token', () => {
        const ts = tokenizeSignificant('"a.b"');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"a.b"');
    });

    it('quoted ident containing operators stays one token', () => {
        const ts = tokenizeSignificant('"a + b"');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].text).toBe('"a + b"');
    });

    it('quoted reserved word does NOT become a keyword', () => {
        const ts = tokenizeSignificant('"select"');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].value).toBe('"select"');
    });

    it('"""" (four quotes) parses as one closed ident with escaped quote', () => {
        const ts = tokenize('""""');
        expect(ts[0].kind).toBe('quoted_ident');
        expect(ts[0].to).toBe(4);
    });
});

// =========================================================================
// OPERATORS
// =========================================================================

describe('tokenize — operators (longest-first / boundary)', () => {
    it('=> is the arrow kind', () => {
        const ts = tokenizeSignificant('=>');
        expect(ts[0].kind).toBe('arrow');
        expect(ts[0].value).toBe('=>');
    });

    it('-> is the arrow kind', () => {
        const ts = tokenizeSignificant('->');
        expect(ts[0].kind).toBe('arrow');
    });

    it('->> is a generic op, NOT an arrow', () => {
        const ts = tokenizeSignificant('->>');
        expect(ts[0].kind).toBe('op');
        expect(ts[0].value).toBe('->>');
    });

    it('<> compares as op', () => {
        expect(sig('<>')).toEqual(['op:<>']);
    });

    it('<=> three-way compare is one op', () => {
        expect(sig('<=>')).toEqual(['op:<=>']);
    });

    it('!== falls back to "!=" then "="', () => {
        expect(sig('!==')).toEqual(['op:!=', 'op:=']);
    });

    it('<<= is one shift-assign op', () => {
        expect(sig('<<=')).toEqual(['op:<<=']);
    });

    it('<<< is "<<" then "<"', () => {
        expect(sig('<<<')).toEqual(['op:<<', 'op:<']);
    });

    it('>>> is ">>" then ">"', () => {
        expect(sig('>>>')).toEqual(['op:>>', 'op:>']);
    });

    it('|| is concat, not two |', () => {
        expect(sig('||')).toEqual(['concat:||']);
    });

    it('|||| is two concat tokens', () => {
        expect(sig('||||')).toEqual(['concat:||', 'concat:||']);
    });

    it('|x| splits into "|" "x" "|"', () => {
        expect(sig('|x|')).toEqual(['op:|', 'ident:x', 'op:|']);
    });

    it(':: is cast, adjacent to an ident', () => {
        expect(sig('x::INT')).toEqual(['ident:x', 'cast:::', 'keyword:INT']);
    });

    it('chained ::', () => {
        expect(sig('a::b::c')).toEqual(['ident:a', 'cast:::', 'ident:b', 'cast:::', 'ident:c']);
    });

    it('>=> is ">=" then ">"', () => {
        expect(sig('>=>')).toEqual(['op:>=', 'op:>']);
    });

    it('<>= is "<>" then "="', () => {
        expect(sig('<>=')).toEqual(['op:<>', 'op:=']);
    });

    it('!=! is "!=" then "!"', () => {
        expect(sig('!=!')).toEqual(['op:!=', 'op:!']);
    });

    it('a->>b is ident op ident', () => {
        expect(sig('a->>b')).toEqual(['ident:a', 'op:->>', 'ident:b']);
    });
});

// =========================================================================
// DOLLAR REFS
// =========================================================================

describe('tokenize — dollar refs (edge cases)', () => {
    it('$ alone is a dollar token of length 1', () => {
        const ts = tokenize('$');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].text).toBe('$');
    });

    it('$$ alone is a dollar token of length 2', () => {
        const ts = tokenize('$$');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].text).toBe('$$');
    });

    it('$1 is dollar', () => {
        const ts = tokenize('$1');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].text).toBe('$1');
    });

    it('$foo.bar.baz is one dollar including all dots', () => {
        const ts = tokenize('$foo.bar.baz');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].text).toBe('$foo.bar.baz');
    });

    it('$foo-bar splits at the hyphen', () => {
        // hyphen is not in the dollar character class, so $foo ends there.
        expect(sig('$foo-bar')).toEqual(['dollar:$foo', 'op:-', 'ident:bar']);
    });

    it('$foo. (trailing dot) is consumed entirely by the dollar token', () => {
        const ts = tokenize('$foo.');
        expect(ts[0].kind).toBe('dollar');
        expect(ts[0].text).toBe('$foo.');
    });

    it('$$$ is "$$" then "$"', () => {
        expect(sig('$$$')).toEqual(['dollar:$$', 'dollar:$']);
    });
});

// =========================================================================
// WHITESPACE
// =========================================================================

describe('tokenize — whitespace and control chars', () => {
    it('CR LF is a single whitespace run', () => {
        const ts = tokenize('a\r\nb');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'whitespace', 'ident', 'eof']);
        const ws = ts.find(t => t.kind === 'whitespace')!;
        expect(ws.text).toBe('\r\n');
    });

    it('tab is whitespace', () => {
        const ts = tokenize('a\tb');
        expect(ts.find(t => t.kind === 'whitespace')!.text).toBe('\t');
    });

    it('vertical tab is NOT recognized as whitespace; tokenized as unknown', () => {
        // The outer whitespace check is c===' '||\t||\n||\r — \v fails it.
        const ts = tokenize('a\vb');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'unknown', 'ident', 'eof']);
    });

    it('form feed is NOT recognized as whitespace either', () => {
        const ts = tokenize('a\fb');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'unknown', 'ident', 'eof']);
    });

    it('NBSP (U+00A0) is treated as unknown, not whitespace', () => {
        const ts = tokenize('a b');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'unknown', 'ident', 'eof']);
    });

    it('mixed CRLF/tabs/spaces collapse into one whitespace token', () => {
        const ts = tokenize(' \t\r\n ');
        expect(ts.map(t => t.kind)).toEqual(['whitespace', 'eof']);
        expect(ts[0].text).toBe(' \t\r\n ');
    });
});

// =========================================================================
// COMMENTS
// =========================================================================

describe('tokenize — comments (edge cases)', () => {
    it('"--" at EOF (no body, no newline) is a comment token', () => {
        const ts = tokenize('--');
        expect(ts[0].kind).toBe('comment');
        expect(ts[0].text).toBe('--');
    });

    it('"---" at EOF is one comment containing the third dash', () => {
        const ts = tokenize('---');
        expect(ts[0].kind).toBe('comment');
        expect(ts[0].text).toBe('---');
    });

    it('"/**/" is an empty block comment', () => {
        const ts = tokenize('/**/');
        expect(ts[0].kind).toBe('comment');
        expect(ts[0].text).toBe('/**/');
    });

    it('block comments do NOT nest — first */ closes the comment', () => {
        // Outer "/* /* x */" closes here; the remaining " */" becomes ops.
        const ts = tokenizeSignificant('/* /* x */ */');
        expect(ts.map(t => `${t.kind}:${t.value}`)).toEqual([
            'op:*', 'op:/', 'eof:',
        ]);
    });

    it('two adjacent block comments tokenize as two comment tokens', () => {
        const ts = tokenize('/* */ /* */');
        const comments = ts.filter(t => t.kind === 'comment');
        expect(comments).toHaveLength(2);
        expect(comments[0].text).toBe('/* */');
        expect(comments[1].text).toBe('/* */');
    });

    it('-- after operator: "a+--c\\nx" is ident, op, comment, whitespace, ident', () => {
        const ts = tokenize('a+--c\nx');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'op', 'comment', 'whitespace', 'ident', 'eof']);
        expect(ts.find(t => t.kind === 'comment')!.text).toBe('--c');
    });

    it('"a-->b" — the "--" starts a line comment that runs to EOF', () => {
        const ts = tokenize('a-->b');
        // a, --comment until newline (none -> EOF)
        const comment = ts.find(t => t.kind === 'comment');
        expect(comment).toBeDefined();
        expect(comment!.text).toBe('-->b');
        expect(ts.map(t => t.kind)).toEqual(['ident', 'comment', 'eof']);
    });

    it('unterminated block comment "/*" runs to EOF and the to=length', () => {
        const ts = tokenize('/*');
        expect(ts[0].kind).toBe('comment');
        expect(ts[0].to).toBe(2);
    });
});

// =========================================================================
// KEYWORD vs IDENT
// =========================================================================

describe('tokenize — keyword vs identifier', () => {
    it('mixed-case keyword is canonicalized in value', () => {
        const ts = tokenizeSignificant('SeLeCt');
        expect(ts[0].kind).toBe('keyword');
        expect(ts[0].value).toBe('SELECT');
        expect(ts[0].text).toBe('SeLeCt'); // text is the raw source
    });

    it('SELECTFOO is an identifier, not a keyword', () => {
        const ts = tokenizeSignificant('SELECTFOO');
        expect(ts[0].kind).toBe('ident');
    });

    it('SELECT1 is an identifier — digits after a keyword prefix mean ident', () => {
        const ts = tokenizeSignificant('SELECT1');
        expect(ts[0].kind).toBe('ident');
        expect(ts[0].value).toBe('SELECT1');
    });

    it('"select" (quoted) is quoted_ident, never a keyword', () => {
        const ts = tokenizeSignificant('"select"');
        expect(ts[0].kind).toBe('quoted_ident');
    });

    it('identifier preserves original case in value, keyword stores UPPER', () => {
        const ts = tokenizeSignificant('Foo Select');
        expect(ts[0]).toMatchObject({ kind: 'ident', value: 'Foo', text: 'Foo' });
        expect(ts[1]).toMatchObject({ kind: 'keyword', value: 'SELECT', text: 'Select' });
    });
});

// =========================================================================
// UNICODE
// =========================================================================

describe('tokenize — unicode (ASCII-strict)', () => {
    it('Latin-1 letter é produces an unknown token (single char)', () => {
        const ts = tokenize('é');
        expect(ts[0].kind).toBe('unknown');
        expect(ts[0].text).toBe('é');
    });

    it('CJK characters tokenize each as a single unknown', () => {
        const ts = tokenize('你好');
        // Each char goes through the unknown path one at a time.
        const unknowns = ts.filter(t => t.kind === 'unknown');
        expect(unknowns.length).toBeGreaterThanOrEqual(2);
    });

    it('an emoji inside a quoted_ident stays inside it', () => {
        const ts = tokenize('"😀"');
        expect(ts[0].kind).toBe('quoted_ident');
        // surrogate pair = 2 code units
        expect(ts[0].to).toBe('"😀"'.length);
    });
});

// =========================================================================
// PUNCTUATION
// =========================================================================

describe('tokenize — punctuation & brackets', () => {
    it('curly braces are single-char punct', () => {
        expect(sig('{}')).toEqual(['punct:{', 'punct:}']);
    });

    it('square brackets are single-char punct', () => {
        expect(sig('[]')).toEqual(['punct:[', 'punct:]']);
    });

    it('"." alone is punct', () => {
        expect(sig('.')).toEqual(['punct:.']);
    });

    it('".." is two punct dots', () => {
        expect(sig('..')).toEqual(['punct:.', 'punct:.']);
    });

    it('"..." is three punct dots', () => {
        expect(sig('...')).toEqual(['punct:.', 'punct:.', 'punct:.']);
    });

    it('semicolon separates statements', () => {
        expect(sig('a;b')).toEqual(['ident:a', 'punct:;', 'ident:b']);
    });
});

// =========================================================================
// STRESS
// =========================================================================

describe('tokenize — stress / performance', () => {
    it('tokenizes 10,000 ident+op tokens within a generous timeout', () => {
        const src = 'a + '.repeat(2500); // ~10k significant tokens
        const t0 = Date.now();
        const ts = tokenize(src);
        const dt = Date.now() - t0;
        // 2500 idents + 2500 ops + 5000 whitespace = ~10000 significant tokens, plus EOF
        expect(ts.length).toBeGreaterThan(9000);
        assertCoverage(src);
        // generous budget (this is partial-parser overhead; not a benchmark)
        expect(dt).toBeLessThan(2000);
    });

    it('very long single ident (10k chars) is one token', () => {
        const src = 'a'.repeat(10000);
        const ts = tokenize(src);
        expect(ts[0].kind).toBe('ident');
        expect(ts[0].to).toBe(10000);
        expect(ts.length).toBe(2); // ident + eof
    });

    it('very long string literal (10k chars) is one token', () => {
        const inner = 'x'.repeat(10000);
        const src = `'${inner}'`;
        const ts = tokenize(src);
        expect(ts[0].kind).toBe('string');
        expect(ts[0].to).toBe(src.length);
    });
});

// =========================================================================
// KEYWORDS SET
// =========================================================================

describe('KEYWORDS set', () => {
    it('contains the common clause starters', () => {
        for (const kw of ['select', 'from', 'where', 'group', 'by', 'having', 'order', 'limit', 'with']) {
            expect(KEYWORDS.has(kw)).toBe(true);
        }
    });

    it('contains type names used as cast targets', () => {
        for (const t of ['integer', 'int', 'double', 'varchar', 'boolean', 'date', 'timestamp']) {
            expect(KEYWORDS.has(t)).toBe(true);
        }
    });

    it('lookup is lowercase — uppercase will miss', () => {
        expect(KEYWORDS.has('SELECT')).toBe(false);
    });

    it('a non-keyword like "foobar" is absent', () => {
        expect(KEYWORDS.has('foobar')).toBe(false);
        expect(KEYWORDS.has('list_transform')).toBe(false);
    });
});

// =========================================================================
// HELPERS
// =========================================================================

describe('isKeyword / isPunct edge cases', () => {
    it('isKeyword returns false for non-keyword tokens even if value matches', () => {
        const t: Token = { kind: 'ident', text: 'select', value: 'select', from: 0, to: 6 };
        expect(isKeyword(t, 'select')).toBe(false);
    });

    it('isKeyword compares against UPPER form', () => {
        const t: Token = { kind: 'keyword', text: 'Select', value: 'SELECT', from: 0, to: 6 };
        expect(isKeyword(t, 'sElEcT')).toBe(true);
    });

    it('isPunct returns false for op tokens with same text', () => {
        const t: Token = { kind: 'op', text: '(', value: '(', from: 0, to: 1 };
        expect(isPunct(t, '(')).toBe(false);
    });
});

// =========================================================================
// EOF SENTINEL
// =========================================================================

describe('tokenize — EOF sentinel', () => {
    it('always emits exactly one EOF as the final token', () => {
        for (const s of ['', 'a', 'SELECT 1', "'unterm", '/* nope']) {
            const ts = tokenize(s);
            expect(ts[ts.length - 1].kind).toBe('eof');
            expect(ts.filter(t => t.kind === 'eof')).toHaveLength(1);
        }
    });

    it('EOF.from === EOF.to === source.length', () => {
        const s = 'SELECT 1';
        const ts = tokenize(s);
        const eof = ts[ts.length - 1];
        expect(eof.from).toBe(s.length);
        expect(eof.to).toBe(s.length);
        expect(eof.text).toBe('');
    });
});

// =========================================================================
// tokenizeSignificant
// =========================================================================

describe('tokenizeSignificant', () => {
    it('drops whitespace and comments but keeps EOF', () => {
        const ts = tokenizeSignificant('  /* a */ SELECT  -- b\n 1 ');
        expect(ts.map(t => t.kind)).toEqual(['keyword', 'number', 'eof']);
    });

    it('returns just EOF for whitespace-only input', () => {
        const ts = tokenizeSignificant('   \n\t  ');
        expect(ts).toHaveLength(1);
        expect(ts[0].kind).toBe('eof');
    });

    it('returns just EOF for comment-only input', () => {
        const ts = tokenizeSignificant('-- nothing here\n/* nor here */');
        expect(ts).toHaveLength(1);
        expect(ts[0].kind).toBe('eof');
    });
});

// quick sanity that kinds() helper covers our shapes
describe('sanity: kinds() helper', () => {
    it('lists non-eof kinds', () => {
        expect(kinds('a + b')).toEqual(['ident', 'whitespace', 'op', 'whitespace', 'ident']);
    });
});
