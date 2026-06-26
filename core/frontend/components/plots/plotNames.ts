// W12 — Plot-name normalization: map short aliases and case-variants to the
// canonical registry key. Centralized so every lookup site agrees.

const SHORT_ALIASES: Record<string, string> = {
    LINE: 'LINE_CHART',
    BAR: 'BAR_CHART',
    AREA: 'AREA_CHART',
    SCATTER: 'SCATTER_PLOT',
    PIE: 'PIE_CHART',
    BOX: 'BOX_PLOT',
    HIST: 'HISTOGRAM',
    HEAT: 'HEATMAP',
    FLAME: 'FLAMEGRAPH',
    // GANTT, RANGE, TABLE, HEATMAP, HISTOGRAM, FLAMEGRAPH already canonical short
};

export function normalizePlotName(rawName: string): string {
    const upper = rawName.toUpperCase();
    return SHORT_ALIASES[upper] ?? upper;
}

export const PLOT_NAME_ALIASES = SHORT_ALIASES;
