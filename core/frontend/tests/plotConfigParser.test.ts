import { describe, it, expect } from 'vitest';
import { createConfigParser } from '../utils/plotConfigParser';
import { buildParserSpec, findColumn, findColumns } from '../utils/plotUtils';
import type { ParserSpec } from '../utils/plotUtils';
import type { PlotParameter } from '../components/plots/plotTypes';

const sampleData = [
    { time: 1, cpu: 50, memory: 1024, label: 'a' },
    { time: 2, cpu: 60, memory: 2048, label: 'b' },
];

const lineSpec: ParserSpec = {
    x: { type: 'column', required: true, description: 'X axis' },
    y: { type: 'column[]', required: true, description: 'Y axis columns' },
    smooth: { type: 'boolean', required: false, defaultValue: false, description: 'smooth' },
    style: { type: 'string', required: false, options: ['solid', 'dashed'], description: 'line style' },
    width: { type: 'number', required: false, defaultValue: 1, description: 'line width' },
};

const tableSpec: ParserSpec = {
    columns: { type: 'column[]', required: false, description: 'cols' },
    sticky: { type: 'boolean', required: false, defaultValue: true, description: 'sticky' },
};

describe('createConfigParser — basic happy path', () => {
    const parse = createConfigParser(lineSpec);

    it('parses required column + column[] params', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu", "memory"])', sampleData);
        expect(result.x).toBe('time');
        expect(result.y).toEqual(['cpu', 'memory']);
    });

    it('applies default values for missing optional params', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"])', sampleData);
        expect(result.smooth).toBe(false);
        expect(result.width).toBe(1);
    });

    it('does not set undefined for params with no default', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"])', sampleData);
        expect('style' in result).toBe(false);
    });

    it('handles single-quoted string values', () => {
        const result: any = parse("LINE_CHART(x: 'time', y: ['cpu'])", sampleData);
        expect(result.x).toBe('time');
        expect(result.y).toEqual(['cpu']);
    });

    it('handles unquoted column names', () => {
        const result: any = parse('LINE_CHART(x: time, y: [cpu])', sampleData);
        expect(result.x).toBe('time');
        expect(result.y).toEqual(['cpu']);
    });

    it('handles boolean true/false case-insensitively', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"], smooth: TRUE)', sampleData);
        expect(result.smooth).toBe(true);
        const result2: any = parse('LINE_CHART(x: "time", y: ["cpu"], smooth: False)', sampleData);
        expect(result2.smooth).toBe(false);
    });

    it('handles negative and decimal numbers', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"], width: -1.5)', sampleData);
        expect(result.width).toBe(-1.5);
    });

    it('parses scientific notation', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"], width: 1e3)', sampleData);
        expect(result.width).toBe(1000);
    });

    it('accepts empty array []', () => {
        const tParse = createConfigParser(tableSpec);
        const result: any = tParse('TABLE(columns: [])', sampleData);
        expect(result.columns).toEqual([]);
    });

    it('strips whitespace inside parens', () => {
        const result: any = parse('LINE_CHART(   x:   "time"  ,  y:  [ "cpu" , "memory"  ]  )', sampleData);
        expect(result.x).toBe('time');
        expect(result.y).toEqual(['cpu', 'memory']);
    });

    it('accepts no-arg call when all params optional', () => {
        const tParse = createConfigParser(tableSpec);
        const result: any = tParse('TABLE()', sampleData);
        expect(result.sticky).toBe(true);
    });
});

describe('createConfigParser — multi-query prefix columns', () => {
    const parse = createConfigParser(lineSpec);

    it('accepts a column referenced via its un-prefixed base name when prefixed columns exist', () => {
        const data = [{ '1_time': 1, '1_cpu': 50, '2_time': 2, '2_cpu': 70 }];
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"])', data);
        // The validator only checks existence — it doesn't rewrite. Both "time" and "cpu" pass.
        expect(result.x).toBe('time');
        expect(result.y).toEqual(['cpu']);
    });
});

