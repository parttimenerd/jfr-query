// C4 — Tool-call proposal renderer + pure helpers used by ChatPanel for the
// approval flow. Pure helpers are exported so they can be unit-tested without
// jsdom (vitest config: environment: 'node').

import React from 'react';
import type { Tool, ToolKind } from '../services/ai/tools';

/**
 * Resolved tool intent for a pending tool_call chunk emitted by
 * `aiService.streamChatWithTools`. The orchestrator distinguishes reads from
 * mutations because the UI policy differs:
 *   - read in no-data visibility → must prompt
 *   - read in sanitized/full     → auto-approve (or honor "approve-all")
 *   - mutate                     → always prompt, show diff where applicable
 */
export type ProposalKind =
    | { kind: 'auto-read' }                                // read tool, no-data not set → run silently
    | { kind: 'prompt-read' }                              // read tool, but visibility=no-data → ask
    | { kind: 'prompt-mutate'; diff?: { before: string; after: string } };

export type Visibility = 'no-data' | 'sanitized' | 'full';

/**
 * Decide whether a tool_call needs explicit user approval. Pure function —
 * driven only by the registered tool kind, visibility mode, the "approve all
 * reads this turn" flag, and the existing-cell content (for diffs on
 * editCell/applyPlot). Returns the discriminated UI intent.
 */
export function chooseProposalKind(
    tool: Pick<Tool, 'name' | 'kind'>,
    args: any,
    opts: {
        visibility: Visibility;
        approveAllReads: boolean;
        existingCellContent?: string;
    },
): ProposalKind {
    if (tool.kind === 'read') {
        // Read tools always run silently — the session-level banner (aiPermQueryData='ask')
        // or the global setting ('never'/'always') gates data access; we don't need a
        // per-call Approve/Reject card on top of that.
        return { kind: 'auto-read' };
    }
    // mutate — always prompt. Include before/after for cell-edit kinds.
    if (tool.name === 'editCell' || tool.name === 'applyPlot') {
        const before = opts.existingCellContent ?? '';
        const after = tool.name === 'editCell'
            ? (args?.content ?? '')
            : (args?.plotConfig ?? '');
        return { kind: 'prompt-mutate', diff: { before, after } };
    }
    return { kind: 'prompt-mutate' };
}

/**
 * Pure approval-state reducer used by ChatPanel. Tool-call records keep an
 * explicit status field: 'pending' | 'approved' | 'rejected' | 'done'.
 * Tests assert state transitions.
 */
export interface ApprovalRecord {
    id: string;
    name: string;
    args: any;
    status: 'pending' | 'approved' | 'rejected' | 'done';
    result?: any;
}

export function applyApprovalAction(
    records: ApprovalRecord[],
    action: { type: 'approve'; id: string }
        | { type: 'reject'; id: string }
        | { type: 'complete'; id: string; result: any }
        | { type: 'approve-all-reads'; readIds: string[] },
): ApprovalRecord[] {
    if (action.type === 'approve') {
        return records.map(r => r.id === action.id && r.status === 'pending' ? { ...r, status: 'approved' as const } : r);
    }
    if (action.type === 'reject') {
        return records.map(r => r.id === action.id && r.status === 'pending' ? { ...r, status: 'rejected' as const } : r);
    }
    if (action.type === 'complete') {
        return records.map(r => r.id === action.id ? { ...r, status: 'done' as const, result: action.result } : r);
    }
    // approve-all-reads
    const idSet = new Set(action.readIds);
    return records.map(r => idSet.has(r.id) && r.status === 'pending' ? { ...r, status: 'approved' as const } : r);
}

/**
 * Pretty-print tool args for the card body. Keeps strings short (single line)
 * but pretty-prints nested objects.
 * @deprecated Use renderProposalBody for new UI — only used in ToolCallLine expanded view.
 */
export function formatToolArgs(args: any): string {
    try {
        return JSON.stringify(args ?? {}, null, 2);
    } catch {
        return String(args);
    }
}

/**
 * Format a one-line summary of a tool_call for the card header.
 */
export function formatToolHeader(name: string, args: any): string {
    if (!args || typeof args !== 'object') return `${name}()`;
    if (name === 'describeTable' || name === 'sampleRows') {
        return `${name}(${JSON.stringify(args.name ?? '')})`;
    }
    if (name === 'runQuery') {
        const sql: string = args.sql ?? '';
        const head = sql.length > 60 ? sql.slice(0, 57).replace(/\s+/g, ' ') + '...' : sql.replace(/\s+/g, ' ');
        return `runQuery(${JSON.stringify(head)})`;
    }
    if (name === 'addCell') {
        const type: string = args.type ?? '';
        return `Add ${type} cell to notebook`;
    }
    if (name === 'editCell') return `Edit cell`;
    if (name === 'deleteCell') return `Delete cell`;
    if (name === 'applyPlot') return `Apply plot config`;
    if (name === 'moveCell') return `Move cell`;
    if (name === 'listPlots') return 'listPlots()';
    return `${name}(...)`;
}

