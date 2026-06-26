// P3 — Notebook-wide plot scope discovery.
//
// Given the full sequence of notebook cells and the *current* cell id, build a
// snapshot of every named plot above this point in the notebook, every SQL
// query ref (numeric `#N` or alias from `CREATE VIEW … AS …`), every variable
// that the cursor can legally reference, and per-named-plot brush metadata
// (used by the brushAnnotator to type `$plotName.brush.lo / .hi`).
//
// Cross-plot symbol resolution (the annotator side) lives in
// `annotators/crossPlotAnnotator.ts` — this file only builds the *view* the
// annotator consumes.
//
// Memoization. Naive rebuilds on every keystroke would be O(N * cells). We
// cache the last result keyed on the `(allCells reference identity,
// currentCellId)` pair — the parent `Notebook` component reuses the same array
// reference across renders unless cells genuinely change.

import { parse } from './parser';
import { walk, type PlotNode, type ColumnSchema } from './ast';
import type { NotebookCellData } from '../../../types';
import { tokenizeCellContent, parseCellContent } from '../../../utils/notebookParser';
import { parsePlotCall } from '../../../utils/plotParser';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlotScopeView {
    /** All named plots in the notebook (with `| name: foo` or `NAME "foo"`). */
    namedPlots: ReadonlyArray<{
        plotName: string;
        cellId: string;
        plotIndexInCell: number;
        shape: string;                          // 'line', 'scatter', ...
        sqlBlockIndex?: number;                 // links back to the SQL block that drives it
        linkedXVars?: [string, string];         // ($start, $end) names without leading $
        linkedYVars?: string;                   // $brushVarName for LINK-Y / LINK-XY (single variable)
        hasBrush: boolean;                      // true if the user has interacted (live brush state)
        declaredColumns?: ColumnSchema[];       // from P2's discovery cache if available
    }>;
    /** All query refs available: 1-based index → cellId + sql. */
    queryRefs: ReadonlyArray<{
        index: number;                          // 1-based per-notebook SQL block index
        cellId: string;
        sql: string;
        alias?: string;                         // view name from `CREATE VIEW ... AS ...`
        columns?: ColumnSchema[];
    }>;
    /** Workspace + cell-local + cross-cell exports flattened. */
    variables: ReadonlyMap<string, {
        name: string;
        scope: 'cellLocal' | 'workspace' | 'crossCell' | 'gesture';
        value?: string;
        dataType: 'number' | 'string' | 'timestamp' | 'json' | 'unknown';
    }>;
    /** Per-named-cell brush metadata (for `.brush.lo/.hi` typing). */
    brushes: ReadonlyMap<string, {
        plotName: string;
        cellId: string;
        xType: 'number' | 'timestamp' | 'string' | 'unknown';
        yType: 'number' | 'timestamp' | 'string' | 'unknown';
    }>;
}

export interface NotebookPlotContext {
    currentCellId: string;
    scope: PlotScopeView;
}

// ---------------------------------------------------------------------------
// Builder input
// ---------------------------------------------------------------------------

export interface BuildArgs {
    /** Notebook cells in document order. */
    cells: ReadonlyArray<NotebookCellData>;
    /** The cell currently being edited — only cells *before* this one
     *  contribute to `namedPlots` and `queryRefs`. */
    currentCellId: string;
    /**
     * Optional adapter that knows how to extract structured information from a
     * cell's content. Tests inject a deterministic implementation. In
     * production this delegates to `parseCellContent` from `utils/notebookParser`.
     */
    parseCell?: (cell: NotebookCellData) => CellParseSummary;
    /**
     * Optional schema-cache lookup keyed on the cell's SQL text. The schema
     * discovery service exposes this via its `getCached(sql)` method.
     */
    lookupColumns?: (sql: string) => ColumnSchema[] | null;
    /**
     * Optional map of cell id → executed plot data per plot block index.
     * Presence (and non-empty) of a plot's data is interpreted as "the plot
     * has been rendered, so a brush selection may exist".
     */
    executedResults?: Record<string, ReadonlyArray<Record<string, unknown>>[]>;
    /** Optional global notebook-scope variables (workspace). */
    workspaceVariables?: Readonly<Record<string, string>>;
}

