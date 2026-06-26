/**
 * Plot-specific AI ghost-text prompt + context builder.
 *
 * Returns a `BuiltContext` mirroring `aiAutocomplete/contextBuilder.ts`. Unlike
 * the SQL variant, the plot prompt is more structured: it inlines the shape
 * registry summary, the SQL result columns of the current cell, the cross-plot
 * scope from prior plot cells (if any), and the named variables in scope.
 *
 * Security: variable keys starting with `$ai_providers` are filtered before
 * serialization so secret values never reach the model.
 */

import type { PlotRegistration } from '../../plots/plotTypes';
import type { ResultColumn } from '../aiAutocomplete/contextBuilder';

export interface PlotScopePlot {
    /** Plot name (from `| name: foo` or `NAME foo`). */
    name: string;
    /** Normalized shape (`line`, `bar`, ...). */
    shape?: string;
    /** Whether this plot exposes a brush. */
    hasBrush?: boolean;
    /** Optional cell id (for diagnostic purposes). */
    cellId?: string;
}

export interface PlotAiContextInput {
    /** Registry of available plot shapes (defaults to a single summary string when omitted). */
    shapeRegistry?: Record<string, PlotRegistration<any>>;
    /** Current cell's SQL result columns (name + type). */
    cellResultSchema?: ResultColumn[] | null;
    /** Cross-plot scope — named plots in earlier cells, referenceable in LINK_X/ON. */
    plotScope?: PlotScopePlot[];
    /** Workspace and cell-local variables, by name. */
    variables?: Record<string, string>;
    /** Prior PLOT cells' raw content (chronological, recent last). */
    priorPlotCellsContent?: string[];
    /** Current cell content before the cursor. */
    currentCellUpToCursor: string;
    /** Current cell content after the cursor. */
    currentCellAfterCursor: string;
    /** Token budget for system+user combined. Default 3072 per plan risk row. */
    budgetTokens?: number;
    /** Max prior cells included. Default 5. */
    maxPriorCells?: number;
    /** Max chars per prior cell. Default 1024. */
    maxPriorCellChars?: number;
}

export interface BuiltContext {
    system: string;
    user: string;
    estimatedTokens: number;
    /** How many prior plot cells survived truncation. */
    includedPriorCells: number;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_BUDGET = 3072;
const DEFAULT_MAX_PRIOR_CELLS = 5;
const DEFAULT_MAX_PRIOR_CHARS = 1024;
const AFTER_CURSOR_LIMIT = 200;

const SYSTEM_PROMPT = `You are an inline completion model for a custom plot DSL inside a DuckDB analysis notebook.
The DSL is a function call: NAME(param: value, ...) optionally followed by SQL-style suffix clauses.
Clauses (uppercase canonical, lowercase accepted): TITLE "...", LEGEND AT RIGHT|LEFT|TOP|BOTTOM|NONE,
PALETTE "...", AXIS-X DOMAIN [a,b] / LABEL "..." / TYPE LINEAR|LOG|TIME|BAND / FORMAT "...", AXIS-Y (same),
TOOLTIP COLUMNS [...], LINK-X "$var", LINK-Y "$var", LINK-XY "$var", BRUSH "$var" MODE X|Y|XY,
NAME "alias", LET name = expr, ON HOVER TOOLTIP "...", ON CLICK NAVIGATE "...".
Plot names accept short aliases (line/bar/area/scatter/pie/box/hist/heatmap/flame/gantt/range/table).
Return ONLY the next 1-80 tokens that would naturally continue at the cursor.
Stop at the next logical boundary: closing ) or }, end-of-clause ',', end-of-statement (newline), or 80 tokens.
No code fences, no narration, no leading/trailing whitespace beyond what continues the prefix.`;

function estimateTokens(s: string): number {
    return Math.ceil(s.length / CHARS_PER_TOKEN);
}

/**
 * Filter out secret-bearing variable keys. The `$ai_providers.*` namespace is
 * reserved for API keys / provider config and MUST NEVER reach a remote model.
 */
function safeVariableEntries(
    vars: Record<string, string> | undefined,
): Array<[string, string]> {
    if (!vars) return [];
    const out: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(vars)) {
        if (/^\$ai_providers/i.test(k)) continue;
        out.push([k, v]);
    }
    return out;
}