describe('createConfigParser — error handling', () => {
    const parse = createConfigParser(lineSpec);

    it('errors when required param missing', () => {
        expect(() => parse('LINE_CHART(x: "time")', sampleData)).toThrow(/Missing required parameter "y"/);
    });

    it('error message includes full usage signature', () => {
        try {
            parse('LINE_CHART(x: "time")', sampleData);
        } catch (e: any) {
            expect(e.message).toMatch(/y: column\[\]/);
            expect(e.message).toMatch(/Required/);
        }
    });

    it('errors on unknown parameter name', () => {
        expect(() => parse('LINE_CHART(x: "time", y: ["cpu"], wrong: 1)', sampleData))
            .toThrow(/Unknown parameter "wrong"/);
    });

    it('suggests close-match when unknown param has similar name', () => {
        expect(() => parse('LINE_CHART(x: "time", y: ["cpu"], smoth: true)', sampleData))
            .toThrow(/Did you mean "smooth"/);
    });

    it('errors on column not in data', () => {
        expect(() => parse('LINE_CHART(x: "missingCol", y: ["cpu"])', sampleData))
            .toThrow(/Column "missingCol" not found/);
    });

    it('column-not-found lists available columns', () => {
        try {
            parse('LINE_CHART(x: "missing", y: ["cpu"])', sampleData);
        } catch (e: any) {
            expect(e.message).toMatch(/time/);
            expect(e.message).toMatch(/cpu/);
            expect(e.message).toMatch(/memory/);
            expect(e.message).toMatch(/label/);
        }
    });

    it('column-not-found error wraps with "Error in parameter"', () => {
        try {
            parse('LINE_CHART(x: "missing", y: ["cpu"])', sampleData);
        } catch (e: any) {
            expect(e.message).toMatch(/Error in parameter "x"/);
            expect(e.message).toMatch(/Hint:/);
        }
    });

    it('errors on positional argument (unnamed)', () => {
        expect(() => parse('LINE_CHART("time", ["cpu"])', sampleData))
            .toThrow(/All parameters must be named/);
    });

    it('errors on missing function call syntax', () => {
        expect(() => parse('not_a_function_call', sampleData))
            .toThrow(/Missing "\("/);
    });

    it('auto-coerces bare column string to single-element array for column[]', () => {
        const result: any = parse('LINE_CHART(x: "time", y: "cpu")', sampleData);
        expect(result.y).toEqual(['cpu']);
    });
});

describe('parameter splitting — splitParams (via parser)', () => {
    const parse = createConfigParser(lineSpec);

    it('does not split commas inside arrays', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu", "memory", "label"])', sampleData);
        expect(result.y).toEqual(['cpu', 'memory', 'label']);
    });

    it('does not split commas inside strings', () => {
        const spec: ParserSpec = { ...lineSpec, title: { type: 'string', required: false, description: 't' } } as ParserSpec;
        const p = createConfigParser(spec);
        const result: any = p('LINE_CHART(x: "time", y: ["cpu"], title: "a, b, c")', sampleData);
        expect(result.title).toBe('a, b, c');
    });

    it('does not split inside single-quoted strings', () => {
        const spec: ParserSpec = { ...lineSpec, title: { type: 'string', required: false, description: 't' } } as ParserSpec;
        const p = createConfigParser(spec);
        const result: any = p("LINE_CHART(x: 'time', y: ['cpu'], title: 'a, b')", sampleData);
        expect(result.title).toBe('a, b');
    });

    it('handles trailing comma gracefully', () => {
        const result: any = parse('LINE_CHART(x: "time", y: ["cpu"],)', sampleData);
        expect(result.x).toBe('time');
    });
});

describe('createConfigParser — value parsing edge cases', () => {
    const numSpec: ParserSpec = {
        n: { type: 'number', required: false, description: 'number' },
        s: { type: 'string', required: false, description: 'string' },
    };
    const parse = createConfigParser(numSpec);

    it('zero', () => {
        const result: any = parse('F(n: 0)', []);
        expect(result.n).toBe(0);
    });

    it('parses unquoted strings as raw token', () => {
        const result: any = parse('F(s: hello)', []);
        expect(result.s).toBe('hello');
    });

    it('handles colons inside string values', () => {
        const result: any = parse('F(s: "a:b:c")', []);
        expect(result.s).toBe('a:b:c');
    });
});

describe('createConfigParser — improved error messages', () => {
    const parse = createConfigParser(lineSpec);

    it('"did you mean" works for typo via Levenshtein, not substring', () => {
        // "smoth" is one edit away from "smooth" but has no substring overlap
        try {
            parse('LINE_CHART(x: "time", y: ["cpu"], smoth: true)', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/Did you mean "smooth"/);
        }
    });

    it('"did you mean" suggests correct column for transposed letters', () => {
        try {
            parse('LINE_CHART(x: "tiem", y: ["cpu"])', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/Did you mean "time"/);
        }
    });

    it('does not suggest a column when the typo is far from any candidate', () => {
        try {
            parse('LINE_CHART(x: "completelydifferent", y: ["cpu"])', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).not.toMatch(/Did you mean/);
        }
    });

    it('truncates available-columns list when there are many', () => {
        const wide: any = {};
        for (let i = 0; i < 30; i++) wide[`col${i}`] = i;
        try {
            parse('LINE_CHART(x: "missing", y: ["cpu"])', [wide]);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/\+\d+ more/);
        }
    });

    it('reports missing-paren errors clearly', () => {
        expect(() => parse('LINE_CHART x: "time", y: ["cpu"]', sampleData))
            .toThrow(/Missing "\("/);
    });

    it('reports unclosed paren', () => {
        expect(() => parse('LINE_CHART(x: "time", y: ["cpu"]', sampleData))
            .toThrow(/Missing closing/);
    });

    it('rejects empty value after colon', () => {
        expect(() => parse('LINE_CHART(x: , y: ["cpu"])', sampleData))
            .toThrow(/Missing value for parameter "x"/);
    });

    it('rejects empty parameter name (": value")', () => {
        // ": value" is a parameter without a name. We should reject it cleanly.
        // Note: the current regex would treat ":" as the colon and "" as key.
        try {
            parse('LINE_CHART(: "time", y: ["cpu"])', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/Empty parameter name|Invalid parameter/);
        }
    });

    it('validates string options and suggests close match', () => {
        try {
            parse('LINE_CHART(x: "time", y: ["cpu"], style: "dasshed")', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/Invalid value "dasshed"/);
            expect(e.message).toMatch(/Did you mean "dashed"/);
        }
    });

    it('error message includes default value for optional params with defaults', () => {
        try {
            parse('LINE_CHART(x: "time")', sampleData);
            expect.fail('expected throw');
        } catch (e: any) {
            expect(e.message).toMatch(/width:\s*number\s+--\s+default\s+1/);
        }
    });
});

