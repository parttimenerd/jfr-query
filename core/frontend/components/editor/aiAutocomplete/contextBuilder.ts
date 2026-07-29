/**
 * Build the system + user prompt for AI ghost-text autocomplete.
 *
 * Token estimation is char-count / 4 (the GPT-family rule of thumb). When the
 * total estimated tokens exceed the budget, the OLDEST prior cells are dropped
 * first (FIFO eviction). Schema, current-cell content, and result-column hints
 * are always included.
 */

import type { SchemaForCompletion } from '../completions';

export interface ResultColumn {
  name: string;
  type: string;
}

export type AutocompleteMode = 'sql' | 'markdown' | 'plot';

export interface ContextInput {
  mode: AutocompleteMode;
  priorCellsContent: string[];
  followingCellContent?: string;
  currentCellUpToCursor: string;
  currentCellAfterCursor: string;
  schema: SchemaForCompletion | null;
  cellResultSchema: ResultColumn[] | null;
  variables?: Record<string, string>;
  /** True when the cursor sits inside a SQL `--` or `/* *​/` comment. */
  inComment?: boolean;
  /** Token budget for system+user combined. Default 4096. */
  budgetTokens?: number;
}

export interface BuiltContext {
  system: string;
  user: string;
  estimatedTokens: number;
  /** How many prior cells survived truncation. */
  includedPriorCells: number;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_BUDGET = 4096;

function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function summarizeSchema(schema: SchemaForCompletion | null): string {
  if (!schema || schema.tables.length === 0) return '';
  const tables = schema.tables.slice(0, 20).map(t => {
    const cols = t.columns.slice(0, 12).map(c => `"${c.name}" ${c.type}`).join(', ');
    const more = t.columns.length > 12 ? `, …(+${t.columns.length - 12})` : '';
    return `- "${t.name}": (${cols}${more})`;
  }).join('\n');
  const views = schema.views.slice(0, 10).map(v => `- "${v.name}"`).join('\n');
  let s = 'TABLES:\n' + tables;
  if (views) s += '\n\nVIEWS:\n' + views;
  return s;
}

function summarizeResultColumns(cols: ResultColumn[] | null): string {
  if (!cols || cols.length === 0) return '';
  return cols.slice(0, 30).map(c => `"${c.name}" ${c.type}`).join(', ');
}

function summarizeVariables(vars: Record<string, string> | undefined): string {
  if (!vars) return '';
  const entries = Object.entries(vars).slice(0, 20);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k} = ${String(v).slice(0, 80)}`).join('\n');
}

const SYSTEM_SQL = `You are an inline code-completion model for a DuckDB SQL notebook.
Return ONLY the next 1-60 tokens that would naturally continue from the cursor.
No narration. No code fences. No restatement of the prefix.
Output stops at the next logical boundary (newline, comma, closing paren) or 60 tokens, whichever is first.
DuckDB SQL: identifiers are case-sensitive when double-quoted; use "Column Name" for spaces.
Prefer columns/tables present in the Schema block. Prefer DuckDB built-ins (date_trunc, time_bucket, list_*, regexp_*, percentile_cont).
Inside subqueries, prefer columns from the INNER FROM clause; outer-scope columns only when correlation is required.

Examples (prefix → completion only, after <<CURSOR>>):
  SELECT date_trunc('hour', "ts") AS h, count(*) FROM events GROUP BY <<CURSOR>>
  → h ORDER BY h
  SELECT * FROM gc WHERE "pauseMs" > <<CURSOR>>
  → 100 ORDER BY "ts" DESC LIMIT 100
  WITH agg AS (SELECT "host", count(*) c FROM events GROUP BY "host") SELECT * FROM agg WHERE <<CURSOR>>
  → c > 10 ORDER BY c DESC
  SELECT "host" FROM events WHERE "host" IN (SELECT "host" FROM requests WHERE <<CURSOR>>
  → "status_code" >= 500)`;

const SYSTEM_SQL_COMMENT = `You are an inline documentation-comment model for a DuckDB SQL notebook.
Return ONLY the next 1-30 tokens of comment prose continuing from the cursor.
No fences. No restatement. The user is mid-comment; keep the voice technical and concise.`;

const SYSTEM_MARKDOWN = `You are an inline prose-completion model for a data-analysis notebook.
Return ONLY the next 1-40 words that would naturally continue from the cursor.
No narration about being an AI. No quotes. No restatement of the prefix.`;

const SYSTEM_PLOT = `You are an inline completion model for a plot configuration DSL.
Return ONLY the next 1-40 tokens to continue the plot call from the cursor.
No prose, no fences, no restatement.

Plot DSL: NAME(param: value, ...) [SUFFIX-CLAUSE ...]
Plots: LINE_CHART, BAR_CHART, AREA_CHART, SCATTER_PLOT, PIE_CHART, HISTOGRAM, HEATMAP, BOX_PLOT, TABLE, FLAMEGRAPH, GANTT, RANGE; composition: ROW(...), COL(...), A + B.
Common params: x, y, color, category, value. Quote column names with spaces ("CPU %").
Suffix clauses (after closing paren): TITLE "...", LEGEND AT BOTTOM|RIGHT|NONE, PALETTE "category10", AXIS_Y DOMAIN [a, b], LINK_X($s,$e), BRUSH $sel MODE X.

Examples (prefix → completion only, after <<CURSOR>>):
  LINE_CHART(x: "ts", y: <<CURSOR>>
  → "cpu") TITLE "CPU over time"
  BAR_CHART(x: "host", y: "count", <<CURSOR>>
  → color: "region", horizontal: true) LEGEND AT BOTTOM
  ROW(LINE_CHART(x: "ts", y: "cpu"), <<CURSOR>>
  → LINE_CHART(x: "ts", y: "mem"))
  LINE_CHART(x: "ts", y: "cpu") + <<CURSOR>>
  → RANGE(x: "ts", low: "p25", high: "p75")
  COL(ROW(<<CURSOR>>
  → LINE_CHART(x: "ts", y: "cpu"), BAR_CHART(x: "host", y: "count")), TABLE())`;

function pickSystem(mode: AutocompleteMode, inComment: boolean): string {
  if (mode === 'markdown') return SYSTEM_MARKDOWN;
  if (mode === 'plot') return SYSTEM_PLOT;
  return inComment ? SYSTEM_SQL_COMMENT : SYSTEM_SQL;
}

/**
 * Build a single string user-payload for the AI request. Truncates prior cells
 * FIFO when the budget is exceeded. The cursor marker `<<CURSOR>>` is included
 * literally so the model knows where to continue.
 */
export function buildAutocompleteContext(input: ContextInput): BuiltContext {
  const budget = input.budgetTokens ?? DEFAULT_BUDGET;
  const system = pickSystem(input.mode, !!input.inComment);

  // Always-included sections.
  const schemaBlock = summarizeSchema(input.schema);
  const resultColsBlock = summarizeResultColumns(input.cellResultSchema);
  const varsBlock = summarizeVariables(input.variables);
  const afterTrimmed = input.currentCellAfterCursor.slice(0, 200);

  // Iteratively drop the OLDEST prior cell until the estimated total fits.
  let priors = [...input.priorCellsContent];
  const buildUser = (): string => {
    const sections: string[] = [];
    if (schemaBlock) sections.push(`# Schema\n${schemaBlock}`);
    if (resultColsBlock) sections.push(`# Current cell result columns\n${resultColsBlock}`);
    if (varsBlock) sections.push(`# Variables in scope\n${varsBlock}`);
    if (priors.length > 0) {
      const block = priors.map((c, i) => `--- cell ${i + 1} ---\n${c}`).join('\n');
      sections.push(`# Prior cells (chronological)\n${block}`);
    }
    sections.push(`# Current cell — text before cursor\n${input.currentCellUpToCursor}<<CURSOR>>${afterTrimmed}`);
    return sections.join('\n\n');
  };

  let user = buildUser();
  let total = estimateTokens(system) + estimateTokens(user);
  while (total > budget && priors.length > 0) {
    priors.shift();
    user = buildUser();
    total = estimateTokens(system) + estimateTokens(user);
  }

  return {
    system,
    user,
    estimatedTokens: total,
    includedPriorCells: priors.length,
  };
}