export function summarizeShapeRegistry(
    reg: Record<string, PlotRegistration<any>> | undefined,
): string {
    if (!reg) return '';
    const entries = Object.values(reg).slice(0, 20);
    if (entries.length === 0) return '';
    const lines: string[] = [];
    for (const p of entries) {
        const required = p.params.filter(x => x.required).map(x => `${x.name}: ${x.type}`).join(', ');
        const optional = p.params.filter(x => !x.required).map(x => x.name).slice(0, 8).join(', ');
        const ex = p.examples?.[0]?.code?.replace(/\s+/g, ' ').slice(0, 120) ?? '';
        lines.push(`- ${p.name}(${required}${optional ? ' | ' + optional : ''})${ex ? `  e.g. ${ex}` : ''}`);
    }
    return lines.join('\n');
}

function summarizeResultColumns(cols: ResultColumn[] | null | undefined): string {
    if (!cols || cols.length === 0) return '';
    return cols.slice(0, 40).map(c => `${c.name} (${c.type})`).join(', ');
}

function summarizePlotScope(scope: PlotScopePlot[] | undefined): string {
    if (!scope || scope.length === 0) return '';
    return scope
        .slice(0, 20)
        .map(p => {
            const shape = p.shape ? ` (${p.shape})` : '';
            const brush = p.hasBrush ? ' — has brush: yes' : '';
            return `- ${p.name}${shape}${brush}`;
        })
        .join('\n');
}

function summarizeVariables(vars: Record<string, string> | undefined): string {
    const entries = safeVariableEntries(vars).slice(0, 25);
    if (entries.length === 0) return '';
    return entries
        .map(([k, v]) => `${k} = ${String(v).slice(0, 80)}`)
        .join('\n');
}

/**
 * Build a Plot-DSL inline-completion prompt. Truncates prior plot cells (FIFO)
 * to keep the total token estimate under `budgetTokens`. Always preserves the
 * shape registry, result columns, plot scope, variables, and current cell text.
 */
export function buildPlotAiContext(input: PlotAiContextInput): BuiltContext {
    const budget = input.budgetTokens ?? DEFAULT_BUDGET;
    const maxPriorCells = input.maxPriorCells ?? DEFAULT_MAX_PRIOR_CELLS;
    const maxPriorChars = input.maxPriorCellChars ?? DEFAULT_MAX_PRIOR_CHARS;

    const shapesBlock = summarizeShapeRegistry(input.shapeRegistry);
    const resultColsBlock = summarizeResultColumns(input.cellResultSchema);
    const scopeBlock = summarizePlotScope(input.plotScope);
    const varsBlock = summarizeVariables(input.variables);
    const afterTrimmed = input.currentCellAfterCursor.slice(0, AFTER_CURSOR_LIMIT);

    // Truncate prior cells per-cell, then FIFO until the budget fits.
    let priors = (input.priorPlotCellsContent ?? [])
        .slice(-maxPriorCells)
        .map(c => c.slice(0, maxPriorChars));

    const buildUser = (): string => {
        const sections: string[] = [];
        if (shapesBlock) sections.push(`# Available shapes\n${shapesBlock}`);
        if (resultColsBlock) sections.push(`# Current cell's SQL result columns\n${resultColsBlock}`);
        if (scopeBlock) sections.push(`# Named plots above this cell (referenceable in LINK_X / ON / LINK_SCROLL)\n${scopeBlock}`);
        if (varsBlock) sections.push(`# Variables in scope\n${varsBlock}`);
        if (priors.length > 0) {
            const block = priors
                .map((c, i) => `--- prior plot cell ${i + 1} ---\n${c}`)
                .join('\n');
            sections.push(`# Prior plot cells (chronological)\n${block}`);
        }
        sections.push(
            `# Current cell — plot DSL before cursor\n${input.currentCellUpToCursor}<<CURSOR>>${afterTrimmed}`,
        );
        return sections.join('\n\n');
    };

    let user = buildUser();
    let total = estimateTokens(SYSTEM_PROMPT) + estimateTokens(user);
    while (total > budget && priors.length > 0) {
        priors.shift();
        user = buildUser();
        total = estimateTokens(SYSTEM_PROMPT) + estimateTokens(user);
    }

    return {
        system: SYSTEM_PROMPT,
        user,
        estimatedTokens: total,
        includedPriorCells: priors.length,
    };
}
