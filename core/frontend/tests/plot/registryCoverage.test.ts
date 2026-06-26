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

    it.each(expectedKeys)('registers %s', (name) => {
        expect(plotRegistry[name]).toBeDefined();
        expect(plotRegistry[name].component).toBeDefined();
        expect(plotRegistry[name].parseConfig).toBeDefined();
    });

    it('has exactly 12 registered plots (no more, no less)', () => {
        // Lock the count so unintentional additions force a conscious update.
        expect(Object.keys(plotRegistry).sort()).toEqual([...expectedKeys].sort());
    });
});
