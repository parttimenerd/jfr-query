import React, { useState } from 'react';
import { formatActionLine } from './toolActionFormat';
import { formatToolArgs } from '../ChatProposalCard';

interface ToolCallLineProps {
    name: string;
    args: any;
    /** When set, the line body becomes clickable and calls onClickTarget(cellId). */
    onClickTarget?: (cellId: string) => void;
    /** Per-action undo. When omitted, the ⎌ button is hidden. */
    onUndo?: () => void;
    /** Tooltip for the undo button. Defaults to "Undo last notebook change". */
    undoTitle?: string;
    /** Visual tone: success (✓) or error (✗). Defaults to success. */
    tone?: 'success' | 'error';
}

/**
 * Compact one-line representation of a completed AI tool call.
 * Replaces the heavy ChatProposalCard for done mutations so the chat stays
 * readable when the AI fires several tool calls in a row.
 */
export const ToolCallLine: React.FC<ToolCallLineProps> = ({
    name, args, onClickTarget, onUndo, undoTitle = 'Undo last notebook change', tone = 'success',
}) => {
    const [expanded, setExpanded] = useState(false);
    const action = formatActionLine(name, args);

    const canScroll = !!(onClickTarget && action.cellId);
    const handleBodyClick = () => {
        if (canScroll && action.cellId) onClickTarget!(action.cellId);
    };

    const icon = tone === 'error' ? '✗' : '✓';
    const iconColor = tone === 'error' ? 'text-red-400' : 'text-green-400';

    return (
        <div className="my-1 text-xs text-gray-400 font-mono group/tcl">
            <div className="flex items-center gap-2">
                <span className={`${iconColor} font-semibold`}>{icon}</span>
                <button
                    type="button"
                    onClick={handleBodyClick}
                    disabled={!canScroll}
                    className={`flex-1 text-left truncate ${canScroll ? 'cursor-pointer hover:text-gray-200' : 'cursor-default'}`}
                    title={canScroll ? 'Scroll to cell' : ''}
                    aria-label={canScroll ? 'Scroll to cell' : undefined}
                >
                    <span className="text-gray-300 font-semibold mr-1">{action.verb}</span>
                    <span className="text-gray-500">{action.summary}</span>
                </button>
                {onUndo && (
                    <button
                        type="button"
                        onClick={onUndo}
                        title={undoTitle}
                        className="text-gray-500 hover:text-amber-300 opacity-0 group-hover/tcl:opacity-100 transition-opacity px-1"
                        aria-label="Undo"
                    >
                        ⎌
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    title={expanded ? 'Hide details' : 'Show details'}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide tool call details' : 'Show tool call details'}
                    className="text-gray-500 hover:text-gray-300 px-1"
                >
                    {expanded ? '▴' : '▾'}
                </button>
            </div>
            {expanded && (
                <pre className="mt-1 ml-6 p-2 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-300 max-h-40 overflow-auto whitespace-pre-wrap">{formatToolArgs(args)}</pre>
            )}
        </div>
    );
};
