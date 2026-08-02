import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { crosstabPlot, aggregate } from '../../../components/plots/CrosstabPlot';

describe('crosstabPlot registration', () => {
    it('has name CROSSTAB', () => {
        expect(crosstabPlot.name).toBe('CROSSTAB');
    });

    it('requires row, col, value', () => {
        ['row', 'col', 'value'].forEach(name => {
            expect(crosstabPlot.params.find(p => p.name === name)?.required).toBe(true);
        });
    });

    it('has optional agg param with default SUM', () => {
        const agg = crosstabPlot.params.find(p => p.name === 'agg');
        expect(agg).toBeDefined();
        expect(agg?.defaultValue).toBe('SUM');
    });
});

describe('crosstabPlot parseConfig', () => {
    it('parses all required columns', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "gcType", col: "phase", value: "duration")', []);
        expect(cfg.row).toBe('gcType');
        expect(cfg.col).toBe('phase');
        expect(cfg.value).toBe('duration');
    });

    it('parses agg function', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "r", col: "c", value: "v", agg: "AVG")', []);
        expect(cfg.agg).toBe('AVG');
    });

    it('defaults agg to SUM', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "r", col: "c", value: "v")', []);
        expect(cfg.agg ?? 'SUM').toBe('SUM');
    });
});

describe('aggregate', () => {
    const rows = [
        { type: 'G1 GC', phase: 'Mark', dur: 10 },
        { type: 'G1 GC', phase: 'Mark', dur: 20 },
        { type: 'G1 GC', phase: 'Sweep', dur: 15 },
        { type: 'Full GC', phase: 'Mark', dur: 100 },
    ];

    it('SUM aggregates correctly', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'SUM');
        expect(result.get('G1 GC')?.get('Mark')).toBe(30);
    });

    it('AVG aggregates correctly', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'AVG');
        expect(result.get('G1 GC')?.get('Mark')).toBe(15);
    });

    it('COUNT counts rows ignoring value', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'COUNT');
        expect(result.get('G1 GC')?.get('Mark')).toBe(2);
    });

    it('MAX finds maximum', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'MAX');
        expect(result.get('G1 GC')?.get('Mark')).toBe(20);
    });

    it('MIN finds minimum', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'MIN');
        expect(result.get('G1 GC')?.get('Mark')).toBe(10);
    });

    it('handles empty data', () => {
        expect(aggregate([], 'r', 'c', 'v', 'SUM').size).toBe(0);
    });
});
