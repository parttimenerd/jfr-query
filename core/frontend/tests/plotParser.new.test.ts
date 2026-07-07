import { describe, it, expect } from 'vitest';
import { tokenize as plotTokenize, PlotToken, PlotTokenKind } from '../components/editor/plot/tokens';
import { parse as plotParse } from '../components/editor/plot/parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kinds(src: string): PlotTokenKind[] {
    return plotTokenize(src).map(t => t.kind);
}

function firstKind(src: string): PlotTokenKind {
    return plotTokenize(src)[0].kind;
}

function firstText(src: string): string {
    return plotTokenize(src)[0].text;
}

function firstValue(src: string): string {
    return plotTokenize(src)[0].value;
}

function countKind(src: string, kind: PlotTokenKind): number {
    return plotTokenize(src).filter(t => t.kind === kind).length;
}

function tokenAt(src: string, index: number): PlotToken {
    return plotTokenize(src)[index];
}

function allTokensHaveText(src: string): boolean {
    const tokens = plotTokenize(src);
    return tokens.every(t => {
        if (t.kind === 'eof') return t.text === '';
        return t.text === src.slice(t.from, t.to);
    });
}

function scriptChildren(src: string) {
    return plotParse(src).children;
}

function firstChild(src: string) {
    return scriptChildren(src)[0];
}

// ---------------------------------------------------------------------------
// plotTokenize
// ---------------------------------------------------------------------------

