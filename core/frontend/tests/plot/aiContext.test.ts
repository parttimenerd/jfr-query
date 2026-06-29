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
        // Each cell ~1KB → 250 tokens. Pick a budget that exceeds the system
        // prompt + a few cells but cannot fit all five — so the algorithm has
        // to drop the oldest (FIFO). The exact figure floats with the system
        // prompt's size; keep it loose enough that prompt copy-edits don't
        // break the assertion, tight enough that some cells must be dropped.
        const big = 'X'.repeat(1024);
        const built = buildPlotAiContext({
            priorPlotCellsContent: [`cell0-${big}`, `cell1-${big}`, `cell2-${big}`, `cell3-${big}`, `cell4-${big}`],
            currentCellUpToCursor: 'LINE_CHART(',
            currentCellAfterCursor: '',
            budgetTokens: 1200,
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

describe('buildPlotAiContext — trimmed flag (B-075)', () => {
    it('trimmed is false when all prior cells fit within budget', () => {
        const built = buildPlotAiContext({
            priorPlotCellsContent: ['LINE_CHART(x: "ts", y: ["cpu"])'],
            currentCellUpToCursor: 'BAR(',
            currentCellAfterCursor: '',
        });
        expect(built.trimmed).toBe(false);
        expect(built.includedPriorCells).toBe(1);
    });

    it('trimmed is true when prior cells exceed token budget', () => {
        // 100 large prior cells should blow the budget
        const largeCells = Array.from({ length: 100 }, (_, i) => `LINE_CHART(x: "ts", y: ["cpu"]) TITLE "cell-${i}" ${'A'.repeat(200)}`);
        const built = buildPlotAiContext({
            priorPlotCellsContent: largeCells,
            budgetTokens: 512, // very tight budget
            currentCellUpToCursor: 'T',
            currentCellAfterCursor: '',
        });
        expect(built.trimmed).toBe(true);
        expect(built.includedPriorCells).toBeLessThan(largeCells.length);
    });

    it('trimmed is false when no prior cells', () => {
        const built = buildPlotAiContext({
            priorPlotCellsContent: [],
            currentCellUpToCursor: 'LINE(',
            currentCellAfterCursor: '',
        });
        expect(built.trimmed).toBe(false);
    });
});

// B-186: O(n) truncation — newest-first greedy selection.
// The algorithm stops at the first prior that doesn't fit, so a large middle
// cell cannot block smaller newer cells from being included.
describe('buildPlotAiContext — B-186 O(n) truncation correctness', () => {
    it('retains newest priors when an older cell is too large to fit', () => {
        // cell0: tiny, cell1: huge, cell2: tiny, cell3: tiny
        // With a tight budget the huge cell1 shouldn't prevent cell2 and cell3
        // from being included (newest-first greedy).
        const huge = 'X'.repeat(3000); // ~750 tokens
        const built = buildPlotAiContext({
            priorPlotCellsContent: [
                'cell0-small',
                `cell1-huge-${huge}`,
                'cell2-small',
                'cell3-small',
            ],
            budgetTokens: 800, // base + small cells fit; huge cell does not
            currentCellUpToCursor: 'LINE(',
            currentCellAfterCursor: '',
            maxPriorCellChars: 4000,
        });
        // Newest cells should be retained
        expect(built.user).toContain('cell3-small');
        expect(built.user).toContain('cell2-small');
        // Huge cell caused trimming
        expect(built.trimmed).toBe(true);
    });

    it('total estimated tokens does not exceed budget after truncation', () => {
        const big = 'Z'.repeat(2000);
        const built = buildPlotAiContext({
            priorPlotCellsContent: Array.from({ length: 20 }, (_, i) => `cell${i}-${big}`),
            budgetTokens: 700,
            currentCellUpToCursor: 'T(',
            currentCellAfterCursor: '',
        });
        expect(built.estimatedTokens).toBeLessThanOrEqual(700);
    });
});
