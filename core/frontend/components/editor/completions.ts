import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import type { TableSchema, ViewSchema, MacroSchema } from '../../types';
import { plotRegistry } from '../plots/plotRegistry';
import { plotClauseDocs } from '../../utils/plotClauseDocs';
import { expandPlotConstants } from '../../utils/plotConstants';
import { parseSqlContext, type SqlContext, type SqlClause } from './sqlContext';
import {
  SQL_FUNCTIONS,
  SQL_KEYWORDS_AFTER_FROM,
  SQL_KEYWORDS_AFTER_GROUP_BY,
  SQL_KEYWORDS_AFTER_JOIN_ON,
  SQL_KEYWORDS_AFTER_ORDER_BY,
  SQL_KEYWORDS_AFTER_SELECT,
  SQL_KEYWORDS_AFTER_WHERE,
  SQL_KEYWORDS_AT_TOP,
} from './sqlFunctions';
import {
  type DistinctValuesRunner,
  lookupCachedValues,
  requestDistinctValues,
} from './distinctValues';

export interface SchemaForCompletion {
  tables: TableSchema[];
  views: ViewSchema[];
  macros: MacroSchema[];
  tableMap: Map<string, TableSchema>;
  viewMap: Map<string, ViewSchema>;
}

export interface SqlCompletionDeps {
  getSchema: () => SchemaForCompletion | null;
  getVariables: () => Record<string, string> | undefined;
  /** Optional: enables live distinct-value completion inside string literals. */
  getQueryRunner?: () => DistinctValuesRunner | null;
  /**
   * Optional: semantic reranker (MiniLM). When provided, completion labels are
   * reordered by similarity to the cursor's left-context using a cache-then-
   * rerank pattern. Cache is keyed on the lowercased context.
   */
  rankCandidates?: (queryContext: string, candidates: string[]) => Promise<string[]>;
  isRankerReady?: () => boolean;
  /** Optional: notification hook fired when a fresh reranker result lands so
   *  the editor can re-query the completion source to apply new boosts. */
  onRankerUpdated?: () => void;
}

const rankCache = new Map<string, string[]>();
const RANK_CACHE_LIMIT = 80;

function rerank(options: Completion[], context: string): Completion[] {
  const cached = rankCache.get(context);
  if (!cached) return options;
  const order = new Map(cached.map((label, i) => [label, i]));
  return [...options].sort((a, b) => {
    const ra = order.get(a.label) ?? 999;
    const rb = order.get(b.label) ?? 999;
    return ra - rb;
  });
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
  }).catch(() => {});
}

const wrap = (s: string, force: boolean): string => {
  if (force) return `"${s}"`;
  return /^[a-zA-Z_]\w*$/.test(s) ? s : `"${s}"`;
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Resolve the columns visible at the cursor by walking referenced tables/views/CTEs.
 * For CTEs without explicit columns, columns aren't known — they're skipped.
 */
function collectColumns(
  schema: SchemaForCompletion,
  ctx: SqlContext,
): Array<{ name: string; type: string; sourceName: string }> {
  const out: Array<{ name: string; type: string; sourceName: string }> = [];
  const seen = new Set<string>();
  const add = (sourceName: string, col: { name: string; type?: string }) => {
    const key = col.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: col.name, type: col.type ?? 'column', sourceName });
  };
  const addFromName = (name: string) => {
    const lc = name.toLowerCase();
    const tbl = schema.tableMap.get(lc);
    if (tbl) tbl.columns.forEach(c => add(tbl.name, c));
    const vw = schema.viewMap.get(lc);
    if (vw) vw.columns.forEach(c => add(vw.name, c));
  };
  // Aliased targets resolve to the original table name.
  for (const alias of ctx.aliases.values()) addFromName(alias.target);
  // Bare references not yet aliased.
  for (const ref of ctx.referenced) {
    if (![...ctx.aliases.values()].some(a => a.target.toLowerCase() === ref)) addFromName(ref);
  }
  return out;
}

/** Columns scoped to a single alias or table name (the `t.` case). */
function collectColumnsForQualifier(
  schema: SchemaForCompletion,
  ctx: SqlContext,
  qualifier: string,
): Array<{ name: string; type: string; sourceName: string }> {
  const alias = ctx.aliases.get(qualifier);
  const targetName = alias ? alias.target.toLowerCase() : qualifier;
  const out: Array<{ name: string; type: string; sourceName: string }> = [];
  const tbl = schema.tableMap.get(targetName);
  if (tbl) tbl.columns.forEach(c => out.push({ name: c.name, type: c.type, sourceName: tbl.name }));
  const vw = schema.viewMap.get(targetName);
  if (vw) vw.columns.forEach(c => out.push({ name: c.name, type: c.type, sourceName: vw.name }));
  return out;
}

function keywordsForClause(clause: SqlClause): string[] {
  switch (clause) {
    case 'select': return SQL_KEYWORDS_AFTER_SELECT;
    case 'from': return SQL_KEYWORDS_AFTER_FROM;
    case 'join': return SQL_KEYWORDS_AFTER_FROM;
    case 'where': return SQL_KEYWORDS_AFTER_WHERE;
    case 'having': return SQL_KEYWORDS_AFTER_WHERE;
    case 'on': return SQL_KEYWORDS_AFTER_JOIN_ON;
    case 'group_by': return SQL_KEYWORDS_AFTER_GROUP_BY;
    case 'order_by': return SQL_KEYWORDS_AFTER_ORDER_BY;
    case null: return SQL_KEYWORDS_AT_TOP;
    default: return [];
  }
}