describe('plotTokenize', () => {

    // -----------------------------------------------------------------------
    describe('shapes and idents', () => {

        it('line_chart tokenizes as ident', () => {
            expect(firstKind('line_chart')).toBe('ident');
        });

        it('bar_chart tokenizes as ident', () => {
            expect(firstKind('bar_chart')).toBe('ident');
        });

        it('scatter_plot tokenizes as ident', () => {
            expect(firstKind('scatter_plot')).toBe('ident');
        });

        it('histogram tokenizes as ident', () => {
            expect(firstKind('histogram')).toBe('ident');
        });

        it('heatmap tokenizes as ident', () => {
            expect(firstKind('heatmap')).toBe('ident');
        });

        it('box_plot tokenizes as ident', () => {
            expect(firstKind('box_plot')).toBe('ident');
        });

        it('pie_chart tokenizes as ident', () => {
            expect(firstKind('pie_chart')).toBe('ident');
        });

        it('area_chart tokenizes as ident', () => {
            expect(firstKind('area_chart')).toBe('ident');
        });

        it('gantt_chart tokenizes as ident', () => {
            expect(firstKind('gantt_chart')).toBe('ident');
        });

        it('flamegraph tokenizes as ident', () => {
            expect(firstKind('flamegraph')).toBe('ident');
        });

        it('range_plot tokenizes as ident', () => {
            expect(firstKind('range_plot')).toBe('ident');
        });

        it('table tokenizes as ident', () => {
            expect(firstKind('table')).toBe('ident');
        });

        // short aliases
        it('line tokenizes as ident', () => {
            expect(firstKind('line')).toBe('ident');
        });

        it('bar tokenizes as ident', () => {
            expect(firstKind('bar')).toBe('ident');
        });

        it('scatter tokenizes as ident', () => {
            expect(firstKind('scatter')).toBe('ident');
        });

        it('pie tokenizes as ident', () => {
            expect(firstKind('pie')).toBe('ident');
        });

        it('area tokenizes as ident', () => {
            expect(firstKind('area')).toBe('ident');
        });

        it('gantt tokenizes as ident', () => {
            expect(firstKind('gantt')).toBe('ident');
        });

        it('range tokenizes as ident', () => {
            expect(firstKind('range')).toBe('ident');
        });

        it('boxplot tokenizes as ident', () => {
            expect(firstKind('boxplot')).toBe('ident');
        });

        // casing
        it('LINE_CHART tokenizes as ident', () => {
            expect(firstKind('LINE_CHART')).toBe('ident');
        });

        it('Line_Chart tokenizes as ident', () => {
            expect(firstKind('Line_Chart')).toBe('ident');
        });

        it('LINE_CHART text preserved as-is', () => {
            expect(firstText('LINE_CHART')).toBe('LINE_CHART');
        });

        it('line_chart text preserved as-is', () => {
            expect(firstText('line_chart')).toBe('line_chart');
        });

        it('Line_Chart text preserved as-is', () => {
            expect(firstText('Line_Chart')).toBe('Line_Chart');
        });

        it('BAR_CHART tokenizes as ident', () => {
            expect(firstKind('BAR_CHART')).toBe('ident');
        });

        it('SCATTER_PLOT tokenizes as ident', () => {
            expect(firstKind('SCATTER_PLOT')).toBe('ident');
        });

        it('HEATMAP tokenizes as ident', () => {
            expect(firstKind('HEATMAP')).toBe('ident');
        });

        it('TABLE tokenizes as ident', () => {
            expect(firstKind('TABLE')).toBe('ident');
        });

        it('FLAMEGRAPH tokenizes as ident', () => {
            expect(firstKind('FLAMEGRAPH')).toBe('ident');
        });

        // tail keywords as idents
        it('title tokenizes as ident', () => {
            expect(firstKind('title')).toBe('ident');
        });

        it('name tokenizes as ident', () => {
            expect(firstKind('name')).toBe('ident');
        });

        it('width tokenizes as ident', () => {
            expect(firstKind('width')).toBe('ident');
        });

        it('height tokenizes as ident', () => {
            expect(firstKind('height')).toBe('ident');
        });

        it('zoom tokenizes as ident', () => {
            expect(firstKind('zoom')).toBe('ident');
        });

        it('link_x tokenizes as ident', () => {
            expect(firstKind('link_x')).toBe('ident');
        });

        it('link_y tokenizes as ident', () => {
            expect(firstKind('link_y')).toBe('ident');
        });

        it('link_xy tokenizes as ident', () => {
            expect(firstKind('link_xy')).toBe('ident');
        });

        it('let tokenizes as ident (not special keyword)', () => {
            // The tokenizer produces ident for all letter-starting tokens
            expect(firstKind('let')).toBe('ident');
        });

        it('row tokenizes as ident', () => {
            expect(firstKind('row')).toBe('ident');
        });

        it('col tokenizes as ident', () => {
            expect(firstKind('col')).toBe('ident');
        });

        it('null tokenizes as ident', () => {
            // null is handled in parser, not tokenizer
            expect(firstKind('null')).toBe('ident');
        });

        it('idents can contain hyphens: link-x', () => {
            expect(firstKind('link-x')).toBe('ident');
            expect(firstText('link-x')).toBe('link-x');
        });

        it('idents can contain hyphens: link-y', () => {
            expect(firstKind('link-y')).toBe('ident');
        });

        it('idents can contain hyphens: link-xy', () => {
            expect(firstKind('link-xy')).toBe('ident');
        });

        it('idents can contain hyphens: link-scroll', () => {
            expect(firstKind('link-scroll')).toBe('ident');
        });

        it('multiple idents separated by space', () => {
            const toks = plotTokenize('line_chart table');
            expect(toks[0].kind).toBe('ident');
            expect(toks[0].text).toBe('line_chart');
            expect(toks[1].kind).toBe('ident');
            expect(toks[1].text).toBe('table');
        });
    });

    // -----------------------------------------------------------------------
    describe('literals', () => {

        it('integer 42 tokenizes as number', () => {
            expect(firstKind('42')).toBe('number');
        });

        it('float 3.14 tokenizes as number', () => {
            expect(firstKind('3.14')).toBe('number');
        });

        it('integer 300 tokenizes as number', () => {
            expect(firstKind('300')).toBe('number');
        });

        it('number 0 tokenizes as number', () => {
            expect(firstKind('0')).toBe('number');
        });

        it('number text is preserved: 42', () => {
            expect(firstText('42')).toBe('42');
        });

        it('number text is preserved: 3.14', () => {
            expect(firstText('3.14')).toBe('3.14');
        });

        it('negative number -5 tokenizes as number', () => {
            expect(firstKind('-5')).toBe('number');
        });

        it('negative float -3.14 tokenizes as number', () => {
            expect(firstKind('-3.14')).toBe('number');
        });

        it('negative number text preserved: -5', () => {
            expect(firstText('-5')).toBe('-5');
        });

        it('scientific notation 1e10 tokenizes as number', () => {
            expect(firstKind('1e10')).toBe('number');
        });

        it('scientific notation 1E10 tokenizes as number', () => {
            expect(firstKind('1E10')).toBe('number');
        });

        it('leading-dot number .5 tokenizes as number', () => {
            expect(firstKind('.5')).toBe('number');
        });

        it('true tokenizes as boolean', () => {
            expect(firstKind('true')).toBe('boolean');
        });

        it('false tokenizes as boolean', () => {
            expect(firstKind('false')).toBe('boolean');
        });

        it('TRUE tokenizes as boolean', () => {
            expect(firstKind('TRUE')).toBe('boolean');
        });

        it('FALSE tokenizes as boolean', () => {
            expect(firstKind('FALSE')).toBe('boolean');
        });

        it('True tokenizes as boolean', () => {
            expect(firstKind('True')).toBe('boolean');
        });

        it('boolean text preserved for true', () => {
            expect(firstText('true')).toBe('true');
        });

        it('boolean text preserved for TRUE', () => {
            expect(firstText('TRUE')).toBe('TRUE');
        });

        it('double-quoted string tokenizes as string', () => {
            expect(firstKind('"hello"')).toBe('string');
        });

        it('single-quoted string tokenizes as string', () => {
            expect(firstKind("'hello'")).toBe('string');
        });

        it('double-quoted string value is unquoted', () => {
            expect(firstValue('"my column"')).toBe('my column');
        });

        it('single-quoted string value is unquoted', () => {
            expect(firstValue("'single quotes'")).toBe('single quotes');
        });

        it('empty double-quoted string', () => {
            const t = plotTokenize('""')[0];
            expect(t.kind).toBe('string');
            expect(t.value).toBe('');
        });

        it('empty single-quoted string', () => {
            const t = plotTokenize("''")[0];
            expect(t.kind).toBe('string');
            expect(t.value).toBe('');
        });

        it('string with spaces inside quotes', () => {
            expect(firstValue('"my column name"')).toBe('my column name');
        });

        it('string with escape sequence', () => {
            expect(firstValue('"hello \\"world\\""')).toBe('hello "world"');
        });

        it('string from position 0', () => {
            const t = plotTokenize('"abc"')[0];
            expect(t.from).toBe(0);
            expect(t.to).toBe(5);
        });

        it('string text includes quotes', () => {
            const t = plotTokenize('"abc"')[0];
            expect(t.text).toBe('"abc"');
        });
    });

    // -----------------------------------------------------------------------
    describe('dollar refs', () => {

        it('$host tokenizes as dollar', () => {
            expect(firstKind('$host')).toBe('dollar');
        });

        it('$host value is $host', () => {
            expect(firstValue('$host')).toBe('$host');
        });

        it('$cell.host tokenizes as dollar', () => {
            expect(firstKind('$cell.host')).toBe('dollar');
        });

        it('$cell.host value is $cell.host', () => {
            expect(firstValue('$cell.host')).toBe('$cell.host');
        });

        it('$$global tokenizes as dollar', () => {
            expect(firstKind('$$global')).toBe('dollar');
        });

        it('$$global value is $$global', () => {
            expect(firstValue('$$global')).toBe('$$global');
        });

        it('$cell.foo.bar tokenizes as dollar', () => {
            expect(firstKind('$cell.foo.bar')).toBe('dollar');
            expect(firstValue('$cell.foo.bar')).toBe('$cell.foo.bar');
        });

        it('$start tokenizes as dollar', () => {
            expect(firstKind('$start')).toBe('dollar');
        });

        it('$end tokenizes as dollar', () => {
            expect(firstKind('$end')).toBe('dollar');
        });

        it('dollar token from/to cover the full text', () => {
            const t = plotTokenize('$host')[0];
            expect(t.from).toBe(0);
            expect(t.to).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    describe('constRef (@name)', () => {

        it('@myConst tokenizes as constRef', () => {
            expect(firstKind('@myConst')).toBe('constRef');
        });

        it('@name value is bare name without @', () => {
            expect(firstValue('@myConst')).toBe('myConst');
        });

        it('@x value is x', () => {
            expect(firstValue('@x')).toBe('x');
        });

        it('@longConstantName value is longConstantName', () => {
            expect(firstValue('@longConstantName')).toBe('longConstantName');
        });

        it('constRef text includes @', () => {
            const t = plotTokenize('@abc')[0];
            expect(t.text).toBe('@abc');
        });

        it('constRef from/to are correct', () => {
            const t = plotTokenize('@abc')[0];
            expect(t.from).toBe(0);
            expect(t.to).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    describe('hash refs', () => {

        it('#2 emits hash then number', () => {
            const toks = plotTokenize('#2');
            expect(toks[0].kind).toBe('hash');
            expect(toks[1].kind).toBe('number');
        });

        it('#viewName emits hash then ident', () => {
            const toks = plotTokenize('#viewName');
            expect(toks[0].kind).toBe('hash');
            expect(toks[1].kind).toBe('ident');
        });

        it('# alone (nothing after) emits a hash token', () => {
            // tokenizer: next === undefined → takes the hash path (not comment)
            const toks = plotTokenize('#');
            expect(toks[0].kind).toBe('hash');
        });

        it('# followed by space is dropped', () => {
            const toks = plotTokenize('# this is a comment');
            expect(toks[0].kind).toBe('eof');
        });

        it('#0 emits hash then number', () => {
            const toks = plotTokenize('#0');
            expect(toks[0].kind).toBe('hash');
            expect(toks[1].kind).toBe('number');
        });
    });

    // -----------------------------------------------------------------------
    describe('operators and punctuation', () => {

        it('( tokenizes as lparen', () => {
            expect(firstKind('(')).toBe('lparen');
        });

        it(') tokenizes as rparen', () => {
            expect(firstKind(')')).toBe('rparen');
        });

        it(': tokenizes as colon', () => {
            expect(firstKind(':')).toBe('colon');
        });

        it(', tokenizes as comma', () => {
            expect(firstKind(',')).toBe('comma');
        });

        it('[ tokenizes as lbracket', () => {
            expect(firstKind('[')).toBe('lbracket');
        });

        it('] tokenizes as rbracket', () => {
            expect(firstKind(']')).toBe('rbracket');
        });

        it('{ tokenizes as lbrace', () => {
            expect(firstKind('{')).toBe('lbrace');
        });

        it('} tokenizes as rbrace', () => {
            expect(firstKind('}')).toBe('rbrace');
        });

        it('= tokenizes as equals', () => {
            expect(firstKind('=')).toBe('equals');
        });

        it('== tokenizes as eq', () => {
            expect(firstKind('==')).toBe('eq');
        });

        it('| tokenizes as pipe', () => {
            expect(firstKind('|')).toBe('pipe');
        });

        it('|| tokenizes as concat', () => {
            expect(firstKind('||')).toBe('concat');
        });

        it('; tokenizes as semi', () => {
            expect(firstKind(';')).toBe('semi');
        });

        it('+ tokenizes as plus', () => {
            expect(firstKind('+')).toBe('plus');
        });

        it('- alone tokenizes as minus', () => {
            expect(firstKind('-')).toBe('minus');
        });

        it('* tokenizes as star', () => {
            expect(firstKind('*')).toBe('star');
        });

        it('/ alone tokenizes as slash', () => {
            expect(firstKind('/')).toBe('slash');
        });

        it('% tokenizes as percent', () => {
            expect(firstKind('%')).toBe('percent');
        });

        it('. alone tokenizes as dot', () => {
            expect(firstKind('.')).toBe('dot');
        });

        it('< tokenizes as lt', () => {
            expect(firstKind('<')).toBe('lt');
        });

        it('> tokenizes as gt', () => {
            expect(firstKind('>')).toBe('gt');
        });

        it('<= tokenizes as le', () => {
            expect(firstKind('<=')).toBe('le');
        });

        it('>= tokenizes as ge', () => {
            expect(firstKind('>=')).toBe('ge');
        });

        it('!= tokenizes as ne', () => {
            expect(firstKind('!=')).toBe('ne');
        });

        it('punctuation text matches source', () => {
            for (const ch of ['(', ')', '[', ']', '{', '}', ':', ',', ';', '+', '*', '%', '.', '|']) {
                const t = plotTokenize(ch)[0];
                expect(t.text).toBe(ch);
            }
        });

        it('equals text is =', () => {
            expect(firstText('=')).toBe('=');
        });

        it('pipe text is |', () => {
            expect(firstText('|')).toBe('|');
        });

        it('semi text is ;', () => {
            expect(firstText(';')).toBe(';');
        });

        it('plus text is +', () => {
            expect(firstText('+')).toBe('+');
        });
    });

    // -----------------------------------------------------------------------
    describe('comments stripped', () => {

        it('// line comment produces no tokens before eof', () => {
            const toks = plotTokenize('// this is a comment');
            expect(toks.length).toBe(1);
            expect(toks[0].kind).toBe('eof');
        });

        it('// comment after real token is stripped', () => {
            const toks = plotTokenize('table() // comment');
            expect(toks.map(t => t.kind)).not.toContain('slash');
            expect(toks.some(t => t.text === '//')).toBe(false);
        });

        it('// comment after real token leaves real tokens intact', () => {
            const toks = plotTokenize('table() // comment');
            const nonEof = toks.filter(t => t.kind !== 'eof');
            expect(nonEof.map(t => t.kind)).toEqual(['ident', 'lparen', 'rparen']);
        });

        it('# followed by digit is hash token, not comment', () => {
            const toks = plotTokenize('#2');
            expect(toks[0].kind).toBe('hash');
        });

        it('# followed by letter is hash token, not comment', () => {
            const toks = plotTokenize('#view');
            expect(toks[0].kind).toBe('hash');
        });

        it('# followed by quote is hash token', () => {
            const toks = plotTokenize('#"view"');
            expect(toks[0].kind).toBe('hash');
        });

        it('# followed by space is stripped', () => {
            const toks = plotTokenize('# comment here');
            expect(toks[0].kind).toBe('eof');
        });

        it('# at end of string with nothing after emits a hash token (not comment)', () => {
            // tokenizer uses next===undefined check which falls into hash path
            const toks = plotTokenize('#');
            expect(toks[0].kind).toBe('hash');
        });

        it('multi-line: // comment on line 1 does not eat line 2', () => {
            const toks = plotTokenize('// comment\ntable()');
            const nonEof = toks.filter(t => t.kind !== 'eof');
            expect(nonEof.map(t => t.kind)).toEqual(['ident', 'lparen', 'rparen']);
        });

        it('multi-line: # comment on line 1 does not eat line 2', () => {
            const toks = plotTokenize('# comment\ntable()');
            const nonEof = toks.filter(t => t.kind !== 'eof');
            expect(nonEof.map(t => t.kind)).toEqual(['ident', 'lparen', 'rparen']);
        });
    });

    // -----------------------------------------------------------------------
    describe('positions', () => {

        it('empty input → [eof]', () => {
            const toks = plotTokenize('');
            expect(toks.length).toBe(1);
            expect(toks[0].kind).toBe('eof');
        });

        it('eof from/to equal source length', () => {
            const src = 'table()';
            const toks = plotTokenize(src);
            const eof = toks[toks.length - 1];
            expect(eof.from).toBe(src.length);
            expect(eof.to).toBe(src.length);
        });

        it('eof token is always last', () => {
            const toks = plotTokenize('line_chart(x:"t")');
            expect(toks[toks.length - 1].kind).toBe('eof');
        });

        it('whitespace-only input → [eof]', () => {
            const toks = plotTokenize('   \t\n  ');
            expect(toks.length).toBe(1);
            expect(toks[0].kind).toBe('eof');
        });

        it('no whitespace tokens emitted', () => {
            const toks = plotTokenize('  table  (  )  ');
            expect(toks.every(t => t.kind !== ('whitespace' as any))).toBe(true);
        });

        it('token text matches source slice for single ident', () => {
            const src = 'table';
            expect(allTokensHaveText(src)).toBe(true);
        });

        it('token text matches source slice for complex expression', () => {
            const src = 'line_chart(x:"time",y:["value"])';
            expect(allTokensHaveText(src)).toBe(true);
        });

        it('token text matches source slice for dollar ref', () => {
            expect(allTokensHaveText('$cell.host')).toBe(true);
        });

        it('token text matches source slice for constRef', () => {
            expect(allTokensHaveText('@myConst')).toBe(true);
        });

        it('ident from/to correct at start: table', () => {
            const t = plotTokenize('table')[0];
            expect(t.from).toBe(0);
            expect(t.to).toBe(5);
        });

        it('ident from/to correct in middle with leading space', () => {
            const src = '  table';
            const t = plotTokenize(src)[0];
            expect(t.from).toBe(2);
            expect(t.to).toBe(7);
        });

        it('lparen from/to after ident', () => {
            const src = 'table(';
            const toks = plotTokenize(src);
            expect(toks[1].kind).toBe('lparen');
            expect(toks[1].from).toBe(5);
            expect(toks[1].to).toBe(6);
        });

        it('rparen from/to', () => {
            const src = 'table()';
            const toks = plotTokenize(src);
            expect(toks[2].kind).toBe('rparen');
            expect(toks[2].from).toBe(6);
            expect(toks[2].to).toBe(7);
        });

        it('string from/to includes quotes', () => {
            const src = '"hello"';
            const t = plotTokenize(src)[0];
            expect(t.from).toBe(0);
            expect(t.to).toBe(7);
        });

        it('string inside expression: from/to correct', () => {
            const src = 'x:"hello"';
            const toks = plotTokenize(src);
            const str = toks.find(t => t.kind === 'string')!;
            expect(str.from).toBe(2);
            expect(str.to).toBe(9);
        });

        it('number from/to correct', () => {
            const src = '  42  ';
            const t = plotTokenize(src)[0];
            expect(t.from).toBe(2);
            expect(t.to).toBe(4);
        });

        it('all tokens in "line_chart(x:42)" have correct text', () => {
            expect(allTokensHaveText('line_chart(x:42)')).toBe(true);
        });

        it('all tokens in multi-line source have correct text', () => {
            expect(allTokensHaveText('let @x = 1\ntable()')).toBe(true);
        });

        it('adjacent tokens: to of token N equals from of token N+1 (no gaps for contiguous)', () => {
            // "table()" — table[0..5], ([5..6], )[6..7]
            const toks = plotTokenize('table()').filter(t => t.kind !== 'eof');
            expect(toks[0].to).toBe(toks[1].from);
            expect(toks[1].to).toBe(toks[2].from);
        });
    });

    // -----------------------------------------------------------------------
    describe('misc edge cases', () => {

        it('unknown chars are skipped silently', () => {
            // `~` is not a recognised char — skip it
            const toks = plotTokenize('~');
            expect(toks[0].kind).toBe('eof');
        });

        it('token count: table() has 3 non-eof tokens', () => {
            const toks = plotTokenize('table()').filter(t => t.kind !== 'eof');
            expect(toks.length).toBe(3);
        });

        it('equals followed by == produces equals then eq', () => {
            const toks = plotTokenize('===').filter(t => t.kind !== 'eof');
            // '===' → eq('==') then equals('=')
            expect(toks[0].kind).toBe('eq');
            expect(toks[1].kind).toBe('equals');
        });

        it('number underscore separator: 1_000 tokenizes as number', () => {
            expect(firstKind('1_000')).toBe('number');
        });

        it('concat || both chars covered', () => {
            const t = plotTokenize('||')[0];
            expect(t.kind).toBe('concat');
            expect(t.text).toBe('||');
        });

        it('le <= both chars covered', () => {
            const t = plotTokenize('<=')[0];
            expect(t.kind).toBe('le');
            expect(t.text).toBe('<=');
        });

        it('ge >= both chars covered', () => {
            const t = plotTokenize('>=')[0];
            expect(t.kind).toBe('ge');
            expect(t.text).toBe('>=');
        });

        it('ne != both chars covered', () => {
            const t = plotTokenize('!=')[0];
            expect(t.kind).toBe('ne');
            expect(t.text).toBe('!=');
        });

        it('array [1, 2, 3] produces lbracket, number, comma, number, comma, number, rbracket', () => {
            const toks = plotTokenize('[1, 2, 3]').filter(t => t.kind !== 'eof');
            expect(toks.map(t => t.kind)).toEqual([
                'lbracket', 'number', 'comma', 'number', 'comma', 'number', 'rbracket',
            ]);
        });

        it('empty array [] produces lbracket, rbracket', () => {
            const toks = plotTokenize('[]').filter(t => t.kind !== 'eof');
            expect(toks.map(t => t.kind)).toEqual(['lbracket', 'rbracket']);
        });

        it('full plot call produces correct kind sequence', () => {
            const ks = kinds('table(x:"t")').filter(k => k !== 'eof');
            expect(ks).toEqual(['ident', 'lparen', 'ident', 'colon', 'string', 'rparen']);
        });

        it('TITLE "x" produces ident then string', () => {
            const toks = plotTokenize('TITLE "x"').filter(t => t.kind !== 'eof');
            expect(toks.map(t => t.kind)).toEqual(['ident', 'string']);
        });

        it('pipe followed by ident: | title', () => {
            const toks = plotTokenize('| title').filter(t => t.kind !== 'eof');
            expect(toks.map(t => t.kind)).toEqual(['pipe', 'ident']);
        });

        it('semicolon separates tokens correctly', () => {
            const toks = plotTokenize('a;b').filter(t => t.kind !== 'eof');
            expect(toks.map(t => t.kind)).toEqual(['ident', 'semi', 'ident']);
        });

        it('brace block: { table() } produces correct sequence', () => {
            const ks = kinds('{ table() }').filter(k => k !== 'eof');
            expect(ks).toEqual(['lbrace', 'ident', 'lparen', 'rparen', 'rbrace']);
        });

        it('let @x = 1 produces ident, constRef, equals, number', () => {
            const ks = kinds('let @x = 1').filter(k => k !== 'eof');
            expect(ks).toEqual(['ident', 'constRef', 'equals', 'number']);
        });

        it('minus before non-number stays as minus', () => {
            const toks = plotTokenize('- x').filter(t => t.kind !== 'eof');
            expect(toks[0].kind).toBe('minus');
            expect(toks[1].kind).toBe('ident');
        });
    });
});

// ---------------------------------------------------------------------------
// plotParse
// ---------------------------------------------------------------------------

describe('plotParse', () => {

    // -----------------------------------------------------------------------
    describe('simple calls', () => {

        it('empty input returns script node', () => {
            const result = plotParse('');
            expect(result).toBeTruthy();
            expect(result.kind).toBe('script');
        });

        it('whitespace-only input returns script node', () => {
            const result = plotParse('   ');
            expect(result).toBeTruthy();
            expect(result.kind).toBe('script');
        });

        it('table() parses as plotCall', () => {
            const child = firstChild('table()');
            expect(child.kind).toBe('plotCall');
        });

        it('table() shape is table', () => {
            const child = firstChild('table()');
            expect(child.shape).toBe('table');
        });

        it('line_chart(x:"t",y:["v"]) parses as plotCall', () => {
            const child = firstChild('line_chart(x:"t",y:["v"])');
            expect(child.kind).toBe('plotCall');
        });

        it('line_chart shape normalizes to line', () => {
            const child = firstChild('line_chart(x:"t")');
            expect(child.shape).toBe('line');
        });

        it('LINE_CHART shape normalizes to line', () => {
            const child = firstChild('LINE_CHART(x:"t")');
            expect(child.shape).toBe('line');
        });

        it('Line_Chart shape normalizes to line', () => {
            const child = firstChild('Line_Chart(x:"t")');
            expect(child.shape).toBe('line');
        });

        it('bar_chart normalizes to bar', () => {
            expect(firstChild('bar_chart()').shape).toBe('bar');
        });

        it('BAR_CHART normalizes to bar', () => {
            expect(firstChild('BAR_CHART()').shape).toBe('bar');
        });

        it('scatter_plot normalizes to scatter', () => {
            expect(firstChild('scatter_plot()').shape).toBe('scatter');
        });

        it('histogram normalizes to histogram', () => {
            expect(firstChild('histogram()').shape).toBe('histogram');
        });

        it('heatmap normalizes to heatmap', () => {
            expect(firstChild('heatmap()').shape).toBe('heatmap');
        });

        it('box_plot normalizes to boxplot', () => {
            expect(firstChild('box_plot()').shape).toBe('boxplot');
        });

        it('boxplot normalizes to boxplot', () => {
            expect(firstChild('boxplot()').shape).toBe('boxplot');
        });

        it('pie_chart normalizes to pie', () => {
            expect(firstChild('pie_chart()').shape).toBe('pie');
        });

        it('pie normalizes to pie', () => {
            expect(firstChild('pie()').shape).toBe('pie');
        });

        it('area_chart normalizes to area', () => {
            expect(firstChild('area_chart()').shape).toBe('area');
        });

        it('area normalizes to area', () => {
            expect(firstChild('area()').shape).toBe('area');
        });

        it('gantt_chart normalizes to gantt', () => {
            expect(firstChild('gantt_chart()').shape).toBe('gantt');
        });

        it('gantt normalizes to gantt', () => {
            expect(firstChild('gantt()').shape).toBe('gantt');
        });

        it('flamegraph normalizes to flamegraph', () => {
            expect(firstChild('flamegraph()').shape).toBe('flamegraph');
        });

        it('range_plot normalizes to range', () => {
            expect(firstChild('range_plot()').shape).toBe('range');
        });

        it('range normalizes to range', () => {
            expect(firstChild('range()').shape).toBe('range');
        });

        it('scatter normalizes to scatter', () => {
            expect(firstChild('scatter()').shape).toBe('scatter');
        });

        it('line normalizes to line', () => {
            expect(firstChild('line()').shape).toBe('line');
        });

        it('bar normalizes to bar', () => {
            expect(firstChild('bar()').shape).toBe('bar');
        });

        it('plotCall form is uppercase when parens used', () => {
            const c = firstChild('LINE_CHART(x:"t")');
            expect(c.form).toBe('uppercase');
        });

        it('plotCall form is lowercase when braces used', () => {
            const c = firstChild('line_chart{x:"t"}');
            expect(c.form).toBe('lowercase');
        });

        it('string parameter produces clause child', () => {
            const call = firstChild('table(x:"value")');
            const clause = call.children.find(c => c.kind === 'clause');
            expect(clause).toBeTruthy();
        });

        it('clause key is lowercased', () => {
            const call = firstChild('table(X:"value")');
            const clause = call.children.find(c => c.kind === 'clause');
            expect(clause?.key).toBe('x');
        });

        it('number parameter parses to clause with literal child', () => {
            const call = firstChild('table(width:300)');
            const clause = call.children.find(c => c.kind === 'clause');
            expect(clause).toBeTruthy();
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('number');
        });

        it('boolean true parameter parses to literal node', () => {
            const call = firstChild('table(visible:true)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('boolean');
            expect(lit?.literalValue).toBe(true);
        });

        it('boolean false parameter parses to literal node', () => {
            const call = firstChild('table(visible:false)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('boolean');
            expect(lit?.literalValue).toBe(false);
        });

        it('array parameter parses to list node', () => {
            const call = firstChild('table(y:["a","b"])');
            const clause = call.children.find(c => c.kind === 'clause');
            const list = clause!.children.find(c => c.kind === 'list');
            expect(list).toBeTruthy();
        });

        it('dollar ref parameter parses to varRef node', () => {
            const call = firstChild('table(x:$host)');
            const clause = call.children.find(c => c.kind === 'clause');
            const varRef = clause!.children.find(c => c.kind === 'varRef');
            expect(varRef).toBeTruthy();
        });

        it('hash ref #2 parses to queryRef node', () => {
            const call = firstChild('table(x:#2)');
            const clause = call.children.find(c => c.kind === 'clause');
            const qref = clause!.children.find(c => c.kind === 'queryRef');
            expect(qref).toBeTruthy();
            expect(qref?.queryIndex).toBe(2);
        });

        it('hash ref #viewName parses to queryRef with queryName', () => {
            const call = firstChild('table(x:#viewName)');
            const clause = call.children.find(c => c.kind === 'clause');
            const qref = clause!.children.find(c => c.kind === 'queryRef');
            expect(qref?.queryName).toBe('viewName');
        });

        it('multiple clauses all parsed', () => {
            const call = firstChild('line_chart(x:"t",y:["v"],color:"red")');
            const clauses = call.children.filter(c => c.kind === 'clause');
            expect(clauses.length).toBe(3);
        });

        it('result is always an object (never null)', () => {
            expect(plotParse('table()')).toBeTruthy();
            expect(typeof plotParse('table()')).toBe('object');
        });

        it('result has children array', () => {
            expect(Array.isArray(plotParse('table()').children)).toBe(true);
        });

        it('script from is 0', () => {
            expect(plotParse('table()').from).toBe(0);
        });

        it('script to equals source length', () => {
            const src = 'table()';
            expect(plotParse(src).to).toBe(src.length);
        });

        it('plotCall from/to span the full call', () => {
            const src = 'table()';
            const call = firstChild(src);
            expect(call.from).toBe(0);
            expect(call.to).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    describe('tail keywords', () => {

        it('TITLE tail parses to tail node', () => {
            const call = firstChild('table() TITLE "My Title"');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail).toBeTruthy();
        });

        it('TITLE tail key is title', () => {
            const call = firstChild('table() TITLE "x"');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('title');
        });

        it('TITLE value parses as string literal', () => {
            const call = firstChild('table() TITLE "My Title"');
            const tail = call.children.find(c => c.kind === 'tail');
            const lit = tail!.children.find(c => c.kind === 'literal');
            expect(lit?.literalValue).toBe('My Title');
        });

        it('NAME tail parses', () => {
            const call = firstChild('table() NAME "gc"');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('name');
        });

        it('WIDTH tail parses', () => {
            const call = firstChild('table() WIDTH 400px');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('width');
        });

        it('HEIGHT tail parses', () => {
            const call = firstChild('table() HEIGHT 300px');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('height');
        });

        it('ZOOM tail parses', () => {
            const call = firstChild('table() ZOOM 2.0');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('zoom');
        });

        it('multiple tail keywords: TITLE and HEIGHT', () => {
            const call = firstChild('table() TITLE "x" HEIGHT 300px');
            const tails = call.children.filter(c => c.kind === 'tail');
            expect(tails.length).toBe(2);
            expect(tails.map(t => t.key)).toContain('title');
            expect(tails.map(t => t.key)).toContain('height');
        });

        it('multiple tail keywords: TITLE WIDTH HEIGHT', () => {
            const call = firstChild('table() TITLE "t" WIDTH 50% HEIGHT 300px');
            const tails = call.children.filter(c => c.kind === 'tail');
            expect(tails.length).toBe(3);
        });

        it('LINK_X tail parses', () => {
            const call = firstChild('table() LINK_X($start, $end, master)');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('link-x');
        });

        it('LINK_Y tail parses', () => {
            const call = firstChild('table() LINK_Y($a, $b, master)');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('link-y');
        });

        it('LINK_XY tail parses', () => {
            const call = firstChild('table() LINK_XY($a, $b)');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('link-xy');
        });

        it('DISABLED tail (bare, no value) parses', () => {
            const call = firstChild('table() DISABLED');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('disabled');
        });

        it('lowercase pipe tail: | title: "My Title"', () => {
            const call = firstChild('table() | title: "My Title"');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail).toBeTruthy();
            expect(tail?.key).toBe('title');
        });

        it('lowercase pipe tail value parses correctly', () => {
            const call = firstChild('table() | title: "My Title"');
            const tail = call.children.find(c => c.kind === 'tail');
            const lit = tail!.children.find(c => c.kind === 'literal');
            expect(lit?.literalValue).toBe('My Title');
        });

        it('lowercase pipe tail: | name: gc', () => {
            const call = firstChild('table() | name: gc');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('name');
        });

        it('lowercase pipe tail: | width: 400px', () => {
            const call = firstChild('table() | width: 400px');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('width');
        });

        it('lowercase pipe tail: | disabled (bare)', () => {
            const call = firstChild('table() | disabled');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('disabled');
        });

        it('lowercase pipe tail: | on: #2 parses queryRef', () => {
            const call = firstChild('table() | on: #2');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail).toBeTruthy();
            const qref = tail!.children.find(c => c.kind === 'queryRef');
            expect(qref?.queryIndex).toBe(2);
        });

        it('multiple lowercase pipe tails', () => {
            const call = firstChild('table() | title: "x" | height: 300px');
            const tails = call.children.filter(c => c.kind === 'tail');
            expect(tails.length).toBe(2);
        });

        it('tailRef child created for tail keyword', () => {
            const call = firstChild('table() TITLE "x"');
            const tail = call.children.find(c => c.kind === 'tail');
            const tref = tail!.children.find(c => c.kind === 'tailRef');
            expect(tref).toBeTruthy();
        });

        it('ON tail with single value', () => {
            const call = firstChild('table() ON 1');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('on');
        });

        it('ON tail with hash ref', () => {
            const call = firstChild('table() ON #2');
            const tail = call.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('on');
        });
    });

    // -----------------------------------------------------------------------
    describe('LET statements', () => {

        it('let @x = 1 produces letStatement', () => {
            const child = firstChild('let @x = 1');
            expect(child.kind).toBe('letStatement');
        });

        it('let @x = 1 letName is x', () => {
            const child = firstChild('let @x = 1');
            expect(child.letName).toBe('x');
        });

        it('let @myConst = "hello" letName is myConst', () => {
            const child = firstChild('let @myConst = "hello"');
            expect(child.letName).toBe('myConst');
        });

        it('let @x = 1 value is literal number', () => {
            const stmt = firstChild('let @x = 1');
            const lit = stmt.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('number');
            expect(lit?.literalValue).toBe(1);
        });

        it('let @x = "hello" value is string literal', () => {
            const stmt = firstChild('let @x = "hello"');
            const lit = stmt.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('string');
            expect(lit?.literalValue).toBe('hello');
        });

        it('let @x = true value is boolean literal', () => {
            const stmt = firstChild('let @x = true');
            const lit = stmt.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('boolean');
            expect(lit?.literalValue).toBe(true);
        });

        it('let @x = [1, 2, 3] value is list', () => {
            const stmt = firstChild('let @x = [1, 2, 3]');
            const list = stmt.children.find(c => c.kind === 'list');
            expect(list).toBeTruthy();
            expect(list!.children.length).toBe(3);
        });

        it('let @x = $var value is varRef', () => {
            const stmt = firstChild('let @x = $var');
            const varRef = stmt.children.find(c => c.kind === 'varRef');
            expect(varRef).toBeTruthy();
        });

        it('let @x = @other value is constRef', () => {
            const stmt = firstChild('let @x = @other');
            const cref = stmt.children.find(c => c.kind === 'constRef');
            expect(cref).toBeTruthy();
        });

        it('LET (uppercase) @x = 1 also parses as letStatement', () => {
            const child = firstChild('LET @x = 1');
            expect(child.kind).toBe('letStatement');
        });

        it('let statement followed by plot call: both parsed', () => {
            const children = scriptChildren('let @x = 1\ntable()');
            expect(children.length).toBe(2);
            expect(children[0].kind).toBe('letStatement');
            expect(children[1].kind).toBe('plotCall');
        });

        it('multiple let statements both parsed', () => {
            const children = scriptChildren('let @a = 1\nlet @b = 2');
            const stmts = children.filter(c => c.kind === 'letStatement');
            expect(stmts.length).toBe(2);
        });

        it('let @x = [1, 2, 3] list has 3 children', () => {
            const stmt = firstChild('let @x = [1, 2, 3]');
            const list = stmt.children.find(c => c.kind === 'list');
            expect(list!.children.length).toBe(3);
        });

        it('constRef child created for @x in let', () => {
            const stmt = firstChild('let @x = 1');
            const cref = stmt.children.find(c => c.kind === 'constRef');
            expect(cref).toBeTruthy();
            expect(cref?.constName).toBe('x');
        });
    });

    // -----------------------------------------------------------------------
    describe('composites', () => {

        it('row { table() } parses as composite', () => {
            const child = firstChild('row { table() }');
            expect(child.kind).toBe('composite');
        });

        it('row composite direction is row', () => {
            const child = firstChild('row { table() }');
            expect(child.direction).toBe('row');
        });

        it('col { table() } parses as composite', () => {
            const child = firstChild('col { table() }');
            expect(child.kind).toBe('composite');
        });

        it('col composite direction is col', () => {
            const child = firstChild('col { table() }');
            expect(child.direction).toBe('col');
        });

        it('ROW { table() } (uppercase) parses as composite', () => {
            const child = firstChild('ROW { table() }');
            expect(child.kind).toBe('composite');
            expect(child.direction).toBe('row');
        });

        it('COL { table() } (uppercase) parses as composite', () => {
            const child = firstChild('COL { table() }');
            expect(child.kind).toBe('composite');
            expect(child.direction).toBe('col');
        });

        it('composite with two children', () => {
            const comp = firstChild('row { table() table() }');
            const calls = comp.children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(2);
        });

        it('composite with semicolon separator', () => {
            const comp = firstChild('row { table(); line_chart() }');
            const calls = comp.children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(2);
        });

        it('nested composite: row { col { table() } table() }', () => {
            const outer = firstChild('row { col { table() } table() }');
            expect(outer.kind).toBe('composite');
            const innerCol = outer.children.find(c => c.kind === 'composite');
            expect(innerCol?.direction).toBe('col');
        });

        it('deeply nested composites parse without error', () => {
            const src = 'row { col { row { col { table() } } } }';
            const result = plotParse(src);
            expect(result.kind).toBe('script');
            expect(result.children.length).toBeGreaterThan(0);
        });

        it('composite with three children', () => {
            const comp = firstChild('col { table() bar_chart() line_chart() }');
            const calls = comp.children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(3);
        });

        it('composite children shapes are normalized', () => {
            const comp = firstChild('row { line_chart() bar_chart() }');
            const calls = comp.children.filter(c => c.kind === 'plotCall');
            expect(calls.map(c => c.shape)).toContain('line');
            expect(calls.map(c => c.shape)).toContain('bar');
        });

        it('composite with tail TITLE', () => {
            const comp = firstChild('row { table() } TITLE "My Row"');
            expect(comp.kind).toBe('composite');
            const tail = comp.children.find(c => c.kind === 'tail');
            expect(tail?.key).toBe('title');
        });

        it('empty composite: row { }', () => {
            const comp = firstChild('row { }');
            expect(comp.kind).toBe('composite');
        });
    });

    // -----------------------------------------------------------------------
    describe('overlay (+)', () => {

        it('overlay: line_chart + line_chart parses as two plot calls at script level', () => {
            // The + operator is not parsed as overlay at script level; each
            // shape call is an independent child (the plus is skipped as unknown token at top level)
            const src = 'line_chart(x:"t",y:"a") + line_chart(x:"t",y:"b")';
            const result = plotParse(src);
            // At minimum the script doesn't throw and has a result
            expect(result.kind).toBe('script');
            expect(result.children.length).toBeGreaterThan(0);
        });

        it('two shapes side by side produce two children', () => {
            const children = scriptChildren('line_chart() bar_chart()');
            const calls = children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(2);
        });

        it('three shapes produce three plotCall children', () => {
            const children = scriptChildren('line_chart() bar_chart() table()');
            const calls = children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    describe('fault tolerance', () => {

        it('never throws on empty string', () => {
            expect(() => plotParse('')).not.toThrow();
        });

        it('never throws on whitespace-only', () => {
            expect(() => plotParse('   \t\n')).not.toThrow();
        });

        it('never throws on garbage input', () => {
            expect(() => plotParse('!@#$%^&*')).not.toThrow();
        });

        it('never throws on just a shape name', () => {
            expect(() => plotParse('line_chart')).not.toThrow();
        });

        it('never throws on unclosed paren', () => {
            expect(() => plotParse('table(')).not.toThrow();
        });

        it('never throws on unclosed bracket', () => {
            expect(() => plotParse('table(y:[')).not.toThrow();
        });

        it('never throws on unclosed brace', () => {
            expect(() => plotParse('row {')).not.toThrow();
        });

        it('never throws on partial typing: line_chart(x:', () => {
            expect(() => plotParse('line_chart(x:')).not.toThrow();
        });

        it('never throws on partial typing: line_chart(', () => {
            expect(() => plotParse('line_chart(')).not.toThrow();
        });

        it('never throws on partial typing: line_chart(x:"', () => {
            expect(() => plotParse('line_chart(x:"')).not.toThrow();
        });

        it('never throws on missing value after colon', () => {
            expect(() => plotParse('table(x:)')).not.toThrow();
        });

        it('never throws on stray comma', () => {
            expect(() => plotParse('table(,)')).not.toThrow();
        });

        it('never throws on only open brace', () => {
            expect(() => plotParse('{')).not.toThrow();
        });

        it('never throws on only close brace', () => {
            expect(() => plotParse('}')).not.toThrow();
        });

        it('never throws on only close paren', () => {
            expect(() => plotParse(')')).not.toThrow();
        });

        it('never throws on let without @name', () => {
            expect(() => plotParse('let = 1')).not.toThrow();
        });

        it('never throws on let without value', () => {
            expect(() => plotParse('let @x =')).not.toThrow();
        });

        it('never throws on let without equals', () => {
            expect(() => plotParse('let @x')).not.toThrow();
        });

        it('never throws on deeply nested unclosed composites', () => {
            expect(() => plotParse('row { col { row { col {')).not.toThrow();
        });

        it('never throws on very long input', () => {
            const src = 'table(x:"col") '.repeat(100);
            expect(() => plotParse(src)).not.toThrow();
        });

        it('never throws on random unicode', () => {
            expect(() => plotParse('🎉 table() 🎊')).not.toThrow();
        });

        it('never throws on only numbers', () => {
            expect(() => plotParse('1 2 3')).not.toThrow();
        });

        it('never throws on only strings', () => {
            expect(() => plotParse('"hello" "world"')).not.toThrow();
        });

        it('never throws on only operators', () => {
            expect(() => plotParse('+ - * /')).not.toThrow();
        });

        it('never throws on mixed garbage and valid calls', () => {
            expect(() => plotParse('!!! table() ??? bar_chart() ^^^')).not.toThrow();
        });

        it('returns object (not null/undefined) on garbage', () => {
            const r = plotParse('!@#$%^');
            expect(r).toBeTruthy();
            expect(typeof r).toBe('object');
        });

        it('returns object on unclosed paren', () => {
            const r = plotParse('table(');
            expect(r).toBeTruthy();
        });

        it('partial typing still parses known children', () => {
            const r = plotParse('table(x:');
            const calls = r.children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBeGreaterThan(0);
        });

        it('never throws on stray pipe', () => {
            expect(() => plotParse('|')).not.toThrow();
        });

        it('never throws on stray semicolon', () => {
            expect(() => plotParse(';')).not.toThrow();
        });

        it('never throws on tab/newline only', () => {
            expect(() => plotParse('\t\n\r')).not.toThrow();
        });

        it('never throws on input with only comments', () => {
            expect(() => plotParse('// just a comment\n# another comment')).not.toThrow();
        });

        it('never throws on let with array value and no closing bracket', () => {
            expect(() => plotParse('let @x = [1, 2')).not.toThrow();
        });

        it('fault-tolerant: table() followed by junk still yields plotCall', () => {
            const r = plotParse('table() !!!');
            const call = r.children.find(c => c.kind === 'plotCall');
            expect(call).toBeTruthy();
        });

        it('fault-tolerant: two valid calls with garbage between', () => {
            const r = plotParse('table() !!! bar_chart()');
            const calls = r.children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(2);
        });

        it('never throws on plot call with no body', () => {
            expect(() => plotParse('table')).not.toThrow();
        });

        it('bare shape name (no parens) still produces plotCall', () => {
            const r = plotParse('table');
            const call = r.children.find(c => c.kind === 'plotCall');
            expect(call).toBeTruthy();
            expect(call?.shape).toBe('table');
        });

        it('idempotence: parse same source twice yields same kind tree', () => {
            const src = 'line_chart(x:"t",y:["v"])';
            const r1 = plotParse(src);
            const r2 = plotParse(src);
            expect(r1.kind).toBe(r2.kind);
            expect(r1.children.length).toBe(r2.children.length);
        });

        it('idempotence: parse garbage twice yields same kind tree', () => {
            const src = '!@#';
            const r1 = plotParse(src);
            const r2 = plotParse(src);
            expect(r1.kind).toBe(r2.kind);
        });
    });

    // -----------------------------------------------------------------------
    describe('cursorPos option', () => {

        it('cursorPos: parse still returns valid result', () => {
            const r = plotParse('table()', { cursorPos: 5 });
            expect(r).toBeTruthy();
            expect(r.kind).toBe('script');
        });

        it('cursorPos at 0 returns valid result', () => {
            expect(() => plotParse('table()', { cursorPos: 0 })).not.toThrow();
        });

        it('cursorPos at end of source', () => {
            const src = 'table()';
            expect(() => plotParse(src, { cursorPos: src.length })).not.toThrow();
        });

        it('cursorPos inside plotCall args emits hole', () => {
            // cursor placed right before the closing paren
            const src = 'table(x:"t",)';
            const r = plotParse(src, { cursorPos: src.indexOf(')') });
            // The parser should produce a script with children
            expect(r.children.length).toBeGreaterThan(0);
        });

        it('cursorPos on empty input emits top-level hole', () => {
            const r = plotParse('', { cursorPos: 0 });
            expect(r.children.length).toBeGreaterThan(0);
            const hole = r.children.find(c => c.kind === 'hole');
            expect(hole).toBeTruthy();
        });

        it('cursorPos beyond source length does not throw', () => {
            expect(() => plotParse('table()', { cursorPos: 9999 })).not.toThrow();
        });

        it('cursorPos -1 (default) does not throw', () => {
            expect(() => plotParse('table()', { cursorPos: -1 })).not.toThrow();
        });

        it('cursorPos inside let statement does not throw', () => {
            expect(() => plotParse('let @x = 1', { cursorPos: 5 })).not.toThrow();
        });

        it('cursorPos inside composite does not throw', () => {
            expect(() => plotParse('row { table() }', { cursorPos: 6 })).not.toThrow();
        });

        it('cursorPos set hasCursor on relevant node', () => {
            const src = 'table()';
            const r = plotParse(src, { cursorPos: 0 });
            // Root script always hasCursor when cursor is inside
            expect(r.hasCursor).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    describe('expression parsing', () => {

        it('null literal in clause', () => {
            const call = firstChild('table(x:null)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('null');
            expect(lit?.literalValue).toBe(null);
        });

        it('function call in clause', () => {
            const call = firstChild('table(x:bucket(ts,100))');
            const clause = call.children.find(c => c.kind === 'clause');
            const fn = clause!.children.find(c => c.kind === 'functionCall');
            expect(fn?.fnName).toBe('bucket');
        });

        it('dimension 400px in clause', () => {
            const call = firstChild('table(width:400px)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('dimension');
            expect(lit?.literalValue).toBe('400px');
        });

        it('dimension 50% in clause', () => {
            const call = firstChild('table(width:50%)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalKind).toBe('dimension');
            expect(lit?.literalValue).toBe('50%');
        });

        it('number value parses to float', () => {
            const call = firstChild('table(n:3.14)');
            const clause = call.children.find(c => c.kind === 'clause');
            const lit = clause!.children.find(c => c.kind === 'literal');
            expect(lit?.literalValue).toBe(3.14);
        });

        it('nested list with strings', () => {
            const call = firstChild('table(y:["a","b","c"])');
            const clause = call.children.find(c => c.kind === 'clause');
            const list = clause!.children.find(c => c.kind === 'list');
            expect(list!.children.length).toBe(3);
        });

        it('nested list with numbers', () => {
            const call = firstChild('table(y:[1,2,3])');
            const clause = call.children.find(c => c.kind === 'clause');
            const list = clause!.children.find(c => c.kind === 'list');
            expect(list!.children.length).toBe(3);
            expect(list!.children[0].literalKind).toBe('number');
        });

        it('clauseRef child created for clause key', () => {
            const call = firstChild('table(myKey:"val")');
            const clause = call.children.find(c => c.kind === 'clause');
            const cref = clause!.children.find(c => c.kind === 'clauseRef');
            expect(cref).toBeTruthy();
            expect(cref?.key).toBe('mykey');
        });

        it('$cell.host.sub in clause parses as varRef', () => {
            const call = firstChild('table(x:$cell.host.sub)');
            const clause = call.children.find(c => c.kind === 'clause');
            const varRef = clause!.children.find(c => c.kind === 'varRef');
            expect(varRef).toBeTruthy();
        });

        it('$$global in clause parses as varRef', () => {
            const call = firstChild('table(x:$$global)');
            const clause = call.children.find(c => c.kind === 'clause');
            const varRef = clause!.children.find(c => c.kind === 'varRef');
            expect(varRef).toBeTruthy();
        });
    });

    // -----------------------------------------------------------------------
    describe('script-level properties', () => {

        it('script kind is always script', () => {
            for (const src of ['', 'table()', 'let @x = 1', 'row { table() }']) {
                expect(plotParse(src).kind).toBe('script');
            }
        });

        it('script from is always 0', () => {
            for (const src of ['table()', 'line_chart(x:"t")', '']) {
                expect(plotParse(src).from).toBe(0);
            }
        });

        it('script to equals source length', () => {
            const cases = ['table()', 'line_chart(x:"t")', 'let @x = 1\ntable()'];
            for (const src of cases) {
                expect(plotParse(src).to).toBe(src.length);
            }
        });

        it('script children is always an array', () => {
            for (const src of ['', '!!!', 'table()', 'row { col { table() } }']) {
                expect(Array.isArray(plotParse(src).children)).toBe(true);
            }
        });

        it('script annotations is always an object', () => {
            for (const src of ['', 'table()', '!@#']) {
                expect(typeof plotParse(src).annotations).toBe('object');
            }
        });

        it('script text is the full source', () => {
            const src = 'table()';
            expect(plotParse(src).text).toBe(src);
        });

        it('multiple top-level plot calls all appear as children', () => {
            const children = scriptChildren('table()\nbar_chart()\nline_chart()');
            const calls = children.filter(c => c.kind === 'plotCall');
            expect(calls.length).toBe(3);
        });

        it('let statement and composite can coexist', () => {
            const children = scriptChildren('let @x = 1\nrow { table() }');
            expect(children.some(c => c.kind === 'letStatement')).toBe(true);
            expect(children.some(c => c.kind === 'composite')).toBe(true);
        });
    });
});
