import React, { useState } from 'react';

export interface TraceStep {
    tool: string;
    args: Record<string, unknown>;
    result: string;
    durationMs: number;
    rowCount?: number;
}

interface ChatTraceViewProps {
    steps: TraceStep[];
}

export function ChatTraceView({ steps }: ChatTraceViewProps) {
    const [expanded, setExpanded] = useState(false);
    const [expandedSql, setExpandedSql] = useState<Set<number>>(new Set());

    const totalMs = steps.reduce((s, t) => s + t.durationMs, 0);
    const queryCount = steps.filter(s => s.tool === 'query_data').length;
    const label = queryCount > 0 ? `${queryCount} quer${queryCount === 1 ? 'y' : 'ies'}` : `${steps.length} steps`;

    return (
        <div className="mb-2 text-xs">
            <button
                onClick={() => setExpanded(e => !e)}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-400 cursor-pointer select-none"
            >
                <span>{expanded ? '▼' : '▶'}</span>
                <span className="font-medium">Thinking</span>
                <span className="text-slate-600">({label} · {totalMs}ms)</span>
            </button>

            {expanded && (
                <div className="mt-1 ml-4 border-l border-gray-800 pl-3 space-y-2">
                    {steps.map((step, i) => (
                        <div key={i} className="text-slate-500">
                            <div className="flex items-baseline gap-1.5">
                                <span>{step.tool === 'query_data' ? '🔍' : '✏️'}</span>
                                <span className="text-slate-400">
                                    {step.tool === 'query_data'
                                        ? String(step.args.reason ?? step.tool)
                                        : step.tool}
                                </span>
                                {step.rowCount !== undefined && (
                                    <span className="text-slate-600">{step.rowCount} rows</span>
                                )}
                                <span className="text-slate-700">{step.durationMs}ms</span>
                                {step.tool === 'query_data' && step.args.sql && (
                                    <button
                                        onClick={() =>
                                            setExpandedSql(prev => {
                                                const next = new Set(prev);
                                                next.has(i) ? next.delete(i) : next.add(i);
                                                return next;
                                            })
                                        }
                                        className="text-[10px] text-slate-600 hover:text-slate-400 cursor-pointer ml-1"
                                    >
                                        {expandedSql.has(i) ? 'hide sql' : 'show sql'}
                                    </button>
                                )}
                            </div>
                            {expandedSql.has(i) && step.args.sql && (
                                <pre className="mt-1 text-[10px] text-cyan-300/60 bg-gray-950 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                                    {String(step.args.sql)}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
