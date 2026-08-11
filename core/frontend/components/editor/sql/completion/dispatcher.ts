// AST-driven completion dispatcher.
//
// Per keystroke:
//   1. Parse the document into an AST.
//   2. Run the annotator chain (alias → schema → function → variable).
//   3. Find the cursor node and its enclosing query scope.
//   4. Walk providers in priority order; collect items from those that match.
//   5. Deduplicate by label (keep the highest-boost copy).
//   6. Kick off the MiniLM reranker and apply any cached order.

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { parse } from '../parser';
import { annotate } from '../annotate';
import { markCursorPath } from '../ast';
import type { CompletionProvider, ProviderContext } from './types';
import type { SchemaForCompletion, SqlCompletionDeps } from '../../completions';
import { clauseAtCursor, clauseAtOffset } from './helpers';
import {
    variableProvider,
    qualifiedColumnProvider,
    columnInScopeProvider,
    aliasProvider,
    selectAliasProvider,
} from './providers/identifiers';
import {
    tableProvider,
    viewProvider,
    cteProvider,
    functionProvider,
    macroProvider,
} from './providers/symbols';
import { keywordProvider, overKeywordProvider } from './providers/keywords';
import { distinctValueProvider } from './providers/distinctValue';
import { applyRerankBoosts, compareRanking } from './reranker';
import { AutocompleteRanker } from '../../../../services/ml/AutocompleteRanker';

const PROVIDERS: CompletionProvider[] = [
    variableProvider,
    distinctValueProvider,
    qualifiedColumnProvider,
    cteProvider,
    tableProvider,
    viewProvider,
    columnInScopeProvider,
    selectAliasProvider,
    aliasProvider,
    functionProvider,
    macroProvider,
    overKeywordProvider,
    keywordProvider,
];
// Pre-sort by priority descending so the per-keystroke dispatch loop
// doesn't allocate a new sorted copy on every completion request.
const PROVIDERS_BY_PRIORITY = PROVIDERS.slice().sort((a, b) => b.priority - a.priority);

// Cache of MiniLM-ranked label orderings, keyed on the last 200 chars of
// up-to-cursor text. Shared across all `sqlCompletionSource` instances.
const rankCache = new Map<string, string[]>();
// Reusable Map for deduplication in dispatchCompletion — cleared between calls
// to avoid allocating a new Map<> on every keystroke.
const _seenLabel = new Map<string, number>();

// Pre-lowercased fallback keywords for fast prefix filtering.
const _FALLBACK_KWS = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN',
    'GROUP BY', 'ORDER BY', 'LIMIT', 'HAVING', 'WITH', 'UNION',
    'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'CREATE VIEW',
];
const _FALLBACK_KWS_LC = _FALLBACK_KWS.map(kw => kw.toLowerCase());
const RANK_CACHE_LIMIT = 80;

// Single-entry parse+annotate cache. When the completion source fires twice
// for the same document (e.g., on embedding-rank update without typing), we
// avoid re-parsing and re-annotating the identical source string.
let _lastParseSource: string | null = null;
let _lastParseSchema: SchemaForCompletion | null = null;
let _lastParseResult: ReturnType<typeof parse> | null = null;
let _lastAnnotateResult: ReturnType<typeof annotate> | null = null;
// Single-entry cache for the contextKey slice — avoids repeated .slice+.toLowerCase()
// when the embedding-rank update re-fires dispatchCompletion without a cursor move.
let _lastUpTo: string | null = null;
let _lastContextKey: string | null = null;
// Single-entry cache for markCursorPath — avoids the full AST walk on re-queries
// (e.g. embedding rank update) when root and cursor position are unchanged.
let _lastCursorRoot: ReturnType<typeof parse>['root'] | null = null;
let _lastCursorOffset: number = -1;
let _lastCursorNode: ReturnType<typeof markCursorPath> | null = null;

