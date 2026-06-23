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
// PLOT completion source (unchanged behavior, kept here so the editor module
// has a single completions entry point).
// ===========================================================================

export interface PlotCompletionDeps {
  getData: () => any[] | null;
}

export function plotCompletionSource(deps: PlotCompletionDeps) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const data = deps.getData();
    const dataKeys = data && data.length > 0 ? Object.keys(data[0]) : [];
    const fullValue = ctx.state.doc.toString();
    const definedConstants = expandPlotConstants(fullValue).constants;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const lineText = line.text;
    const lineCh = ctx.pos - line.from;
    const before = lineText.slice(0, lineCh);

    const atRefMatch = before.match(/@(\w*)$/);
    if (atRefMatch) {
      const from = ctx.pos - atRefMatch[0].length;
      const partial = atRefMatch[1].toLowerCase();
      const options = definedConstants
        .filter(c => c.name.toLowerCase().startsWith(partial))
        .map<Completion>(c => ({
          label: `@${c.name}`,
          detail: `= ${truncate(c.value, 30)}`,
          type: 'variable',
          apply: `@${c.name}`,
        }));
      return options.length > 0 ? { from, options, validFor: /^@\w*$/ } : null;
    }

    const tokenMatch = ctx.matchBefore(/[\w"]+/);
    const tokenText = tokenMatch?.text ?? '';
    const from = tokenMatch ? tokenMatch.from : ctx.pos;

    const funcMatch = before.match(/(\w+)\s*\(([^)]*)$/);
    if (funcMatch) {
      const funcName = funcMatch[1].toUpperCase();
      const argsStr = funcMatch[2];
      const plotDef = plotRegistry[funcName];
      if (plotDef) {
        const isTypingValue = /:\s*[\w"']*\s*$/.test(before);
        const paramNameMatch = before.match(/(\w+)\s*:\s*[\w"']*\s*$/);
        const currentParamName = paramNameMatch ? paramNameMatch[1] : null;
        const paramDef = currentParamName ? plotDef.params.find(p => p.name === currentParamName) : null;

        if (isTypingValue && paramDef) {
          const options: Completion[] = [];
          if (paramDef.type.includes('column')) {
            for (const key of dataKeys) {
              options.push({ label: key, detail: 'column', type: 'column', apply: `"${key}"` });
            }
          }
          if (paramDef.options) {
            for (const opt of paramDef.options) {
              options.push({ label: opt, detail: 'option', type: 'atom', apply: opt });
            }
          }
          for (const c of definedConstants) {
            options.push({
              label: `@${c.name}`,
              detail: `= ${truncate(c.value, 30)}`,
              type: 'variable',
              apply: `@${c.name}`,
            });
          }
          return options.length > 0 ? { from, options } : null;
        }
        const usedParams = new Set(
          argsStr.match(/(\w+)\s*:/g)?.map(p => p.slice(0, -1).trim()) || [],
        );
        const options: Completion[] = [];
        for (const param of plotDef.params) {
          if (usedParams.has(param.name)) continue;
          options.push({
            label: param.name,
            detail: `${param.type}${param.required ? ' *' : ''}`,
            type: 'plotParam',
            apply: `${param.name}: `,
          });
        }
        return options.length > 0 ? { from, options } : null;
      }
    }

    if (/\)\s*\w*$/.test(before)) {
      const options: Completion[] = Object.values(plotClauseDocs).map(c => ({
        label: c.name,
        detail: c.signature,
        type: 'keyword',
        apply: `${c.name} `,
      }));
      return { from, options };
    }

    const beforeToken = lineText.slice(0, tokenMatch ? tokenMatch.from - line.from : lineCh);
    if (/^\s*$/.test(beforeToken) || /;\s*$/.test(beforeToken.trim())) {
      const options: Completion[] = Object.values(plotRegistry).map(p => ({
        label: p.name,
        detail: p.description,
        type: 'plotFn',
        apply: p.template,
      }));
      options.push({
        label: 'LET',
        detail: 'define a reusable constant',
        type: 'keyword',
        apply: 'LET @name = value',
      });
      return options.length > 0 ? { from, options } : null;
    }

    if (tokenText) {
      const options: Completion[] = [];
      for (const key of dataKeys) {
        if (!key.toLowerCase().startsWith(tokenText.toLowerCase())) continue;
        options.push({ label: key, detail: 'column', type: 'column', apply: `"${key}"` });
      }
      if (options.length > 0) return { from, options };
    }

    return null;
  };
}
