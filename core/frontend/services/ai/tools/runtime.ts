// Tool execution runtime. Wires the tool schemas to actual notebook/DuckDB
// operations via an injectable deps object. Pure logic — no provider/SDK
// imports here — so the runtime stays testable without spinning up a
// network mock.

import { TOOLS, getTool, validateToolArgs, type Tool } from './index';

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
}

export type NotebookMutation =
    | { kind: 'add'; type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }
    | { kind: 'edit'; cellId: string; content: string }
    | { kind: 'applyPlot'; cellId: string; plotConfig: string };

export type ToolResult =
    | { ok: true; data: any }
    | { ok: false; error: string };

/**
 * Reject SQL containing the protected variable namespace. Single point of
 * defense; visibility.ts strips outbound payloads, this strips inbound
 * tool calls.
 */
function isForbiddenSql(sql: string): boolean {
    return /"?\$ai_providers"?/i.test(sql);
}

export async function executeTool(name: string, args: any, deps: ToolDeps): Promise<ToolResult> {
    const tool = getTool(name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };

    const err = validateToolArgs(tool, args ?? {});
    if (err) return { ok: false, error: err };

    // Approval gate for mutations. Throws → translate to rejected result so
    // the assistant sees a structured reason and can apologise / retry.
    if (tool.kind === 'mutate') {
        try {
            await deps.requireApproval(name, args);
        } catch (e: any) {
            return { ok: false, error: e?.message || 'rejected by user' };
        }
    }

    try {
        switch (name) {
            case 'runQuery': {
                const sql: string = args.sql;
                if (isForbiddenSql(sql)) return { ok: false, error: 'forbidden token' };
                const result = await deps.duckdbQuery(sql, { limit: 100 });
                return { ok: true, data: { columns: result.columns, rows: result.rows.slice(0, 100) } };
            }
            case 'describeTable': {
                const tname: string = args.name;
                const result = await deps.duckdbQuery(`DESCRIBE "${tname.replace(/"/g, '""')}"`);
                return { ok: true, data: { columns: result.rows } };
            }
            case 'sampleRows': {
                const tname: string = args.name;
                const limit = Math.min(typeof args.limit === 'number' ? args.limit : 10, 100);
                const result = await deps.duckdbQuery(`SELECT * FROM "${tname.replace(/"/g, '""')}" LIMIT ${limit}`);
                return { ok: true, data: { columns: result.columns, rows: result.rows } };
            }
            case 'listPlots': {
                return { ok: true, data: { plots: deps.listPlotsInNotebook() } };
            }
            case 'addCell': {
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
                });
                if (res.ok) return { ok: true, data: { cellId: args.cellId } };
                return { ok: false, error: (res as { ok: false; error: string }).error };
            }
            default:
                return { ok: false, error: `unimplemented tool: ${name}` };
        }
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export { TOOLS };
export type { Tool };
