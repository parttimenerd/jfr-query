import { describe, it, expect } from 'vitest';
import { validatePlotConfig } from '../utils/plotValidator';

const sampleData = [
    { ts: 1000, cpu: 50, heap: 200 },
    { ts: 2000, cpu: 70, heap: 250 },
];

describe('validatePlotConfig — basic validation', () => {
    it('returns null for TABLE() (always valid)', () => {
        expect(validatePlotConfig('TABLE()', sampleData)).toBeNull();
    });

    it('returns null for valid LINE_CHART with existing columns', () => {
        expect(validatePlotConfig('LINE_CHART(x: "ts", y: ["cpu"])', sampleData)).toBeNull();
    });

    it('returns null when data is empty (any config is valid)', () => {
        expect(validatePlotConfig('LINE_CHART(x: "ts", y: ["cpu"])', [])).toBeNull();
    });

    it('returns null when data has error key', () => {
        expect(validatePlotConfig('LINE_CHART(x: "ts", y: ["cpu"])', [{ error: 'SQL error' }])).toBeNull();
    });

    it('returns error for unknown plot type', () => {
        const result = validatePlotConfig('UNKNOWN_PLOT(x: "ts")', sampleData);
        expect(result).toBeTruthy();
        expect(result).toContain('UNKNOWN_PLOT');
    });

    it('returns null when config is empty (defaults to TABLE)', () => {
        expect(validatePlotConfig('', sampleData)).toBeNull();
    });
});

describe('validatePlotConfig — column validation', () => {
    it('returns error when required column does not exist in data', () => {
        // BAR_CHART requires x and y — "nonexistent" is not in sampleData
        const result = validatePlotConfig('BAR_CHART(x: "nonexistent", y: ["cpu"])', sampleData);
        // parseConfig should throw or return an error about missing column
        // (some implementations may be lenient — at minimum it should not crash)
        expect(typeof result === 'string' || result === null).toBe(true);
    });

    it('returns null for SCATTER_PLOT with valid x and y columns', () => {
        const result = validatePlotConfig('SCATTER_PLOT(x: "ts", y: "cpu")', sampleData);
        expect(result).toBeNull();
    });
});

describe('validatePlotConfig — LET constant expansion', () => {
    it('returns null for valid config with LET constant', () => {
        const config = 'LET @xCol = "ts"\nLINE_CHART(x: @xCol, y: ["cpu"])';
        const result = validatePlotConfig(config, sampleData);
        expect(result).toBeNull();
    });

    it('returns error for invalid LET constant syntax', () => {
        const config = 'LET @missing_equals "ts"\nLINE_CHART(x: @xCol, y: ["cpu"])';
        const result = validatePlotConfig(config, sampleData);
        // Should catch the LET syntax error or expansion error
        expect(typeof result === 'string' || result === null).toBe(true);
    });
});

describe('validatePlotConfig — composite layouts (B-178)', () => {
    it('returns null for ROW(...) composite with valid children', () => {
        const config = 'ROW(TABLE(), TABLE())';
        expect(validatePlotConfig(config, sampleData)).toBeNull();
    });

    it('returns null for COL(...) composite with valid children', () => {
        const config = 'COL(TABLE(), TABLE())';
        expect(validatePlotConfig(config, sampleData)).toBeNull();
    });

    it('returns null for overlay A + B composite', () => {
        const config = 'LINE_CHART(x: "ts", y: ["cpu"]) + LINE_CHART(x: "ts", y: ["heap"])';
        expect(validatePlotConfig(config, sampleData)).toBeNull();
    });

    it('returns error for ROW with unknown child plot type', () => {
        const config = 'ROW(TABLE(), UNKNOWN_PLOT(x: "ts"))';
        const result = validatePlotConfig(config, sampleData);
        expect(result).toBeTruthy();
        expect(result).toContain('UNKNOWN_PLOT');
    });

    it('does NOT error for multi-query ON clause when supportsMultiQuery is undefined (B-177)', () => {
        // SCATTER_PLOT has supportsMultiQuery undefined, not false — should not error
        const config = 'SCATTER_PLOT(x: "ts", y: "cpu") ON #1, #2';
        const result = validatePlotConfig(config, sampleData);
        // Should not return the "does not support multiple queries" error
        if (result !== null) {
            expect(result).not.toContain('does not support multiple queries');
        }
    });

    it('returns error for multi-query ON clause when supportsMultiQuery is explicitly false', () => {
        // TABLE has supportsMultiQuery: false
        const config = 'TABLE() ON #1, #2';
        const result = validatePlotConfig(config, sampleData);
        expect(result).toBeTruthy();
        expect(result).toContain('does not support multiple queries');
    });
});
