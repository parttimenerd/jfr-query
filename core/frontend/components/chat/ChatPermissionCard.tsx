import React from 'react';

const MUTATION_TOOLS = new Set(['add_cell', 'editCell', 'deleteCell', 'applyPlot', 'moveCell']);

interface ChatPermissionCardProps {
    toolName: string;
    args: Record<string, unknown>;
    onAllowSession: () => void;
    onAllowAlways: () => void;
    onDeny: () => void;
}

export function ChatPermissionCard({ toolName, args, onAllowSession, onAllowAlways, onDeny }: ChatPermissionCardProps) {
    const isQuery = toolName === 'query_data';

    return (
        <div className="bg-[#0d1420] border border-[#1e2d3d] rounded-lg p-3 my-2 text-sm">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{isQuery ? '🔍' : '✏️'}</span>
                <span className="font-semibold text-slate-200">
                    {isQuery ? 'Allow AI to query your data?' : 'Allow AI to modify your notebook?'}
                </span>
            </div>

            {isQuery && (
                <>
                    <div className="text-xs text-slate-400 mb-1">
                        <span className="text-slate-500">Reason: </span>
                        {String(args.reason)}
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                        <span className="text-slate-500">Tables: </span>
                        {(args.tables as string[]).join(', ')}
                    </div>
                    <pre className="text-[10px] text-cyan-300/70 bg-gray-950 rounded p-2 overflow-x-auto mb-3 whitespace-pre-wrap font-mono leading-relaxed">
                        {String(args.sql).slice(0, 200)}{String(args.sql).length > 200 ? '…' : ''}
                    </pre>
                </>
            )}

            {MUTATION_TOOLS.has(toolName) && (
                <div className="text-xs text-slate-400 mb-3">
                    <span className="text-slate-500">Action: </span>
                    {toolName === 'add_cell' && `Add ${String(args.type)} cell`}
                    {toolName === 'editCell' && `Edit cell`}
                    {toolName === 'deleteCell' && `Delete cell`}
                    {toolName === 'applyPlot' && `Apply plot config`}
                    {toolName === 'moveCell' && `Move cell`}
                </div>
            )}

            <div className="flex gap-2 flex-wrap">
                <button
                    onClick={onAllowSession}
                    className="px-3 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded cursor-pointer"
                >
                    Allow for this session
                </button>
                <button
                    onClick={onAllowAlways}
                    className="px-3 py-1 text-xs bg-[#1e2d3d] hover:bg-[#263548] text-slate-300 rounded border border-[#2d3f52] cursor-pointer"
                >
                    Always allow
                </button>
                <button
                    onClick={onDeny}
                    className="px-3 py-1 text-xs bg-[#1e2d3d] hover:bg-red-900/30 text-slate-400 hover:text-red-400 rounded border border-[#2d3f52] cursor-pointer"
                >
                    Deny
                </button>
            </div>
        </div>
    );
}
