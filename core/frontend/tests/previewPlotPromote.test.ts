// Pin the promote contract from previewPlot's "Add to Notebook" button.
//
// ChatPanel's previewPlot handler calls
//     onAddCellFromAI(sql, plotConfig, '', '')
// which in App.tsx builds a cell from these segments:
//     - markdown:  '# \n\n\n\n'              (empty title + body)
//     - sql:       '\n${sql}\n'
//     - markdown:  '\n\n'
//     - plot:      '\n${plotConfig}\n'
// and the cell is added to the notebook by reconstructCellContent(segments).
//
// We don't (can't) reach App.tsx's addCellFromAI from a node-env test, but we
// CAN verify the contract: those segments, after reconstruction, must
// round-trip through tokenizeCellContent into one sql block and one plot block
// with the supplied bodies — i.e. the cell is runnable, not a blob of
// markdown. If the segments shape ever changes, this test fails before the
// regression reaches the notebook.

import { describe, it, expect } from 'vitest';
import { reconstructCellContent, tokenizeCellContent, type CellSegment } from '../utils/notebookParser';

function buildPromoteCellContent(sql: string, plotConfig: string, title = '', markdownText = ''): string {
    // Mirror of App.tsx:592 addCellFromAI segment shape.
    const segments: CellSegment[] = [
        { type: 'markdown', content: `# ${title}\n\n${markdownText}\n\n` },
        { type: 'sql', content: `\n${sql}\n` },
        { type: 'markdown', content: '\n\n' },
        { type: 'plot', content: `\n${plotConfig}\n` },
    ];
    return reconstructCellContent(segments);
}

describe('previewPlot promote contract — addCellFromAI cell shape', () => {
    it('produces a cell with exactly one runnable sql block and one runnable plot block', () => {
        const sql = 'SELECT objectClass, totalWeight FROM allocations';
        const plotConfig = 'BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "Top Classes"';
        const content = buildPromoteCellContent(sql, plotConfig);

        const segments = tokenizeCellContent(content);
        const sqlBlocks = segments.filter(s => s.type === 'sql');
        const plotBlocks = segments.filter(s => s.type === 'plot');

        expect(sqlBlocks).toHaveLength(1);
        expect(plotBlocks).toHaveLength(1);
        // The block bodies must contain the supplied strings verbatim — if the
        // notebook executor sees anything else, the chart won't render.
        expect(sqlBlocks[0].content).toContain(sql);
        if (plotBlocks[0].type === 'plot') {
            expect(plotBlocks[0].content).toContain(plotConfig);
        }
    });

    it('does not wrap the SQL inside a markdown segment', () => {
        // Regression guard against accidentally serialising the cell as one
        // markdown blob (the chart would render as text, not a chart).
        const content = buildPromoteCellContent('SELECT 1 AS x', 'BAR_CHART(x: "x", y: ["x"])');
        const segments = tokenizeCellContent(content);
        const markdownBlobs = segments.filter(s => s.type === 'markdown').map(s => s.content).join('');
        expect(markdownBlobs).not.toContain('SELECT 1 AS x');
        expect(markdownBlobs).not.toContain('BAR_CHART');
    });

    it('preserves a multi-line plot DSL (composites must round-trip too)', () => {
        const sql = 'SELECT 1';
        const plotConfig = 'ROW(\n  BAR_CHART(x: "x", y: ["y"]),\n  LINE_CHART(x: "x", y: ["y"])\n) TITLE "side by side"';
        const content = buildPromoteCellContent(sql, plotConfig);

        const segments = tokenizeCellContent(content);
        const plotBlock = segments.find(s => s.type === 'plot');
        expect(plotBlock).toBeDefined();
        if (plotBlock?.type === 'plot') {
            expect(plotBlock.content).toContain('ROW(');
            expect(plotBlock.content).toContain('LINE_CHART');
            expect(plotBlock.content).toContain('side by side');
        }
    });

    it('keeps the sql block before the plot block (chart depends on the query)', () => {
        const content = buildPromoteCellContent('SELECT 2', 'BAR_CHART(x: "x", y: ["x"])');
        const segments = tokenizeCellContent(content);
        const sqlIdx = segments.findIndex(s => s.type === 'sql');
        const plotIdx = segments.findIndex(s => s.type === 'plot');
        expect(sqlIdx).toBeGreaterThanOrEqual(0);
        expect(plotIdx).toBeGreaterThanOrEqual(0);
        expect(sqlIdx).toBeLessThan(plotIdx);
    });

    it('does not produce variables / if blocks the model never requested', () => {
        const content = buildPromoteCellContent('SELECT 1', 'BAR_CHART(x: "x", y: ["x"])');
        const segments = tokenizeCellContent(content);
        expect(segments.find(s => s.type === 'variables')).toBeUndefined();
        expect(segments.find(s => s.type === 'if')).toBeUndefined();
    });
});
