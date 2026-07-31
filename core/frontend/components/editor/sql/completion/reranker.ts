// AST-aware reranker.
//
// CodeMirror's @codemirror/autocomplete sorts options by `score + boost`. The
// score is the fuzzy matcher's verdict; boost is whatever the source set.
// So to influence the popup order, we must WRITE the structural signal into
// each Completion's `boost` field — returning a pre-sorted array would be
// silently re-sorted away.
//
// `applyRerankBoosts` produces new Completion copies whose `boost` is
// `providerBoost + structuralDelta + embeddingDelta`. Range of the delta sum:
// [-3, +14], chosen so it can move items across provider classes (provider
// boosts are 1..10) without obliterating strong provider signals.

import type { Completion } from '@codemirror/autocomplete';
import type { ProviderContext } from './types';
import type { Node } from '../ast';
import type { TableBinding } from '../scope';

const COLUMN_CONTEXT_CLAUSES = new Set([
    'select', 'where', 'having', 'groupBy', 'orderBy', 'on', 'qualify',
]);

const TABLE_CONTEXT_CLAUSES = new Set(['from', 'join']);

// Cursor is after a comparison operator/keyword → expect a value, not a column.
// E.g.: `WHERE cause = `, `WHERE ts < `, `WHERE name LIKE `, `WHERE ts BETWEEN `.
const AFTER_EQ_RE = /[=<>!]\s*$|(?:LIKE|IN|BETWEEN|IS)\s*$/i;

const NUMERIC_TYPES = new Set([
    'INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC',
    'SMALLINT', 'TINYINT', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT',
    'UTINYINT', 'REAL',
]);

const TEMPORAL_TYPES = new Set([
    'TIMESTAMP', 'DATE', 'INTERVAL', 'TIME', 'TIMESTAMPTZ', 'TIMESTAMP_NS',
    'TIMESTAMP_MS', 'TIMESTAMP_S',
]);

const AGGREGATE_FNS = new Set([
    'SUM', 'AVG', 'MIN', 'MAX', 'MEDIAN', 'STDDEV', 'COUNT', 'QUANTILE',
    'VAR_POP', 'VAR_SAMP', 'STDDEV_POP', 'STDDEV_SAMP', 'APPROX_COUNT_DISTINCT',
    'FIRST', 'LAST', 'STRING_AGG', 'LIST', 'ARRAY_AGG', 'BOOL_AND', 'BOOL_OR',
]);

const DELTA_MIN = -3;
const DELTA_MAX = 14;

export interface RerankInput {
    item: Completion;
    ctx: ProviderContext;
    // Pre-computed lookup of column-label-lc → underlying type (uppercased).
    // Pass `null` if not yet built; the function falls back to skipping
    // type-affinity bonuses.
    columnTypeMap?: Map<string, string> | null;
    // Cached fn-arg info (null = not in fn-arg).
    fnArg?: { fnName: string } | null;
    // Normalised embedding rank in [0,1]. Undefined when no cache hit.
    embedRankPct?: number;
}

// Walk up from cursor node looking for an enclosing function-call slot.
// Stop at query/script boundaries; bail (return null) if we cross an
// `overClause` or `windowDef` first — those aren't real fn-arg slots.
export function inFunctionArg(cursorNode: Node): { fnName: string } | null {
    let n: Node | undefined = cursorNode;
    while (n) {
        if (n.kind === 'overClause' || n.kind === 'windowDef') return null;
        if (n.kind === 'functionCall') {
            const idents = n.children.filter(c => c.kind === 'identifier');
            return { fnName: idents[0]?.text.toUpperCase() ?? '' };
        }
        if (n.kind === 'query' || n.kind === 'script') return null;
        n = n.parent;
    }
    return null;
}

