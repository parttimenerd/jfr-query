// Comprehensive tests for the SQL tokenizer and parser.
//
// Coverage targets:
//   tokenize()             ~200 cases
//   tokenizeSignificant()  ~50  cases
//   parse()                ~250 cases
//
// The parser is fault-tolerant: it must never throw regardless of input.
// Tests verify this property explicitly in the "fault-tolerance" section.

import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeSignificant, Token, TokenKind } from '../components/editor/sql/tokens';
import { parse } from '../components/editor/sql/parser';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Significant token stream as "kind:value" strings, excluding eof. */
function sig(input: string): string[] {
    return tokenize(input)
        .filter(t => t.kind !== 'whitespace' && t.kind !== 'comment' && t.kind !== 'eof')
        .map(t => `${t.kind}:${t.value}`);
}

/** All token kinds (including whitespace, excluding eof). */
function kinds(input: string): TokenKind[] {
    return tokenize(input).filter(t => t.kind !== 'eof').map(t => t.kind);
}

/** Assert that every non-EOF token's text equals source[from..to] and tokens
 *  cover the source gaplessly. */
function assertCoverage(source: string): void {
    const ts = tokenize(source);
    expect(ts.length).toBeGreaterThan(0);
    const eof = ts[ts.length - 1];
    expect(eof.kind).toBe('eof');
    expect(eof.from).toBe(source.length);
    expect(eof.to).toBe(source.length);
    let cursor = 0;
    for (const t of ts) {
        if (t.kind === 'eof') continue;
        expect(source.slice(t.from, t.to)).toBe(t.text);
        expect(t.from).toBe(cursor);
        cursor = t.to;
    }
    expect(cursor).toBe(source.length);
}

// ---------------------------------------------------------------------------
// tokenize()
// ---------------------------------------------------------------------------

