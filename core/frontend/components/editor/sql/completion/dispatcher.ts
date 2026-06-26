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
import { keywordProvider } from './providers/keywords';
import { distinctValueProvider } from './providers/distinctValue';
import { applyRerankBoosts, compareRanking } from './reranker';

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
    keywordProvider,
];

// Cache of MiniLM-ranked label orderings, keyed on the last 200 chars of
// up-to-cursor text. Shared across all `sqlCompletionSource` instances.
const rankCache = new Map<string, string[]>();
const RANK_CACHE_LIMIT = 80;

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
    const upToInit = cx.state.doc.toString().slice(0, cx.pos);
    const insideOpenString = countUnescapedQuotes(upToInit) % 2 === 1;
    if (!tokenMatch && !cx.explicit && !insideOpenString) return null;
    const token = tokenMatch ? tokenMatch.text : '';
    const tokenFrom = tokenMatch ? tokenMatch.from : cx.pos;

    const schema = deps.getSchema();
    if (!schema && !token.startsWith('$')) return null;

    const source = cx.state.doc.toString();
    const upTo = source.slice(0, cx.pos);
    const variables = deps.getVariables() || {};
    const runner = deps.getQueryRunner?.() ?? null;

    // Dev-only perf guard: warn if the full parse+annotate+dispatch path exceeds
    // 10ms on a single keystroke. Cheap; `performance.now()` is sub-microsecond.
    const tStart =
        import.meta.env?.DEV && typeof performance !== 'undefined'
            ? performance.now()
            : -1;

    // Parse + annotate.
    let parseResult;
    let annotateResult;
    try {
        parseResult = parse(source);
        annotateResult = annotate(parseResult.root, {
            tables: schema?.tables ?? [],
            views: schema?.views ?? [],
        });
    } catch {
        // Parser/annotator should never throw, but guard so we don't kill the
        // completion popup if they do.
        return null;
    }

    const root = parseResult.root;
    const cursor = markCursorPath(root, cx.pos);

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
        explicit: cx.explicit,
        enclosingClause: clauseAtOffset(root, cursor, cx.pos),
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

    // Walk providers in declared priority order; collect items.
    const merged: Completion[] = [];
    let bestFrom = tokenFrom;
    let bestPriority = -1;
    let bestValidFor: RegExp | undefined;
    const seenLabel = new Map<string, Completion>();

    for (const p of PROVIDERS.slice().sort((a, b) => b.priority - a.priority)) {
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
            const existing = seenLabel.get(item.label);
            if (!existing) {
                seenLabel.set(item.label, item);
                merged.push(item);
            } else {
                // Keep the higher-boost duplicate.
                const eb = existing.boost ?? 0;
                const nb = item.boost ?? 0;
                if (nb > eb) {
                    const idx = merged.indexOf(existing);
                    if (idx >= 0) merged[idx] = item;
                    seenLabel.set(item.label, item);
                }
            }
        }
    }

    if (merged.length === 0) return null;

    // Distinct-value and qualified-column providers may want a different
    // `from`. If the winning provider was one of those, `bestFrom` is already
    // set to its preferred position.
    const contextKey = upTo.slice(Math.max(0, upTo.length - 200)).toLowerCase();
    kickRank(deps, contextKey, merged);
    const ordered = rerank(merged, contextKey, ctx);

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
        options: ordered,
        validFor: bestValidFor ?? /^"?[\w-]*$/,
    };
}

// Exposed for tests so they can flush rerank state between cases.
export function _clearRankCacheForTests(): void {
    rankCache.clear();
}

function countUnescapedQuotes(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "'" && s[i - 1] !== '\\') n++;
    }
    return n;
}
