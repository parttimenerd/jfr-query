// Unit tests for the AST-aware reranker. Verifies that the structural delta
// is correctly written into each Completion's `boost` field — CodeMirror
// sorts options by `score + boost`, so this is where the structural signal
// must land. Also verifies the embedding-fusion path and the devtools
// `compareRanking` helper.

import { describe, it, expect } from 'vitest';
import type { Completion } from '@codemirror/autocomplete';
import { parse } from '../../components/editor/sql/parser';
import { annotate } from '../../components/editor/sql/annotate';
import { markCursorPath } from '../../components/editor/sql/ast';
import { clauseAtCursor } from '../../components/editor/sql/completion/helpers';
import {
    structuralBoostDelta,
    applyRerankBoosts,
    compareRanking,
    inFunctionArg,
    buildColumnTypeMap,
} from '../../components/editor/sql/completion/reranker';
import type { ProviderContext } from '../../components/editor/sql/completion/types';
import type { SchemaForCompletion } from '../../components/editor/completions';

function makeSchema(): SchemaForCompletion {
    const tables = [
        {
            name: 'ActiveRecording',
            columns: [
                { name: 'id', type: 'INTEGER' },
                { name: 'startTime', type: 'TIMESTAMP' },
                { name: 'duration', type: 'INTERVAL' },
            ],
        },
        {
            name: 'GarbageCollection',
            columns: [
                { name: 'gcId', type: 'BIGINT' },
                { name: 'cause', type: 'VARCHAR' },
                { name: 'duration', type: 'INTERVAL' },
            ],
        },
    ];
    return {
        tables,
        views: [],
        macros: [],
        tableMap: new Map(tables.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(),
    };
}

function makeCtx(input: string, token = ''): ProviderContext {
    const pos = input.indexOf('|');
    if (pos < 0) throw new Error('missing | marker');
    const source = input.slice(0, pos) + input.slice(pos + 1);
    const schema = makeSchema();
    const parseResult = parse(source);
    const annotateResult = annotate(parseResult.root, {
        tables: schema.tables,
        views: schema.views,
    });
    const root = parseResult.root;
    const cursor = markCursorPath(root, pos);
    let scope = null;
    let n: typeof cursor | undefined = cursor;
    while (n) {
        if (n.kind === 'query' && n.annotations.scope) {
            scope = annotateResult.scopes.get(n.annotations.scope.id) ?? null;
            break;
        }
        n = n.parent;
    }
    return {
        schema,
        variables: {},
        runner: null,
        source,
        upTo: source.slice(0, pos),
        pos,
        root,
        scopes: annotateResult.scopes,
        cursorNode: cursor,
        scope,
        token,
        tokenFrom: pos - token.length,
        explicit: false,
        enclosingClause: clauseAtCursor(cursor),
    };
}

// Convenience: sort by descending boost (mirroring what CodeMirror does after
// adding matcher score). For these tests we don't run the matcher; we assume
// matcher score is 0 (no fuzzy match) so boost alone determines order.
function rankByBoost(items: Completion[]): Completion[] {
    return [...items].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0));
}

