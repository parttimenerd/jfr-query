// Renders a parsed plan as a chat card with:
//   - Summary text
//   - List of steps (each with a one-line label and an optional details toggle)
//   - "Trust plan" checkbox (skips per-step approval on execution)
//   - Execute / Discard buttons
//   - Status line reflecting executed/failed/discarded states
//
// Plan execution itself is delegated to the parent — this component is pure
// presentational + holds local UI state for the trust checkbox and expand
// toggles.

import React, { useState } from 'react';
import {
    describePlanStep,
    extractPlotBlockAt,
    type ParsedPlan,
    type PlanStep,
} from '../../services/ai/chatModes';
import type { ChatMessageMeta } from '../../types';
import { InlineDiff } from './InlineDiff';

interface ChatPlanCardProps {
    plan: ParsedPlan;
    meta?: ChatMessageMeta;
    /** Lookup cell content by id — needed to render diff bodies for edit/applyPlot. */
    getCellContent?: (cellId: string) => string | undefined;
    onExecute: (plan: ParsedPlan, opts: { trust: boolean }) => void;
    onDiscard: (plan: ParsedPlan) => void;
}

export const ChatPlanCard: React.FC<ChatPlanCardProps> = ({
    plan, meta, getCellContent, onExecute, onDiscard,
}) => {
    const [trust, setTrust] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const toggle = (i: number) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
        });
    };

    const status = meta?.planStatus ?? 'pending';
    const isExecuting = status === 'executing';
    const isDone = status === 'executed' || status === 'discarded' || status === 'failed';
    const fallbackParse = plan.parseLayer === 'fallback';

    return (
        <div className="border border-cyan-700/40 bg-cyan-900/10 rounded-md p-2.5 my-1">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">Plan</span>
                {fallbackParse && (
                    <span title="Parsed from prose — review carefully" className="text-[10px] px-1 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">low confidence</span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">{plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}</span>
            </div>
            {plan.summary && (
                <div className="text-xs text-gray-200 mb-2 leading-snug">{plan.summary}</div>
            )}
            <ol className="space-y-1 mb-2">
                {plan.steps.map((step, i) => (
                    <li key={step.id} className="text-xs">
                        <div className="flex items-start gap-1.5">
                            <span className="text-gray-500 w-4 flex-shrink-0 text-right">{i + 1}.</span>
                            <div className="flex-1 min-w-0">
                                <button
                                    onClick={() => toggle(i)}
                                    className="text-left w-full hover:text-cyan-200 transition-colors flex items-center gap-1"
                                >
                                    <span className={`inline-block w-2 transition-transform ${expanded.has(i) ? 'rotate-90' : ''}`} aria-hidden>›</span>
                                    <span className="text-gray-100">{describePlanStep(step)}</span>
                                </button>
                                {step.rationale && (
                                    <div className="ml-3 text-[11px] text-gray-400 italic">{step.rationale}</div>
                                )}
                                {expanded.has(i) && (
                                    <div className="ml-3 mt-1">
                                        <StepDetail step={step} getCellContent={getCellContent} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </li>
                ))}
            </ol>

            {status === 'pending' && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-cyan-700/30">
                    <label className="flex items-center gap-1 text-[11px] text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={trust}
                            onChange={e => setTrust(e.target.checked)}
                            className="w-3 h-3 accent-cyan-500"
                        />
                        Trust plan (skip per-step approval)
                    </label>
                    <div className="ml-auto flex gap-1">
                        <button
                            onClick={() => onDiscard(plan)}
                            className="px-2 py-1 text-xs rounded text-gray-300 hover:bg-gray-700"
                        >
                            Discard
                        </button>
                        <button
                            onClick={() => onExecute(plan, { trust })}
                            className="px-2 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                        >
                            Execute plan
                        </button>
                    </div>
                </div>
            )}

            {isExecuting && (
                <div className="mt-2 pt-2 border-t border-cyan-700/30 text-[11px] text-cyan-300">
                    Executing… {typeof meta?.planExecutedSteps === 'number' ? `(${meta.planExecutedSteps}/${plan.steps.length})` : ''}
                </div>
            )}

            {status === 'executed' && (
                <div className="mt-2 pt-2 border-t border-cyan-700/30 text-[11px] text-emerald-300">
                    ✓ Executed {meta?.planExecutedSteps ?? plan.steps.length} step{(meta?.planExecutedSteps ?? plan.steps.length) === 1 ? '' : 's'}.
                </div>
            )}

            {status === 'failed' && (
                <div className="mt-2 pt-2 border-t border-cyan-700/30 text-[11px] text-red-300">
                    Failed after step {meta?.planExecutedSteps ?? 0}: {meta?.planLastError ?? 'unknown error'}.
                    <button
                        onClick={() => onExecute(plan, { trust })}
                        className="ml-2 px-1.5 py-0.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white"
                    >
                        Resume
                    </button>
                </div>
            )}

            {status === 'discarded' && (
                <div className="mt-2 pt-2 border-t border-cyan-700/30 text-[11px] text-gray-400">
                    Discarded.
                </div>
            )}
            {isDone && status !== 'executed' && null}
        </div>
    );
};

interface StepDetailProps {
    step: PlanStep;
    getCellContent?: (cellId: string) => string | undefined;
}

const StepDetail: React.FC<StepDetailProps> = ({ step, getCellContent }) => {
    if (step.kind === 'add') {
        return (
            <pre className="text-[11px] bg-gray-900/60 border border-gray-700 rounded p-1.5 font-mono whitespace-pre-wrap break-all">
                {step.content}
            </pre>
        );
    }
    if (step.kind === 'edit') {
        const before = getCellContent?.(step.cellId) ?? '';
        return <InlineDiff before={before} after={step.content} compact />;
    }
    // applyPlot
    const cellContent = getCellContent?.(step.cellId) ?? '';
    const before = extractPlotBlockAt(cellContent, step.plotBlockIndex ?? 0) ?? '';
    return <InlineDiff before={before} after={step.plotConfig} compact labelBefore="plot before" labelAfter="plot after" />;
};
