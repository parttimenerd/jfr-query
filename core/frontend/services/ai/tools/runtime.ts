// Tool execution runtime. Wires the tool schemas to actual notebook/DuckDB
// operations via an injectable deps object. Pure logic — no provider/SDK
// imports here — so the runtime stays testable without spinning up a
// network mock.

import { TOOLS, getTool, validateToolArgs, type Tool } from './index';
import { parseComposite } from '../../../utils/plotParser';

export interface ToolDeps {
    /** Execute a DuckDB SQL query. Caller decides about read-only enforcement. */
    duckdbQuery: (sql: string, opts?: { limit?: number }) => Promise<{ columns: { name: string; type: string }[]; rows: any[] }>;
    /** Return the current notebook cells, in order. */
    listCells: () => Array<{ id: string; type: 'sql' | 'plot' | 'markdown'; content: string }>;
    /** Apply a notebook mutation. Implementations should be atomic per call. */
    mutateCells: (op: NotebookMutation) => Promise<{ ok: true; cellId?: string } | { ok: false; error: string }>;
    /** List plot cells (id + declared name + config). */
    listPlotsInNotebook: () => Array<{ id: string; name?: string; config: string }>;
    /**
     * Called for every mutate-tool BEFORE execution. Resolves when the user
     * approves, rejects with an Error('rejected by user') when they reject.
     * Read tools do not call this — visibility-mode gating is enforced by
     * the orchestrator (AiService.streamChatWithTools).
     */
    requireApproval: (toolName: string, args: any) => Promise<void>;
    /** Read the notebook's current variables (name → string value). Optional;
     *  variable tools will fail if not supplied. */
    getVariables?: () => Record<string, string>;
    /** Replace the notebook's variables map. Implementations should persist. */
    setVariables?: (next: Record<string, string>) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Current chat visibility mode. Used to gate previewPlot/screenshotPlot. */
    getVisibility?: () => 'no-data' | 'sanitized' | 'full';
    /** Capture a PNG of a previously rendered plot preview. Returns a data URL or null. */
    screenshotPreview?: (previewId: string) => Promise<string | null>;
    /** True when the active provider can carry image content in a tool_result. */
    providerSupportsImages?: () => boolean;
    /** Return the current per-channel memory facts. */
    getMemory?: () => Record<string, string>;
    /** Upsert a memory fact (max 200 chars; LRU eviction at 10 entries handled by caller). */
    setMemory?: (key: string, value: string) => void;
    /** Replace the per-channel task list. */
    setTaskList?: (tasks: Array<{ id: string; text: string; done: boolean }>) => void;
}

export type NotebookMutation =
    | { kind: 'add'; type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }
    | { kind: 'edit'; cellId: string; content: string }
    | { kind: 'applyPlot'; cellId: string; plotConfig: string; plotBlockIndex?: number }
    | { kind: 'delete'; cellId: string }
    | { kind: 'move'; cellId: string; targetCellId: string; position: 'before' | 'after' };

export type ToolResult =
    | { ok: true; data: any }
    | { ok: false; error: string };

/**
 * Reject SQL containing the protected variable namespace. Single point of
 * defense; visibility.ts strips outbound payloads, this strips inbound
 * tool calls.
 */
function isForbiddenSql(sql: string): boolean {
    return /\$ai_providers\b/i.test(sql);
}

/**
 * Detect multiple top-level SELECT/WITH/INSERT/UPDATE/DELETE statements in a
 * single SQL string. A cell must contain exactly one statement (the notebook
 * runner passes the whole content to DuckDB as one query). Returns an error
 * message if multiple statements are detected, or null if it looks clean.
 *
 * Heuristic: strip single-line comments and string literals, then count
 * top-level SELECT/WITH/INSERT/UPDATE/DELETE keywords that appear at a
 * position where a new statement could start (preceded only by whitespace or
 * a semicolon).
 */
function detectMultipleSqlStatements(sql: string): string | null {
    // Strip -- comments and quoted strings (rough approximation)
    const stripped = sql
        .replace(/--[^\n]*/g, ' ')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');

    // Match bare SELECT/WITH/INSERT/UPDATE/DELETE at start-of-statement positions.
    // "Start of statement" = beginning of string or after semicolon.
    // Bare newlines are intentionally excluded: they appear inside CTEs, subqueries,
    // and multi-line expressions and would produce false positives for valid single statements.
    const stmtPattern = /(?:^\s*|;\s*)(SELECT|WITH|INSERT|UPDATE|DELETE)\b/gi;
    const matches = [...stripped.matchAll(stmtPattern)];
    if (matches.length > 1) {
        return `SQL cell content contains ${matches.length} statements. ` +
            'A cell must contain exactly one SQL statement. ' +
            'Call addCell once per statement instead of concatenating them.';
    }
    return null;
}