describe('reranker — structuralBoostDelta', () => {
    it('boosts columns in a WHERE clause', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const col: Completion = { label: 'cause', type: 'column' };
        const kw: Completion = { label: 'AND', type: 'keyword' };
        const dCol = structuralBoostDelta({ item: col, ctx });
        const dKw = structuralBoostDelta({ item: kw, ctx });
        expect(dCol).toBeGreaterThan(dKw);
        expect(dCol).toBeGreaterThanOrEqual(6); // col + col-in-scope bonus
        expect(dKw).toBeLessThan(0);            // keyword penalty
    });

    it('boosts column-in-scope above out-of-scope column', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const inScope: Completion = { label: 'cause', type: 'column' };
        const outOfScope: Completion = { label: 'randomCol', type: 'column' };
        expect(structuralBoostDelta({ item: inScope, ctx }))
            .toBeGreaterThan(structuralBoostDelta({ item: outOfScope, ctx }));
    });

    it('prefix bonus stacks', () => {
        const ctx = makeCtx('SELECT cau| FROM GarbageCollection', 'cau');
        const hit: Completion = { label: 'cause', type: 'column' };
        const miss: Completion = { label: 'duration', type: 'column' };
        expect(structuralBoostDelta({ item: hit, ctx }))
            .toBeGreaterThan(structuralBoostDelta({ item: miss, ctx }));
    });

    it('clamps to [-3, +14]', () => {
        const ctx = makeCtx('SELECT cau| FROM GarbageCollection', 'cau');
        const stacked: Completion = { label: 'cause', type: 'column' };
        const d = structuralBoostDelta({ item: stacked, ctx });
        expect(d).toBeLessThanOrEqual(14);
        expect(d).toBeGreaterThanOrEqual(-3);
    });

    it('penalises keywords in column-context (clamped at -3)', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const kw: Completion = { label: 'ORDER', type: 'keyword' };
        const d = structuralBoostDelta({ item: kw, ctx });
        expect(d).toBe(-3);
    });

    it('rewards table types in FROM clause', () => {
        const ctx = makeCtx('SELECT * FROM |');
        const tbl: Completion = { label: 'GarbageCollection', type: 'class' };
        const kw: Completion = { label: 'WHERE', type: 'keyword' };
        expect(structuralBoostDelta({ item: tbl, ctx }))
            .toBeGreaterThan(structuralBoostDelta({ item: kw, ctx }));
    });
});

describe('reranker — type-affinity', () => {
    it('boosts temporal columns in ORDER BY', () => {
        const ctx = makeCtx('SELECT * FROM ActiveRecording ORDER BY |');
        const ctmap = buildColumnTypeMap(ctx);
        const ts: Completion = { label: 'startTime', type: 'column' };
        const id: Completion = { label: 'id', type: 'column' };
        const dTs = structuralBoostDelta({ item: ts, ctx, columnTypeMap: ctmap });
        const dId = structuralBoostDelta({ item: id, ctx, columnTypeMap: ctmap });
        expect(dTs).toBeGreaterThan(dId);
    });

    it('boosts numeric columns inside SUM()', () => {
        const ctx = makeCtx('SELECT SUM(|) FROM ActiveRecording');
        const ctmap = buildColumnTypeMap(ctx);
        const fn = inFunctionArg(ctx.cursorNode);
        const id: Completion = { label: 'id', type: 'column' };       // INTEGER
        const dur: Completion = { label: 'duration', type: 'column' }; // INTERVAL
        const dId = structuralBoostDelta({ item: id, ctx, columnTypeMap: ctmap, fnArg: fn });
        const dDur = structuralBoostDelta({ item: dur, ctx, columnTypeMap: ctmap, fnArg: fn });
        expect(dId).toBeGreaterThan(dDur);
    });

    it('boosts VARCHAR columns in GROUP BY', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection GROUP BY |');
        const ctmap = buildColumnTypeMap(ctx);
        const cause: Completion = { label: 'cause', type: 'column' };   // VARCHAR
        const gcId: Completion = { label: 'gcId', type: 'column' };     // BIGINT
        const dC = structuralBoostDelta({ item: cause, ctx, columnTypeMap: ctmap });
        const dG = structuralBoostDelta({ item: gcId, ctx, columnTypeMap: ctmap });
        expect(dC).toBeGreaterThan(dG);
    });
});

describe('reranker — inFunctionArg', () => {
    it('detects when cursor is inside SUM()', () => {
        const ctx = makeCtx('SELECT SUM(|) FROM ActiveRecording');
        const fn = inFunctionArg(ctx.cursorNode);
        expect(fn).not.toBeNull();
        expect(fn!.fnName).toBe('SUM');
    });

    it('returns null when cursor is outside any fn call', () => {
        const ctx = makeCtx('SELECT * FROM ActiveRecording WHERE |');
        const fn = inFunctionArg(ctx.cursorNode);
        expect(fn).toBeNull();
    });
});

