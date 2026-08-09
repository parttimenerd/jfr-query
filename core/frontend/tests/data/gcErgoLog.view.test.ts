import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS_SQL, CONDITIONAL_VIEWS_SQL } from '../../data/builtinSql';

describe('GCErgoLog conditional view', () => {
    const entry = CONDITIONAL_VIEWS_SQL.find(e => e.requires === 'GCErgonomicTrace' && (e as any).sql?.includes('"GCErgoLog"'));

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
        expect(entry?.sql).toContain(String.raw`^GC\(\d+\)\s+`);
    });

    it('includes parsed structured columns using ergo_ macros', () => {
        expect(entry?.sql).toContain('ergo_bytes');
        expect(entry?.sql).toContain('ergo_pct');
        expect(entry?.sql).toContain('ergo_ms');
        expect(entry?.sql).toContain('ergo_int');
    });

    it('exposes Occupancy MB and Threshold MB columns', () => {
        expect(entry?.sql).toContain('"Occupancy MB"');
        expect(entry?.sql).toContain('"Threshold MB"');
    });
});

describe('gc-ergo-ihop view', () => {
    const entry = CONDITIONAL_VIEWS_SQL.find(e => (e as any).sql?.includes('"gc-ergo-ihop"'));
    it('exists', () => { expect(entry).toBeDefined(); });
    it('filters gc+ergo+ihop tag', () => { expect(entry?.sql).toContain("tag = 'gc+ergo+ihop'"); });
    it('includes IHOP % column', () => { expect(entry?.sql).toContain('"IHOP %"'); });
});

describe('gc-ergo-cset view', () => {
    const entry = CONDITIONAL_VIEWS_SQL.find(e => (e as any).sql?.includes('"gc-ergo-cset"'));
    it('exists', () => { expect(entry).toBeDefined(); });
    it('filters gc+ergo+cset tag', () => { expect(entry?.sql).toContain("tag = 'gc+ergo+cset'"); });
    it('includes Eden Regions column', () => { expect(entry?.sql).toContain('"Eden Regions"'); });
    it('includes Survivor Regions column', () => { expect(entry?.sql).toContain('"Survivor Regions"'); });
});

describe('gc-ergo-heap view', () => {
    const entry = CONDITIONAL_VIEWS_SQL.find(e => (e as any).sql?.includes('"gc-ergo-heap"'));
    it('exists', () => { expect(entry).toBeDefined(); });
    it('filters gc+ergo+heap tag', () => { expect(entry?.sql).toContain("tag = 'gc+ergo+heap'"); });
    it('includes Pause Ratio % column', () => { expect(entry?.sql).toContain('"Pause Ratio %"'); });
});

describe('ergo message parsing macros', () => {
    it('ergo_bytes macro is defined', () => {
        const m = BUILTIN_MACROS_SQL.find(s => s.includes('ergo_bytes'));
        expect(m).toBeDefined();
        expect(m).toContain('CREATE OR REPLACE MACRO ergo_bytes');
        expect(m).toContain('TRY_CAST');
    });

    it('ergo_ms macro is defined', () => {
        const m = BUILTIN_MACROS_SQL.find(s => s.includes('ergo_ms'));
        expect(m).toBeDefined();
        expect(m).toContain('CREATE OR REPLACE MACRO ergo_ms');
    });

    it('ergo_pct macro is defined', () => {
        const m = BUILTIN_MACROS_SQL.find(s => s.includes('ergo_pct'));
        expect(m).toBeDefined();
        expect(m).toContain('CREATE OR REPLACE MACRO ergo_pct');
    });

    it('ergo_int macro is defined', () => {
        const m = BUILTIN_MACROS_SQL.find(s => s.includes('ergo_int'));
        expect(m).toBeDefined();
        expect(m).toContain('CREATE OR REPLACE MACRO ergo_int');
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

// Validate ergo message parsing patterns with JS equivalents
describe('ergo message pattern extraction (JS mirror)', () => {
    // ergo_bytes: extract 'key: NNB' → number
    const ergoBytes = (msg: string, key: string) => {
        const re = new RegExp(key + '[: ]+([0-9]+)B');
        const m = msg.match(re);
        return m ? parseInt(m[1], 10) : null;
    };

    // ergo_ms: extract 'key: N.NNms' → number
    const ergoMs = (msg: string, key: string) => {
        const re = new RegExp(key + '[: ]+([0-9]+(?:[.][0-9]*)?)ms');
        const m = msg.match(re);
        return m ? parseFloat(m[1]) : null;
    };

    // ergo_pct: extract first 'N.NN%' → number
    const ergoPct = (msg: string) => {
        const m = msg.match(/([0-9]+(?:[.][0-9]*)?)%/);
        return m ? parseFloat(m[1]) : null;
    };

    // ergo_int: extract 'key: N' or 'key = N' → integer
    const ergoInt = (msg: string, key: string) => {
        const re = new RegExp(key + '[: =]+([0-9]+)');
        const m = msg.match(re);
        return m ? parseInt(m[1], 10) : null;
    };

    it('ergo_bytes extracts occupancy from IHOP message', () => {
        const msg = 'Request concurrent cycle initiation occupancy: 6291456B threshold: 5767168B source: end of GC';
        expect(ergoBytes(msg, 'occupancy')).toBe(6291456);
        expect(ergoBytes(msg, 'threshold')).toBe(5767168);
    });

    it('ergo_ms extracts target pause time from CSet message', () => {
        const msg = 'Start choosing CSet. Pending cards: 489 target pause time: 200.00ms';
        expect(ergoMs(msg, 'target pause time')).toBe(200.00);
    });

    it('ergo_pct extracts pause ratio from heap expansion message', () => {
        const msg = 'Heap expansion: short term pause time ratio 3.29%';
        expect(ergoPct(msg)).toBe(3.29);
    });

    it('ergo_int extracts Eden region count from CSet message', () => {
        const msg = 'Add young regions to CSet. Eden: 12 regions. Survivor: 2 regions.';
        expect(ergoInt(msg, 'Eden')).toBe(12);
        expect(ergoInt(msg, 'Survivor')).toBe(2);
    });

    it('ergo_int extracts Pending cards', () => {
        const msg = 'Start choosing CSet. Pending cards: 231 target pause time: 200.00ms';
        expect(ergoInt(msg, 'Pending cards')).toBe(231);
    });

    it('all return null when pattern absent', () => {
        const msg = 'Initiate concurrent cycle (concurrent cycle initiation requested)';
        expect(ergoBytes(msg, 'occupancy')).toBeNull();
        expect(ergoMs(msg, 'target pause time')).toBeNull();
        expect(ergoPct(msg)).toBeNull();
        expect(ergoInt(msg, 'Pending cards')).toBeNull();
    });
});
