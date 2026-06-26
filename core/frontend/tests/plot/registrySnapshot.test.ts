// W5 — Autocomplete: shape registry snapshot must include the 12 canonical
// plot types and their new canonical params, so AI ghost-text picks them up.

import { describe, it, expect } from 'vitest';
import { summarizeShapeRegistry } from '../../components/editor/plot/aiPlotContext';
import { plotRegistry } from '../../components/plots/plotRegistry';

describe('summarizeShapeRegistry', () => {
    const summary = summarizeShapeRegistry(plotRegistry);

    it('includes all 12 canonical plot types', () => {
        const expected = [
            'TABLE', 'BAR_CHART', 'PIE_CHART', 'LINE_CHART', 'SCATTER_PLOT',
            'HEATMAP', 'FLAMEGRAPH', 'HISTOGRAM', 'BOX_PLOT', 'AREA_CHART',
            'GANTT', 'RANGE',
        ];
        for (const name of expected) {
            expect(summary).toContain(name);
        }
    });

    it('exposes canonical param names introduced by W3 (PIE category, GANTT lane/task, etc.)', () => {
        // PIE_CHART canonical rename: name → category
        const pieLine = summary.split('\n').find(l => l.startsWith('- PIE_CHART'));
        expect(pieLine).toBeDefined();
        expect(pieLine).toContain('category');

        // GANTT canonical rename: row → lane, plus required task
        const ganttLine = summary.split('\n').find(l => l.startsWith('- GANTT'));
        expect(ganttLine).toBeDefined();
        expect(ganttLine).toContain('lane');
        expect(ganttLine).toContain('task');
    });

    it('returns empty string when registry is undefined', () => {
        expect(summarizeShapeRegistry(undefined)).toBe('');
    });
});
