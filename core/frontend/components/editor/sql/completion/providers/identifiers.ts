// Variable, qualified-column, in-scope column, and alias providers.

import type { Completion } from '@codemirror/autocomplete';
import type { CompletionProvider, ProviderContext } from '../types';
import type { Node } from '../../ast';
import { findEnclosing } from '../../ast';
import { Scope, type TableBinding } from '../../scope';
import { wrap, truncate, VALID_FOR_IDENT, VALID_FOR_DOLLAR } from '../helpers';

const SCAN_ALIAS_RE = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*|"[^"]+")(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;

// Reusable sets for deduplication — cleared before each use. Single-threaded
// JS makes this safe since all providers run synchronously within one dispatch.
const _seenStr = new Set<string>();

// Column-context clauses: places where columns are legitimate completions.
function isColumnContext(ctx: ProviderContext): boolean {
    const c = ctx.enclosingClause;
    return c === 'select' || c === 'where' || c === 'having' ||
        c === 'groupBy' || c === 'orderBy' || c === 'on' || c === 'qualify';
}

// ----------------------------- variable -----------------------------

export const variableProvider: CompletionProvider = {
    name: 'variable',
    priority: 100,

    matches(node, ctx) {
        if (node.kind === 'variableRef' || node.kind === 'doubleDollarRef' ||
            node.kind === 'crossCellRef') return true;
        // Fall back to token starting with `$` (parser may not have produced a
        // dollar node yet for mid-type input like a bare `$`).
        return ctx.token.startsWith('$');
    },

    provide(node, ctx) {
        // Determine the prefix to filter on. The token already includes the
        // leading `$` / `$$`.
        const tk = ctx.token.startsWith('$') ? ctx.token : node.text;
        const lc = tk.toLowerCase();
        const isDoubleDollar = tk.startsWith('$$');

        const items: Completion[] = [];
        const seen = _seenStr;
        seen.clear();
        for (const [rawName, value] of Object.entries(ctx.variables)) {
            // Two storage conventions are in the wild:
            //   1) keys without `$`  (workspace `metadata.variables`, tests)
            //   2) keys with `$`     (parsed cell `parsed.variables`)
            // Strip a single leading `$` (or `$$`) so the candidate always
            // gets exactly one prefix prepended.
            const name = rawName.startsWith('$$')
                ? rawName.slice(2)
                : rawName.startsWith('$') ? rawName.slice(1) : rawName;
            const candidate = isDoubleDollar ? `$$${name}` : `$${name}`;
            if (lc && !candidate.toLowerCase().startsWith(lc)) continue;
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            items.push({
                label: candidate,
                detail: `= ${truncate(String(value), 30)}`,
                type: 'variable',
                apply: candidate,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_DOLLAR,
        };
    },
};

// ---------------------- qualifiedColumn (alias.col) -----------------

export const qualifiedColumnProvider: CompletionProvider = {
    name: 'qualifiedColumn',
    priority: 90,

    matches(node, ctx) {
        // Case 1: cursor is on a `qualifiedIdent` node (e.g. `t.col|`).
        if (node.kind === 'qualifiedIdent') return true;
        // Case 2: the user just typed a trailing `.` after an identifier
        // (token text like `t.` or `t.partial`).
        if (ctx.token.includes('.')) return true;
        // Case 3: parent is a qualifiedIdent.
        if (node.parent?.kind === 'qualifiedIdent') return true;
        return false;
    },

    provide(node, ctx) {
        // Try to extract qualifier + partial.
        let qualifier = '';
        let partial = '';
        let dotIndex = ctx.pos;
        const isQuoted = ctx.token.startsWith('"');

        if (ctx.token.includes('.')) {
            const [q, rest] = ctx.token.split('.', 2);
            qualifier = q;
            partial = rest || '';
            dotIndex = ctx.tokenFrom + q.length + 1;
        } else if (node.kind === 'qualifiedIdent') {
            // qualifiedIdent has children: [identifier, ., identifier?]
            let firstIdent: Node | undefined;
            let lastIdent: Node | undefined;
            let identCount = 0;
            for (const c of node.children) {
                if (c.kind === 'identifier') {
                    if (!firstIdent) firstIdent = c;
                    lastIdent = c;
                    identCount++;
                }
            }
            if (identCount >= 1) qualifier = firstIdent!.text;
            if (identCount >= 2) partial = lastIdent!.text;
            dotIndex = identCount >= 2 ? lastIdent!.from : ctx.pos;
        } else if (node.parent?.kind === 'qualifiedIdent') {
            const parent = node.parent;
            let firstIdent: Node | undefined;
            let identCount = 0;
            let secondIdent: Node | undefined;
            for (const c of parent.children) {
                if (c.kind === 'identifier') {
                    if (!firstIdent) firstIdent = c;
                    else if (!secondIdent) secondIdent = c;
                    identCount++;
                }
            }
            if (identCount >= 1) qualifier = firstIdent!.text;
            if (identCount === 2 && secondIdent === node) {
                partial = node.text;
                dotIndex = node.from;
            }
        }

        if (!qualifier) return { items: [] };

        const cols = collectColumnsForQualifier(ctx, qualifier);
        // Strip leading `"` if partial is a quoted ident, then lowercase.
        const lcPartial = partial.charCodeAt(0) === 34 ? partial.slice(1).toLowerCase() : partial.toLowerCase();
        const items: Completion[] = [];
        for (const c of cols) {
            if (lcPartial && !(c.nameLc ?? c.name.toLowerCase()).startsWith(lcPartial)) continue;
            items.push({ label: c.name, detail: c.type, type: 'column', apply: wrap(c.name, isQuoted), boost: 10 });
        }
        return {
            items,
            from: dotIndex,
            validFor: VALID_FOR_IDENT,
        };
    },
};

function collectColumnsForQualifier(
    ctx: ProviderContext,
    qualifier: string,
): Array<{ name: string; type: string; sourceName: string; nameLc?: string }> {
    const out: Array<{ name: string; type: string; sourceName: string; nameLc?: string }> = [];
    const qkey = qualifier.toLowerCase();
    if (ctx.scope) {
        for (const t of ctx.scope.listTables()) {
            if ((t.aliasLc ?? t.alias.toLowerCase()) === qkey || (t.targetLc ?? t.target.toLowerCase()) === qkey) {
                for (const c of t.columns) {
                    out.push({ name: c.name, type: c.type, sourceName: t.alias, nameLc: c.nameLc });
                }
                if (out.length > 0) return out;
            }
        }
    }
    // Cross-scope fallback: the partial parser sometimes splits incomplete
    // input (e.g. `SELECT r.|`) so the cursor lands in an empty query whose
    // FROM lives in a sibling. Try every scope in the map.
    for (const s of ctx.scopes.values()) {
        for (const t of s.listTables()) {
            if ((t.aliasLc ?? t.alias.toLowerCase()) === qkey || (t.targetLc ?? t.target.toLowerCase()) === qkey) {
                for (const c of t.columns) {
                    out.push({ name: c.name, type: c.type, sourceName: t.alias, nameLc: c.nameLc });
                }
                if (out.length > 0) return out;
            }
        }
    }
    // CTE fallback: qualifier matches a CTE declared in any scope. Useful
    // when the user types `cte_name.|` but the parser fragmented the
    // statement and the cursor's scope doesn't have the CTE bound as a
    // table yet.
    for (const s of ctx.scopes.values()) {
        for (const c of s.listCtes()) {
            if ((c.nameLc ?? c.name.toLowerCase()) === qkey) {
                for (const col of c.columns) {
                    out.push({ name: col.name, type: col.type, sourceName: c.name, nameLc: col.nameLc });
                }
                if (out.length > 0) return out;
            }
        }
    }
    // Document-scan fallback: parser may have bailed on a broken statement
    // (e.g. `SELECT r.| FROM …`). Scan the full source text for FROM/JOIN
    // aliases and resolve via schema.
    const aliasTarget = scanAliasFromSource(ctx.source, qualifier);
    if (aliasTarget) {
        const tbl = ctx.schema.tableMap.get(aliasTarget.toLowerCase());
        if (tbl) {
            for (const c of tbl.columns) {
                out.push({ name: c.name, type: c.type, sourceName: tbl.name, nameLc: c.nameLc });
            }
            if (out.length > 0) return out;
        }
        const vw = ctx.schema.viewMap.get(aliasTarget.toLowerCase());
        if (vw) {
            for (const c of vw.columns) {
                out.push({ name: c.name, type: c.type, sourceName: vw.name, nameLc: c.nameLc });
            }
            if (out.length > 0) return out;
        }
    }
    // Fallback: schema by direct name (unaliased table).
    const tbl = ctx.schema.tableMap.get(qkey);
    if (tbl) {
        for (const c of tbl.columns) out.push({ name: c.name, type: c.type, sourceName: tbl.name, nameLc: c.nameLc });
        return out;
    }
    const vw = ctx.schema.viewMap.get(qkey);
    if (vw) {
        for (const c of vw.columns) out.push({ name: c.name, type: c.type, sourceName: vw.name, nameLc: c.nameLc });
    }
    return out;
}

// Scan the document for a FROM/JOIN <target> [AS] <alias> pattern matching
// the qualifier and return the underlying table/view name. Used only as a
// fallback when the AST parser couldn't recover the alias chain.
function scanAliasFromSource(src: string, qualifier: string): string | null {
    const re = SCAN_ALIAS_RE;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const qkey = qualifier.toLowerCase();
    while ((m = re.exec(src)) !== null) {
        const target = m[1].replace(/^"|"$/g, '');
        const alias = m[2];
        if (alias && alias.toLowerCase() === qkey) return target;
        if (!alias && target.toLowerCase() === qkey) return target;
    }
    return null;
}

// -------------------- columnInScope (unqualified column) ------------

export const columnInScopeProvider: CompletionProvider = {
    name: 'columnInScope',
    priority: 80,

    matches(node, ctx) {
        if (!isColumnContext(ctx)) return false;
        // Don't fire when we're already in a qualifier context (a dot in the
        // token means qualifiedColumnProvider handles it).
        if (ctx.token.includes('.')) return false;
        // Skip if cursor is on a CTE name or alias position (handled below by
        // checking the parent kind).
        if (isDefinitionSite(node)) return false;
        return true;
    },

    provide(node, ctx) {
        const isQuoted = ctx.token.startsWith('"');
        const lc = ctx.tokenLc;
        const items: Completion[] = [];

        // Resolve visible tables (same logic as the former collectVisibleColumns, but
        // iterate directly to skip the intermediate col-object array allocation).
        let tables: readonly TableBinding[] = ctx.scope ? ctx.scope.ownTables() : [];
        if (tables.length === 0 && ctx.scope) tables = ctx.scope.listTables();
        if (tables.length === 0) {
            for (const s of ctx.scopes.values()) {
                const t = s.listTables();
                if (t.length > 0) { tables = t; break; }
            }
        }

        if (tables.length === 1) {
            // Fast path: single table — no dedup needed.
            const t = tables[0];
            for (const c of t.columns) {
                const key = c.nameLc ?? c.name.toLowerCase();
                if (lc && !key.startsWith(lc)) continue;
                items.push({ label: c.name, detail: c.type + ' · ' + t.alias, type: 'column', apply: wrap(c.name, isQuoted), boost: 5 });
            }
        } else if (tables.length > 1) {
            const seen = _seenStr;
            seen.clear();
            for (const t of tables) {
                for (const c of t.columns) {
                    const key = c.nameLc ?? c.name.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (lc && !key.startsWith(lc)) continue;
                    items.push({ label: c.name, detail: c.type + ' · ' + t.alias, type: 'column', apply: wrap(c.name, isQuoted), boost: 5 });
                }
            }
        } else {
            // Empty-FROM fallback: offer every column from every table/view.
            const seen = _seenStr;
            seen.clear();
            const addFallback = (srcName: string, c: { name: string; type: string; nameLc?: string }) => {
                const key = c.nameLc ?? c.name.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                if (lc && !key.startsWith(lc)) return;
                items.push({ label: c.name, detail: c.type + ' · ' + srcName, type: 'column', apply: wrap(c.name, isQuoted), boost: 5 });
            };
            for (const t of ctx.schema.tables) for (const c of t.columns) addFallback(t.name, c);
            for (const v of ctx.schema.views) for (const c of v.columns) addFallback(v.name, c);
        }

        return { items, from: ctx.tokenFrom, validFor: VALID_FOR_IDENT };
    },
};

// True if `node` is a definition site (CTE name, alias identifier, etc.) and
// should not trigger column completion.
function isDefinitionSite(node: Node): boolean {
    if (node.kind !== 'identifier') return false;
    const p = node.parent;
    if (!p) return false;
    if (p.kind === 'cte') {
        // First identifier child of a `cte` node is the CTE name.
        for (const c of p.children) { if (c.kind === 'identifier') return c === node; }
    }
    if (p.kind === 'tableRef') {
        // Alias slot: last identifier child of a tableRef when count >= 2.
        let lastIdent: Node | undefined;
        let identCount = 0;
        for (const c of p.children) { if (c.kind === 'identifier') { lastIdent = c; identCount++; } }
        if (identCount >= 2 && lastIdent === node) return true;
    }
    return false;
}

// ------------------------------ alias -------------------------------

export const aliasProvider: CompletionProvider = {
    name: 'alias',
    priority: 75,

    matches(node, ctx) {
        if (!ctx.scope) return false;
        if (!isColumnContext(ctx)) return false;
        if (ctx.token.includes('.')) return false;
        return true;
    },

    provide(node, ctx) {
        if (!ctx.scope) return { items: [] };
        const lc = ctx.tokenLc;
        const items: Completion[] = [];
        // Own-scope aliases first; ancestor aliases only when own scope is empty
        // (mirrors the column candidate logic so derived-table subqueries don't
        // see the outer FROM's aliases).
        const ownT = ctx.scope.ownTables();
        const aliasSource = ownT.length > 0 ? ownT : ctx.scope.listTables();

        // Fast path: single table — no duplicate aliases possible, skip Set.
        if (aliasSource.length <= 1) {
            for (const t of aliasSource) {
                if ((t.aliasLc ?? t.alias.toLowerCase()) === (t.targetLc ?? t.target.toLowerCase())) continue;
                const key = t.aliasLc ?? t.alias.toLowerCase();
                if (lc && !key.startsWith(lc)) continue;
                items.push({ label: t.alias, detail: `alias of ${t.target}`, type: 'variable', apply: t.alias, boost: 4 });
            }
            return { items, from: ctx.tokenFrom, validFor: VALID_FOR_IDENT };
        }

        const seen = _seenStr;
        seen.clear();
        for (const t of aliasSource) {
            // Only surface aliases that differ from the underlying target —
            // bare table references are already produced by the table provider.
            if ((t.aliasLc ?? t.alias.toLowerCase()) === (t.targetLc ?? t.target.toLowerCase())) continue;
            const key = t.aliasLc ?? t.alias.toLowerCase();
            if (seen.has(key)) continue;
            if (lc && !key.startsWith(lc)) continue;
            seen.add(key);
            items.push({
                label: t.alias,
                detail: `alias of ${t.target}`,
                type: 'variable',
                apply: t.alias,
                boost: 4,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};

// -------------------- selectAlias (projection AS name) --------------
// Surface AS-aliases declared in the enclosing query's SELECT list when the
// cursor sits in a clause that legitimately references them (ORDER BY,
// HAVING, QUALIFY). DuckDB resolves these post-projection labels.

export const selectAliasProvider: CompletionProvider = {
    name: 'selectAlias',
    priority: 76,

    matches(_node, ctx) {
        const c = ctx.enclosingClause;
        if (c !== 'orderBy' && c !== 'having' && c !== 'qualify') return false;
        if (ctx.token.includes('.')) return false;
        return true;
    },

    provide(node, ctx) {
        const query = findEnclosing(node, 'query');
        if (!query) return { items: [] };
        // Some parses nest queries (e.g. ORDER BY hangs off an outer query
        // whose only meaningful child is an inner query holding the SELECT).
        // Find the nearest selectClause descendant — check direct children first,
        // then fall back to a shallow search through inner queries.
        let sel: Node | null = null;
        for (const c of query.children) {
            if (c.kind === 'selectClause') { sel = c; break; }
        }
        if (!sel) {
            // Try one level deeper (inner query child).
            for (const c of query.children) {
                if (c.kind !== 'query') continue;
                for (const cc of c.children) {
                    if (cc.kind === 'selectClause') { sel = cc; break; }
                }
                if (sel) break;
            }
        }
        if (!sel) return { items: [] };
        const lc = ctx.tokenLc;
        const items: Completion[] = [];
        const seen = _seenStr;
        seen.clear();
        for (const proj of (sel as Node).children) {
            if (proj.kind !== 'projection') continue;
            // The parser places the alias as the LAST identifier child after
            // the expression. For `COUNT(*) AS c`, children are
            // [functionCall, identifier(c)]; for `host AS h`, it's
            // [identifier(host), identifier(h)]. We treat the trailing
            // identifier child as the alias when the projection has 2+
            // children (expression + alias) OR has exactly one identifier
            // that isn't the only ident-child of a single-ident projection.
            if (proj.children.length < 2) continue;
            const last = proj.children[proj.children.length - 1];
            if (last.kind !== 'identifier') continue;
            // Strip surrounding double-quotes without a regex allocation.
            const raw = last.text;
            const name = raw.length >= 2 && raw.charCodeAt(0) === 34 && raw.charCodeAt(raw.length - 1) === 34
                ? raw.slice(1, -1)
                : raw;
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            if (lc && !key.startsWith(lc)) continue;
            seen.add(key);
            items.push({
                label: name,
                detail: 'select alias',
                type: 'variable',
                apply: name,
                boost: 6,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};
