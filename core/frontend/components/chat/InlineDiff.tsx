// Side-by-side before/after diff used by approval cards and plan steps.
// Kept simple — same visual treatment the existing ChatProposalCard uses,
// just factored out so plan cards can reuse it without duplicating styling.

import React from 'react';

interface InlineDiffProps {
    before: string;
    after: string;
    /** Optional column labels. Defaults: 'before' / 'after'. */
    labelBefore?: string;
    labelAfter?: string;
    /** Compact (mt-1, smaller padding) for embedded use in dense lists. */
    compact?: boolean;
}

export const InlineDiff: React.FC<InlineDiffProps> = ({
    before,
    after,
    labelBefore = 'before',
    labelAfter = 'after',
    compact = false,
}) => {
    const pad = compact ? 'p-1' : 'p-2';
    const text = compact ? 'text-[10px]' : 'text-xs';
    return (
        <div className={`grid grid-cols-2 gap-2 text-xs font-mono ${compact ? 'mt-1' : 'mt-2'}`}>
            <div className={`bg-red-900/30 border border-red-800/50 rounded ${pad} overflow-x-auto`}>
                <div className={`${text} text-red-300 mb-0.5`}>{labelBefore}</div>
                <pre className="whitespace-pre-wrap break-all">{before || '(empty)'}</pre>
            </div>
            <div className={`bg-green-900/30 border border-green-800/50 rounded ${pad} overflow-x-auto`}>
                <div className={`${text} text-green-300 mb-0.5`}>{labelAfter}</div>
                <pre className="whitespace-pre-wrap break-all">{after || '(empty)'}</pre>
            </div>
        </div>
    );
};
