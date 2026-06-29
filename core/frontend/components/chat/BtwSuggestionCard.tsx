// Small "by the way" suggestion card. Renders a single hint text, optional
// "Use" action button, and a dismiss control.
//
// Pure presentational — the parent owns hint state via useChatMode.

import React from 'react';
import { XMarkIcon } from '../icons/XMarkIcon';
import type { BtwHint } from '../../services/ai/chatModes';

interface BtwSuggestionCardProps {
    hint: BtwHint;
    onDismiss: (id: string) => void;
    /** If the hint has a send-prompt action, this fires it. The parent decides
     * whether to send to the channel as a user message or do something else. */
    onAction?: (hint: BtwHint) => void;
}

export const BtwSuggestionCard: React.FC<BtwSuggestionCardProps> = ({ hint, onDismiss, onAction }) => {
    const hasAction = hint.action?.type === 'send-prompt' && typeof onAction === 'function';
    return (
        <div
            role="note"
            aria-label="By the way suggestion"
            className="group relative bg-amber-900/20 border border-amber-700/40 rounded-md px-2.5 py-1.5 text-xs text-amber-200 flex items-start gap-2"
        >
            <span className="text-amber-400 flex-shrink-0 leading-tight" aria-hidden>·</span>
            <div className="flex-1 min-w-0">
                <div className="break-words leading-snug">{hint.text}</div>
                {hasAction && (
                    <button
                        onClick={() => onAction!(hint)}
                        className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-700/40 hover:bg-amber-600/50 text-amber-100 text-[11px] font-medium transition-colors"
                    >
                        Try this
                    </button>
                )}
            </div>
            <button
                onClick={() => onDismiss(hint.id)}
                aria-label="Dismiss suggestion"
                className="opacity-40 group-hover:opacity-100 hover:text-amber-100 transition-opacity flex-shrink-0"
            >
                <XMarkIcon className="w-3 h-3"/>
            </button>
        </div>
    );
};
