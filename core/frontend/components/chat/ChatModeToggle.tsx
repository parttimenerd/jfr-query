// Three-segment pill toggle for normal / plan / btw chat modes.
// verbose mode is activated via the /verbose slash command (not this toggle).

import React from 'react';
import type { ChatMode } from '../../services/ai/chatModes';

interface ChatModeToggleProps {
    mode: ChatMode;
    onChange: (mode: ChatMode) => void;
    /** Smaller variant for InlineChat (tighter padding, no labels on narrow screens). */
    compact?: boolean;
    disabled?: boolean;
}

interface Segment {
    id: ChatMode;
    label: string;
    title: string;
}

const SEGMENTS: Segment[] = [
    { id: 'normal', label: 'Normal', title: 'Normal chat — assistant may modify the notebook' },
    { id: 'plan',   label: 'Plan',   title: 'Plan mode — assistant proposes changes without modifying the notebook' },
    { id: 'btw',    label: 'BTW',    title: 'BTW mode — receive "by the way" suggestion cards after each reply' },
];

export const ChatModeToggle: React.FC<ChatModeToggleProps> = ({ mode, onChange, compact = false, disabled = false }) => {
    const pad = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';
    return (
        <div
            role="tablist"
            aria-label="Chat mode"
            className={`inline-flex rounded-md border border-gray-700 bg-gray-800 overflow-hidden ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
        >
            {SEGMENTS.map(seg => {
                const active = seg.id === mode;
                return (
                    <button
                        key={seg.id}
                        role="tab"
                        aria-selected={active}
                        title={seg.title}
                        onClick={() => onChange(seg.id)}
                        className={`${pad} font-medium transition-colors ${
                            active
                                ? 'bg-cyan-600 text-white'
                                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700'
                        }`}
                    >
                        {seg.label}
                    </button>
                );
            })}
        </div>
    );
};