function rerank(options: Completion[], context: string, ctx: ProviderContext): Completion[] {
    // Write structural + embedding signals into each item's `boost` field.
    // CodeMirror sorts the popup by `matcher.score + boost`, so this is how
    // we influence ordering — returning a sorted array does nothing.
    const cached = rankCache.get(context) ?? null;
    return applyRerankBoosts(options, ctx, cached);
}

function kickRank(
    deps: SqlCompletionDeps,
    contextKey: string,
    options: Completion[],
): void {
    if (!deps.rankCandidates || !deps.isRankerReady) return;
    if (!deps.isRankerReady()) return;
    if (rankCache.has(contextKey)) return;
    if (options.length < 3) return;
    const labels = options.map(o => o.label);
    deps.rankCandidates(contextKey, labels).then(ranked => {
        rankCache.set(contextKey, ranked);
        while (rankCache.size > RANK_CACHE_LIMIT) {
            const first = rankCache.keys().next().value;
            if (first === undefined) break;
            rankCache.delete(first);
        }
        // Tell the editor a fresh embedding rank is now cached so it can
        // re-query the completion source and pick up the new boost values.
        // `rankCache.has` guards the recursive entry, so we won't re-kick.
        try { deps.onRankerUpdated?.(); } catch { /* swallow */ }
    }).catch(() => {});
}

