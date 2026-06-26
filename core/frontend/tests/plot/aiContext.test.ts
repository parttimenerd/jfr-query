// Tests for `buildPlotAiContext`. Covers: section presence, secret filtering,
// FIFO truncation, scope/brush surface, and column-type inlining.

import { describe, it, expect } from 'vitest';
import { buildPlotAiContext } from '../../components/editor/plot/aiPlotContext';
import type { PlotRegistration } from '../../components/plots/plotTypes';

function fakeRegistry(): Record<string, PlotRegistration<any>> {
    return {
        LINE_CHART: {
            name: 'LINE_CHART',
            description: 'Line chart',
            params: [
                { name: 'x', type: 'column', required: true, description: 'X column' },
                { name: 'y', type: 'column[]', required: true, description: 'Y columns' },
                { name: 'color', type: 'string', required: false, description: 'Color' },
            ],
            template: 'LINE_CHART(x: "$x", y: ["$y"])',
            examples: [{ description: 'basic', code: 'LINE_CHART(x: "ts", y: ["v"])' }],
            parseConfig: () => ({}),
            component: (() => null) as any,
        },
        BAR_CHART: {
            name: 'BAR_CHART',
            description: 'Bar chart',
            params: [
                { name: 'x', type: 'column', required: true, description: 'cat' },
            ],
            template: 'BAR_CHART(x: "$x")',
            examples: [],
            parseConfig: () => ({}),
            component: (() => null) as any,
        },
    };
}

describe('buildPlotAiContext — basic shape', () => {
    it('returns system + user with shapes, schema, scope, vars, prior cells', () => {
        const built = buildPlotAiContext({
            shapeRegistry: fakeRegistry(),
            cellResultSchema: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'pause', type: 'INTERVAL' },
            ],
            plotScope: [{ name: 'gc_overview', shape: 'line', hasBrush: true }],
            variables: { $$start: '0', $end: '100' },
            priorPlotCellsContent: ['BAR_CHART(x: "cause")'],
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
        });
        expect(built.system).toContain('inline completion model');
        expect(built.user).toContain('# Available shapes');
        expect(built.user).toContain('LINE_CHART');
        expect(built.user).toContain('# Current cell\'s SQL result columns');
        expect(built.user).toContain('ts (TIMESTAMP)');
        expect(built.user).toContain('pause (INTERVAL)');
        expect(built.user).toContain('# Named plots above this cell');
        expect(built.user).toContain('gc_overview (line) — has brush: yes');
        expect(built.user).toContain('# Variables in scope');
        expect(built.user).toContain('$$start = 0');
        expect(built.user).toContain('# Prior plot cells');
        expect(built.user).toContain('BAR_CHART(x: "cause")');
        expect(built.user).toContain('LINE_CHART(<<CURSOR>>');
    });
});

describe('buildPlotAiContext — security', () => {
    it('excludes $ai_providers.* keys from output', () => {
        const built = buildPlotAiContext({
            variables: {
                '$ai_providers.gemini.googleApiKey': 'AIzaSy-SECRET-KEY-DO-NOT-LEAK',
                '$ai_providers.openai.openaiApiKey': 'sk-SECRET',
                '$$publicVar': '42',
            },
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
        });
        expect(built.user).not.toContain('AIzaSy-SECRET-KEY-DO-NOT-LEAK');
        expect(built.user).not.toContain('sk-SECRET');
        expect(built.user).not.toContain('$ai_providers');
        expect(built.user).toContain('$$publicVar');
    });
});

describe('buildPlotAiContext — truncation', () => {
    it('truncates prior cells FIFO (oldest first) when over budget', () => {
        // Each cell ~1KB → 250 tokens; budget = 600 system+user → ~3 cells max.
        const big = 'X'.repeat(1024);
        const built = buildPlotAiContext({
            priorPlotCellsContent: [`cell0-${big}`, `cell1-${big}`, `cell2-${big}`, `cell3-${big}`, `cell4-${big}`],
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
            budgetTokens: 600,
            maxPriorCellChars: 1024,
        });
        // Oldest must go first. cell0 should be excluded if any was dropped.
        if (built.includedPriorCells < 5) {
            expect(built.user).not.toContain('cell0-');
        }
        // The newest cell should be retained.
        expect(built.user).toContain('cell4-');
    });

    it('caps prior cells at maxPriorCells (default 5)', () => {
        const built = buildPlotAiContext({
            priorPlotCellsContent: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
            currentCellUpToCursor: '',
            currentCellAfterCursor: '',
        });
        expect(built.includedPriorCells).toBeLessThanOrEqual(5);
        // c1/c2 (oldest) shouldn't appear when 5+ cells provided.
        expect(built.user).not.toMatch(/\bc1\b/);
        expect(built.user).not.toMatch(/\bc2\b/);
    });
});

describe('buildPlotAiContext — scope rendering', () => {
    it('omits scope block entirely when scope is empty', () => {
        const built = buildPlotAiContext({
            plotScope: [],
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
        });
        expect(built.user).not.toContain('# Named plots above this cell');
    });

    it('omits brush hint when plot has no brush', () => {
        const built = buildPlotAiContext({
            plotScope: [{ name: 'simple', shape: 'bar', hasBrush: false }],
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
        });
        expect(built.user).toContain('- simple (bar)');
        expect(built.user).not.toContain('has brush: yes');
    });
});

describe('buildPlotAiContext — result schema', () => {
    it('inlines name + type for each result column', () => {
        const built = buildPlotAiContext({
            cellResultSchema: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'cause', type: 'VARCHAR' },
                { name: 'pause_ns', type: 'BIGINT' },
            ],
            currentCellUpToCursor: 'LINE_CHART(x: ',
            currentCellAfterCursor: '',
        });
        expect(built.user).toContain('ts (TIMESTAMP)');
        expect(built.user).toContain('cause (VARCHAR)');
        expect(built.user).toContain('pause_ns (BIGINT)');
    });

    it('omits result columns section when none', () => {
        const built = buildPlotAiContext({
            cellResultSchema: null,
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
        });
        expect(built.user).not.toContain('# Current cell\'s SQL result columns');
    });
});