describe('buildParserSpec — common title param', () => {
    // buildParserSpec automatically injects `title` into all plot specs.
    const plotParams: PlotParameter[] = [
        { name: 'x', type: 'column', required: true, description: 'x' },
        { name: 'y', type: 'column[]', required: true, description: 'y' },
    ];
    const parse = createConfigParser(buildParserSpec(plotParams));
    const data = [{ x: 1, y: 2 }];

    it('accepts title param in function args', () => {
        const result: any = parse('CHART(x: "x", y: ["y"], title: "My Chart")', data);
        expect(result.title).toBe('My Chart');
    });

    it('title is optional — absent title not in result', () => {
        const result: any = parse('CHART(x: "x", y: ["y"])', data);
        expect('title' in result).toBe(false);
    });

    it('does not double-inject title if already in params', () => {
        const paramsWithTitle: PlotParameter[] = [
            ...plotParams,
            { name: 'title', type: 'string', required: false, description: 'custom title desc' },
        ];
        const spec = buildParserSpec(paramsWithTitle);
        const keys = Object.keys(spec).filter(k => k === 'title');
        expect(keys.length).toBe(1);
    });
});

describe('findColumn / findColumns — regex metacharacter safety', () => {
    it('findColumn: direct match with brackets in name', () => {
        const cols = ['duration[ms]', 'count'];
        expect(findColumn('duration[ms]', cols)).toBe('duration[ms]');
    });

    it('findColumn: prefixed match with brackets in name does not false-positive', () => {
        // Without escaping, "1_durationm" would match "1_duration[ms]" regex because [ms] is a char class.
        const cols = ['1_durationm', '1_duration[ms]'];
        const result = findColumn('duration[ms]', cols);
        expect(result).toBe('1_duration[ms]');
    });

    it('findColumn: prefixed match with dot in name', () => {
        const cols = ['1_cpu.load', 'cpu.load'];
        // Direct match first
        expect(findColumn('cpu.load', cols)).toBe('cpu.load');
    });

    it('findColumn: prefixed match when dot would match any char without escape', () => {
        // "1_cpuXload" should NOT match "cpu.load" (dot is literal)
        const cols = ['1_cpuXload', '1_cpu.load'];
        expect(findColumn('cpu.load', cols)).toBe('1_cpu.load');
    });

    it('findColumns: returns all prefixed matches with special chars', () => {
        const cols = ['1_value$total', '2_value$total', 'other'];
        const result = findColumns('value$total', cols);
        expect(result).toEqual(['1_value$total', '2_value$total']);
    });

    it('findColumns: dollar sign in name is treated literally, not as end-anchor', () => {
        // Without escaping "$" would be end-of-string anchor; regex "^\d+_value$total$"
        // would never match because "total" comes after "$" which anchors end.
        const cols = ['1_value$total'];
        expect(findColumns('value$total', cols)).toEqual(['1_value$total']);
    });

    it('plotConfigParser column validation: brackets in column name do not throw', () => {
        const spec: ParserSpec = { x: { type: 'column', required: true, description: 'x' } };
        const parse = createConfigParser(spec);
        const data = [{ 'duration[ms]': 100 }];
        // Should not throw — column exists
        const result: any = parse('F(x: "duration[ms]")', data);
        expect(result.x).toBe('duration[ms]');
    });

    it('plotConfigParser column validation: prefixed bracket column is found', () => {
        const spec: ParserSpec = { x: { type: 'column', required: true, description: 'x' } };
        const parse = createConfigParser(spec);
        const data = [{ '1_duration[ms]': 100, '2_duration[ms]': 200 }];
        // Should not throw — prefixed match exists
        expect(() => parse('F(x: "duration[ms]")', data)).not.toThrow();
    });
});
