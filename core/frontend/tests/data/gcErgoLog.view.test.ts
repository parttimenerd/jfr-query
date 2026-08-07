import { describe, it, expect } from 'vitest';
import { CONDITIONAL_VIEWS_SQL } from '../../data/builtinSql';

describe('GCErgoLog conditional view', () => {
    const entry = CONDITIONAL_VIEWS_SQL.find(e => e.requires === 'GCErgonomicTrace');

    it('exists in CONDITIONAL_VIEWS_SQL', () => {
        expect(entry).toBeDefined();
    });

    it('has a sql property (not buildSql)', () => {
        expect(entry?.sql).toBeDefined();
        expect(typeof entry?.sql).toBe('string');
    });

    it('creates GCErgoLog view', () => {
        expect(entry?.sql).toContain('CREATE OR REPLACE VIEW "GCErgoLog"');
    });

    it('selects from GCErgonomicTrace', () => {
        expect(entry?.sql).toContain('FROM GCErgonomicTrace');
    });

    it('normalises tag from gc+ergo+cset to gc,ergo,cset format', () => {
        expect(entry?.sql).toContain("replace(tag, '+', ',')");
    });

    it('strips GC(N) prefix from message', () => {
        expect(entry?.sql).toContain("regexp_replace(message");
        // In the TypeScript source the regex is written with escaped parens: '^GC\\(\\d+\\)\\s+'
        // which the TS compiler emits as the string: ^GC\(\d+\)\s+
        expect(entry?.sql).toContain(String.raw`^GC\(\d+\)\s+`);
    });
});

// Mirror the regexp_replace logic with a JS equivalent to validate the pattern
describe('GC(N) prefix stripping regex', () => {
    // DuckDB: regexp_replace(message, '^GC\\(\\d+\\)\\s+', '')
    const RE = /^GC\(\d+\)\s+/;

    const cases: [string, string][] = [
        ['GC(0) Start choosing CSet. Pending cards: 489 target pause time: 200.00ms',
         'Start choosing CSet. Pending cards: 489 target pause time: 200.00ms'],
        ['GC(12) Heap expansion: short term pause time ratio 3.29%',
         'Heap expansion: short term pause time ratio 3.29%'],
        ['GC(0) Running G1 Merge Heap Roots using 6 workers for 47 regions',
         'Running G1 Merge Heap Roots using 6 workers for 47 regions'],
        // Messages without GC prefix (pre-GC events) pass through unchanged
        ['Attempting full compaction',
         'Attempting full compaction'],
        ['Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 6291456B',
         'Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 6291456B'],
    ];

    for (const [input, expected] of cases) {
        it(`strips prefix from: "${input.slice(0, 40)}..."`, () => {
            expect(input.replace(RE, '')).toBe(expected);
        });
    }
});

// Validate tag normalisation
describe('tag normalisation (+ → ,)', () => {
    const cases: [string, string][] = [
        ['gc+ergo+cset',   'gc,ergo,cset'],
        ['gc+ergo+ihop',   'gc,ergo,ihop'],
        ['gc+ergo+heap',   'gc,ergo,heap'],
        ['gc+ergo+refine', 'gc,ergo,refine'],
        ['gc+ergo',        'gc,ergo'],
    ];

    for (const [input, expected] of cases) {
        it(`normalises "${input}" → "${expected}"`, () => {
            expect(input.replace(/\+/g, ',')).toBe(expected);
        });
    }
});