export function sqlCompletionSource(deps: SqlCompletionDeps) {
  return (cx: CompletionContext): CompletionResult | null => {
    // Match identifier-ish things to the left: $var, alias.col, "quoted, word.
    const tokenMatch = cx.matchBefore(/(\$\$?\w*|"[^"]*|[\w]+(?:\.[\w"]*)?)/);
    if (!tokenMatch && !cx.explicit) return null;
    const token = tokenMatch ? tokenMatch.text : '';
    const from = tokenMatch ? tokenMatch.from : cx.pos;

    const variables = deps.getVariables() || {};
    const schema = deps.getSchema();
    const runner = deps.getQueryRunner?.() ?? null;

    // --- $variable completions (highest priority) ---
    if (token.startsWith('$')) {
      const lc = token.toLowerCase();
      const opts: Completion[] = [];
      for (const [name, value] of Object.entries(variables)) {
        if (name.toLowerCase().startsWith(lc)) {
          opts.push({
            label: name,
            detail: `= ${truncate(String(value), 30)}`,
            type: 'variable',
            apply: name,
          });
        }
      }
      return opts.length > 0 ? { from, options: opts, validFor: /^\$\$?\w*$/ } : null;
    }

    if (!schema) return null;

    const fullSql = cx.state.doc.toString();
    const upTo = fullSql.slice(0, cx.pos);
    const sqlCtx = parseSqlContext(upTo);

    // --- Inside a string literal in a WHERE comparison: distinct-value completion ---
    if (sqlCtx.insideStringForColumn) {
      const { column, table } = sqlCtx.insideStringForColumn;
      // Trigger background fetch (cheap if cached).
      if (runner) requestDistinctValues(runner, schema, table, column, sqlCtx.referenced);
      const values = lookupCachedValues(schema, table, column, sqlCtx.referenced);
      // String tokens: find the unclosed quote and offer completions from inside.
      const lastQuote = upTo.lastIndexOf("'");
      const stringStart = lastQuote + 1;
      const partial = upTo.slice(stringStart).toLowerCase();
      if (values && values.length > 0) {
        const opts: Completion[] = values
          .filter(v => v.toLowerCase().startsWith(partial))
          .slice(0, 50)
          .map(v => ({
            label: v,
            detail: 'value',
            type: 'text',
            apply: v + "'",
            boost: 10,
          }));
        if (opts.length > 0) return { from: stringStart, options: opts, validFor: /^[^']*$/ };
      }
      return null;
    }

    // --- alias.column / table.column qualifier ---
    if (sqlCtx.qualifierAlias) {
      // The `.` was just typed; from = cx.pos (offer a fresh column list).
      const cols = collectColumnsForQualifier(schema, sqlCtx, sqlCtx.qualifierAlias);
      if (cols.length === 0) return null;
      const opts: Completion[] = cols.map(c => ({
        label: c.name,
        detail: `${c.type}`,
        type: 'column',
        apply: wrap(c.name, false),
        boost: 10,
      }));
      return { from: cx.pos, options: opts, validFor: /^"?\w*$/ };
    }

    // --- Tokens like `t.partial` — qualifier+partial in same match ---
    if (token.includes('.')) {
      const [qual, rest] = token.split('.', 2);
      const lc = (rest || '').toLowerCase().replace(/^"/, '');
      const isQuoted = (rest || '').startsWith('"');
      const cols = collectColumnsForQualifier(schema, sqlCtx, qual.toLowerCase());
      const opts: Completion[] = cols
        .filter(c => c.name.toLowerCase().startsWith(lc))
        .map(c => ({
          label: c.name,
          detail: c.type,
          type: 'column',
          apply: wrap(c.name, isQuoted),
          boost: 10,
        }));
      if (opts.length === 0) return null;
      const dotIndex = (tokenMatch?.from ?? cx.pos) + qual.length + 1;
      return { from: dotIndex, options: opts, validFor: /^"?\w*$/ };
    }

    const isQuoted = token.startsWith('"');
    const lc = token.toLowerCase().replace(/^"/, '');
    const options: Completion[] = [];

    // --- Column completions in column contexts ---
    const inColumnCtx =
      sqlCtx.clause === 'select' ||
      sqlCtx.clause === 'where' ||
      sqlCtx.clause === 'having' ||
      sqlCtx.clause === 'group_by' ||
      sqlCtx.clause === 'order_by' ||
      sqlCtx.clause === 'on';

    if (inColumnCtx) {
      const cols = collectColumns(schema, sqlCtx);
      const candidateList = cols.length > 0 ? cols : (
        // No FROM yet — fall back to every column in every table.
        [...schema.tables.flatMap(t => t.columns.map(c => ({ name: c.name, type: c.type, sourceName: t.name }))),
         ...schema.views.flatMap(v => v.columns.map(c => ({ name: c.name, type: c.type, sourceName: v.name })))]
      );
      const seenCol = new Set<string>();
      for (const c of candidateList) {
        const key = c.name.toLowerCase();
        if (seenCol.has(key)) continue;
        if (lc && !key.startsWith(lc)) continue;
        seenCol.add(key);
        options.push({
          label: c.name,
          detail: `${c.type} · ${c.sourceName}`,
          type: 'column',
          apply: wrap(c.name, isQuoted),
          boost: 5,
        });
      }
    }

    // --- Aliases as completions (e.g. typing `t` after `FROM RecordingInfo t, ...`) ---
    if (inColumnCtx || sqlCtx.clause === 'on') {
      for (const alias of sqlCtx.aliases.values()) {
        if (!alias.alias.toLowerCase().startsWith(lc)) continue;
        options.push({
          label: alias.alias,
          detail: `alias of ${alias.target}`,
          type: 'variable',
          apply: alias.alias,
          boost: 4,
        });
      }
    }

    // --- Tables/views/macros — always offered when not in a "values only" spot ---
    const seenObjects = new Set<string>();
    const inTableCtx = sqlCtx.clause === 'from' || sqlCtx.clause === 'join' || sqlCtx.clause === null || sqlCtx.clause === 'with';
    if (inTableCtx || !inColumnCtx) {
      for (const t of schema.tables) {
        if (!t.name.toLowerCase().startsWith(lc)) continue;
        if (seenObjects.has(t.name.toLowerCase())) continue;
        seenObjects.add(t.name.toLowerCase());
        options.push({
          label: t.name,
          detail: t.rowCount != null ? `table · ${t.rowCount.toLocaleString()} rows` : 'table',
          type: 'table',
          apply: wrap(t.name, isQuoted),
          boost: inTableCtx ? 6 : 1,
        });
      }
      for (const v of schema.views) {
        if (!v.name.toLowerCase().startsWith(lc)) continue;
        if (seenObjects.has(v.name.toLowerCase())) continue;
        seenObjects.add(v.name.toLowerCase());
        options.push({
          label: v.name,
          detail: 'view',
          type: 'view',
          apply: wrap(v.name, isQuoted),
          boost: inTableCtx ? 6 : 1,
        });
      }
      // CTEs in this statement.
      for (const cte of sqlCtx.ctes.values()) {
        if (!cte.name.startsWith(lc)) continue;
        if (seenObjects.has(cte.name)) continue;
        seenObjects.add(cte.name);
        options.push({
          label: cte.name,
          detail: 'CTE (this query)',
          type: 'view',
          apply: cte.name,
          boost: 8,
        });
      }
    }

    // Macros (always — they're functions, valid in expressions).
    for (const m of schema.macros) {
      if (!m.name.toLowerCase().startsWith(lc)) continue;
      const sig = m.parameters.length > 0 ? `(${m.parameters.join(', ')})` : '()';
      options.push({
        label: m.name,
        detail: `macro${sig} → ${m.returnType}`,
        type: 'function',
        apply: `${m.name}(`,
        boost: 2,
      });
    }

    // --- Builtin SQL functions in expression contexts ---
    if (inColumnCtx) {
      for (const fn of SQL_FUNCTIONS) {
        if (!fn.name.toLowerCase().startsWith(lc)) continue;
        options.push({
          label: fn.name,
          detail: fn.detail,
          info: fn.signature,
          type: 'function',
          apply: fn.signature.startsWith(fn.name + '(') ? `${fn.name}(` : fn.name,
          boost: fn.boost ?? 1,
        });
      }
    }

    // --- Keywords for the current clause ---
    const kws = keywordsForClause(sqlCtx.clause);
    for (const kw of kws) {
      const tag = kw.split(/\s+/)[0].toLowerCase();
      if (lc && !tag.startsWith(lc) && !kw.toLowerCase().startsWith(lc)) continue;
      options.push({
        label: kw,
        detail: 'keyword',
        type: 'keyword',
        apply: kw + ' ',
        boost: 0,
      });
    }

    if (options.length === 0) return null;

    // Optional semantic rerank (MiniLM) — cache-then-apply.
    const contextKey = upTo.slice(Math.max(0, upTo.length - 200)).toLowerCase();
    kickRank(deps, contextKey, options);
    const ordered = rerank(options, contextKey);
    return { from, options: ordered, validFor: /^"?[\w-]*$/ };
  };
}

// ===========================================================================
// PLOT completion source — hint-driven (P7).
//
// Reads the rich annotated plot AST produced by `parseAndAnnotate`: walks down
// to the deepest `hole` node containing the cursor (or adjacent to it) and
// dispatches on its `PlotHoleHint.kind`. Every completion list (clause keys,
// clause values, tail keys, link args, query refs, etc.) is driven by the
// hint's structured payload — no regex / token fallback. The only legacy
// behavior preserved verbatim is the `@constRef` early-return so users can
// reference LET constants from anywhere.
// ===========================================================================

import { parseAndAnnotate } from './plot';
import { walk, type PlotNode, type ColumnSchema } from './plot/ast';
import type { PlotHoleHint } from './plot/holeKinds';
import type { PlotScopeView } from './plot/notebookPlotScope';
import { closestMatch } from './plot/lint';

export interface PlotCompletionDeps {
  getData: () => any[] | null;
  /**
   * P2 — synchronous read into the schema discovery cache for the cell's
   * companion SQL. Returns null on cache miss or when the feature flag is off.
   */
  getCellResultColumns?: () => ColumnSchema[] | null;
  /** P2 — fire-and-forget request to populate the schema cache. */
  requestSchemaDiscovery?: (sql: string) => void;
  /** P2 — companion SQL text for the current plot cell. */
  getCellSql?: () => string | null;
  /**
   * P3 — notebook-wide plot scope view (named plots, query refs, brush types).
   * Returns null when there is no notebook context (e.g. standalone editor).
   */
  getNotebookPlotScope?: () => PlotScopeView | null;
  /** P3 — id of the cell currently being edited (used as the scope's `currentCellId`). */
  getCurrentCellId?: () => string | null;
  /** Variable map ($-prefixed keys → values). Optional; defaults to {}. */
  getVariables?: () => Record<string, string> | undefined;
  /** Number of SQL blocks in the surrounding cell (drives `#N` query-ref completions). */
  getSqlBlockCount?: () => number;
}

const UPPERCASE_TAILS_DEFAULT: ReadonlyArray<string> = [
  'TITLE', 'SUBTITLE', 'NAME', 'ZOOM',
  'WIDTH', 'HEIGHT', 'ON', 'DISABLED',
  'LINK_X', 'LINK_Y', 'LINK_XY', 'LINK_SCROLL',
];

const LINK_POSITIONAL_KEYWORDS = ['master', 'clamp'];

function detailForColumn(name: string, cols: ColumnSchema[] | null): string {
  if (!cols) return 'column';
  const c = cols.find(x => x.name === name);
  return c?.dataType ? `column · ${c.dataType}` : 'column';
}

/**
 * Walk the tree to find the most specific `hole` node whose span contains the
 * cursor (inclusively). When multiple holes share a position (parser emits
 * e.g. both `clauseValue` and `clauseKey` at the same point when typing
 * `x: <cursor>)`), we prefer the more specific value-side hint over the
 * key-side hint, the inner argument hint over the outer tail-key hint, etc.
 */
const HINT_PRIORITY: Record<string, number> = {
  // Higher = more specific.
  clauseValue: 10,
  letValue: 9,
  tailValue: 9,
  linkArgs: 9,
  onArg: 9,
  queryRefTarget: 9,
  clauseKey: 5,
  tailKey: 4,
  letName: 3,
  topLevel: 1,
};

function findHoleAtCursor(root: PlotNode, pos: number): PlotNode | null {
  let best: PlotNode | null = null;
  let bestPriority = -1;

  // Detect "the cursor is at the end of (or inside) a clauseRef" — that means
  // the user is typing a clause key, even though the parser may also have
  // emitted a clauseValue hole for the same position (because the colon is
  // missing). In that case force priority toward the clauseKey hole.
  let cursorInsideClauseKey = false;
  // Detect "the cursor is inside an ident node whose parent is a clause and
  // sits past the colon" — i.e. the user is typing a value, not a key, even
  // though the parser may have emitted a clauseKey hole at the terminator.
  let cursorInsideClauseValue = false;
  walk(root, n => {
    if (n.kind === 'clauseRef' && n.from <= pos && pos <= n.to) {
      cursorInsideClauseKey = true;
    }
    if (n.kind === 'ident' && n.from <= pos && pos <= n.to) {
      const parent = n.parent;
      if (parent?.kind === 'clause' && parent.colonFrom !== undefined && pos > parent.colonFrom) {
        cursorInsideClauseValue = true;
      }
    }
    // varRef / literal / constRef inside a clause value also count as "user is
    // typing a value, not a key" — suppress the clauseKey hole that the parser
    // may have emitted at the terminator.
    if (
      (n.kind === 'varRef' || n.kind === 'literal' || n.kind === 'constRef' || n.kind === 'functionCall') &&
      n.from <= pos && pos <= n.to
    ) {
      const parent = n.parent;
      if (parent?.kind === 'clause' && parent.colonFrom !== undefined && pos > parent.colonFrom) {
        cursorInsideClauseValue = true;
      }
    }
  });

  walk(root, n => {
    if (n.kind !== 'hole') return;
    if (n.from > pos || pos > n.to) return;
    const kind = n.annotations.hint?.kind;
    let pri = kind ? (HINT_PRIORITY[kind] ?? 0) : 0;
    if (cursorInsideClauseKey && kind === 'clauseKey') pri += 20;
    if (cursorInsideClauseKey && kind === 'clauseValue') pri = -1;
    if (cursorInsideClauseValue && kind === 'clauseKey') pri = -1;
    if (pri < 0) return;
    if (pri > bestPriority) {
      best = n;
      bestPriority = pri;
    }
  });
  return best;
}

/**
 * Locate the deepest non-hole node containing the cursor. Used to detect "the
 * cursor is inside a value ident" cases where the parser successfully
 * consumed a partial column name (and so didn't emit a value hole) but we
 * still want column completions for the slot.
 */
function findValueAncestorClause(root: PlotNode, pos: number): {
  shape: string;
  clauseKey: string;
  paramType: string;
  columnTyped: boolean;
  options?: string[];
} | null {
  let bestClause: PlotNode | null = null;
  walk(root, n => {
    if (n.kind !== 'clause') return;
    if (n.from > pos || pos > n.to) return;
    // Cursor must be after the colon position (i.e. in the value portion).
    if (n.colonFrom !== undefined && pos <= n.colonFrom) return;
    if (!bestClause || (n.to - n.from) <= (bestClause.to - bestClause.from)) {
      bestClause = n;
    }
  });
  if (!bestClause) return null;
  const clause = bestClause as PlotNode;
  // Walk up to the enclosing plotCall to know the shape + clauseDef.
  let p: PlotNode | undefined = clause.parent;
  while (p && p.kind !== 'plotCall') p = p.parent;
  if (!p || !p.shape) return null;
  const cref = clause.children.find(c => c.kind === 'clauseRef');
  const def = cref?.annotations.resolves;
  const paramType = def?.kind === 'clauseDef' ? def.paramType : 'value';
  const options = def?.kind === 'clauseDef' ? def.options : undefined;
  const columnTyped = paramType === 'column' || paramType.includes('column');
  return {
    shape: p.shape,
    clauseKey: clause.key ?? '',
    paramType,
    columnTyped,
    options,
  };
}

/**
 * Find the partial-identifier the user is currently typing immediately before
 * `pos`. Returns `{from, text}` where `from` is the index where the partial
 * starts. Used so we can replace just the partial when a completion is picked
 * (matching CM6 semantics).
 */
function partialBefore(doc: string, pos: number): { from: number; text: string } {
  let i = pos;
  while (i > 0 && /[\w@$#-]/.test(doc[i - 1])) i--;
  return { from: i, text: doc.slice(i, pos) };
}

/**
 * Build the `@const` completion options. Reused by the early return and by
 * `clauseValue` / `letValue` dispatch where `@const` can also appear.
 */
function buildConstOptions(
  fullValue: string,
  partial: string,
): Completion[] {
  const defined = expandPlotConstants(fullValue).constants;
  const lc = partial.toLowerCase();
  return defined
    .filter(c => c.name.toLowerCase().startsWith(lc))
    .map<Completion>(c => ({
      label: `@${c.name}`,
      detail: `= ${truncate(c.value, 30)}`,
      type: 'variable',
      apply: `@${c.name}`,
      boost: 2,
    }));
}

// ─── Per-hint dispatchers ────────────────────────────────────────────────────

function completeTopLevel(from: number, _hint: Extract<PlotHoleHint, { kind: 'topLevel' }>): CompletionResult {
  const options: Completion[] = Object.values(plotRegistry).map(p => ({
    label: p.name,
    detail: p.description,
    type: 'plotFn',
    apply: p.template,
    boost: 5,
  }));
  options.push({
    label: 'row',
    detail: 'horizontal composite of plots',
    type: 'keyword',
    apply: 'row { ',
    boost: 3,
  });
  options.push({
    label: 'col',
    detail: 'vertical composite of plots',
    type: 'keyword',
    apply: 'col { ',
    boost: 3,
  });
  options.push({
    label: 'LET',
    detail: 'define a reusable constant',
    type: 'keyword',
    apply: 'LET @name = value',
    boost: 1,
  });
  return { from, options };
}

function completeClauseKey(
  from: number,
  hint: Extract<PlotHoleHint, { kind: 'clauseKey' }>,
  partial: string,
): CompletionResult | null {
  const options: Completion[] = [];
  const used = new Set(hint.usedKeys.map(k => k.toLowerCase()));
  const required = new Set(hint.requiredMissing.map(k => k.toLowerCase()));
  const columnSet = new Set(hint.columnKeys.map(k => k.toLowerCase()));
  const lc = partial.toLowerCase();

  for (const key of hint.availableKeys) {
    const lck = key.toLowerCase();
    if (used.has(lck)) continue;
    if (lc && !lck.startsWith(lc)) continue;
    const isRequired = required.has(lck);
    const isColumn = columnSet.has(lck);
    options.push({
      label: key,
      detail: `${isColumn ? 'column · ' : ''}${isRequired ? 'required' : 'clause'}`,
      type: 'plotParam',
      apply: `${key}: `,
      // Required clauses + column clauses bubble to the top.
      boost: (isRequired ? 5 : 0) + (isColumn ? 1 : 0),
    });
  }
  return options.length > 0 ? { from, options } : null;
}

function completeClauseValue(
  from: number,
  hint: Extract<PlotHoleHint, { kind: 'clauseValue' }>,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
  cachedColumns: ColumnSchema[] | null,
  dataKeys: string[],
  fullValue: string,
): CompletionResult | null {
  const options: Completion[] = [];
  const lc = partial.toLowerCase();
  const stripQuote = lc.replace(/^"/, '');

  // 1. Column completions when the slot is column-typed (or the registry
  //    couldn't tell — we still offer columns since most clause values accept
  //    them).
  const wantsColumns = hint.columnTyped || hint.paramType === 'column' ||
    hint.paramType === 'column[]' || hint.paramType.includes('column');
  if (wantsColumns) {
    const cols = cachedColumns?.map(c => c.name) ?? dataKeys;
    for (const name of cols) {
      if (stripQuote && !name.toLowerCase().startsWith(stripQuote)) continue;
      options.push({
        label: name,
        detail: detailForColumn(name, cachedColumns),
        type: 'column',
        apply: `"${name}"`,
        boost: 5,
      });
    }
  }

  // 2. Enumerated options (e.g. `linear` / `log` for `yScale`).
  if (hint.options && hint.options.length > 0) {
    for (const opt of hint.options) {
      if (lc && !opt.toLowerCase().startsWith(lc)) continue;
      options.push({
        label: opt,
        detail: 'option',
        type: 'atom',
        apply: opt,
        boost: 3,
      });
    }
  }

  // 3. Constants are always allowed in value slots.
  options.push(...buildConstOptions(fullValue, partial.startsWith('@') ? partial.slice(1) : ''));

  // 4. Variables are also valid value tokens.
  options.push(...buildVariableOptions(deps, scope, partial.startsWith('$') ? partial : ''));

  return options.length > 0 ? { from, options } : null;
}

function completeTailKey(
  from: number,
  hint: Extract<PlotHoleHint, { kind: 'tailKey' }>,
  partial: string,
): CompletionResult | null {
  const allowed = hint.allowedTails.length > 0 ? hint.allowedTails : [...UPPERCASE_TAILS_DEFAULT];
  const lc = partial.toLowerCase();
  const options: Completion[] = [];
  for (const kw of allowed) {
    if (lc && !kw.toLowerCase().startsWith(lc)) continue;
    const doc = plotClauseDocs[kw.toUpperCase()];
    options.push({
      label: kw,
      detail: doc?.signature ?? 'tail',
      type: 'keyword',
      apply: `${kw} `,
      boost: 2,
    });
  }
  return options.length > 0 ? { from, options } : null;
}

function completeTailValue(
  from: number,
  hint: Extract<PlotHoleHint, { kind: 'tailValue' }>,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
  cachedColumns: ColumnSchema[] | null,
  dataKeys: string[],
  fullValue: string,
): CompletionResult | null {
  const options: Completion[] = [];
  if (hint.valueType === 'identList' || hint.valueType === 'linkArgs') {
    // Names of plots / vars
    options.push(...buildPlotNameOptions(scope, partial));
    options.push(...buildVariableOptions(deps, scope, partial));
  }
  if (hint.valueType === 'number' || hint.valueType === 'dimension') {
    options.push(...buildConstOptions(fullValue, partial.startsWith('@') ? partial.slice(1) : ''));
  }
  if (hint.valueType === 'string') {
    options.push(...buildConstOptions(fullValue, partial.startsWith('@') ? partial.slice(1) : ''));
  }
  // Allow columns in any tail value that accepts identifiers.
  if (hint.valueType === 'identList') {
    const cols = cachedColumns?.map(c => c.name) ?? dataKeys;
    const lc = partial.toLowerCase().replace(/^"/, '');
    for (const c of cols) {
      if (lc && !c.toLowerCase().startsWith(lc)) continue;
      options.push({
        label: c,
        detail: detailForColumn(c, cachedColumns),
        type: 'column',
        apply: `"${c}"`,
        boost: 2,
      });
    }
  }
  return options.length > 0 ? { from, options } : null;
}

function completeLinkArgs(
  from: number,
  hint: Extract<PlotHoleHint, { kind: 'linkArgs' }>,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
): CompletionResult | null {
  const options: Completion[] = [];
  // First two positions are variables. After that we suggest master/clamp.
  if (hint.consumed < 2) {
    options.push(...buildVariableOptions(deps, scope, partial));
  } else {
    const lc = partial.toLowerCase();
    for (const kw of LINK_POSITIONAL_KEYWORDS) {
      if (lc && !kw.startsWith(lc)) continue;
      options.push({ label: kw, detail: 'link option', type: 'keyword', apply: kw, boost: 2 });
    }
    // Also still accept named plot refs (rare but allowed).
    options.push(...buildPlotNameOptions(scope, partial));
  }
  return options.length > 0 ? { from, options } : null;
}

function completeOnArg(
  from: number,
  _hint: Extract<PlotHoleHint, { kind: 'onArg' }>,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
): CompletionResult | null {
  const options: Completion[] = [];
  // Query refs (`#N`) and named view aliases (`#viewname`).
  options.push(...buildQueryRefOptions(deps, scope, partial));
  // Named plots are also valid.
  options.push(...buildPlotNameOptions(scope, partial));
  return options.length > 0 ? { from, options } : null;
}

function completeQueryRefTarget(
  from: number,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
): CompletionResult | null {
  return buildQueryRefResult(from, partial, deps, scope);
}

function completeLetName(from: number, _partial: string): CompletionResult | null {
  // No completions for new constant names — just suppress the popup.
  return null;
}

function completeLetValue(
  from: number,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
  fullValue: string,
): CompletionResult | null {
  const options: Completion[] = [
    ...buildConstOptions(fullValue, partial.startsWith('@') ? partial.slice(1) : ''),
    ...buildVariableOptions(deps, scope, partial.startsWith('$') ? partial : ''),
  ];
  return options.length > 0 ? { from, options } : null;
}

// ─── Shared builders ─────────────────────────────────────────────────────────

function buildVariableOptions(
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
  partial: string,
): Completion[] {
  const options: Completion[] = [];
  const lc = partial.toLowerCase().replace(/^\$+/, '');
  const seen = new Set<string>();
  // Scope variables (carries typed metadata).
  if (scope) {
    for (const [name, v] of scope.variables) {
      if (lc && !name.toLowerCase().startsWith(lc)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const prefix = v.scope === 'workspace' ? '$$' : '$';
      options.push({
        label: `${prefix}${name}`,
        detail: `${v.scope} · ${v.dataType}`,
        type: 'variable',
        apply: `${prefix}${name}`,
        boost: 3,
      });
    }
  }
  // Bare deps.getVariables() fallback (handles standalone editor / tests).
  const vars = deps.getVariables?.() ?? {};
  for (const [name, value] of Object.entries(vars)) {
    const bare = name.startsWith('$') ? name.replace(/^\$+/, '') : name;
    if (lc && !bare.toLowerCase().startsWith(lc)) continue;
    if (seen.has(bare.toLowerCase())) continue;
    seen.add(bare.toLowerCase());
    const prefix = name.startsWith('$$') ? '$$' : '$';
    options.push({
      label: `${prefix}${bare}`,
      detail: `= ${truncate(String(value), 30)}`,
      type: 'variable',
      apply: `${prefix}${bare}`,
      boost: 2,
    });
  }
  // Brush refs from prior named plots — wired so LINK_X / LINK_Y can complete.
  if (scope) {
    for (const [plotName, b] of scope.brushes) {
      for (const suffix of ['.lo', '.hi'] as const) {
        const candidate = `${plotName}.brush${suffix}`;
        const lcCandidate = candidate.toLowerCase();
        if (lc && !lcCandidate.startsWith(lc) && !plotName.toLowerCase().startsWith(lc)) continue;
        if (seen.has(lcCandidate)) continue;
        seen.add(lcCandidate);
        options.push({
          label: `$${candidate}`,
          detail: `brush · ${b.xType}`,
          type: 'variable',
          apply: `$${candidate}`,
          boost: 4,
        });
      }
    }
  }
  return options;
}

function buildPlotNameOptions(scope: PlotScopeView | null, partial: string): Completion[] {
  if (!scope) return [];
  const lc = partial.toLowerCase();
  const options: Completion[] = [];
  for (const p of scope.namedPlots) {
    if (lc && !p.plotName.toLowerCase().startsWith(lc)) continue;
    options.push({
      label: p.plotName,
      detail: `${p.shape} plot`,
      type: 'variable',
      apply: p.plotName,
      boost: 4,
    });
  }
  return options;
}

function buildQueryRefOptions(
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
  partial: string,
): Completion[] {
  const options: Completion[] = [];
  const lc = partial.toLowerCase().replace(/^#/, '');
  const seen = new Set<string>();
  if (scope) {
    for (const q of scope.queryRefs) {
      const idxLabel = `#${q.index}`;
      if (lc && !String(q.index).startsWith(lc)) {
        // continue, but also check alias prefix below
      } else if (!seen.has(idxLabel)) {
        seen.add(idxLabel);
        options.push({
          label: idxLabel,
          detail: q.alias ? `query · ${q.alias}` : `query in cell ${q.cellId}`,
          type: 'variable',
          apply: idxLabel,
          boost: 4,
        });
      }
      if (q.alias && (!lc || q.alias.toLowerCase().startsWith(lc))) {
        const aliasLabel = `#${q.alias}`;
        if (!seen.has(aliasLabel)) {
          seen.add(aliasLabel);
          options.push({
            label: aliasLabel,
            detail: `view alias`,
            type: 'variable',
            apply: aliasLabel,
            boost: 4,
          });
        }
      }
    }
  }
  // Fall back to #1..#N from sqlBlockCount when scope is unavailable.
  if (options.length === 0) {
    const n = deps.getSqlBlockCount?.() ?? 0;
    for (let i = 1; i <= n; i++) {
      const lbl = `#${i}`;
      if (lc && !String(i).startsWith(lc)) continue;
      options.push({ label: lbl, detail: `query #${i}`, type: 'variable', apply: lbl, boost: 4 });
    }
  }
  return options;
}

function buildQueryRefResult(
  from: number,
  partial: string,
  deps: PlotCompletionDeps,
  scope: PlotScopeView | null,
): CompletionResult | null {
  const opts = buildQueryRefOptions(deps, scope, partial);
  return opts.length > 0 ? { from, options: opts } : null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function plotCompletionSource(deps: PlotCompletionDeps) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const fullValue = ctx.state.doc.toString();
    const data = deps.getData();

    // P2 — prefer typed columns from the discovery cache; fall back to row
    // sampling, and kick off discovery on cache miss.
    const cachedColumns = deps.getCellResultColumns?.() ?? null;
    if (!cachedColumns && deps.getCellSql && deps.requestSchemaDiscovery) {
      const cellSql = deps.getCellSql();
      if (cellSql && cellSql.trim()) deps.requestSchemaDiscovery(cellSql);
    }
    const dataKeys = data && data.length > 0 ? Object.keys(data[0]) : [];

    // P3 — pull in the notebook plot scope (may be null in standalone editor).
    const scope = deps.getNotebookPlotScope?.() ?? null;
    const cellId = deps.getCurrentCellId?.() ?? null;
    const notebookContext = scope && cellId
      ? { currentCellId: cellId, scope }
      : undefined;

    // ── @const early return ────────────────────────────────────────────────
    const partial = partialBefore(fullValue, ctx.pos);
    if (partial.text.startsWith('@')) {
      const options = buildConstOptions(fullValue, partial.text.slice(1));
      return options.length > 0
        ? { from: partial.from, options, validFor: /^@\w*$/ }
        : null;
    }

    // Parse + annotate with cursor info — emits a `hole` at the cursor.
    let root: PlotNode;
    try {
      const result = parseAndAnnotate({
        src: fullValue,
        cursorPos: ctx.pos,
        resultColumns: cachedColumns ?? undefined,
        shapeRegistry: getPlotRegistryAsShapes(),
        notebookContext,
      });
      root = result.root;
    } catch (err) {
      if ((import.meta as any).env?.DEV) console.warn('[plotCompletionSource] parse failed:', err);
      return null;
    }

    const hole = findHoleAtCursor(root, ctx.pos);
    const hint = hole?.annotations.hint;
    if (!hint) {
      // No specific hole hint — try value-ancestor fallback (e.g. user typed
      // `x: g` and the parser consumed `g` as an ident, so no value hole was
      // emitted, but the cursor is inside a column-typed clause value).
      const va = findValueAncestorClause(root, ctx.pos);
      if (va) {
        const synthHint: Extract<PlotHoleHint, { kind: 'clauseValue' }> = {
          kind: 'clauseValue',
          shape: va.shape,
          clauseKey: va.clauseKey,
          paramType: va.paramType,
          columnTyped: va.columnTyped,
          options: va.options,
          inList: false,
        };
        return completeClauseValue(
          partial.from, synthHint, partial.text, deps, scope,
          cachedColumns, dataKeys, fullValue,
        );
      }
      if (partial.text.startsWith('$')) {
        const options = buildVariableOptions(deps, scope, partial.text);
        return options.length > 0
          ? { from: partial.from, options, validFor: /^\$\$?\w*$/ }
          : null;
      }
      // Top-level / composite-body fallback: when the cursor sits at a position
      // where a fresh statement can start (start-of-doc, after `{`, `}`, `;`,
      // `+`, `,`, or a newline), offer the registry shapes + row/col. Covers
      // partial-typed shape names (LINE|, BAR|) and empty composite bodies
      // (`row { |`) where the parser never managed to emit a hole hint.
      const before = fullValue.slice(0, partial.from);
      const trimmed = before.replace(/\s+$/, '');
      const lastCh = trimmed.length === 0 ? '' : trimmed[trimmed.length - 1];
      const atTopLevelPos = trimmed.length === 0 ||
        lastCh === '{' || lastCh === '}' || lastCh === ';' ||
        lastCh === '+' || lastCh === ',' || /\n\s*$/.test(before);
      if (atTopLevelPos) {
        const lcShape = partial.text.toLowerCase();
        const options: Completion[] = [];
        for (const p of Object.values(plotRegistry)) {
          if (lcShape && !p.name.toLowerCase().startsWith(lcShape)) continue;
          options.push({
            label: p.name,
            detail: p.description,
            type: 'plotFn',
            apply: p.template,
            boost: 5,
          });
        }
        if (!lcShape || 'row'.startsWith(lcShape)) {
          options.push({ label: 'row', detail: 'horizontal composite of plots', type: 'keyword', apply: 'row { ', boost: 3 });
        }
        if (!lcShape || 'col'.startsWith(lcShape)) {
          options.push({ label: 'col', detail: 'vertical composite of plots', type: 'keyword', apply: 'col { ', boost: 3 });
        }
        if (!lcShape || 'let'.startsWith(lcShape)) {
          options.push({ label: 'LET', detail: 'define a reusable constant', type: 'keyword', apply: 'LET @name = value', boost: 1 });
        }
        // Typo-recovery: if the user typed 3+ chars that don't prefix any
        // canonical shape name, surface the single closest match (Levenshtein
        // ≤2). Require the first two chars to coincide to avoid wildly wrong
        // suggestions like "XXXX" → "BAR_CHART".
        if (options.length === 0 && lcShape.length >= 3) {
          const names = Object.values(plotRegistry).map(p => p.name);
          const m = closestMatch(lcShape, names);
          if (m && m.slice(0, 2).toLowerCase() === lcShape.slice(0, 2).toLowerCase()) {
            const p = plotRegistry[m as keyof typeof plotRegistry];
            options.push({
              label: m,
              detail: `did you mean? · ${p?.description ?? ''}`.trim(),
              type: 'plotFn',
              apply: p?.template ?? m,
              boost: 4,
            });
          }
        }
        if (options.length > 0) return { from: partial.from, options };
      }

      if (partial.text === '') return null;
      // Generic column suggestions on a bare identifier (best-effort).
      const cols = cachedColumns?.map(c => c.name) ?? dataKeys;
      const lc = partial.text.toLowerCase().replace(/^"/, '');
      const options: Completion[] = [];
      for (const c of cols) {
        if (!c.toLowerCase().startsWith(lc)) continue;
        options.push({
          label: c,
          detail: detailForColumn(c, cachedColumns),
          type: 'column',
          apply: `"${c}"`,
          boost: 1,
        });
      }
      return options.length > 0 ? { from: partial.from, options } : null;
    }

    const from = partial.from;

    switch (hint.kind) {
      case 'topLevel':
        return completeTopLevel(from, hint);
      case 'clauseKey':
        return completeClauseKey(from, hint, partial.text);
      case 'clauseValue':
        return completeClauseValue(
          from, hint, partial.text, deps, scope, cachedColumns, dataKeys, fullValue,
        );
      case 'tailKey':
        return completeTailKey(from, hint, partial.text);
      case 'tailValue':
        return completeTailValue(
          from, hint, partial.text, deps, scope, cachedColumns, dataKeys, fullValue,
        );
      case 'linkArgs':
        return completeLinkArgs(from, hint, partial.text, deps, scope);
      case 'onArg':
        return completeOnArg(from, hint, partial.text, deps, scope);
      case 'queryRefTarget':
        return completeQueryRefTarget(from, partial.text, deps, scope);
      case 'letName':
        return completeLetName(from, partial.text);
      case 'letValue':
        return completeLetValue(from, partial.text, deps, scope, fullValue);
    }
    return null;
  };
}

/**
 * Adapt the runtime `plotRegistry` (uppercase keys, `params: PlotParameter[]`)
 * to the parser-side `ShapeRegistry` shape (lowercase keys + `validClauses` /
 * `columnClauses` / `requiredClauses` / `clauseDefs`).
 */
function getPlotRegistryAsShapes(): import('./plot/annotators/shapeAnnotator').ShapeRegistry {
  // Memoize — registry is stable for the editor session.
  if (cachedShapeRegistry) return cachedShapeRegistry;
  const reg: import('./plot/annotators/shapeAnnotator').ShapeRegistry = {};
  const SHAPE_MAP: Record<string, string> = {
    LINE_CHART: 'line',
    BAR_CHART: 'bar',
    PIE_CHART: 'pie',
    SCATTER_PLOT: 'scatter',
    HEATMAP: 'heatmap',
    HISTOGRAM: 'histogram',
    BOX_PLOT: 'boxplot',
    FLAMEGRAPH: 'flamegraph',
    TABLE: 'table',
  };
  for (const [upperName, def] of Object.entries(plotRegistry)) {
    const lower = SHAPE_MAP[upperName] ?? upperName.toLowerCase();
    const params = (def as any).params ?? [];
    const validClauses = params.map((p: any) => p.name);
    const columnClauses = params
      .filter((p: any) => typeof p.type === 'string' && p.type.includes('column'))
      .map((p: any) => p.name);
    const requiredClauses = params
      .filter((p: any) => p.required)
      .map((p: any) => p.name);
    const clauseDefs = params.map((p: any) => ({
      key: p.name,
      paramType: p.type,
      required: !!p.required,
      options: p.options,
      description: p.description,
    }));
    reg[lower] = {
      name: lower,
      validClauses,
      columnClauses,
      requiredClauses,
      clauseDefs,
      description: (def as any).description,
    };
  }
  cachedShapeRegistry = reg;
  return reg;
}
let cachedShapeRegistry: import('./plot/annotators/shapeAnnotator').ShapeRegistry | null = null;
