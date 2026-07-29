import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../services/ai/tools/runtime';
import type { ToolDeps } from '../../services/ai/tools/runtime';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
        listCells: vi.fn().mockReturnValue([
            { id: 'cell-1', type: 'sql', content: 'SELECT ts, duration_ms, thread FROM jfr_events' },
            { id: 'cell-2', type: 'plot', content: 'LINE_CHART(x: "ts", y: "duration_ms")' },
        ]),
        mutateCells: vi.fn().mockResolvedValue({ ok: true }),
        listPlotsInNotebook: vi.fn().mockReturnValue([]),
        requireApproval: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('executeTool — suggestPlot', () => {
    it('returns schema columns for a SQL cell', async () => {
        const duckdbQuery = vi.fn().mockResolvedValue({
            columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'duration_ms', type: 'BIGINT' },
                { name: 'thread', type: 'VARCHAR' },
            ],
            rows: [],
        });
        const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps({ duckdbQuery }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toHaveProperty('columns');
        expect(result.data.columns).toContain('ts (TIMESTAMP)');
        expect(result.data.columns).toContain('duration_ms (BIGINT)');
        expect(result.data.columns).toContain('thread (VARCHAR)');
    });

    it('returns an error for an unknown cell id', async () => {
        const result = await executeTool('suggestPlot', { cellId: 'not-found' }, makeDeps());
        expect(result.ok).toBe(false);
    });

    it('returns an error for a non-SQL cell', async () => {
        const result = await executeTool('suggestPlot', { cellId: 'cell-2' }, makeDeps());
        expect(result.ok).toBe(false);
        expect((result as { ok: false; error: string }).error).toContain('SQL');
    });

    it('returns an error for a cell containing $ai_providers', async () => {
        const deps = makeDeps({
            listCells: vi.fn().mockReturnValue([
                { id: 'cell-evil', type: 'sql', content: 'SELECT * FROM $ai_providers.keys' },
            ]),
        });
        const result = await executeTool('suggestPlot', { cellId: 'cell-evil' }, deps);
        expect(result.ok).toBe(false);
        expect((result as { ok: false; error: string }).error).toMatch(/\$ai_providers/);
    });

    it('suggestPlot is in the TOOLS registry with kind read', async () => {
        const { TOOLS } = await import('../../services/ai/tools/index');
        const tool = TOOLS.find(t => t.name === 'suggestPlot');
        expect(tool).toBeTruthy();
        expect(tool!.kind).toBe('read');
    });

    it('heuristic suggests WATERFALL for delta column + varchar category', async () => {
        const duckdbQuery = vi.fn()
            .mockResolvedValueOnce({
                columns: [
                    { name: 'phase', type: 'VARCHAR' },
                    { name: 'heapDelta', type: 'DOUBLE' },
                ],
                rows: [],
            })
            .mockResolvedValueOnce({ columns: [{ name: 'cnt', type: 'BIGINT' }], rows: [{ cnt: 8 }] });
        const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps({ duckdbQuery }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.instruction).toContain('WATERFALL');
    });

    it('heuristic suggests TREEMAP/BAR for single varchar + single numeric (no timestamp)', async () => {
        const duckdbQuery = vi.fn()
            .mockResolvedValueOnce({
                columns: [
                    { name: 'objectClass', type: 'VARCHAR' },
                    { name: 'totalWeight', type: 'BIGINT' },
                ],
                rows: [],
            })
            .mockResolvedValueOnce({ columns: [{ name: 'cnt', type: 'BIGINT' }], rows: [{ cnt: 85 }] });
        const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps({ duckdbQuery }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.instruction).toContain('TREEMAP');
    });
});