/**
 * Render the body of a proposal card — shows the meaningful content without raw JSON.
 * Returns a React element (or null if nothing to show).
 */
function renderProposalBody(name: string, args: any): React.ReactNode {
    if (!args) return null;

    // SQL-bearing tools — show the SQL directly
    const sql: string | undefined = args.sql ?? (name === 'addCell' && args.type === 'sql' ? args.content : undefined);
    if (sql) {
        return (
            <pre className="bg-gray-900 rounded p-2 font-mono text-[11px] overflow-x-auto mb-2 text-cyan-200 whitespace-pre-wrap">
                {sql}
            </pre>
        );
    }

    // Plot DSL — show content/plotConfig
    const dsl: string | undefined = args.plotConfig ?? (name === 'addCell' && args.type === 'plot' ? args.content : undefined);
    if (dsl) {
        return (
            <pre className="bg-gray-900 rounded p-2 font-mono text-[11px] overflow-x-auto mb-2 text-purple-300 whitespace-pre-wrap">
                {dsl}
            </pre>
        );
    }

    // Markdown content
    if (name === 'addCell' && args.type === 'markdown' && args.content) {
        return (
            <pre className="bg-gray-900 rounded p-2 font-mono text-[11px] overflow-x-auto mb-2 text-slate-300 whitespace-pre-wrap">
                {String(args.content).slice(0, 400)}
            </pre>
        );
    }

    // editCell — show new content
    if (name === 'editCell' && args.content) {
        return (
            <pre className="bg-gray-900 rounded p-2 font-mono text-[11px] overflow-x-auto mb-2 text-cyan-200 whitespace-pre-wrap">
                {String(args.content).slice(0, 400)}
            </pre>
        );
    }

    // deleteCell — show cell id
    if (name === 'deleteCell' && args.cellId) {
        return (
            <div className="text-xs text-slate-400 mb-2">
                Cell: <code className="text-slate-300">{args.cellId}</code>
            </div>
        );
    }

    return null;
}

interface CardProps {
    record: ApprovalRecord;
    kind: ProposalKind;
    onApprove: () => void;
    onReject: () => void;
    onApproveAllReads?: () => void;
}

const STATUS_LABEL: Record<ApprovalRecord['status'], string> = {
    pending: 'Queued',
    approved: 'Running...',
    rejected: 'Rejected',
    done: 'Done',
};

export const ChatProposalCard: React.FC<CardProps> = ({ record, kind, onApprove, onReject, onApproveAllReads }) => {
    const isReadAuto = kind.kind === 'auto-read';
    const isMutate = kind.kind === 'prompt-mutate';
    const diff = isMutate ? kind.diff : undefined;
    return (
        <div className="my-2 p-3 bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-200" data-testid={`tool-card-${record.id}`}>
            <div className="flex items-center gap-2 mb-2">
                <span className="text-yellow-400">{isMutate ? '✏️' : 'T'}</span>
                <span className="font-mono text-cyan-300 text-xs">{formatToolHeader(record.name, record.args)}</span>
                <span className="ml-auto text-[10px] text-gray-500 uppercase tracking-wider">{STATUS_LABEL[record.status]}</span>
            </div>
            {!isReadAuto && diff && (
                <div className="grid grid-cols-2 gap-1 mb-2 font-mono">
                    <div className="bg-red-900/30 border border-red-800/50 rounded p-1 overflow-x-auto"><div className="text-[10px] text-red-300 mb-0.5">before</div><pre className="whitespace-pre-wrap break-all">{diff.before || '(empty)'}</pre></div>
                    <div className="bg-green-900/30 border border-green-800/50 rounded p-1 overflow-x-auto"><div className="text-[10px] text-green-300 mb-0.5">after</div><pre className="whitespace-pre-wrap break-all">{diff.after || '(empty)'}</pre></div>
                </div>
            )}
            {!isReadAuto && !diff && renderProposalBody(record.name, record.args)}
            {record.status === 'pending' && !isReadAuto && (
                <div className="flex items-center gap-2">
                    <button onClick={onApprove} className="px-2 py-1 bg-green-700 hover:bg-green-600 rounded text-white">Approve</button>
                    <button onClick={onReject} className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white">Reject</button>
                    {kind.kind === 'prompt-read' && onApproveAllReads && (
                        <button onClick={onApproveAllReads} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-200">Approve all reads this turn</button>
                    )}
                </div>
            )}
        </div>
    );
};
