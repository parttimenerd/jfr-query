import { describe, it, expect } from 'vitest';
import {
    formatSuggestionPreview,
    formatChipLabel,
} from '../../components/PlotSuggestionChip';
import type { PlotSuggestionResult } from '../../services/plotSuggestion';

// The chip renders DOM; the test environment is `node` (no jsdom) so we test
// the pure formatting helpers and the discriminated-union label logic.
// React-tree interaction tests live behind an integration/playwright layer.

describe('formatSuggestionPreview', () => {
    it('returns the first statement only', () => {
        expect(formatSuggestionPreview('LINE_CHART(x: ts, y: count)')).toBe(
            'LINE_CHART(x: ts, y: count)',
        );
    });

    it('strips trailing TITLE modifier', () => {
        expect(formatSuggestionPreview('LINE_CHART(x: ts, y: count) TITLE "Heap"')).toBe(
            'LINE_CHART(x: ts, y: count)',
        );
    });

    it('strips trailing ON modifier', () => {
        expect(formatSuggestionPreview('BAR_CHART(x: cause, y: total) ON 1')).toBe(
            'BAR_CHART(x: cause, y: total)',
        );
    });

    it('keeps only the first statement when joined with semicolons', () => {
        expect(formatSuggestionPreview('LINE_CHART(x: a, y: b); BAR_CHART(x: c, y: d)')).toBe(
            'LINE_CHART(x: a, y: b)',
        );
    });

    it('returns empty string for empty input', () => {
        expect(formatSuggestionPreview('')).toBe('');
    });
});

describe('formatChipLabel', () => {
    it('renders the config when not degraded', () => {
        const r: PlotSuggestionResult = {
            config: 'LINE_CHART(x: ts, y: count)',
            source: 'cloud-tiny',
        };
        expect(formatChipLabel(r)).toBe('Suggested: LINE_CHART(x: ts, y: count)');
    });

    it('renders "(no model)" when degraded by offline-only', () => {
        const r: PlotSuggestionResult = {
            config: '',
            source: 'cloud-tiny',
            degraded: 'offline-only',
        };
        expect(formatChipLabel(r)).toBe('Suggested: (no model)');
    });
});