export async function executeTool(name: string, args: any, deps: ToolDeps): Promise<ToolResult> {
    const tool = getTool(name);
    if (!tool) return { ok: false, error: `Tool "${name}" is not available. The available tools are: ${TOOLS.map(t => t.name).join(', ')}.` };

    const err = validateToolArgs(tool, args ?? {});
    if (err) return { ok: false, error: err };

    // Approval gate for mutations. Throws → translate to rejected result so
    // the assistant sees a structured reason and can apologise / retry.
    if (tool.kind === 'mutate') {
        try {
            await deps.requireApproval(name, args);
        } catch (e: any) {
            return { ok: false, error: e?.message || 'The user declined this action. Try a different approach.' };
        }
    }

    try {
        switch (name) {
            case 'runQuery': {
                const sql: string = args.sql;
                if (isForbiddenSql(sql)) return { ok: false, error: 'SQL references $ai_providers which contains sensitive credentials and cannot be queried.' };
                const pageSize = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 500) : 100;
                const offset = typeof args.offset === 'number' ? Math.max(args.offset, 0) : 0;
                // Ask the dep for pageSize + offset rows; the dep is allowed to
                // return one extra so we can detect truncation without an
                // extra round-trip. See ChatPanel.duckdbQuery.
                const result = await deps.duckdbQuery(sql, { limit: pageSize + offset + 1 });
                const fullPage = result.rows.slice(offset, offset + pageSize);
                const truncated = result.rows.length > pageSize + offset;
                return {
                    ok: true,
                    data: {
                        columns: result.columns,
                        rows: fullPage,
                        returned: fullPage.length,
                        truncated,
                        offset,
                        limit: pageSize,
                    },
                };
            }
            case 'describeTable': {
                const tname: string = args.name;
                if (isForbiddenSql(tname)) return { ok: false, error: 'SQL references $ai_providers which contains sensitive credentials and cannot be queried.' };
                const result = await deps.duckdbQuery(`DESCRIBE "${tname.replace(/"/g, '""')}"`);
                return { ok: true, data: { columns: result.rows } };
            }
            case 'sampleRows': {
                const tname: string = args.name;
                if (isForbiddenSql(tname)) return { ok: false, error: 'SQL references $ai_providers which contains sensitive credentials and cannot be queried.' };
                const limit = Math.min(typeof args.limit === 'number' ? Math.max(args.limit, 1) : 10, 500);
                const result = await deps.duckdbQuery(`SELECT * FROM "${tname.replace(/"/g, '""')}" LIMIT ${limit}`);
                return { ok: true, data: { columns: result.columns, rows: result.rows } };
            }
            case 'listPlots': {
                return { ok: true, data: { plots: deps.listPlotsInNotebook() } };
            }
            case 'previewPlot': {
                const sql: string = args.sql;
                const plotConfig: string = args.plotConfig;
                if (isForbiddenSql(sql)) return { ok: false, error: 'SQL references $ai_providers which contains sensitive credentials and cannot be queried.' };
                if (deps.getVisibility?.() === 'no-data') {
                    return { ok: false, error: "previewPlot disabled when chat visibility is 'no-data' — the user would see chart data the AI cannot." };
                }
                try {
                    const parsed = parseComposite(plotConfig);
                    const mainOk = !!(parsed.mainConfig && /^[A-Z_]+\s*\(/i.test(parsed.mainConfig.trim()));
                    const compositeOk = !!parsed.composite && parsed.composite.children.length > 0;
                    if (!mainOk && !compositeOk) {
                        return { ok: false, error: 'invalid plot DSL: expected something like BAR_CHART(x: "col", y: ["col2"]).' };
                    }
                } catch (e: any) {
                    return { ok: false, error: `invalid plot DSL: ${e?.message || String(e)}` };
                }
                const limit = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 500) : 200;
                // Ask the dep for limit+1 rows so we can detect truncation
                // without a follow-up COUNT(*). See ChatPanel.duckdbQuery.
                const result = await deps.duckdbQuery(sql, { limit: limit + 1 });
                const rows = result.rows.slice(0, limit);
                const truncated = result.rows.length > limit;
                const previewId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                return {
                    ok: true,
                    data: {
                        previewId,
                        columns: result.columns,
                        rows,
                        plotConfig,
                        returned: rows.length,
                        truncated,
                        limit,
                    },
                };
            }
            case 'screenshotPlot': {
                if (!deps.screenshotPreview) {
                    return { ok: false, error: 'screenshotPlot not supported in this environment' };
                }
                if (!deps.providerSupportsImages?.()) {
                    return { ok: false, error: 'screenshotPlot is not supported by the current AI provider — switch to Anthropic to enable image tool results.' };
                }
                if (deps.getVisibility?.() !== 'full') {
                    return { ok: false, error: "screenshotPlot requires chat visibility 'full' — current setting redacts data and the rendered chart by extension." };
                }
                const previewId: string = args.previewId;
                const dataUrl = await deps.screenshotPreview(previewId);
                if (!dataUrl) return { ok: false, error: `no preview found with id: ${previewId}` };
                // Wrap in an `image` shape so per-provider tool_result adapters
                // can emit a multimodal content block on the next turn.
                return { ok: true, data: { image: { mediaType: 'image/png', dataUrl } } };
            }
            case 'addCell': {
                if (args.type === 'sql') {
                    const multiErr = detectMultipleSqlStatements(args.content);
                    if (multiErr) return { ok: false, error: multiErr };
                }
                const res = await deps.mutateCells({
                    kind: 'add',
                    type: args.type,
                    content: args.content,
                    afterCellId: args.afterCellId,
                });
                if (res.ok) return { ok: true, data: { cellId: res.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'editCell': {
                const targetCell = deps.listCells().find(c => c.id === args.cellId);
                if (targetCell?.type === 'sql') {
                    const multiErr = detectMultipleSqlStatements(args.content);
                    if (multiErr) return { ok: false, error: multiErr };
                }
                const res = await deps.mutateCells({
                    kind: 'edit',
                    cellId: args.cellId,
                    content: args.content,
                });
                if (res.ok) return { ok: true, data: { cellId: args.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'applyPlot': {
                const res = await deps.mutateCells({
                    kind: 'applyPlot',
                    cellId: args.cellId,
                    plotConfig: args.plotConfig,
                    plotBlockIndex: typeof args.plotBlockIndex === 'number' ? args.plotBlockIndex : 0,
                });
                if (res.ok) return { ok: true, data: { cellId: args.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'listCells': {
                const cells = deps.listCells();
                const data = cells.map(c => ({
                    id: c.id,
                    type: c.type,
                    contentPreview: c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content,
                    contentLength: c.content.length,
                }));
                return { ok: true, data: { cells: data } };
            }
            case 'readCell': {
                const cell = deps.listCells().find(c => c.id === args.cellId);
                if (!cell) return { ok: false, error: `cell not found: ${args.cellId}` };
                return { ok: true, data: { id: cell.id, type: cell.type, content: cell.content } };
            }
            case 'deleteCell': {
                const res = await deps.mutateCells({ kind: 'delete', cellId: args.cellId });
                if (res.ok) return { ok: true, data: { cellId: args.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'moveCell': {
                const res = await deps.mutateCells({
                    kind: 'move',
                    cellId: args.cellId,
                    targetCellId: args.targetCellId,
                    position: args.position,
                });
                if (res.ok) return { ok: true, data: { cellId: args.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'listVariables': {
                if (!deps.getVariables) return { ok: false, error: 'variables not supported in this environment' };
                return { ok: true, data: { variables: deps.getVariables() } };
            }
            case 'setVariable': {
                if (!deps.getVariables || !deps.setVariables) return { ok: false, error: 'variables not supported in this environment' };
                const name: string = args.name;
                const value: string = args.value;
                if (!name) return { ok: false, error: 'name must be non-empty' };
                const next = { ...deps.getVariables(), [name]: value };
                const res = await deps.setVariables(next);
                if (res.ok) return { ok: true, data: { name, value } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'deleteVariable': {
                if (!deps.getVariables || !deps.setVariables) return { ok: false, error: 'variables not supported in this environment' };
                const name: string = args.name;
                const current = deps.getVariables();
                if (!(name in current)) return { ok: true, data: { name, deleted: false } };
                const next = { ...current };
                delete next[name];
                const res = await deps.setVariables(next);
                if (res.ok) return { ok: true, data: { name, deleted: true } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            case 'rememberFact': {
                const { key, value } = args as { key: string; value: string };
                deps.setMemory?.(key, String(value).slice(0, 200));
                return { ok: true, data: { stored: key } };
            }
            case 'recallMemory': {
                return { ok: true, data: deps.getMemory?.() ?? {} };
            }
            case 'updateTaskList': {
                const tasks = (args as any).tasks ?? [];
                deps.setTaskList?.(tasks);
                return { ok: true, data: { updated: tasks.length } };
            }
            default:
                return { ok: false, error: `Tool "${name}" is recognized but not yet implemented in this version.` };
        }
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export { TOOLS };
export type { Tool };
