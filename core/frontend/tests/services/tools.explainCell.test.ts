import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../services/ai/tools/runtime';
import type { ToolDeps } from '../../services/ai/tools/runtime';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
        listCells: vi.fn().mockReturnValue([
            { id: 'cell-1', type: 'sql', content: 'SELECT event_type, count(*) FROM jfr GROUP BY 1' },
            { id: 'cell-2', type: 'plot', content: 'LINE_CHART(x: "ts", y: "duration")' },
        ]),
        mutateCells: vi.fn().mockResolvedValue({ ok: true }),
        listPlotsInNotebook: vi.fn().mockReturnValue([]),
        requireApproval: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('executeTool — explainCell', () => {
    it('returns a prompt context for a known cell', async () => {
        const result = await executeTool('explainCell', { cellId: 'cell-1' }, makeDeps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toHaveProperty('content');
        expect(result.data.content).toContain('SELECT');
    });

    it('returns chart-focused instruction for a plot cell', async () => {
        const result = await executeTool('explainCell', { cellId: 'cell-2' }, makeDeps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.cellType).toBe('plot');
        expect(result.data.instruction).toContain('visually');
    });

    it('returns an error for an unknown cell id', async () => {
        const result = await executeTool('explainCell', { cellId: 'not-found' }, makeDeps());
        expect(result.ok).toBe(false);
    });

    it('tool is in the TOOLS registry', async () => {
        const { TOOLS } = await import('../../services/ai/tools/index');
        const tool = TOOLS.find(t => t.name === 'explainCell');
        expect(tool).toBeTruthy();
        expect(tool!.kind).toBe('read');
    });
});
