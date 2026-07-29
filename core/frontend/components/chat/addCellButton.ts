// Pure helpers for the "Add to Notebook" button in ChatPanel.
//
// Why this button exists: the LEGACY non-tool-calling AI path returns a
// `{ text, code, plotConfig }` triple as a single suggestion. Unlike the
// tool-calling path (which writes cells via `addCell` + the approval flow),
// the legacy path produces no side effect on its own — the user has to
// click "Add to Notebook" to accept it. We need both paths because some
// providers / tiers (e.g. offline / browser models without function-call
// support) only emit legacy responses.
//
// Kept pure so they can be unit-tested without rendering the whole panel.

import type { ChatMessage } from '../../types';

/** Should the "Add to Notebook" button be rendered for this message? */
export function shouldShowAddButton(msg: ChatMessage): boolean {
    return !!(msg.isActionable && msg.code);
}

export interface AddCellArgs {
    code: string;
    plotConfig: string;
    title: string;
    markdownText: string;
}

/**
 * Build the arguments for `onAddCellFromAI(code, plotConfig, title, markdownText)`.
 * Returns `null` when the message isn't eligible for the button so callers
 * can guard with a single check. Title defaults to `"AI Suggested Cell"`.
 */
export function buildAddCellArgs(msg: ChatMessage): AddCellArgs | null {
    if (!shouldShowAddButton(msg)) return null;
    return {
        code: msg.code!,
        plotConfig: msg.plotConfig || 'TABLE()',
        title: 'AI Suggested Cell',
        markdownText: msg.text,
    };
}