describe('reranker — applyRerankBoosts (boost-write contract)', () => {
    it('writes boost into each Completion (provider + delta)', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'AND', type: 'keyword', boost: 0 },
        ];
        const out = applyRerankBoosts(items, ctx, null);
        const causeOut = out.find(o => o.label === 'cause')!;
        const andOut = out.find(o => o.label === 'AND')!;
        expect(causeOut.boost!).toBeGreaterThan(5);   // delta added
        expect(andOut.boost!).toBeLessThan(0);        // negative delta
    });

    it('does not sort the array — preserves input order', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'AND', type: 'keyword' },
            { label: 'cause', type: 'column' },
            { label: 'duration', type: 'column' },
        ];
        const out = applyRerankBoosts(items, ctx, null);
        expect(out.map(o => o.label)).toEqual(['AND', 'cause', 'duration']);
    });

    it('preserves provider boost as additive baseline (boost >= original - 3)', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 10 },
        ];
        const out = applyRerankBoosts(items, ctx, null);
        expect(out[0].boost!).toBeGreaterThanOrEqual(10 - 3);
    });

    it('returns shallow copies, not in-place mutations', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const orig: Completion = { label: 'cause', type: 'column', boost: 5 };
        const items: Completion[] = [orig];
        const out = applyRerankBoosts(items, ctx, null);
        expect(orig.boost).toBe(5);
        expect(out[0]).not.toBe(orig);
    });
});

describe('reranker — embedding fusion', () => {
    it('uses embedding rank when no structural difference', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'duration', type: 'column', boost: 5 },
            { label: 'cause', type: 'column', boost: 5 },
        ];
        // Embedding says cause is better.
        const out = applyRerankBoosts(items, ctx, ['cause', 'duration']);
        const sorted = rankByBoost(out);
        expect(sorted[0].label).toBe('cause');
    });

    it('structural beats contradicting embedding when delta is large', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'AND', type: 'keyword', boost: 0 },
        ];
        // Adversarial embedding: keyword first.
        const out = applyRerankBoosts(items, ctx, ['AND', 'cause']);
        const sorted = rankByBoost(out);
        expect(sorted[0].label).toBe('cause');
    });

    it('passes through when embeddingOrder is null', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'AND', type: 'keyword', boost: 0 },
        ];
        const out = applyRerankBoosts(items, ctx, null);
        const sorted = rankByBoost(out);
        expect(sorted[0].label).toBe('cause');
    });
});

describe('reranker — baseline-vs-Phase-5 scenarios', () => {
    it('WHERE c| → cause is top', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE c|', 'c');
        const items: Completion[] = [
            { label: 'CASE', type: 'keyword' },
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'COUNT', type: 'function' },
        ];
        const sorted = rankByBoost(applyRerankBoosts(items, ctx, null));
        expect(sorted[0].label).toBe('cause');
    });

    it('SUM(|) → numeric column id beats INTERVAL duration', () => {
        const ctx = makeCtx('SELECT SUM(|) FROM ActiveRecording');
        const items: Completion[] = [
            { label: 'duration', type: 'column', boost: 5 },
            { label: 'id', type: 'column', boost: 5 },
            { label: 'WHERE', type: 'keyword' },
        ];
        const sorted = rankByBoost(applyRerankBoosts(items, ctx, null));
        expect(sorted[0].label).toBe('id');
    });

    it('ORDER BY | → temporal column on top', () => {
        const ctx = makeCtx('SELECT * FROM ActiveRecording ORDER BY |');
        const items: Completion[] = [
            { label: 'id', type: 'column', boost: 5 },
            { label: 'startTime', type: 'column', boost: 5 },
            { label: 'duration', type: 'column', boost: 5 },
        ];
        const sorted = rankByBoost(applyRerankBoosts(items, ctx, null));
        expect(sorted[0].label).toBe('startTime');
    });

    it('GROUP BY | → VARCHAR cause beats BIGINT gcId', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection GROUP BY |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'gcId', type: 'column', boost: 5 },
        ];
        const sorted = rankByBoost(applyRerankBoosts(items, ctx, null));
        expect(sorted[0].label).toBe('cause');
    });
});

