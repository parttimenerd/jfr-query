import React from 'react';
import type { PlotSuggestionResult } from '../services/plotSuggestion';

/**
 * Build the compact preview string for a suggested plot config — e.g.
 *   "LINE_CHART(x: ts, y: count)" → "LINE_CHART(x: ts, y: count)"
 *   "BAR_CHART(...)               TITLE \"Foo\""  → "BAR_CHART(...)"
 *
 * Strips post-call modifiers (TITLE/ON/WIDTH/HEIGHT/...) for the chip preview.
 * Pure helper, exported for tests so we can validate without a DOM renderer.
 */
export function formatSuggestionPreview(config: string): string {
    if (!config) return '';
    // First newline-delimited statement, then strip post-call modifiers
    // (ON/TITLE/WIDTH/HEIGHT/ZOOM/LINK_X). Conservative: only strip when there
    // is a closing paren followed by the modifier keyword.
    const firstStatement = config.split(/\n\s*\n|;/)[0].trim();
    const trimmed = firstStatement.replace(
        /\)\s+(TITLE|ON|WIDTH|HEIGHT|ZOOM|LINK_X)\b.*$/i,
        ')',
    );
    return trimmed;
}

/**
 * Build the label shown to the user. When the suggestion is degraded
 * (offline-only switch blocked the cloud call) we show a sentinel string
 * rather than the empty config.
 */
export function formatChipLabel(result: PlotSuggestionResult): string {
    if (result.degraded === 'offline-only') {
        return 'Suggested: (no model)';
    }
    return `Suggested: ${formatSuggestionPreview(result.config)}`;
}

export interface PlotSuggestionChipProps {
    suggestion: PlotSuggestionResult;
    onApply: (config: string) => void;
    onTryAnother: () => void;
    onDismiss: () => void;
    onOpenSettings?: () => void;
}

const PlotSuggestionChip: React.FC<PlotSuggestionChipProps> = ({
    suggestion,
    onApply,
    onTryAnother,
    onDismiss,
    onOpenSettings,
}) => {
    const isDegraded = suggestion.degraded === 'offline-only';
    const label = formatChipLabel(suggestion);

    return (
        <div
            data-testid="plot-suggestion-chip"
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 my-1 rounded-md bg-cyan-900/20 border border-cyan-700/30 text-xs"
        >
            <span className="text-cyan-300 font-mono truncate">{label}</span>
            {isDegraded ? (
                <button
                    type="button"
                    onClick={onOpenSettings}
                    className="px-2 py-0.5 text-cyan-300 hover:underline"
                >
                    Open Settings
                </button>
            ) : (
                <>
                    <button
                        type="button"
                        onClick={() => onApply(suggestion.config)}
                        className="px-2 py-0.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white"
                    >
                        Apply
                    </button>
                    <button
                        type="button"
                        onClick={onTryAnother}
                        className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                    >
                        Try another
                    </button>
                </>
            )}
            <button
                type="button"
                onClick={onDismiss}
                className="px-2 py-0.5 rounded text-gray-400 hover:text-gray-200 ml-auto"
                aria-label="Dismiss"
            >
                Dismiss
            </button>
        </div>
    );
};

export default React.memo(PlotSuggestionChip);
