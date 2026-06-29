// Renders a diffPlans report — useful when a follow-up plan supersedes a
// prior plan in the same channel. Shows added/removed/modified/unchanged
// step labels, plus summary changes.

import React from 'react';
import { describePlanStep, diffPlans, type ParsedPlan } from '../../services/ai/chatModes';

interface PlanDiffViewProps {
    before: ParsedPlan;
    after: ParsedPlan;
}

const KIND_META = {
    added:     { label: 'Added',     bg: 'bg-green-900/30',  text: 'text-green-300',  symbol: '+' },
    removed:   { label: 'Removed',   bg: 'bg-red-900/30',    text: 'text-red-300',    symbol: '−' },
    modified:  { label: 'Modified',  bg: 'bg-amber-900/30',  text: 'text-amber-200',  symbol: '~' },
    unchanged: { label: 'Unchanged', bg: 'bg-gray-800/40',   text: 'text-gray-400',   symbol: '·' },
} as const;

export const PlanDiffView: React.FC<PlanDiffViewProps> = ({ before, after }) => {
    const report = diffPlans(before, after);
    return (
        <div className="border border-gray-700 bg-gray-900/40 rounded-md p-2 my-1 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Plan revised</div>
            {report.summaryChanged && (
                <div className="mb-2">
                    <div className="text-[10px] text-gray-500">summary</div>
                    <div className="line-through text-gray-500">{report.summaryBefore || '(none)'}</div>
                    <div className="text-gray-200">{report.summaryAfter || '(none)'}</div>
                </div>
            )}
            <ul className="space-y-0.5">
                {report.stepDiffs.map((d, i) => {
                    const meta = KIND_META[d.kind];
                    const step = d.kind === 'modified' ? d.after : d.step;
                    const label = describePlanStep(step);
                    return (
                        <li key={i} className={`flex items-start gap-2 px-1.5 py-0.5 rounded ${meta.bg}`}>
                            <span className={`font-mono ${meta.text} flex-shrink-0`} aria-label={meta.label}>{meta.symbol}</span>
                            <span className="text-gray-200 flex-1 min-w-0 break-words">{label}</span>
                            {d.kind === 'modified' && (
                                <span className="text-[10px] text-amber-300 flex-shrink-0">
                                    {d.fields.join(', ')}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
