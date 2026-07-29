// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { matchesFilter } from '../components/PlotHelpModal';

describe('PlotHelpModal — matchesFilter', () => {
    it('returns true when filter is empty', () => {
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', '')).toBe(true);
    });

    it('matches by name (case-insensitive)', () => {
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', 'line')).toBe(true);
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', 'LINE')).toBe(true);
    });

    it('matches by description', () => {
        expect(matchesFilter('BAR_CHART', 'Show values by category.', 'category')).toBe(true);
    });

    it('returns false when no match', () => {
        expect(matchesFilter('BAR_CHART', 'Show values by category.', 'zzz')).toBe(false);
    });

    it('handles special characters and whitespace in filter term', () => {
        expect(matchesFilter('LINE_CHART', 'A line chart.', '  line  ')).toBe(false);
        expect(matchesFilter('LINE_CHART', 'Has (parens) in description.', '(parens)')).toBe(true);
    });
});