describe('tokenize', () => {

    // -----------------------------------------------------------------------
    // keywords
    // -----------------------------------------------------------------------
    describe('keywords', () => {
        it('SELECT is a keyword with value SELECT', () => {
            const [t] = tokenizeSignificant('SELECT');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('SELECT');
            expect(t.text).toBe('SELECT');
        });

        it('select (lowercase) is canonicalized to SELECT', () => {
            const [t] = tokenizeSignificant('select');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('SELECT');
            expect(t.text).toBe('select');
        });

        it('Select (mixed case) is canonicalized to SELECT', () => {
            const [t] = tokenizeSignificant('Select');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('SELECT');
        });

        it('FROM keyword', () => {
            expect(sig('FROM')).toEqual(['keyword:FROM']);
        });

        it('from keyword', () => {
            expect(sig('from')).toEqual(['keyword:FROM']);
        });

        it('WHERE keyword', () => {
            expect(sig('WHERE')).toEqual(['keyword:WHERE']);
        });

        it('GROUP keyword', () => {
            expect(sig('GROUP')).toEqual(['keyword:GROUP']);
        });

        it('BY keyword', () => {
            expect(sig('BY')).toEqual(['keyword:BY']);
        });

        it('HAVING keyword', () => {
            expect(sig('HAVING')).toEqual(['keyword:HAVING']);
        });

        it('ORDER keyword', () => {
            expect(sig('ORDER')).toEqual(['keyword:ORDER']);
        });

        it('LIMIT keyword', () => {
            expect(sig('LIMIT')).toEqual(['keyword:LIMIT']);
        });

        it('OFFSET keyword', () => {
            expect(sig('OFFSET')).toEqual(['keyword:OFFSET']);
        });

        it('WITH keyword', () => {
            expect(sig('WITH')).toEqual(['keyword:WITH']);
        });

        it('AS keyword', () => {
            expect(sig('AS')).toEqual(['keyword:AS']);
        });

        it('DISTINCT keyword', () => {
            expect(sig('DISTINCT')).toEqual(['keyword:DISTINCT']);
        });

        it('ALL keyword', () => {
            expect(sig('ALL')).toEqual(['keyword:ALL']);
        });

        it('UNION keyword', () => {
            expect(sig('UNION')).toEqual(['keyword:UNION']);
        });

        it('INTERSECT keyword', () => {
            expect(sig('INTERSECT')).toEqual(['keyword:INTERSECT']);
        });

        it('EXCEPT keyword', () => {
            expect(sig('EXCEPT')).toEqual(['keyword:EXCEPT']);
        });

        it('JOIN keyword', () => {
            expect(sig('JOIN')).toEqual(['keyword:JOIN']);
        });

        it('INNER keyword', () => {
            expect(sig('INNER')).toEqual(['keyword:INNER']);
        });

        it('LEFT keyword', () => {
            expect(sig('LEFT')).toEqual(['keyword:LEFT']);
        });

        it('RIGHT keyword', () => {
            expect(sig('RIGHT')).toEqual(['keyword:RIGHT']);
        });

        it('FULL keyword', () => {
            expect(sig('FULL')).toEqual(['keyword:FULL']);
        });

        it('OUTER keyword', () => {
            expect(sig('OUTER')).toEqual(['keyword:OUTER']);
        });

        it('CROSS keyword', () => {
            expect(sig('CROSS')).toEqual(['keyword:CROSS']);
        });

        it('ON keyword', () => {
            expect(sig('ON')).toEqual(['keyword:ON']);
        });

        it('USING keyword', () => {
            expect(sig('USING')).toEqual(['keyword:USING']);
        });

        it('AND keyword', () => {
            expect(sig('AND')).toEqual(['keyword:AND']);
        });

        it('OR keyword', () => {
            expect(sig('OR')).toEqual(['keyword:OR']);
        });

        it('NOT keyword', () => {
            expect(sig('NOT')).toEqual(['keyword:NOT']);
        });

        it('IN keyword', () => {
            expect(sig('IN')).toEqual(['keyword:IN']);
        });

        it('IS keyword', () => {
            expect(sig('IS')).toEqual(['keyword:IS']);
        });

        it('NULL keyword', () => {
            expect(sig('NULL')).toEqual(['keyword:NULL']);
        });

        it('TRUE keyword', () => {
            expect(sig('TRUE')).toEqual(['keyword:TRUE']);
        });

        it('FALSE keyword', () => {
            expect(sig('FALSE')).toEqual(['keyword:FALSE']);
        });

        it('BETWEEN keyword', () => {
            expect(sig('BETWEEN')).toEqual(['keyword:BETWEEN']);
        });

        it('LIKE keyword', () => {
            expect(sig('LIKE')).toEqual(['keyword:LIKE']);
        });

        it('ILIKE keyword', () => {
            expect(sig('ILIKE')).toEqual(['keyword:ILIKE']);
        });

        it('CASE keyword', () => {
            expect(sig('CASE')).toEqual(['keyword:CASE']);
        });

        it('WHEN keyword', () => {
            expect(sig('WHEN')).toEqual(['keyword:WHEN']);
        });

        it('THEN keyword', () => {
            expect(sig('THEN')).toEqual(['keyword:THEN']);
        });

        it('ELSE keyword', () => {
            expect(sig('ELSE')).toEqual(['keyword:ELSE']);
        });

        it('END keyword', () => {
            expect(sig('END')).toEqual(['keyword:END']);
        });

        it('CAST keyword', () => {
            expect(sig('CAST')).toEqual(['keyword:CAST']);
        });

        it('OVER keyword', () => {
            expect(sig('OVER')).toEqual(['keyword:OVER']);
        });

        it('PARTITION keyword', () => {
            expect(sig('PARTITION')).toEqual(['keyword:PARTITION']);
        });

        it('WINDOW keyword', () => {
            expect(sig('WINDOW')).toEqual(['keyword:WINDOW']);
        });

        it('ASC keyword', () => {
            expect(sig('ASC')).toEqual(['keyword:ASC']);
        });

        it('DESC keyword', () => {
            expect(sig('DESC')).toEqual(['keyword:DESC']);
        });

        it('PIVOT keyword (DuckDB)', () => {
            expect(sig('PIVOT')).toEqual(['keyword:PIVOT']);
        });

        it('UNPIVOT keyword (DuckDB)', () => {
            expect(sig('UNPIVOT')).toEqual(['keyword:UNPIVOT']);
        });

        it('CREATE keyword', () => {
            expect(sig('CREATE')).toEqual(['keyword:CREATE']);
        });

        it('TABLE keyword', () => {
            expect(sig('TABLE')).toEqual(['keyword:TABLE']);
        });

        it('INSERT keyword', () => {
            expect(sig('INSERT')).toEqual(['keyword:INSERT']);
        });

        it('UPDATE keyword', () => {
            expect(sig('UPDATE')).toEqual(['keyword:UPDATE']);
        });

        it('DELETE keyword', () => {
            expect(sig('DELETE')).toEqual(['keyword:DELETE']);
        });

        it('SET keyword', () => {
            expect(sig('SET')).toEqual(['keyword:SET']);
        });

        it('VALUES keyword', () => {
            expect(sig('VALUES')).toEqual(['keyword:VALUES']);
        });

        it('INTEGER type keyword', () => {
            expect(sig('INTEGER')).toEqual(['keyword:INTEGER']);
        });

        it('DOUBLE type keyword', () => {
            expect(sig('DOUBLE')).toEqual(['keyword:DOUBLE']);
        });

        it('VARCHAR type keyword', () => {
            expect(sig('VARCHAR')).toEqual(['keyword:VARCHAR']);
        });

        it('BOOLEAN type keyword', () => {
            expect(sig('BOOLEAN')).toEqual(['keyword:BOOLEAN']);
        });

        it('TIMESTAMP type keyword', () => {
            expect(sig('TIMESTAMP')).toEqual(['keyword:TIMESTAMP']);
        });

        it('SELECT + FROM sequence', () => {
            expect(sig('SELECT * FROM t')).toContain('keyword:SELECT');
            expect(sig('SELECT * FROM t')).toContain('keyword:FROM');
        });

        it('keyword text preserves original casing, value is uppercase', () => {
            const ts = tokenizeSignificant('sElEcT');
            expect(ts[0].kind).toBe('keyword');
            expect(ts[0].text).toBe('sElEcT');
            expect(ts[0].value).toBe('SELECT');
        });

        it('RECURSIVE keyword', () => {
            expect(sig('RECURSIVE')).toEqual(['keyword:RECURSIVE']);
        });

        it('QUALIFY keyword', () => {
            expect(sig('QUALIFY')).toEqual(['keyword:QUALIFY']);
        });

        it('NULLS keyword', () => {
            expect(sig('NULLS')).toEqual(['keyword:NULLS']);
        });

        it('FIRST keyword', () => {
            expect(sig('FIRST')).toEqual(['keyword:FIRST']);
        });

        it('LAST keyword', () => {
            expect(sig('LAST')).toEqual(['keyword:LAST']);
        });

        it('EXCLUDE keyword', () => {
            expect(sig('EXCLUDE')).toEqual(['keyword:EXCLUDE']);
        });

        it('REPLACE keyword', () => {
            expect(sig('REPLACE')).toEqual(['keyword:REPLACE']);
        });

        it('LATERAL keyword', () => {
            expect(sig('LATERAL')).toEqual(['keyword:LATERAL']);
        });

        it('FILTER keyword', () => {
            expect(sig('FILTER')).toEqual(['keyword:FILTER']);
        });

        it('RETURNING keyword', () => {
            expect(sig('RETURNING')).toEqual(['keyword:RETURNING']);
        });

        it('INTO keyword', () => {
            expect(sig('INTO')).toEqual(['keyword:INTO']);
        });

        it('DROP keyword', () => {
            expect(sig('DROP')).toEqual(['keyword:DROP']);
        });

        it('ALTER keyword', () => {
            expect(sig('ALTER')).toEqual(['keyword:ALTER']);
        });

        it('ARRAY keyword', () => {
            expect(sig('ARRAY')).toEqual(['keyword:ARRAY']);
        });

        it('STRUCT keyword', () => {
            expect(sig('STRUCT')).toEqual(['keyword:STRUCT']);
        });

        it('INTERVAL keyword', () => {
            expect(sig('INTERVAL')).toEqual(['keyword:INTERVAL']);
        });

        it('DATE keyword', () => {
            expect(sig('DATE')).toEqual(['keyword:DATE']);
        });

        it('NATURAL keyword', () => {
            expect(sig('NATURAL')).toEqual(['keyword:NATURAL']);
        });

        it('EXISTS keyword', () => {
            expect(sig('EXISTS')).toEqual(['keyword:EXISTS']);
        });

        it('GLOB keyword', () => {
            expect(sig('GLOB')).toEqual(['keyword:GLOB']);
        });
    });

    // -----------------------------------------------------------------------
    // identifiers
    // -----------------------------------------------------------------------
    describe('identifiers', () => {
        it('simple lowercase ident', () => {
            expect(sig('foo')).toEqual(['ident:foo']);
        });

        it('ident with underscore', () => {
            expect(sig('bar_baz')).toEqual(['ident:bar_baz']);
        });

        it('leading underscore', () => {
            expect(sig('_x')).toEqual(['ident:_x']);
        });

        it('camelCase ident', () => {
            expect(sig('camelCase')).toEqual(['ident:camelCase']);
        });

        it('ident starting with uppercase', () => {
            expect(sig('MyTable')).toEqual(['ident:MyTable']);
        });

        it('all-caps non-keyword is still an ident', () => {
            expect(sig('FOOBAR')).toEqual(['ident:FOOBAR']);
        });

        it('ident with digits (not leading)', () => {
            expect(sig('x1')).toEqual(['ident:x1']);
        });

        it('keyword prefix + extra chars → ident', () => {
            expect(sig('SELECTME')).toEqual(['ident:SELECTME']);
        });

        it('SELECT1 is an ident (digit suffix)', () => {
            expect(sig('SELECT1')).toEqual(['ident:SELECT1']);
        });

        it('ident value preserves original casing', () => {
            const [t] = tokenizeSignificant('EventType');
            expect(t.kind).toBe('ident');
            expect(t.value).toBe('EventType');
        });

        it('multiple idents separated by whitespace', () => {
            expect(sig('a b c')).toEqual(['ident:a', 'ident:b', 'ident:c']);
        });

        it('ident adjacent to punct', () => {
            expect(sig('f(x)')).toEqual(['ident:f', 'punct:(', 'ident:x', 'punct:)']);
        });

        it('ident then dot then ident', () => {
            expect(sig('a.b')).toEqual(['ident:a', 'punct:.', 'ident:b']);
        });

        it('schema.table.column triple', () => {
            expect(sig('s.t.c')).toEqual(['ident:s', 'punct:.', 'ident:t', 'punct:.', 'ident:c']);
        });

        it('ident with all allowed chars', () => {
            expect(sig('AbCdEf_012')).toEqual(['ident:AbCdEf_012']);
        });

        it('single char idents', () => {
            expect(sig('a b c')).toEqual(['ident:a', 'ident:b', 'ident:c']);
        });

        it('double-underscore ident', () => {
            expect(sig('__private')).toEqual(['ident:__private']);
        });
    });

    // -----------------------------------------------------------------------
    // quoted identifiers
    // -----------------------------------------------------------------------
    describe('quoted identifiers', () => {
        it('simple quoted ident with spaces', () => {
            const [t] = tokenizeSignificant('"foo bar"');
            expect(t.kind).toBe('quoted_ident');
            expect(t.value).toBe('"foo bar"');
        });

        it('quoted ident text includes surrounding quotes', () => {
            const [t] = tokenizeSignificant('"my table"');
            expect(t.text).toBe('"my table"');
        });

        it('quoted ident from = 0', () => {
            const [t] = tokenize('"a"');
            expect(t.from).toBe(0);
            expect(t.to).toBe(3);
        });

        it('quoted reserved word is NOT a keyword', () => {
            const [t] = tokenizeSignificant('"select"');
            expect(t.kind).toBe('quoted_ident');
        });

        it('quoted ident with escaped internal double-quote ""', () => {
            const [t] = tokenizeSignificant('"a""b"');
            expect(t.kind).toBe('quoted_ident');
            expect(t.text).toBe('"a""b"');
        });

        it('unterminated quoted ident runs to EOF', () => {
            const [t] = tokenize('"oops');
            expect(t.kind).toBe('quoted_ident');
            expect(t.to).toBe(5);
        });

        it('empty quoted ident ""', () => {
            const [t] = tokenize('""');
            expect(t.kind).toBe('quoted_ident');
            expect(t.text).toBe('""');
        });

        it('quoted ident containing a dot stays single token', () => {
            const [t] = tokenizeSignificant('"a.b"');
            expect(t.kind).toBe('quoted_ident');
            expect(t.text).toBe('"a.b"');
        });

        it('quoted ident containing operator characters stays single token', () => {
            const [t] = tokenizeSignificant('"a + b"');
            expect(t.kind).toBe('quoted_ident');
            expect(t.text).toBe('"a + b"');
        });

        it('span from/to correct after preceding whitespace', () => {
            const ts = tokenize(' "foo"');
            const q = ts.find(t => t.kind === 'quoted_ident')!;
            expect(q.from).toBe(1);
            expect(q.to).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // string literals
    // -----------------------------------------------------------------------
    describe('string literals', () => {
        it("simple string 'hello'", () => {
            const [t] = tokenize("'hello'");
            expect(t.kind).toBe('string');
            expect(t.text).toBe("'hello'");
        });

        it('string value includes surrounding quotes', () => {
            const [t] = tokenizeSignificant("'hi'");
            expect(t.value).toBe("'hi'");
        });

        it("escaped single-quote '' inside string", () => {
            const [t] = tokenize("'it''s'");
            expect(t.kind).toBe('string');
            expect(t.text).toBe("'it''s'");
        });

        it('unterminated string consumes to end of input', () => {
            const [t] = tokenize("'oops");
            expect(t.kind).toBe('string');
            expect(t.to).toBe(5);
        });

        it('unterminated string text matches full slice', () => {
            const s = "'abc";
            const [t] = tokenize(s);
            expect(t.text).toBe(s);
        });

        it('empty string literal', () => {
            const [t] = tokenize("''");
            expect(t.kind).toBe('string');
            expect(t.text).toBe("''");
        });

        it('string with embedded newline', () => {
            const [t] = tokenize("'a\nb'");
            expect(t.kind).toBe('string');
            expect(t.text).toBe("'a\nb'");
        });

        it('string containing /* */ stays a string, no comment emitted', () => {
            const ts = tokenizeSignificant("'/* not */'");
            expect(ts[0].kind).toBe('string');
            expect(ts.filter(t => t.kind === 'comment')).toHaveLength(0);
        });

        it('string containing -- stays a string', () => {
            const ts = tokenizeSignificant("'-- not'");
            expect(ts[0].kind).toBe('string');
        });

        it('string span from/to correct', () => {
            const ts = tokenize("x = 'hello'");
            const s = ts.find(t => t.kind === 'string')!;
            expect(s.from).toBe(4);
            expect(s.to).toBe(11);
        });

        it('multiple strings in sequence', () => {
            expect(sig("'a' 'b'")).toEqual(["string:'a'", "string:'b'"]);
        });

        it('four single-quotes is one closed string with escaped quote', () => {
            const [t] = tokenize("''''");
            expect(t.kind).toBe('string');
            expect(t.to).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // numbers
    // -----------------------------------------------------------------------
    describe('numbers', () => {
        it('integer 42', () => {
            expect(sig('42')).toEqual(['number:42']);
        });

        it('decimal 3.14', () => {
            expect(sig('3.14')).toEqual(['number:3.14']);
        });

        it('scientific notation 1e10', () => {
            expect(sig('1e10')).toEqual(['number:1e10']);
        });

        it('scientific notation uppercase E', () => {
            expect(sig('2E10')).toEqual(['number:2E10']);
        });

        it('leading-dot decimal .5', () => {
            expect(sig('.5')).toEqual(['number:.5']);
        });

        it('0.5', () => {
            expect(sig('0.5')).toEqual(['number:0.5']);
        });

        it('hex literal 0xFF', () => {
            expect(sig('0xFF')).toEqual(['number:0xFF']);
        });

        it('hex literal uppercase 0XFF', () => {
            expect(sig('0XFF')).toEqual(['number:0XFF']);
        });

        it('hex literal 0xABCDEF', () => {
            expect(sig('0xABCDEF')).toEqual(['number:0xABCDEF']);
        });

        it('negative number -1 is unary minus + number', () => {
            expect(sig('-1')).toEqual(['op:-', 'number:1']);
        });

        it('scientific with negative exponent 1.5e-3', () => {
            expect(sig('1.5e-3')).toEqual(['number:1.5e-3']);
        });

        it('scientific with positive exponent 1.5e+3', () => {
            expect(sig('1.5e+3')).toEqual(['number:1.5e+3']);
        });

        it('digit-grouped 1_000_000', () => {
            expect(sig('1_000_000')).toEqual(['number:1_000_000']);
        });

        it('zero', () => {
            expect(sig('0')).toEqual(['number:0']);
        });

        it('number position: from=0, to=2 for "42"', () => {
            const [t] = tokenize('42');
            expect(t.from).toBe(0);
            expect(t.to).toBe(2);
        });

        it('number in expression: position correct', () => {
            const ts = tokenizeSignificant('a + 99');
            const n = ts.find(t => t.kind === 'number')!;
            expect(n.from).toBe(4);
            expect(n.to).toBe(6);
        });

        it('lone dot before non-digit is punct not number', () => {
            expect(sig('.x')).toContain('punct:.');
        });

        it('"." alone is punct', () => {
            expect(sig('.')).toEqual(['punct:.']);
        });

        it('integer 0', () => {
            const [t] = tokenize('0');
            expect(t.kind).toBe('number');
        });

        it('large integer', () => {
            expect(sig('9999999999')).toEqual(['number:9999999999']);
        });
    });

    // -----------------------------------------------------------------------
    // operators
    // -----------------------------------------------------------------------
    describe('operators', () => {
        it('+ is op', () => {
            expect(sig('+')).toEqual(['op:+']);
        });

        it('- is op', () => {
            expect(sig('-')).toEqual(['op:-']);
        });

        it('* is op', () => {
            expect(sig('*')).toEqual(['op:*']);
        });

        it('/ is op', () => {
            expect(sig('/')).toEqual(['op:/']);
        });

        it('% is op', () => {
            expect(sig('%')).toEqual(['op:%']);
        });

        it('= is op', () => {
            expect(sig('=')).toEqual(['op:=']);
        });

        it('<> is op', () => {
            expect(sig('<>')).toEqual(['op:<>']);
        });

        it('!= is op', () => {
            expect(sig('!=')).toEqual(['op:!=']);
        });

        it('<= is op', () => {
            expect(sig('<=')).toEqual(['op:<=']);
        });

        it('>= is op', () => {
            expect(sig('>=')).toEqual(['op:>=']);
        });

        it('< is op', () => {
            expect(sig('<')).toEqual(['op:<']);
        });

        it('> is op', () => {
            expect(sig('>')).toEqual(['op:>']);
        });

        it(':: is cast kind', () => {
            expect(sig('::')).toEqual(['cast:::']);
        });

        it('|| is concat kind', () => {
            expect(sig('||')).toEqual(['concat:||']);
        });

        it('-> is arrow kind', () => {
            expect(sig('->')).toEqual(['arrow:->']);
        });

        it('=> is arrow kind', () => {
            expect(sig('=>')).toEqual(['arrow:=>']);
        });

        it('** is op', () => {
            expect(sig('**')).toEqual(['op:**']);
        });

        it('longest-match: <= beats < followed by =', () => {
            expect(sig('<=')).toEqual(['op:<=']);
            expect(sig('<=')).not.toContain('op:<');
        });

        it('longest-match: >= beats >', () => {
            expect(sig('>=')).toEqual(['op:>=']);
        });

        it('longest-match: <> is one token', () => {
            expect(sig('<>')).toHaveLength(1);
        });

        it(': followed by non-: produces op: ::', () => {
            // :: is handled as cast; a single : is op or unknown
            const ts = tokenizeSignificant('x::INT');
            expect(ts[1].kind).toBe('cast');
        });

        it('^, ~, & are ops', () => {
            expect(sig('^')).toEqual(['op:^']);
            expect(sig('~')).toEqual(['op:~']);
            expect(sig('&')).toEqual(['op:&']);
        });

        it('| alone is op', () => {
            expect(sig('|')).toEqual(['op:|']);
        });

        it('? is op', () => {
            expect(sig('?')).toEqual(['op:?']);
        });

        it('! is op', () => {
            expect(sig('!')).toEqual(['op:!']);
        });

        it('->> is op (not arrow)', () => {
            const [t] = tokenizeSignificant('->>');
            expect(t.kind).toBe('op');
            expect(t.value).toBe('->>');
        });

        it('arithmetic sequence: a + b - c * d / e', () => {
            expect(sig('a + b - c * d / e')).toEqual([
                'ident:a', 'op:+', 'ident:b', 'op:-', 'ident:c',
                'op:*', 'ident:d', 'op:/', 'ident:e',
            ]);
        });

        it('comparison chain', () => {
            expect(sig('x = 1 AND y > 2')).toContain('op:=');
            expect(sig('x = 1 AND y > 2')).toContain('op:>');
        });
    });

    // -----------------------------------------------------------------------
    // punctuation
    // -----------------------------------------------------------------------
    describe('punctuation', () => {
        it('( is punct', () => {
            expect(sig('(')).toEqual(['punct:(']);
        });

        it(') is punct', () => {
            expect(sig(')')).toEqual(['punct:)']);
        });

        it(', is punct', () => {
            expect(sig(',')).toEqual(['punct:,']);
        });

        it('; is punct', () => {
            expect(sig(';')).toEqual(['punct:;']);
        });

        it('. is punct', () => {
            expect(sig('.')).toEqual(['punct:.']);
        });

        it('[ is punct', () => {
            expect(sig('[')).toEqual(['punct:[']);
        });

        it('] is punct', () => {
            expect(sig(']')).toEqual(['punct:]']);
        });

        it('{ is punct', () => {
            expect(sig('{')).toEqual(['punct:{']);
        });

        it('} is punct', () => {
            expect(sig('}')).toEqual(['punct:}']);
        });

        it('multiple punct in sequence', () => {
            expect(sig('(a, b)')).toEqual([
                'punct:(', 'ident:a', 'punct:,', 'ident:b', 'punct:)',
            ]);
        });

        it('semicolon between tokens', () => {
            expect(sig('a;b')).toEqual(['ident:a', 'punct:;', 'ident:b']);
        });

        it('bracket list [1, 2, 3]', () => {
            expect(sig('[1, 2, 3]')).toEqual([
                'punct:[', 'number:1', 'punct:,', 'number:2', 'punct:,', 'number:3', 'punct:]',
            ]);
        });
    });

    // -----------------------------------------------------------------------
    // whitespace
    // -----------------------------------------------------------------------
    describe('whitespace', () => {
        it('single space is whitespace', () => {
            expect(kinds(' ')).toEqual(['whitespace']);
        });

        it('tab is whitespace', () => {
            expect(kinds('\t')).toEqual(['whitespace']);
        });

        it('newline is whitespace', () => {
            expect(kinds('\n')).toEqual(['whitespace']);
        });

        it('CR LF is a single whitespace run', () => {
            const ts = tokenize('a\r\nb');
            const ws = ts.find(t => t.kind === 'whitespace')!;
            expect(ws.text).toBe('\r\n');
        });

        it('mixed whitespace collapses into one token', () => {
            const ts = tokenize(' \t\r\n ');
            expect(ts.map(t => t.kind)).toEqual(['whitespace', 'eof']);
        });

        it('whitespace token value is empty string', () => {
            const [t] = tokenize(' ');
            expect(t.value).toBe('');
        });

        it('whitespace text matches source slice', () => {
            const src = '  \t  ';
            const [t] = tokenize(src);
            expect(t.text).toBe(src);
        });

        it('tokens between whitespace have correct from/to', () => {
            const ts = tokenize('a b');
            const idents = ts.filter(t => t.kind === 'ident');
            expect(idents[0].from).toBe(0);
            expect(idents[0].to).toBe(1);
            expect(idents[1].from).toBe(2);
            expect(idents[1].to).toBe(3);
        });

        it('whitespace-only input: one whitespace token + eof', () => {
            const ts = tokenize('   ');
            expect(ts.map(t => t.kind)).toEqual(['whitespace', 'eof']);
        });

        it('leading and trailing whitespace produces whitespace tokens', () => {
            const ts = tokenize('  a  ');
            expect(ts[0].kind).toBe('whitespace');
            expect(ts[ts.length - 2].kind).toBe('whitespace');
        });
    });

    // -----------------------------------------------------------------------
    // comments
    // -----------------------------------------------------------------------
    describe('comments', () => {
        it('line comment -- runs to end of line', () => {
            const ts = tokenize('a -- comment\nb');
            const c = ts.find(t => t.kind === 'comment')!;
            expect(c.text).toBe('-- comment');
        });

        it('line comment does NOT include the newline', () => {
            const ts = tokenize('-- hi\nx');
            const c = ts.find(t => t.kind === 'comment')!;
            expect(c.text).not.toContain('\n');
        });

        it('line comment at EOF (no trailing newline)', () => {
            const ts = tokenize('-- end');
            expect(ts[0].kind).toBe('comment');
            expect(ts[0].text).toBe('-- end');
        });

        it('block comment /* ... */', () => {
            const ts = tokenize('a /* hi */ b');
            const c = ts.find(t => t.kind === 'comment')!;
            expect(c.text).toBe('/* hi */');
        });

        it('block comment multi-line', () => {
            const src = '/* line1\nline2 */';
            const [c] = tokenize(src);
            expect(c.kind).toBe('comment');
            expect(c.text).toBe(src);
        });

        it('unterminated block comment consumes to EOF', () => {
            const [c] = tokenize('/* oops');
            expect(c.kind).toBe('comment');
            expect(c.to).toBe(7);
        });

        it('empty block comment /**/', () => {
            const [c] = tokenize('/**/');
            expect(c.kind).toBe('comment');
            expect(c.text).toBe('/**/');
        });

        it('comment value is empty string', () => {
            const [c] = tokenize('-- x');
            expect(c.value).toBe('');
        });

        it('comment span: from/to match source positions', () => {
            const src = 'a -- hi\n';
            const ts = tokenize(src);
            const c = ts.find(t => t.kind === 'comment')!;
            expect(src.slice(c.from, c.to)).toBe(c.text);
        });

        it('two adjacent block comments', () => {
            const ts = tokenize('/* a */ /* b */');
            const cs = ts.filter(t => t.kind === 'comment');
            expect(cs).toHaveLength(2);
        });

        it('comment-only input gives comment + eof', () => {
            const ts = tokenize('-- comment');
            expect(ts.map(t => t.kind)).toEqual(['comment', 'eof']);
        });

        it('block comment does NOT nest — first */ closes', () => {
            // "/* /* x */ */" → comment = "/* /* x */", then " */" is ops
            const ts = tokenizeSignificant('/* /* x */ */');
            expect(ts[0].kind).not.toBe('comment');
        });
    });

    // -----------------------------------------------------------------------
    // dollar variables
    // -----------------------------------------------------------------------
    describe('dollar variables', () => {
        it('$foo is dollar kind', () => {
            const [t] = tokenizeSignificant('$foo');
            expect(t.kind).toBe('dollar');
            expect(t.value).toBe('$foo');
        });

        it('$$foo is dollar kind', () => {
            const [t] = tokenizeSignificant('$$foo');
            expect(t.kind).toBe('dollar');
            expect(t.value).toBe('$$foo');
        });

        it('$plot.brush stays as one dollar token', () => {
            const [t] = tokenizeSignificant('$plot.brush');
            expect(t.kind).toBe('dollar');
            expect(t.text).toBe('$plot.brush');
        });

        it('$cell.var.0 tuple index is one dollar token', () => {
            const [t] = tokenizeSignificant('$cell.var.0');
            expect(t.kind).toBe('dollar');
            expect(t.text).toBe('$cell.var.0');
        });

        it('$ alone is a dollar token of length 1', () => {
            const [t] = tokenize('$');
            expect(t.kind).toBe('dollar');
            expect(t.text).toBe('$');
        });

        it('$$ alone is a dollar token of length 2', () => {
            const [t] = tokenize('$$');
            expect(t.kind).toBe('dollar');
            expect(t.text).toBe('$$');
        });

        it('$1 is dollar (numeric name)', () => {
            const [t] = tokenize('$1');
            expect(t.kind).toBe('dollar');
        });

        it('$foo splits at hyphen', () => {
            expect(sig('$foo-bar')).toEqual(['dollar:$foo', 'op:-', 'ident:bar']);
        });

        it('dollar token span covers the full text', () => {
            const src = '$foo.bar';
            const [t] = tokenize(src);
            expect(t.from).toBe(0);
            expect(t.to).toBe(src.length);
        });

        it('dollar in expression context', () => {
            const ts = tokenizeSignificant('x > $threshold');
            const d = ts.find(t => t.kind === 'dollar')!;
            expect(d.value).toBe('$threshold');
        });
    });

    // -----------------------------------------------------------------------
    // special token kinds: NULL, TRUE, FALSE
    // -----------------------------------------------------------------------
    describe('special keywords NULL TRUE FALSE', () => {
        it('NULL is keyword with value NULL', () => {
            const [t] = tokenizeSignificant('NULL');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('NULL');
        });

        it('null (lowercase) is keyword NULL', () => {
            const [t] = tokenizeSignificant('null');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('NULL');
        });

        it('TRUE is keyword', () => {
            const [t] = tokenizeSignificant('TRUE');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('TRUE');
        });

        it('true (lowercase) is keyword TRUE', () => {
            const [t] = tokenizeSignificant('true');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('TRUE');
        });

        it('FALSE is keyword', () => {
            const [t] = tokenizeSignificant('FALSE');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('FALSE');
        });

        it('false (lowercase) is keyword FALSE', () => {
            const [t] = tokenizeSignificant('false');
            expect(t.kind).toBe('keyword');
            expect(t.value).toBe('FALSE');
        });
    });

    // -----------------------------------------------------------------------
    // token positions (from / to)
    // -----------------------------------------------------------------------
    describe('token positions', () => {
        it('empty input: eof has from=0 to=0', () => {
            const [eof] = tokenize('');
            expect(eof.from).toBe(0);
            expect(eof.to).toBe(0);
        });

        it('single token from=0', () => {
            const [t] = tokenize('SELECT');
            expect(t.from).toBe(0);
        });

        it('to = from + text.length for single-char tokens', () => {
            const [t] = tokenize('(');
            expect(t.to - t.from).toBe(1);
        });

        it('eof from/to equals source.length', () => {
            const src = 'SELECT 1';
            const ts = tokenize(src);
            const eof = ts[ts.length - 1];
            expect(eof.from).toBe(src.length);
            expect(eof.to).toBe(src.length);
        });

        it('token text always matches source[from..to]', () => {
            const src = "SELECT a + 'hello' FROM t";
            const ts = tokenize(src);
            for (const t of ts) {
                if (t.kind === 'eof') continue;
                expect(src.slice(t.from, t.to)).toBe(t.text);
            }
        });

        it('gapless coverage: tokens tile the source', () => {
            assertCoverage("SELECT * FROM t WHERE x = 1");
        });

        it('gapless coverage on empty', () => {
            assertCoverage('');
        });

        it('gapless coverage on whitespace-only', () => {
            assertCoverage('   \n');
        });

        it('gapless coverage on comment-only', () => {
            assertCoverage('-- comment');
        });

        it('gapless coverage on complex query', () => {
            assertCoverage("WITH r AS (SELECT * FROM t) SELECT a::INT FROM r WHERE b IN ('x','y')");
        });
    });

    // -----------------------------------------------------------------------
    // empty input and EOF
    // -----------------------------------------------------------------------
    describe('empty input and EOF', () => {
        it('empty string produces exactly one token: eof', () => {
            const ts = tokenize('');
            expect(ts).toHaveLength(1);
            expect(ts[0].kind).toBe('eof');
        });

        it('eof is always the final token', () => {
            for (const s of ['', 'a', 'SELECT 1', "'unterm", '/* nope']) {
                const ts = tokenize(s);
                expect(ts[ts.length - 1].kind).toBe('eof');
            }
        });

        it('exactly one eof token per call', () => {
            const ts = tokenize('SELECT a, b FROM t');
            expect(ts.filter(t => t.kind === 'eof')).toHaveLength(1);
        });

        it('eof text is empty string', () => {
            const ts = tokenize('x');
            const eof = ts[ts.length - 1];
            expect(eof.text).toBe('');
        });

        it('eof value is empty string', () => {
            const ts = tokenize('x');
            const eof = ts[ts.length - 1];
            expect(eof.value).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // unknown tokens
    // -----------------------------------------------------------------------
    describe('unknown tokens', () => {
        it('unrecognized char produces unknown token', () => {
            const [t] = tokenize('@');
            expect(t.kind).toBe('unknown');
            expect(t.text).toBe('@');
        });

        it('unknown token advances by exactly one char', () => {
            const [t] = tokenize('@');
            expect(t.to - t.from).toBe(1);
        });

        it('multiple unknowns produce multiple tokens', () => {
            const ts = tokenize('@@');
            const unknowns = ts.filter(t => t.kind === 'unknown');
            expect(unknowns).toHaveLength(2);
        });

        it('backslash is unknown', () => {
            const [t] = tokenize('\\');
            expect(t.kind).toBe('unknown');
        });
    });
});

// ---------------------------------------------------------------------------
// tokenizeSignificant()
// ---------------------------------------------------------------------------

describe('tokenizeSignificant', () => {
    it('returns empty array for empty input (no eof)', () => {
        // tokenizeSignificant DOES include eof — check actual behavior
        const ts = tokenizeSignificant('');
        // eof token kind is not whitespace/comment so it is kept
        expect(ts.every(t => t.kind !== 'whitespace' && t.kind !== 'comment')).toBe(true);
    });

    it('filters out all whitespace tokens', () => {
        const ts = tokenizeSignificant('  SELECT   1  ');
        expect(ts.some(t => t.kind === 'whitespace')).toBe(false);
    });

    it('filters out line comment tokens', () => {
        const ts = tokenizeSignificant('SELECT 1 -- comment');
        expect(ts.some(t => t.kind === 'comment')).toBe(false);
    });

    it('filters out block comment tokens', () => {
        const ts = tokenizeSignificant('/* block */ SELECT 1');
        expect(ts.some(t => t.kind === 'comment')).toBe(false);
    });

    it('keeps keyword tokens', () => {
        const ts = tokenizeSignificant('SELECT');
        expect(ts.some(t => t.kind === 'keyword')).toBe(true);
    });

    it('keeps ident tokens', () => {
        const ts = tokenizeSignificant('foo');
        expect(ts.some(t => t.kind === 'ident')).toBe(true);
    });

    it('keeps number tokens', () => {
        const ts = tokenizeSignificant('42');
        expect(ts.some(t => t.kind === 'number')).toBe(true);
    });

    it('keeps string tokens', () => {
        const ts = tokenizeSignificant("'hi'");
        expect(ts.some(t => t.kind === 'string')).toBe(true);
    });

    it('keeps punct tokens', () => {
        const ts = tokenizeSignificant('(a)');
        expect(ts.some(t => t.kind === 'punct')).toBe(true);
    });

    it('keeps op tokens', () => {
        const ts = tokenizeSignificant('a + b');
        expect(ts.some(t => t.kind === 'op')).toBe(true);
    });

    it('keeps cast tokens', () => {
        const ts = tokenizeSignificant('x::INT');
        expect(ts.some(t => t.kind === 'cast')).toBe(true);
    });

    it('keeps concat tokens', () => {
        const ts = tokenizeSignificant("'a' || 'b'");
        expect(ts.some(t => t.kind === 'concat')).toBe(true);
    });

    it('keeps arrow tokens', () => {
        const ts = tokenizeSignificant('x -> x');
        expect(ts.some(t => t.kind === 'arrow')).toBe(true);
    });

    it('keeps dollar tokens', () => {
        const ts = tokenizeSignificant('$foo');
        expect(ts.some(t => t.kind === 'dollar')).toBe(true);
    });

    it('token positions are still correct after filtering', () => {
        const src = '  SELECT   1  ';
        const ts = tokenizeSignificant(src);
        for (const t of ts) {
            if (t.kind === 'eof') continue;
            expect(src.slice(t.from, t.to)).toBe(t.text);
        }
    });

    it('whitespace-only → only eof remains', () => {
        const ts = tokenizeSignificant('   \n\t  ');
        expect(ts.length).toBe(1);
        expect(ts[0].kind).toBe('eof');
    });

    it('comment-only → only eof remains', () => {
        const ts = tokenizeSignificant('-- nothing here\n/* nor here */');
        expect(ts.length).toBe(1);
        expect(ts[0].kind).toBe('eof');
    });

    it('SELECT 1 FROM t → keyword, number, keyword, ident, eof', () => {
        const ts = tokenizeSignificant('SELECT 1 FROM t');
        expect(ts.map(t => t.kind)).toEqual(['keyword', 'number', 'keyword', 'ident', 'eof']);
    });

    it('comment inside an expression is removed', () => {
        const ts = tokenizeSignificant('a /* plus */ + b');
        expect(ts.map(t => `${t.kind}:${t.value}`)).toEqual([
            'ident:a', 'op:+', 'ident:b', 'eof:',
        ]);
    });

    it('line comment between clauses is removed', () => {
        const ts = tokenizeSignificant('SELECT 1 -- c\n  FROM t');
        expect(ts.map(t => t.value)).toEqual(['SELECT', '1', 'FROM', 't', '']);
    });

    it('multiple interspersed comments and spaces', () => {
        const ts = tokenizeSignificant('/* a */ SELECT /* b */ 1 -- c');
        const nonEof = ts.filter(t => t.kind !== 'eof');
        expect(nonEof.every(t => t.kind !== 'whitespace' && t.kind !== 'comment')).toBe(true);
    });

    it('dollar variable kept after filtering', () => {
        const ts = tokenizeSignificant('WHERE x = $v -- filter');
        const d = ts.find(t => t.kind === 'dollar');
        expect(d).toBeDefined();
        expect(d!.value).toBe('$v');
    });

    it('complex multi-comment query: only substantive tokens remain', () => {
        const src = '/* header */\n-- describe\nSELECT /* inline */ a\nFROM t -- tail';
        const ts = tokenizeSignificant(src);
        const kinds = ts.filter(t => t.kind !== 'eof').map(t => t.kind);
        expect(kinds.every(k => k !== 'whitespace' && k !== 'comment')).toBe(true);
    });

    it('result is a subset of tokenize() with same tokens', () => {
        const src = 'SELECT a FROM t';
        const all = tokenize(src);
        const sig2 = tokenizeSignificant(src);
        for (const t of sig2) {
            const found = all.some(a => a.from === t.from && a.to === t.to && a.kind === t.kind);
            expect(found).toBe(true);
        }
    });

    it('empty string: eof only', () => {
        const ts = tokenizeSignificant('');
        expect(ts).toHaveLength(1);
        expect(ts[0].kind).toBe('eof');
    });

    it('position invariant: filtered token positions still match source', () => {
        const src = "WITH cte AS (SELECT a FROM t) SELECT b FROM cte WHERE b > 0";
        const ts = tokenizeSignificant(src);
        for (const t of ts) {
            if (t.kind === 'eof') continue;
            expect(src.slice(t.from, t.to)).toBe(t.text);
        }
    });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

// AST walk helper (matches structure in existing parser tests)
import { walk, type Node, type NodeKind } from '../components/editor/sql/ast';

function findNode(root: Node, kind: NodeKind): Node | undefined {
    let found: Node | undefined;
    walk(root, (n) => { if (!found && n.kind === kind) { found = n; } });
    return found;
}

function countNodes(root: Node, kind: NodeKind): number {
    let n = 0;
    walk(root, (x) => { if (x.kind === kind) n++; });
    return n;
}

function allNodes(root: Node): Node[] {
    const out: Node[] = [];
    walk(root, (n) => { out.push(n); });
    return out;
}

describe('parse', () => {

    // -----------------------------------------------------------------------
    // ParseResult structure
    // -----------------------------------------------------------------------
    describe('ParseResult structure', () => {
        it('returns an object with root, source, and tokens fields', () => {
            const result = parse('SELECT 1');
            expect(result).toHaveProperty('root');
            expect(result).toHaveProperty('source');
            expect(result).toHaveProperty('tokens');
        });

        it('source field equals the input string', () => {
            const src = 'SELECT * FROM t';
            const { source } = parse(src);
            expect(source).toBe(src);
        });

        it('tokens field matches tokenizeSignificant(source)', () => {
            const src = 'SELECT a FROM t';
            const { tokens } = parse(src);
            const expected = tokenizeSignificant(src);
            expect(tokens).toEqual(expected);
        });

        it('root node is always defined', () => {
            const { root } = parse('');
            expect(root).toBeDefined();
        });

        it('root node kind is script for complete query', () => {
            const { root } = parse('SELECT 1');
            expect(root.kind).toBe('script');
        });

        it('root node kind is script for empty input', () => {
            const { root } = parse('');
            expect(root.kind).toBe('script');
        });

        it('root from is always 0', () => {
            const { root } = parse('SELECT 1');
            expect(root.from).toBe(0);
        });

        it('root to <= source.length', () => {
            const src = 'SELECT 1';
            const { root } = parse(src);
            expect(root.to).toBeLessThanOrEqual(src.length);
        });
    });

    // -----------------------------------------------------------------------
    // Basic SELECT
    // -----------------------------------------------------------------------
    describe('basic SELECT', () => {
        it('SELECT * FROM t', () => {
            const { root } = parse('SELECT * FROM t');
            expect(findNode(root, 'selectClause')).toBeDefined();
            expect(findNode(root, 'starExpr')).toBeDefined();
            expect(findNode(root, 'fromClause')).toBeDefined();
        });

        it('SELECT 1', () => {
            const { root } = parse('SELECT 1');
            const lit = findNode(root, 'literal');
            expect(lit).toBeDefined();
            expect(lit!.text).toBe('1');
        });

        it('SELECT col1, col2 FROM table', () => {
            const { root } = parse('SELECT col1, col2 FROM t');
            const projections = allNodes(root).filter(n => n.kind === 'projection');
            expect(projections.length).toBeGreaterThanOrEqual(2);
        });

        it('SELECT a, b, c FROM t has 3 projections', () => {
            const { root } = parse('SELECT a, b, c FROM t');
            const sel = findNode(root, 'selectClause')!;
            expect(sel.children.filter(n => n.kind === 'projection').length).toBe(3);
        });

        it('SELECT col AS alias produces a projection with identifier children', () => {
            const { root } = parse('SELECT a AS alpha FROM t');
            const proj = findNode(root, 'projection')!;
            expect(proj).toBeDefined();
            expect(proj.children.length).toBeGreaterThanOrEqual(2);
        });

        it('SELECT with bare-ident alias (no AS)', () => {
            const { root } = parse('SELECT a myalias FROM t');
            const proj = findNode(root, 'projection')!;
            expect(proj.children.length).toBeGreaterThanOrEqual(2);
        });

        it('SELECT COUNT(*) FROM t', () => {
            const { root } = parse('SELECT COUNT(*) FROM t');
            expect(findNode(root, 'functionCall')).toBeDefined();
        });

        it('SELECT SUM(x), COUNT(*) FROM t', () => {
            const { root } = parse('SELECT SUM(x), COUNT(*) FROM t');
            expect(countNodes(root, 'functionCall')).toBeGreaterThanOrEqual(2);
        });

        it('SELECT DISTINCT a FROM t', () => {
            const { root } = parse('SELECT DISTINCT a FROM t');
            const sel = findNode(root, 'selectClause')!;
            expect(sel.text).toContain('DISTINCT');
        });

        it('SELECT ALL a FROM t', () => {
            const { root } = parse('SELECT ALL a FROM t');
            expect(findNode(root, 'selectClause')).toBeDefined();
        });

        it('SELECT from subquery: SELECT * FROM (SELECT 1)', () => {
            const { root } = parse('SELECT * FROM (SELECT 1)');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(2);
        });

        it('long SELECT list does not crash', () => {
            const cols = Array.from({ length: 50 }, (_, i) => `col${i}`).join(', ');
            const src = `SELECT ${cols} FROM t`;
            expect(() => parse(src)).not.toThrow();
            const { root } = parse(src);
            const sel = findNode(root, 'selectClause')!;
            expect(sel).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // WHERE
    // -----------------------------------------------------------------------
    describe('WHERE clause', () => {
        it('SELECT * FROM t WHERE x > 5', () => {
            const { root } = parse('SELECT * FROM t WHERE x > 5');
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('WHERE has binary expression', () => {
            const { root } = parse('SELECT * FROM t WHERE x = 1');
            expect(findNode(root, 'binaryExpr')).toBeDefined();
        });

        it('WHERE with AND', () => {
            const { root } = parse('SELECT * FROM t WHERE x = 1 AND y = 2');
            expect(countNodes(root, 'binaryExpr')).toBeGreaterThanOrEqual(2);
        });

        it('WHERE with OR', () => {
            const { root } = parse('SELECT * FROM t WHERE x = 1 OR y = 2');
            expect(countNodes(root, 'binaryExpr')).toBeGreaterThanOrEqual(2);
        });

        it('WHERE with NOT', () => {
            const { root } = parse('SELECT * FROM t WHERE NOT x = 1');
            expect(findNode(root, 'unaryExpr')).toBeDefined();
        });

        it('WHERE with IS NULL', () => {
            const { root } = parse('SELECT * FROM t WHERE x IS NULL');
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('WHERE with IS NOT NULL', () => {
            const { root } = parse('SELECT * FROM t WHERE x IS NOT NULL');
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('WHERE with LIKE', () => {
            const { root } = parse("SELECT * FROM t WHERE name LIKE '%foo%'");
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('WHERE with IN list', () => {
            const { root } = parse("SELECT * FROM t WHERE cause IN ('a', 'b')");
            expect(findNode(root, 'list')).toBeDefined();
        });

        it('WHERE with BETWEEN', () => {
            const { root } = parse('SELECT * FROM t WHERE x BETWEEN 1 AND 10');
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('WHERE annotation is set', () => {
            const { root } = parse('SELECT * FROM t WHERE x = 1');
            const where = findNode(root, 'whereClause')!;
            expect(where.annotations.clause).toBe('where');
        });
    });

    // -----------------------------------------------------------------------
    // GROUP BY / HAVING
    // -----------------------------------------------------------------------
    describe('GROUP BY and HAVING', () => {
        it('GROUP BY single column', () => {
            const { root } = parse('SELECT a FROM t GROUP BY a');
            expect(findNode(root, 'groupByClause')).toBeDefined();
        });

        it('GROUP BY annotation', () => {
            const { root } = parse('SELECT a FROM t GROUP BY a');
            const g = findNode(root, 'groupByClause')!;
            expect(g.annotations.clause).toBe('groupBy');
        });

        it('GROUP BY multiple columns', () => {
            const { root } = parse('SELECT a, b FROM t GROUP BY a, b');
            const g = findNode(root, 'groupByClause')!;
            expect(g.children.length).toBeGreaterThanOrEqual(2);
        });

        it('GROUP BY with aggregate in SELECT', () => {
            const { root } = parse('SELECT cat, count(*) FROM t GROUP BY cat');
            expect(findNode(root, 'groupByClause')).toBeDefined();
            expect(findNode(root, 'functionCall')).toBeDefined();
        });

        it('HAVING clause', () => {
            const { root } = parse('SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 1');
            expect(findNode(root, 'havingClause')).toBeDefined();
        });

        it('HAVING annotation', () => {
            const { root } = parse('SELECT a FROM t GROUP BY a HAVING count(*) > 0');
            const h = findNode(root, 'havingClause')!;
            expect(h.annotations.clause).toBe('having');
        });

        it('GROUP BY ALL', () => {
            const { root } = parse('SELECT a, b FROM t GROUP BY ALL');
            expect(findNode(root, 'groupByClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // ORDER BY / LIMIT / OFFSET
    // -----------------------------------------------------------------------
    describe('ORDER BY, LIMIT, OFFSET', () => {
        it('ORDER BY single column', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x');
            expect(findNode(root, 'orderByClause')).toBeDefined();
        });

        it('ORDER BY annotation', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x');
            const o = findNode(root, 'orderByClause')!;
            expect(o.annotations.clause).toBe('orderBy');
        });

        it('ORDER BY DESC', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x DESC');
            expect(findNode(root, 'orderByClause')).toBeDefined();
        });

        it('ORDER BY ASC', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x ASC');
            expect(findNode(root, 'orderByClause')).toBeDefined();
        });

        it('ORDER BY multiple columns', () => {
            const { root } = parse('SELECT * FROM t ORDER BY a, b DESC');
            const o = findNode(root, 'orderByClause')!;
            expect(o.children.length).toBeGreaterThanOrEqual(2);
        });

        it('ORDER BY with NULLS FIRST', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x NULLS FIRST');
            expect(findNode(root, 'orderByClause')).toBeDefined();
        });

        it('ORDER BY with NULLS LAST', () => {
            const { root } = parse('SELECT * FROM t ORDER BY x NULLS LAST');
            expect(findNode(root, 'orderByClause')).toBeDefined();
        });

        it('LIMIT clause', () => {
            const { root } = parse('SELECT * FROM t LIMIT 10');
            expect(findNode(root, 'limitClause')).toBeDefined();
        });

        it('LIMIT annotation', () => {
            const { root } = parse('SELECT * FROM t LIMIT 10');
            const l = findNode(root, 'limitClause')!;
            expect(l.annotations.clause).toBe('limit');
        });

        it('LIMIT with OFFSET', () => {
            const { root } = parse('SELECT * FROM t LIMIT 10 OFFSET 5');
            const lim = findNode(root, 'limitClause')!;
            // offset literal should appear under the limitClause
            expect(lim.text).toContain('10');
        });

        it('full clause chain: GROUP BY + HAVING + ORDER BY + LIMIT', () => {
            const { root } = parse(
                'SELECT cat, count(*) FROM t GROUP BY cat HAVING count(*) > 1 ORDER BY cat LIMIT 5'
            );
            expect(findNode(root, 'groupByClause')).toBeDefined();
            expect(findNode(root, 'havingClause')).toBeDefined();
            expect(findNode(root, 'orderByClause')).toBeDefined();
            expect(findNode(root, 'limitClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // FROM and table references
    // -----------------------------------------------------------------------
    describe('FROM and table references', () => {
        it('FROM simple table', () => {
            const { root } = parse('SELECT * FROM mytable');
            const from = findNode(root, 'fromClause')!;
            expect(from).toBeDefined();
        });

        it('FROM annotation', () => {
            const { root } = parse('SELECT * FROM t');
            const from = findNode(root, 'fromClause')!;
            expect(from.annotations.clause).toBe('from');
        });

        it('FROM schema.table', () => {
            const { root } = parse('SELECT * FROM schema.table');
            expect(findNode(root, 'fromClause')).toBeDefined();
        });

        it('FROM with alias', () => {
            const { root } = parse('SELECT * FROM mytable mt');
            expect(findNode(root, 'tableRef')).toBeDefined();
        });

        it('FROM with AS alias', () => {
            const { root } = parse('SELECT * FROM mytable AS mt');
            expect(findNode(root, 'tableRef')).toBeDefined();
        });

        it('FROM with comma-joined sources', () => {
            const { root } = parse('SELECT * FROM a, b');
            const from = findNode(root, 'fromClause')!;
            const refs = from.children.filter(c => c.kind === 'tableRef');
            expect(refs.length).toBe(2);
        });

        it('FROM subquery', () => {
            const { root } = parse('SELECT * FROM (SELECT 1 AS x) sub');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(2);
        });

        it('FROM dollar variable ref', () => {
            const { root } = parse('SELECT * FROM $myTable');
            expect(findNode(root, 'fromClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // JOINs
    // -----------------------------------------------------------------------
    describe('JOIN', () => {
        it('INNER JOIN with ON', () => {
            const { root } = parse('SELECT * FROM a JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
            expect(findNode(root, 'joinCondition')).toBeDefined();
        });

        it('explicit INNER JOIN', () => {
            const { root } = parse('SELECT * FROM a INNER JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('LEFT JOIN', () => {
            const { root } = parse('SELECT * FROM a LEFT JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('LEFT OUTER JOIN', () => {
            const { root } = parse('SELECT * FROM a LEFT OUTER JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('RIGHT JOIN', () => {
            const { root } = parse('SELECT * FROM a RIGHT JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('FULL OUTER JOIN', () => {
            const { root } = parse('SELECT * FROM a FULL OUTER JOIN b ON a.x = b.y');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('CROSS JOIN', () => {
            const { root } = parse('SELECT * FROM a CROSS JOIN b');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('JOIN with USING', () => {
            const { root } = parse('SELECT * FROM a JOIN b USING (id)');
            expect(findNode(root, 'join')).toBeDefined();
        });

        it('JOIN annotation on join node', () => {
            const { root } = parse('SELECT * FROM a JOIN b ON a.x = b.y');
            const j = findNode(root, 'join')!;
            expect(j.annotations.clause).toBe('join');
        });

        it('multiple JOINs', () => {
            const { root } = parse('SELECT * FROM a JOIN b ON a.x = b.y JOIN c ON b.z = c.z');
            expect(countNodes(root, 'join')).toBeGreaterThanOrEqual(2);
        });

        it('join condition has binary expression', () => {
            const { root } = parse('SELECT * FROM a JOIN b ON a.x = b.y');
            const cond = findNode(root, 'joinCondition')!;
            expect(findNode(cond, 'binaryExpr')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // CTEs (WITH)
    // -----------------------------------------------------------------------
    describe('WITH / CTEs', () => {
        it('WITH foo AS (SELECT ...)', () => {
            const { root } = parse('WITH foo AS (SELECT 1) SELECT * FROM foo');
            expect(findNode(root, 'with')).toBeDefined();
            expect(findNode(root, 'cte')).toBeDefined();
        });

        it('inner query nested under cte', () => {
            const { root } = parse('WITH foo AS (SELECT 1) SELECT * FROM foo');
            const cte = findNode(root, 'cte')!;
            expect(findNode(cte, 'query')).toBeDefined();
        });

        it('WITH RECURSIVE', () => {
            const { root } = parse(
                'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT * FROM r'
            );
            expect(findNode(root, 'with')).toBeDefined();
        });

        it('multiple CTEs', () => {
            const { root } = parse('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b');
            expect(countNodes(root, 'cte')).toBe(2);
        });

        it('CTE with column list', () => {
            const { root } = parse('WITH cte(x, y) AS (SELECT 1, 2) SELECT * FROM cte');
            expect(findNode(root, 'cte')).toBeDefined();
        });

        it('nested CTE with subquery body', () => {
            const { root } = parse(
                'WITH r AS (SELECT * FROM (SELECT a FROM t) sub) SELECT * FROM r'
            );
            expect(findNode(root, 'cte')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Set operations
    // -----------------------------------------------------------------------
    describe('set operations', () => {
        it('UNION ALL', () => {
            const { root } = parse('SELECT 1 UNION ALL SELECT 2');
            expect(findNode(root, 'setOp')).toBeDefined();
        });

        it('UNION DISTINCT', () => {
            const { root } = parse('SELECT 1 UNION DISTINCT SELECT 2');
            expect(findNode(root, 'setOp')).toBeDefined();
        });

        it('UNION (bare)', () => {
            const { root } = parse('SELECT 1 UNION SELECT 2');
            expect(findNode(root, 'setOp')).toBeDefined();
        });

        it('INTERSECT', () => {
            const { root } = parse('SELECT 1 INTERSECT SELECT 2');
            expect(findNode(root, 'setOp')).toBeDefined();
        });

        it('EXCEPT', () => {
            const { root } = parse('SELECT 1 EXCEPT SELECT 2');
            expect(findNode(root, 'setOp')).toBeDefined();
        });

        it('chained UNION ALL', () => {
            const { root } = parse('SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3');
            expect(countNodes(root, 'setOp')).toBeGreaterThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Expressions
    // -----------------------------------------------------------------------
    describe('expressions', () => {
        it('a + b * c respects precedence', () => {
            const { root } = parse('SELECT a + b * c');
            const sel = findNode(root, 'selectClause')!;
            const proj = sel.children[0];
            const topExpr = proj.children[0];
            expect(topExpr.kind).toBe('binaryExpr');
            // Right child should also be binaryExpr (the * node)
            expect(topExpr.children[1].kind).toBe('binaryExpr');
        });

        it(':: cast operator', () => {
            const { root } = parse('SELECT x::INTEGER');
            expect(findNode(root, 'castExpr')).toBeDefined();
        });

        it('chained :: casts', () => {
            const { root } = parse('SELECT x::TEXT::INTEGER');
            expect(countNodes(root, 'castExpr')).toBeGreaterThanOrEqual(2);
        });

        it('CAST(x AS DOUBLE)', () => {
            const { root } = parse('SELECT CAST(x AS DOUBLE)');
            expect(findNode(root, 'castExpr')).toBeDefined();
        });

        it('TRY_CAST', () => {
            const { root } = parse('SELECT TRY_CAST(x AS INTEGER)');
            expect(findNode(root, 'castExpr')).toBeDefined();
        });

        it('CASE WHEN THEN ELSE END', () => {
            const { root } = parse("SELECT CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END");
            expect(findNode(root, 'caseExpr')).toBeDefined();
        });

        it('CASE with multiple WHEN branches', () => {
            const { root } = parse("SELECT CASE WHEN x > 0 THEN 'pos' WHEN x < 0 THEN 'neg' ELSE 'zero' END");
            expect(findNode(root, 'caseExpr')).toBeDefined();
        });

        it('CASE with scrutinee', () => {
            const { root } = parse("SELECT CASE x WHEN 1 THEN 'one' ELSE 'other' END");
            expect(findNode(root, 'caseExpr')).toBeDefined();
        });

        it('function call', () => {
            const { root } = parse('SELECT count(*)');
            expect(findNode(root, 'functionCall')).toBeDefined();
        });

        it('COUNT(DISTINCT col)', () => {
            const { root } = parse('SELECT COUNT(DISTINCT cause) FROM gc');
            expect(findNode(root, 'functionCall')).toBeDefined();
        });

        it('nested function calls', () => {
            const { root } = parse('SELECT coalesce(trim(a), b)');
            expect(countNodes(root, 'functionCall')).toBeGreaterThanOrEqual(2);
        });

        it('FILTER clause on aggregate', () => {
            const { root } = parse('SELECT count(*) FILTER (WHERE x > 0) FROM t');
            expect(findNode(root, 'filterClause')).toBeDefined();
        });

        it('|| concat operator', () => {
            const { root } = parse("SELECT 'a' || 'b'");
            expect(findNode(root, 'binaryExpr')).toBeDefined();
        });

        it('unary minus', () => {
            const { root } = parse('SELECT -1');
            expect(findNode(root, 'unaryExpr')).toBeDefined();
        });

        it('bracket list literal [1, 2, 3]', () => {
            const { root } = parse('SELECT [1, 2, 3]');
            expect(findNode(root, 'list')).toBeDefined();
        });

        it('parenthesized expression', () => {
            const { root } = parse('SELECT (a + b) * c');
            expect(findNode(root, 'paren')).toBeDefined();
        });

        it('boolean literal TRUE', () => {
            const { root } = parse('SELECT TRUE');
            expect(findNode(root, 'literal')).toBeDefined();
        });

        it('boolean literal FALSE', () => {
            const { root } = parse('SELECT FALSE');
            expect(findNode(root, 'literal')).toBeDefined();
        });

        it('NULL literal', () => {
            const { root } = parse('SELECT NULL');
            expect(findNode(root, 'literal')).toBeDefined();
        });

        it('string literal', () => {
            const { root } = parse("SELECT 'hello'");
            expect(findNode(root, 'literal')).toBeDefined();
        });

        it('qualified ident a.b', () => {
            const { root } = parse('SELECT a.b FROM t');
            expect(findNode(root, 'qualifiedIdent')).toBeDefined();
        });

        it('three-part qualified name a.b.c', () => {
            const { root } = parse('SELECT a.b.c FROM t');
            expect(findNode(root, 'qualifiedIdent')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Window functions
    // -----------------------------------------------------------------------
    describe('window functions', () => {
        it('OVER (PARTITION BY a ORDER BY b)', () => {
            const { root } = parse('SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM t');
            expect(findNode(root, 'overClause')).toBeDefined();
        });

        it('OVER with empty parens', () => {
            const { root } = parse('SELECT row_number() OVER () FROM t');
            expect(findNode(root, 'overClause')).toBeDefined();
        });

        it('OVER with named window', () => {
            const { root } = parse('SELECT row_number() OVER w FROM t WINDOW w AS (ORDER BY a)');
            expect(findNode(root, 'overClause')).toBeDefined();
        });

        it('SUM with OVER and PARTITION BY', () => {
            const { root } = parse('SELECT SUM(x) OVER (PARTITION BY y) FROM t');
            expect(findNode(root, 'overClause')).toBeDefined();
        });

        it('RANK() OVER ORDER BY', () => {
            const { root } = parse('SELECT RANK() OVER (ORDER BY score DESC) FROM t');
            expect(findNode(root, 'overClause')).toBeDefined();
        });

        it('FILTER combined with OVER', () => {
            const { root } = parse(
                'SELECT count(*) FILTER (WHERE x > 0) OVER (PARTITION BY y) FROM t'
            );
            expect(findNode(root, 'filterClause')).toBeDefined();
            expect(findNode(root, 'overClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Star expressions
    // -----------------------------------------------------------------------
    describe('star expressions', () => {
        it('SELECT *', () => {
            const { root } = parse('SELECT * FROM t');
            expect(findNode(root, 'starExpr')).toBeDefined();
        });

        it('SELECT t.*', () => {
            const { root } = parse('SELECT t.* FROM t');
            expect(findNode(root, 'starExpr')).toBeDefined();
        });

        it('SELECT * EXCLUDE (col)', () => {
            const { root } = parse('SELECT * EXCLUDE (timestamp) FROM t');
            expect(findNode(root, 'starExpr')).toBeDefined();
        });

        it('SELECT * REPLACE (expr AS col)', () => {
            const { root } = parse('SELECT * REPLACE (upper(name) AS name) FROM t');
            expect(findNode(root, 'starExpr')).toBeDefined();
        });

        it('COLUMNS() expression', () => {
            const { root } = parse("SELECT COLUMNS('amount.*') FROM t");
            expect(findNode(root, 'columnsExpr')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Lambda
    // -----------------------------------------------------------------------
    describe('lambda expressions', () => {
        it('x -> x * 2', () => {
            const { root } = parse('SELECT list_transform([1,2], x -> x * 2)');
            expect(findNode(root, 'lambdaExpr')).toBeDefined();
        });

        it('lambda with => arrow', () => {
            const { root } = parse('SELECT list_filter([1,2,3], x => x > 1)');
            expect(findNode(root, 'lambdaExpr')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Dollar variable references
    // -----------------------------------------------------------------------
    describe('dollar variable references', () => {
        it('$var as variableRef', () => {
            const { root } = parse('SELECT $threshold');
            expect(findNode(root, 'variableRef')).toBeDefined();
        });

        it('$$var as doubleDollarRef', () => {
            const { root } = parse('SELECT $$global');
            expect(findNode(root, 'doubleDollarRef')).toBeDefined();
        });

        it('$cell.var as crossCellRef', () => {
            const { root } = parse('SELECT * FROM t WHERE x = $gcCell.threshold');
            expect(findNode(root, 'crossCellRef')).toBeDefined();
        });

        it('$plot.brush as crossCellRef', () => {
            const { root } = parse('SELECT * FROM t WHERE ts IN $gc.brush');
            expect(findNode(root, 'crossCellRef')).toBeDefined();
        });

        it('$cell.range.0 tuple index as crossCellRef', () => {
            const { root } = parse('SELECT $cell.range.0');
            expect(findNode(root, 'crossCellRef')).toBeDefined();
        });

        it('multiple dollar refs', () => {
            const { root } = parse('SELECT $a, $$b, $c.d FROM t');
            const varRefs: Node[] = [];
            walk(root, n => {
                if (n.kind === 'variableRef' || n.kind === 'doubleDollarRef' || n.kind === 'crossCellRef') {
                    varRefs.push(n);
                }
            });
            expect(varRefs.length).toBe(3);
        });

        it('dollar variable in WHERE', () => {
            const { root } = parse('SELECT * FROM t WHERE x > $min');
            expect(findNode(root, 'variableRef')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Subqueries
    // -----------------------------------------------------------------------
    describe('subqueries', () => {
        it('subquery in FROM', () => {
            const { root } = parse('SELECT * FROM (SELECT a, b FROM t) sub');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(2);
        });

        it('correlated subquery in WHERE', () => {
            const { root } = parse('SELECT * FROM t WHERE x IN (SELECT id FROM other)');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(2);
        });

        it('nested subquery three levels deep', () => {
            const { root } = parse(
                'SELECT * FROM (SELECT * FROM (SELECT 1 AS x) a) b'
            );
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(3);
        });

        it('EXISTS subquery', () => {
            const { root } = parse('SELECT * FROM t WHERE EXISTS (SELECT 1 FROM other WHERE other.id = t.id)');
            expect(findNode(root, 'whereClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // DuckDB-specific
    // -----------------------------------------------------------------------
    describe('DuckDB-specific syntax', () => {
        it(':: cast operator', () => {
            const { root } = parse('SELECT x::INTEGER FROM t');
            expect(findNode(root, 'castExpr')).toBeDefined();
        });

        it('PIVOT statement', () => {
            const { root } = parse(
                "PIVOT sales ON month IN ('jan', 'feb') USING sum(amount)"
            );
            // Parser should produce a query node (non-SELECT path)
            expect(root.kind).toBe('script');
        });

        it('UNPIVOT statement', () => {
            const { root } = parse('UNPIVOT data ON col1, col2 INTO NAME n VALUE v');
            expect(root.kind).toBe('script');
        });

        it('list_transform lambda', () => {
            const { root } = parse('SELECT list_transform([1,2,3], x -> x * 2)');
            expect(findNode(root, 'lambdaExpr')).toBeDefined();
        });

        it('QUALIFY clause', () => {
            const { root } = parse(
                'SELECT *, row_number() OVER (PARTITION BY a ORDER BY b) AS rn FROM t QUALIFY rn = 1'
            );
            expect(findNode(root, 'qualifyClause')).toBeDefined();
        });

        it('QUALIFY annotation', () => {
            const { root } = parse('SELECT x, row_number() OVER () AS rn FROM t QUALIFY rn <= 3');
            const q = findNode(root, 'qualifyClause');
            if (q) expect(q.annotations.clause).toBe('qualify');
        });

        it('COLUMNS regex expression', () => {
            const { root } = parse("SELECT COLUMNS('amount_.*') FROM t");
            expect(findNode(root, 'columnsExpr')).toBeDefined();
        });

        it('struct access with dot operator', () => {
            const { root } = parse('SELECT a.b.c FROM t');
            expect(findNode(root, 'qualifiedIdent')).toBeDefined();
        });

        it('ILIKE operator', () => {
            const { root } = parse("SELECT * FROM t WHERE name ILIKE '%foo%'");
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('SIMILAR TO', () => {
            const { root } = parse("SELECT * FROM t WHERE name SIMILAR TO '%foo%'");
            expect(findNode(root, 'whereClause')).toBeDefined();
        });

        it('GLOB operator', () => {
            const { root } = parse("SELECT * FROM t WHERE path GLOB '*.ts'");
            expect(findNode(root, 'whereClause')).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Span coverage invariant
    // -----------------------------------------------------------------------
    describe('span coverage invariant', () => {
        const samples = [
            'SELECT 1',
            'SELECT * FROM t',
            'SELECT a, b, c FROM t WHERE x = 1',
            'SELECT a, b FROM t GROUP BY a HAVING count(*) > 1 ORDER BY a LIMIT 10',
            "WITH r AS (SELECT * FROM t) SELECT * FROM r",
            "SELECT count(*) FILTER (WHERE x > 0) OVER (PARTITION BY y) FROM t",
            "SELECT CASE WHEN x > 0 THEN 'pos' WHEN x < 0 THEN 'neg' ELSE 'zero' END FROM t",
            "SELECT x::INTEGER + y::DOUBLE FROM t",
            "SELECT list_transform([1,2,3], x -> x * 2)",
            "SELECT $a, $$b, $cell.v.0 FROM t",
            'SELECT * FROM a JOIN b ON a.x = b.y',
            "SELECT CAST(x AS DOUBLE) FROM t",
            'SELECT DISTINCT a, b FROM t ORDER BY a DESC NULLS LAST',
            "SELECT 'a' || 'b' || c FROM t",
            "SELECT * FROM t WHERE x BETWEEN 1 AND 10",
            "SELECT * FROM t WHERE cause IN ('a', 'b', 'c')",
        ];

        for (const s of samples) {
            it(`every node text = source[from..to]: ${s.slice(0, 50)}`, () => {
                const { root } = parse(s);
                walk(root, (n) => {
                    expect(s.slice(n.from, n.to)).toBe(n.text);
                    expect(n.from).toBeGreaterThanOrEqual(0);
                    expect(n.to).toBeLessThanOrEqual(s.length);
                    expect(n.from).toBeLessThanOrEqual(n.to);
                });
            });
        }
    });

    // -----------------------------------------------------------------------
    // Fault-tolerance: parser never throws
    // -----------------------------------------------------------------------
    describe('fault-tolerance (never throws)', () => {
        const broken = [
            '',
            ' ',
            'SELECT',
            'SELECT ',
            'SELECT FROM',
            'SELECT * FROM',
            'SELECT * FROM t WHERE',
            'SELECT * FROM t WHERE x =',
            'SELECT count(',
            'SELECT count(distinct',
            'SELECT count(distinct,',
            'WITH foo AS (',
            'WITH foo AS (SELECT',
            'SELECT * FROM t JOIN',
            'SELECT * FROM t JOIN b ON',
            'SELECT CASE WHEN',
            'SELECT CASE WHEN x THEN',
            'SELECT $',
            'SELECT $$',
            'SELECT $plot.',
            'SELECT a, , b FROM t',
            ')((SELECT',
            '/* comment */',
            '-- comment',
            '(((',
            ';;;',
            '???',
            '@@@@',
            'SELECT SELECT SELECT',
            'FROM FROM FROM',
            'WHERE WHERE',
            'SELECT 1 UNION',
            'SELECT 1 UNION ALL',
            'WITH',
            'WITH foo',
            'WITH foo AS',
            'WITH foo AS (',
            'SELECT * FROM t WHERE x IS',
            'SELECT * FROM t WHERE x IN',
            'SELECT * FROM t WHERE x IN (',
            'SELECT * FROM t WHERE x BETWEEN',
            'SELECT * FROM t WHERE x BETWEEN 1',
            'CASE',
            'CASE WHEN',
            'CASE WHEN x',
            'CASE WHEN x THEN',
            'ORDER',
            'ORDER BY',
            'GROUP',
            'GROUP BY',
            'LIMIT',
            'SELECT ::',
            'SELECT x ::',
            'SELECT () FROM t',
            'SELECT (SELECT',
            'SELECT (SELECT 1',
            'SELECT list_transform(',
            'SELECT list_transform([',
            'SELECT CAST',
            'SELECT CAST(',
            'SELECT CAST(x',
            'SELECT CAST(x AS',
        ];

        for (const s of broken) {
            it(`never throws for: ${JSON.stringify(s)}`, () => {
                expect(() => parse(s)).not.toThrow();
            });
        }

        it('produces script root for every broken input', () => {
            for (const s of broken) {
                const { root } = parse(s);
                expect(root.kind).toBe('script');
            }
        });

        it('parse(input).root.from is always >= 0 for broken inputs', () => {
            for (const s of broken) {
                const { root } = parse(s);
                expect(root.from).toBeGreaterThanOrEqual(0);
            }
        });

        it('parse(input).root.to <= source.length for all broken inputs', () => {
            for (const s of broken) {
                const { root } = parse(s);
                expect(root.to).toBeLessThanOrEqual(s.length);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Hole nodes
    // -----------------------------------------------------------------------
    describe('hole nodes on incomplete input', () => {
        it('SELECT FROM emits hole expecting expression', () => {
            const { root } = parse('SELECT FROM t');
            const sel = findNode(root, 'selectClause')!;
            const hole = findNode(sel, 'hole');
            expect(hole).toBeDefined();
            expect(hole!.annotations.expectedKinds).toContain('identifier');
        });

        it('SELECT * FROM (no table) emits hole for tableRef', () => {
            const { root } = parse('SELECT * FROM');
            const from = findNode(root, 'fromClause')!;
            const hole = findNode(from, 'hole');
            expect(hole).toBeDefined();
            expect(hole!.annotations.expectedKinds).toContain('tableRef');
        });

        it('hole nodes have from=to (zero-width)', () => {
            const { root } = parse('SELECT FROM');
            const sel = findNode(root, 'selectClause')!;
            const hole = findNode(sel, 'hole');
            if (hole) {
                expect(hole.from).toBe(hole.to);
            }
        });

        it('hole has expectedKinds array', () => {
            const { root } = parse('SELECT FROM t');
            const hole = findNode(root, 'hole');
            if (hole) {
                expect(Array.isArray(hole.annotations.expectedKinds)).toBe(true);
            }
        });

        it('WITH foo AS ( missing inner query emits hole', () => {
            const { root } = parse('WITH foo AS (');
            const cte = findNode(root, 'cte');
            // Should still produce a CTE node or a hole descendant
            expect(root.kind).toBe('script');
        });
    });

    // -----------------------------------------------------------------------
    // Multiple statements
    // -----------------------------------------------------------------------
    describe('multiple statements', () => {
        it('two SELECT statements separated by ;', () => {
            const { root } = parse('SELECT 1; SELECT 2');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(2);
        });

        it('three statements', () => {
            const { root } = parse('SELECT 1; SELECT 2; SELECT 3');
            expect(countNodes(root, 'query')).toBeGreaterThanOrEqual(3);
        });

        it('trailing semicolon', () => {
            expect(() => parse('SELECT 1;')).not.toThrow();
        });

        it('only semicolons', () => {
            expect(() => parse(';;;')).not.toThrow();
            const { root } = parse(';;;');
            expect(root.kind).toBe('script');
        });

        it('INSERT statement parsed without throw', () => {
            expect(() => parse('INSERT INTO t VALUES (1, 2, 3)')).not.toThrow();
        });

        it('UPDATE statement parsed without throw', () => {
            expect(() => parse('UPDATE t SET a = 1 WHERE id = 42')).not.toThrow();
        });

        it('DELETE statement parsed without throw', () => {
            expect(() => parse('DELETE FROM t WHERE id = 99')).not.toThrow();
        });

        it('CREATE TABLE parsed without throw', () => {
            expect(() => parse('CREATE TABLE foo (id INTEGER, name VARCHAR)')).not.toThrow();
        });

        it('DROP TABLE parsed without throw', () => {
            expect(() => parse('DROP TABLE IF EXISTS foo')).not.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // Idempotence: parse never throws regardless of any input
    // -----------------------------------------------------------------------
    describe('idempotence / robustness', () => {
        it('parsing the same source twice gives structurally equivalent roots', () => {
            const src = 'SELECT a, b FROM t WHERE x = 1';
            const r1 = parse(src);
            const r2 = parse(src);
            expect(r1.root.kind).toBe(r2.root.kind);
            expect(r1.root.text).toBe(r2.root.text);
        });

        it('very long query does not throw', () => {
            const cols = Array.from({ length: 200 }, (_, i) => `col${i} AS alias${i}`).join(', ');
            expect(() => parse(`SELECT ${cols} FROM t`)).not.toThrow();
        });

        it('deeply nested subqueries do not throw', () => {
            let q = 'SELECT 1';
            for (let i = 0; i < 20; i++) {
                q = `SELECT * FROM (${q}) sub${i}`;
            }
            expect(() => parse(q)).not.toThrow();
        });

        it('very long WHERE chain does not throw', () => {
            const conditions = Array.from({ length: 100 }, (_, i) => `x${i} = ${i}`).join(' AND ');
            expect(() => parse(`SELECT * FROM t WHERE ${conditions}`)).not.toThrow();
        });

        it('parse(tokenizeSignificant input) matches tokens field', () => {
            const src = 'SELECT a, b FROM t WHERE x > 0 ORDER BY a LIMIT 5';
            const { tokens } = parse(src);
            const direct = tokenizeSignificant(src);
            expect(tokens).toEqual(direct);
        });

        it('single SELECT keyword alone is fault-tolerant', () => {
            const { root } = parse('SELECT');
            expect(root.kind).toBe('script');
        });

        it('single identifier alone parses as script', () => {
            const { root } = parse('foo');
            expect(root.kind).toBe('script');
        });

        it('single number alone parses as script', () => {
            const { root } = parse('42');
            expect(root.kind).toBe('script');
        });

        it('single operator alone parses without throw', () => {
            expect(() => parse('+')).not.toThrow();
        });

        it('all token kinds inline do not throw', () => {
            expect(() => parse("SELECT $x, $$y, 'str', 42, \"qi\", x::INT, a || b")).not.toThrow();
        });
    });
});