export function dispatchCompletion(
    cx: CompletionContext,
    deps: SqlCompletionDeps,
): CompletionResult | null {
    // Match identifier-ish things to the left: $var, alias.col, "quoted, word.
    const tokenMatch = cx.matchBefore(/(\$\$?[\w.]*|"[^"]*|[\w]+(?:\.[\w"]*)?)/);
    // The token regex doesn't match inside an open string literal (the quote
    // isn't a word char). Detect this case explicitly so the distinct-value
    // provider still fires.
    const upToInit = cx.state.doc.sliceString(0, cx.pos);
    const insideOpenString = countUnescapedQuotes(upToInit) % 2 === 1;
    if (!tokenMatch && !cx.explicit && !insideOpenString) return null;
    const token = tokenMatch ? tokenMatch.text : '';
    const tokenFrom = tokenMatch ? tokenMatch.from : cx.pos;

    const schema = deps.getSchema();
    // When schema is absent and this is not a $variable token, fall back to a
    // minimal set of top-level SQL keywords so the editor is still helpful.
    if (!schema && !token.startsWith('$')) {
        const lc = token.toLowerCase();
        const options = _FALLBACK_KWS
            .filter((_, i) => !lc || _FALLBACK_KWS_LC[i].startsWith(lc))
            .map(kw => ({ label: kw, detail: 'keyword', type: 'keyword' as const, apply: kw + ' ', boost: 0 }));
        if (options.length === 0 && !cx.explicit) return null;
        return {
            from: tokenFrom,
            options,
            validFor: /^[A-Za-z ]*$/,
        };
    }

    const source = cx.state.doc.toString();
    const upTo = upToInit; // reuse: upToInit === source.slice(0, cx.pos)
    const variables = deps.getVariables() || {};
    const runner = deps.getQueryRunner?.() ?? null;

    // Dev-only perf guard: warn if the full parse+annotate+dispatch path exceeds
    // 10ms on a single keystroke. Cheap; `performance.now()` is sub-microsecond.
    const tStart =
        import.meta.env?.DEV && typeof performance !== 'undefined'
            ? performance.now()
            : -1;

    // Parse + annotate. Cache by source string — avoids re-parsing when
    // the popup re-fires for the same document (e.g., embedding rank update).
    let parseResult;
    let annotateResult;
    try {
        if (source === _lastParseSource && schema === _lastParseSchema && _lastParseResult && _lastAnnotateResult) {
            parseResult = _lastParseResult;
            annotateResult = _lastAnnotateResult;
        } else {
            parseResult = parse(source);
            annotateResult = annotate(parseResult.root, {
                tables: schema?.tables ?? [],
                views: schema?.views ?? [],
                tableMap: schema?.tableMap,
                viewMap: schema?.viewMap,
            });
            _lastParseSource = source;
            _lastParseSchema = schema;
            _lastParseResult = parseResult;
            _lastAnnotateResult = annotateResult;
        }
    } catch {
        // Parser/annotator should never throw, but guard so we don't kill the
        // completion popup if they do.
        return null;
    }

    const root = parseResult.root;
    let cursor: ReturnType<typeof markCursorPath>;
    if (root === _lastCursorRoot && cx.pos === _lastCursorOffset && _lastCursorNode) {
        cursor = _lastCursorNode;
    } else {
        cursor = markCursorPath(root, cx.pos);
        _lastCursorRoot = root;
        _lastCursorOffset = cx.pos;
        _lastCursorNode = cursor;
    }

    // Find enclosing query scope.
    let scope = null;
    let n: typeof cursor | undefined = cursor;
    while (n) {
        if (n.kind === 'query' && n.annotations.scope) {
            scope = annotateResult.scopes.get(n.annotations.scope.id) ?? null;
            break;
        }
        n = n.parent;
    }

    const ctx: ProviderContext = {
        schema: schema as SchemaForCompletion,
        variables,
        runner,
        source,
        upTo,
        pos: cx.pos,
        root,
        scopes: annotateResult.scopes,
        cursorNode: cursor,
        scope,
        token,
        tokenFrom,
        tokenLc: token.charCodeAt(0) === 34 ? token.slice(1).toLowerCase() : token.toLowerCase(),
        explicit: cx.explicit,
        enclosingClause: clauseAtOffset(root, cursor, cx.pos),
        onDistinctValuesReady: deps.onDistinctValuesReady,
    };

    // No schema (only valid when handling `$variable` completions).
    if (!schema) {
        if (!token.startsWith('$')) return null;
        const r = variableProvider.provide(cursor, ctx);
        if (r.items.length === 0) return null;
        return {
            from: r.from ?? tokenFrom,
            options: r.items,
            validFor: r.validFor ?? /^\$\$?[\w.]*$/,
        };
    }

    // Inside an open string literal: only the distinct-value provider is relevant.
    // Other providers would inherit the string-start `from` offset and insert their
    // completions inside the string, producing broken SQL.
    if (insideOpenString) {
        const dvMatches = distinctValueProvider.matches(cursor, ctx);
        if (!dvMatches) return null;
        const dvResult = distinctValueProvider.provide(cursor, ctx);
        if (!dvResult || dvResult.items.length === 0) return null;
        return {
            from: dvResult.from ?? tokenFrom,
            options: dvResult.items,
            validFor: dvResult.validFor,
        };
    }

    // Walk providers in declared priority order; collect items.
    const merged: Completion[] = [];
    let bestFrom = tokenFrom;
    let bestPriority = -1;
    let bestValidFor: RegExp | undefined;
    // Map label → index in merged[] so duplicate resolution is O(1) per item
    // instead of indexOf's O(n) linear scan. Reuse module-level Map to avoid
    // per-keystroke allocation; clear before use.
    const seenLabel = _seenLabel;
    seenLabel.clear();

    for (const p of PROVIDERS_BY_PRIORITY) {
        let matches = false;
        try { matches = p.matches(cursor, ctx); } catch { matches = false; }
        if (!matches) continue;
        let result;
        try { result = p.provide(cursor, ctx); } catch { continue; }
        if (!result || result.items.length === 0) continue;

        if (p.priority > bestPriority) {
            bestPriority = p.priority;
            if (result.from !== undefined) bestFrom = result.from;
            if (result.validFor) bestValidFor = result.validFor;
        }

        for (const item of result.items) {
            const existingIdx = seenLabel.get(item.label);
            if (existingIdx === undefined) {
                seenLabel.set(item.label, merged.length);
                merged.push(item);
            } else {
                // Keep the higher-boost duplicate.
                const eb = merged[existingIdx].boost ?? 0;
                const nb = item.boost ?? 0;
                if (nb > eb) {
                    merged[existingIdx] = item;
                }
            }
        }
    }

    if (merged.length === 0) return null;

    // Distinct-value and qualified-column providers may want a different
    // `from`. If the winning provider was one of those, `bestFrom` is already
    // set to its preferred position.
    let contextKey: string;
    if (upTo === _lastUpTo && _lastContextKey !== null) {
        contextKey = _lastContextKey;
    } else {
        contextKey = upTo.slice(Math.max(0, upTo.length - 200)).toLowerCase();
        _lastUpTo = upTo;
        _lastContextKey = contextKey;
    }
    kickRank(deps, contextKey, merged);
    const ordered = rerank(merged, contextKey, ctx);

    // Apply the trained linear ranker (AutocompleteRanker) as an additional
    // boost layer. It's sync once loaded (committed JSON weights), so no
    // latency added. The ranker scores are mapped to a [-2, +2] nudge added
    // on top of the structural+embedding boost already in `ordered`.
    const rankerOrdered = applyAutocompleteRankerBoosts(ordered, upTo, cx.pos, ctx.enclosingClause ?? '');

    // Dev-only: stash last invocation for `window.__sqlCompletionDebug`.
    if (import.meta.env?.DEV && typeof window !== 'undefined') {
        const cached = rankCache.get(contextKey) ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__sqlCompletionDebug = {
            lastItems: merged,
            lastCtx: ctx,
            lastEmbeddingOrder: cached,
            compareRanking: (items?: Completion[], context?: ProviderContext, emb?: string[] | null, opts?: { structuralOff?: boolean }) =>
                compareRanking(items ?? merged, context ?? ctx, emb !== undefined ? emb : cached, opts),
        };
    }

    if (tStart >= 0) {
        const elapsed = performance.now() - tStart;
        if (elapsed > 10) {
            // eslint-disable-next-line no-console
            console.warn(`[sql-completion] dispatch took ${elapsed.toFixed(1)}ms (>10ms budget)`);
        }
    }

    return {
        from: bestFrom,
        options: rankerOrdered,
        validFor: bestValidFor ?? /^"?\w*$/,
    };
}

// Exposed for tests so they can flush rerank state between cases.
export function _clearRankCacheForTests(): void {
    rankCache.clear();
    _seenLabel.clear();
    _lastParseSource = null;
    _lastParseSchema = null;
    _lastParseResult = null;
    _lastAnnotateResult = null;
    _lastUpTo = null;
    _lastContextKey = null;
    _lastCursorRoot = null;
    _lastCursorOffset = -1;
    _lastCursorNode = null;
}

/**
 * Apply AutocompleteRanker scores as a small boost nudge on top of existing
 * boosts. The ranker is a trained linear model (MRR 0.9137) that uses prefix
 * match, scenario, column/keyword/function type signals. Scores are normalized
 * to a [-2, +2] delta so they don't override the structural/embedding signal
 * but still break ties correctly.
 */
function applyAutocompleteRankerBoosts(
    items: Completion[],
    context: string,
    cursorPos: number,
    scenario: string,
): Completion[] {
    AutocompleteRanker.boostItemsInPlace(items, context, cursorPos, scenario);
    return items;
}

function countUnescapedQuotes(s: string): number {
    // DuckDB uses '' (doubled single quote) to escape a literal quote inside a string.
    // Backslash is NOT a quote escape in DuckDB SQL — treat every ' as significant,
    // but skip '' pairs so they don't flip the odd/even parity.
    // Use charCodeAt (39 = "'") to avoid per-character string boxing.
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) === 39) {
            if (s.charCodeAt(i + 1) === 39) { i++; continue; }
            n++;
        }
    }
    return n;
}
