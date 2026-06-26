// Locks in the showcase's 12-plot inventory. If any of these names disappear or
// fail to register, the test fails — preventing silent regressions where a
// plot's React component exists in the tree but isn't reachable from the parser.

import { describe, it, expect } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';

describe('plotRegistry — showcase 12-plot coverage', () => {
    // Showcase canon: GANTT and RANGE (not GANTT_CHART / RANGE_PLOT).
    const expectedKeys = [
        'TABLE',
        'BAR_CHART',
        'PIE_CHART',
        'LINE_CHART',
        'SCATTER_PLOT',
        'HEATMAP',
        'FLAMEGRAPH',
        'HISTOGRAM',
        'BOX_PLOT',
        'AREA_CHART',
        'GANTT',
        'RANGE',
    ];

    // Aliases that point at one of the canonical plots; allowed in the registry
    // but not counted as a distinct plot.
    const aliasKeys = ['FLAME_GRAPH'];

    it.each(expectedKeys)('registers %s', (name) => {
        expect(plotRegistry[name]).toBeDefined();
        expect(plotRegistry[name].component).toBeDefined();
        expect(plotRegistry[name].parseConfig).toBeDefined();
    });

    it('has exactly 12 canonical registered plots (aliases allowed)', () => {
        const actual = Object.keys(plotRegistry).filter(k => !aliasKeys.includes(k)).sort();
        expect(actual).toEqual([...expectedKeys].sort());
    });
});