export interface CellParseSummary {
    /** Per-block SQL text in this cell. */
    sqlBlocks: string[];
    /** Per-block alias parsed from `CREATE VIEW <alias> AS …` (null when absent). */
    queryAliases: ReadonlyArray<string | null>;
    /** Plot DSL blocks in this cell along with their owning SQL block index. */
    plotBlocks: ReadonlyArray<{ config: string; sqlIndex: number }>;
    /** Cell-local variables (e.g. front-matter style declarations within the cell). */
    cellLocalVariables?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface CacheEntry {
    cellsRef: ReadonlyArray<NotebookCellData>;
    currentCellId: string;
    view: PlotScopeView;
}

export class NotebookPlotScope {
    private cache: CacheEntry | null = null;

    /**
     * Build (or return cached) a scope view. Caller is responsible for keeping
     * a stable `cells` array reference across rerenders to maximize cache hits.
     */
    build(args: BuildArgs): PlotScopeView {
        if (
            this.cache &&
            this.cache.cellsRef === args.cells &&
            this.cache.currentCellId === args.currentCellId
        ) {
            return this.cache.view;
        }
        const view = buildScopeView(args);
        this.cache = { cellsRef: args.cells, currentCellId: args.currentCellId, view };
        return view;
    }

    clear(): void {
        this.cache = null;
    }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const VIEW_ALIAS_RE = /create\s+(?:or\s+replace\s+)?(?:temp(?:ory)?\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|'([^']+)'|([a-zA-Z_][\w]*))\s+as\b/i;

function buildScopeView(args: BuildArgs): PlotScopeView {
    const namedPlots: PlotScopeView['namedPlots'][number][] = [];
    const queryRefs: PlotScopeView['queryRefs'][number][] = [];
    const variables = new Map<string, {
        name: string;
        scope: 'cellLocal' | 'workspace' | 'crossCell' | 'gesture';
        value?: string;
        dataType: 'number' | 'string' | 'timestamp' | 'json' | 'unknown';
    }>();
    const brushes = new Map<string, {
        plotName: string;
        cellId: string;
        xType: 'number' | 'timestamp' | 'string' | 'unknown';
        yType: 'number' | 'timestamp' | 'string' | 'unknown';
    }>();

    // 1. Workspace (notebook-global) variables — always in scope regardless of cell order.
    if (args.workspaceVariables) {
        for (const [name, value] of Object.entries(args.workspaceVariables)) {
            const bare = name.startsWith('$') ? name.slice(1) : name;
            variables.set(bare, {
                name: bare,
                scope: 'workspace',
                value,
                dataType: inferDataType(value),
            });
        }
    }

    // 2. Walk cells in order, stopping AFTER processing the current cell's
    //    parse summary — but cross-plot references must point UP-document, so
    //    plots from the current cell itself are excluded from `namedPlots`.
    let queryIndexCounter = 1;
    for (const cell of args.cells) {
        const isCurrentCell = cell.id === args.currentCellId;
        const summary = (args.parseCell ?? defaultParseCell)(cell);

        // 2a. SQL blocks → queryRefs.
        summary.sqlBlocks.forEach((sql, sqlBlockIndex) => {
            const trimmed = sql.trim();
            if (!trimmed) {
                // Only count non-current-cell empty blocks so the index
                // stays in sync with what's actually in queryRefs (B-151).
                if (!isCurrentCell) queryIndexCounter++;
                return;
            }
            let alias = summary.queryAliases[sqlBlockIndex] ?? undefined;
            if (!alias) {
                const m = VIEW_ALIAS_RE.exec(trimmed);
                if (m) alias = m[1] ?? m[2] ?? m[3];
            }
            const columns = args.lookupColumns?.(trimmed) ?? undefined;
            if (!isCurrentCell) {
                queryRefs.push({
                    index: queryIndexCounter,
                    cellId: cell.id,
                    sql: trimmed,
                    alias,
                    columns: columns ?? undefined,
                });
                queryIndexCounter++;
            }
        });

        // 2b. Plot blocks → namedPlots (skip the current cell — only earlier plots are visible).
        summary.plotBlocks.forEach((pb, plotIndexInCell) => {
            const meta = extractPlotMetadata(pb.config);
            if (meta.plotName && !isCurrentCell) {
                const sql = summary.sqlBlocks[pb.sqlIndex]?.trim() ?? '';
                const declaredColumns = sql ? (args.lookupColumns?.(sql) ?? undefined) : undefined;

                const executed = args.executedResults?.[cell.id]?.[pb.sqlIndex];
                const hasBrush = !!(executed && executed.length > 0);

                const linkedVars = meta.linkedXVars && meta.linkedXVars.length >= 2
                    ? [meta.linkedXVars[0], meta.linkedXVars[1]] as [string, string]
                    : undefined;
                // LINK-Y takes a single brush variable name.
                const linkedYVars = meta.linkedYVars && meta.linkedYVars.length >= 1
                    ? meta.linkedYVars[0]
                    : undefined;

                namedPlots.push({
                    plotName: meta.plotName,
                    cellId: cell.id,
                    plotIndexInCell,
                    shape: meta.shape ?? 'unknown',
                    sqlBlockIndex: pb.sqlIndex,
                    linkedXVars: linkedVars,
                    linkedYVars,
                    hasBrush,
                    declaredColumns,
                });

                // Brush typing: infer the x-axis dataType from the source SQL's column for the plot's `x:` clause.
                const xType = inferAxisType(meta.xColumn, declaredColumns);
                const yType = inferAxisType(meta.yColumn, declaredColumns);
                brushes.set(meta.plotName, {
                    plotName: meta.plotName,
                    cellId: cell.id,
                    xType,
                    yType,
                });
            }
        });

        // 2c. Cell-local variables (from `summary.cellLocalVariables`).
        if (summary.cellLocalVariables) {
            for (const [name, value] of Object.entries(summary.cellLocalVariables)) {
                const bare = name.startsWith('$') ? name.slice(1) : name;
                // Don't override workspace vars; later cells override earlier ones for cell-local.
                const existing = variables.get(bare);
                if (existing?.scope === 'workspace') continue;
                variables.set(bare, {
                    name: bare,
                    scope: 'cellLocal',
                    value,
                    dataType: inferDataType(value),
                });
            }
        }

        // Stop processing after the current cell: cells *below* don't contribute.
        if (isCurrentCell) break;
    }

    return { namedPlots, queryRefs, variables, brushes };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PlotMetadata {
    plotName?: string;
    shape?: string;
    linkedXVars?: string[];
    linkedYVars?: string[];
    xColumn?: string;
    yColumn?: string;
}

/**
 * Parse a plot DSL block enough to extract its name, shape, link vars, and the
 * column names bound to `x:` / `y:`. We reuse the existing plot parser rather
 * than maintaining a second tokenizer.
 */
export function extractPlotMetadata(plotSrc: string): PlotMetadata {
    const root = safeParse(plotSrc);
    if (!root) return {};
    const meta: PlotMetadata = {};
    walk(root, n => {
        if (n.kind === 'plotCall') {
            if (!meta.shape && n.shape) meta.shape = n.shape;
            // Extract x: / y: clause values.
            for (const child of n.children) {
                if (child.kind !== 'clause' || !child.key) continue;
                const valueNode = child.children.find(c => c.kind !== 'clauseRef');
                if (!valueNode) continue;
                const colName = valueNode.kind === 'ident' ? valueNode.name : undefined;
                if (!colName) continue;
                if (child.key.toLowerCase() === 'x' && !meta.xColumn) meta.xColumn = colName;
                if (child.key.toLowerCase() === 'y' && !meta.yColumn) meta.yColumn = colName;
            }
        }
        if (n.kind === 'tail' && n.key) {
            const key = n.key.toLowerCase();
            if (key === 'name') {
                const v = n.children.find(c => c.kind === 'literal' || c.kind === 'ident');
                if (v) {
                    const raw = typeof v.literalValue === 'string' ? v.literalValue : (v.name ?? v.text);
                    if (raw) meta.plotName = stripQuotes(raw);
                }
            } else if (key === 'link-x' || key === 'link-y' || key === 'link-xy' || key === 'link-scroll') {
                const list = n.children.find(c => c.kind === 'list');
                const collected: string[] = [];
                if (list) {
                    for (const item of list.children) {
                        if (item.kind === 'varRef' && item.dollar) {
                            const v = item.dollar;
                            collected.push(v.path.length > 0 ? v.name + '.' + v.path.join('.') : v.name);
                        }
                    }
                }
                if (key === 'link-x' || key === 'link-xy' || key === 'link-scroll') meta.linkedXVars = collected;
                if (key === 'link-y') meta.linkedYVars = collected;
            }
        }
    });

    // Fallback: the AST parser does not handle `LINK-Y $var` / `LINK-XY $var`
    // (uppercase hyphenated bare form without parens). Use the regex-based
    // parsePlotCall to fill in what the walk missed.
    if (!meta.linkedYVars) {
        try {
            const p = parsePlotCall(plotSrc);
            if (p.linkY) meta.linkedYVars = [p.linkY.replace(/^\$/, '')];
            else if (p.linkXY) meta.linkedYVars = [p.linkXY.replace(/^\$/, '')];
        } catch { /* ignore */ }
    }

    return meta;
}

function safeParse(src: string): PlotNode | undefined {
    try {
        return parse(src);
    } catch {
        return undefined;
    }
}

function stripQuotes(s: string): string {
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
        return s.slice(1, -1);
    }
    return s;
}

const TIMESTAMP_NAME_RE = /(?:^|_)(?:time|date|ts|timestamp)(?:_|$)|ts$|_at$|when$/i;

function inferAxisType(
    columnName: string | undefined,
    declaredColumns: ColumnSchema[] | undefined,
): 'number' | 'timestamp' | 'string' | 'unknown' {
    if (!columnName) return 'unknown';
    const col = declaredColumns?.find(c => c.name.toLowerCase() === columnName.toLowerCase());
    if (col?.dataType) {
        const dt = col.dataType.toUpperCase();
        if (dt.startsWith('TIMESTAMP') || dt === 'DATE' || dt === 'DATETIME') return 'timestamp';
        if (dt.includes('INT') || dt === 'DOUBLE' || dt === 'FLOAT' || dt === 'NUMERIC' || dt.startsWith('DECIMAL') || dt === 'REAL') return 'number';
        if (dt.includes('CHAR') || dt === 'TEXT' || dt === 'STRING' || dt === 'VARCHAR') return 'string';
    }
    if (TIMESTAMP_NAME_RE.test(columnName)) return 'timestamp';
    return 'unknown';
}

function inferDataType(value: string | undefined): 'number' | 'string' | 'timestamp' | 'json' | 'unknown' {
    if (value == null) return 'unknown';
    const t = value.trim();
    if (!t) return 'unknown';
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return 'number';
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(t)) return 'timestamp';
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) return 'json';
    return 'string';
}

/**
 * Default `parseCell` adapter — wires up the production `parseCellContent`
 * pipeline. Tests inject a synthetic version, so the heavy notebookParser
 * import is local to keep the test-time module graph tight.
 */
function defaultParseCell(cell: NotebookCellData): CellParseSummary {
    const tokens = tokenizeCellContent(cell.content);
    const parsed = parseCellContent(tokens);
    return {
        sqlBlocks: parsed.sqlBlocks,
        queryAliases: parsed.queryAliases,
        plotBlocks: parsed.plotBlocksWithSqlIndex,
        cellLocalVariables: parsed.variables,
    };
}