// Build a per-call Map<labelLc, type> from the cursor scope's bound tables.
// Falls back to scanning every scope when the cursor's own scope has no
// tables — happens for the outer set-op wrapper query that owns the ORDER BY
// clause but whose FROM lives in the inner SELECT.
export function buildColumnTypeMap(ctx: ProviderContext): Map<string, string> {
    const m = new Map<string, string>();
    let tables: TableBinding[] = ctx.scope ? ctx.scope.listTables() : [];
    if (tables.length === 0) {
        for (const s of ctx.scopes.values()) {
            const t = s.listTables();
            if (t.length > 0) { tables = t; break; }
        }
    }
    for (const t of tables) {
        for (const c of t.columns) {
            const key = c.name.toLowerCase();
            if (!m.has(key)) m.set(key, (c.type || '').toUpperCase());
        }
    }
    return m;
}

// Compute the integer boost-delta for a single (item, ctx). Pure; no I/O.
export function structuralBoostDelta(input: RerankInput): number {
    const { item, ctx } = input;
    const type = item.type ?? '';
    const clause = ctx.enclosingClause;
    let d = 0;

    // In WHERE, detect value position (cursor after = / LIKE / BETWEEN / IS).
    // When in value pos, suppress ALL column boosts — the user expects a literal.
    const inValuePos = clause === 'where' && AFTER_EQ_RE.test(ctx.upTo.slice(-80));

    // Clause-shape match.
    if (clause && COLUMN_CONTEXT_CLAUSES.has(clause)) {
        if (!inValuePos) {
            if (type === 'column') d += 6;
            else if (type === 'function') d += 3;
            else if (type === 'keyword') d -= 3;
        }
    } else if (clause && TABLE_CONTEXT_CLAUSES.has(clause)) {
        if (type === 'class' || type === 'type' || type === 'enum') d += 6;
        else if (type !== 'column' && type !== 'keyword' && type !== 'variable') {
            d += 6;
        }
    }

    // Use the per-call columnTypeMap when supplied — it already encodes the
    // cross-scope fallback (handles the outer set-op wrapper case).
    const typeMap = input.columnTypeMap;

    // Column-in-scope: skip when in value position (no column expected there).
    if (type === 'column' && !inValuePos) {
        const labelLc = item.label.toLowerCase();
        if (typeMap && typeMap.has(labelLc)) {
            d += 4;
        } else if (!typeMap && ctx.scope) {
            // No precomputed map — scan listTables() directly.
            for (const t of ctx.scope.listTables()) {
                if (t.columns.some(c => c.name.toLowerCase() === labelLc)) {
                    d += 4;
                    break;
                }
            }
        }
    }

    // CTE-in-scope: both in FROM/JOIN AND inside column-ctx clauses
    // (qualified `cteName.col` resolution wins a small bonus).
    if (ctx.scope) {
        const labelLc = item.label.toLowerCase();
        for (const c of ctx.scope.listCtes()) {
            if (c.name.toLowerCase() === labelLc) {
                d += 3;
                break;
            }
        }
    }

    // Function-arg slot bonuses/penalties.
    const fnArg = input.fnArg !== undefined ? input.fnArg : inFunctionArg(ctx.cursorNode);
    if (fnArg) {
        if (type === 'column') d += 3;
        else if (type === 'keyword') d -= 3;
    }

    // Type-affinity bonuses (only when columnTypeMap is provided).
    if (type === 'column' && typeMap) {
        const colType = typeMap.get(item.label.toLowerCase());
        if (colType) {
            if (clause === 'orderBy' && TEMPORAL_TYPES.has(colType)) d += 2;
            if (fnArg && AGGREGATE_FNS.has(fnArg.fnName) && NUMERIC_TYPES.has(colType)) d += 2;
            if (clause === 'groupBy' && (colType === 'VARCHAR' || colType === 'TEXT' || colType === 'STRING')) d += 1;
        }
    }

    // Prefix bonus (strip leading `$` / `"`).
    if (ctx.token) {
        const tk = ctx.token.replace(/^["$]+/, '').toLowerCase();
        if (tk && item.label.toLowerCase().startsWith(tk)) {
            d += 1;
        }
    }

    // Embedding nudge.
    if (input.embedRankPct !== undefined) {
        d += Math.round(2 - 4 * input.embedRankPct);
    }

    if (d < DELTA_MIN) return DELTA_MIN;
    if (d > DELTA_MAX) return DELTA_MAX;
    return d;
}

// Return new Completion[] copies whose `boost` is
// `providerBoost + structuralBoostDelta + embeddingDelta`. The dispatcher
// hands this list to CodeMirror, which sorts by `score + boost`.
//
// Input order is preserved; CodeMirror does its own sort.
export function applyRerankBoosts(
    items: Completion[],
    ctx: ProviderContext,
    embeddingOrder: string[] | null,
): Completion[] {
    const columnTypeMap = buildColumnTypeMap(ctx);
    const fnArg = inFunctionArg(ctx.cursorNode);
    const embRank = new Map<string, number>();
    const N = embeddingOrder ? Math.max(embeddingOrder.length - 1, 1) : 1;
    if (embeddingOrder) {
        embeddingOrder.forEach((label, i) => embRank.set(label, i));
    }

    return items.map(item => {
        const r = embeddingOrder ? embRank.get(item.label) : undefined;
        const embedRankPct = r === undefined ? undefined : r / N;
        const delta = structuralBoostDelta({ item, ctx, columnTypeMap, fnArg, embedRankPct });
        const baseBoost = item.boost ?? 0;
        return { ...item, boost: baseBoost + delta };
    });
}

// Devtools helper: returns a breakdown of each item's score components in
// descending final-score order. Intended for `window.__sqlCompletionDebug`
// in development builds only.
export interface RankExplanation {
    label: string;
    provider: number;
    delta: number;
    final: number;
}

export interface CompareRankingOptions {
    // When true, skip structural delta entirely; only the embedding nudge
    // contributes to `delta`. Pure-embedding range is [-2, +2]; with no
    // embedding order supplied, every row's delta is 0.
    structuralOff?: boolean;
}

// Embedding-only contribution: returns `round(2 - 4·embedRankPct)` when an
// embedding rank is present, else 0. Used by `compareRanking` when
// `structuralOff: true` so the structural path short-circuits cleanly.
function embeddingBoostDelta(embedRankPct: number | undefined): number {
    if (embedRankPct === undefined) return 0;
    return Math.round(2 - 4 * embedRankPct);
}

// Approach: when `options.structuralOff === true`, we bypass
// `structuralBoostDelta` entirely and compute the row's delta from the
// embedding nudge alone (range [-2, +2]). This keeps `structuralBoostDelta`'s
// single-arg public shape untouched.
export function compareRanking(
    items: Completion[],
    ctx: ProviderContext,
    embeddingOrder: string[] | null,
    options?: CompareRankingOptions,
): RankExplanation[] {
    const structuralOff = options?.structuralOff === true;
    const columnTypeMap = structuralOff ? null : buildColumnTypeMap(ctx);
    const fnArg = structuralOff ? null : inFunctionArg(ctx.cursorNode);
    const embRank = new Map<string, number>();
    const N = embeddingOrder ? Math.max(embeddingOrder.length - 1, 1) : 1;
    if (embeddingOrder) {
        embeddingOrder.forEach((label, i) => embRank.set(label, i));
    }
    const rows = items.map(item => {
        const r = embeddingOrder ? embRank.get(item.label) : undefined;
        const embedRankPct = r === undefined ? undefined : r / N;
        const provider = item.boost ?? 0;
        const delta = structuralOff
            ? embeddingBoostDelta(embedRankPct)
            : structuralBoostDelta({ item, ctx, columnTypeMap, fnArg, embedRankPct });
        return { label: String(item.label), provider, delta, final: provider + delta };
    });
    rows.sort((a, b) => b.final - a.final);
    return rows;
}