describe('reranker — compareRanking devtools helper', () => {
    it('returns sorted breakdown', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'AND', type: 'keyword' },
            { label: 'cause', type: 'column', boost: 5 },
        ];
        const rows = compareRanking(items, ctx, null);
        expect(rows.length).toBe(2);
        expect(rows[0].label).toBe('cause');
        expect(rows[0].provider).toBe(5);
        expect(rows[0].delta).toBeGreaterThan(0);
        expect(rows[0].final).toBe(rows[0].provider + rows[0].delta);
    });

    it('structuralOff:true with null embedding → every row has delta === 0', () => {
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'cause', type: 'column', boost: 5 },
            { label: 'AND', type: 'keyword', boost: 0 },
            { label: 'COUNT', type: 'function', boost: 3 },
        ];
        const rows = compareRanking(items, ctx, null, { structuralOff: true });
        expect(rows.length).toBe(3);
        for (const r of rows) {
            expect(r.delta).toBe(0);
            expect(r.final).toBe(r.provider);
        }
    });

    it('structuralOff:true still applies embedding nudge (±2 integer range)', () => {
        const ctx = makeCtx('SELECT * FROM ActiveRecording WHERE |');
        const items: Completion[] = [
            { label: 'duration', type: 'column', boost: 5 },
            { label: 'id', type: 'column', boost: 5 },
            { label: 'startTime', type: 'column', boost: 5 },
        ];
        const rows = compareRanking(items, ctx, ['duration', 'id', 'startTime'], { structuralOff: true });
        const byLabel = new Map(rows.map(r => [r.label, r]));
        // formula: round(2 - 4 * (i / N)) with N = length-1 = 2 → +2, 0, -2.
        expect(byLabel.get('duration')!.delta).toBe(2);
        expect(byLabel.get('id')!.delta).toBe(0);
        expect(byLabel.get('startTime')!.delta).toBe(-2);
        for (const r of rows) {
            expect(Number.isInteger(r.delta)).toBe(true);
            expect(r.delta).toBeGreaterThanOrEqual(-2);
            expect(r.delta).toBeLessThanOrEqual(2);
        }
        // duration (with +2 embedding nudge) should now lead.
        expect(rows[0].label).toBe('duration');
    });

    it('default (no opts) matches pre-change behaviour — structural path is on', () => {
        // Same scenario as the original "returns sorted breakdown" test:
        // when structuralOff is omitted, cause (column) outranks AND (keyword).
        const ctx = makeCtx('SELECT * FROM GarbageCollection WHERE |');
        const items: Completion[] = [
            { label: 'AND', type: 'keyword' },
            { label: 'cause', type: 'column', boost: 5 },
        ];
        const rowsDefault = compareRanking(items, ctx, null);
        const rowsExplicitOff = compareRanking(items, ctx, null, { structuralOff: false });
        expect(rowsDefault).toEqual(rowsExplicitOff);
        // Structural delta is non-zero for at least one row when on.
        expect(rowsDefault.some(r => r.delta !== 0)).toBe(true);
    });
});

describe('reranker — perf (gated by VITEST_PERF=1)', () => {
    const perfGated = process.env.VITEST_PERF !== '1';
    it.skipIf(perfGated)('applyRerankBoosts is under 5ms/call on 200-line cells', () => {
        // Synthetic 200-line query.
        const big = Array.from({ length: 100 }, (_, i) =>
            `SELECT id FROM ActiveRecording WHERE id = ${i} UNION ALL`
        ).join('\n') + '\nSELECT * FROM ActiveRecording WHERE |';
        const ctx = makeCtx(big);
        const items: Completion[] = Array.from({ length: 80 }, (_, i) => ({
            label: `col_${i}`,
            type: i % 3 === 0 ? 'column' : i % 3 === 1 ? 'function' : 'keyword',
            boost: i % 10,
        }));
        const ITER = 1000;
        const start = performance.now();
        for (let i = 0; i < ITER; i++) {
            applyRerankBoosts(items, ctx, null);
        }
        const elapsed = performance.now() - start;
        const meanMs = elapsed / ITER;
        // Mean should be under 5ms; total under 5000ms.
        expect(meanMs).toBeLessThan(5);
    });
});
