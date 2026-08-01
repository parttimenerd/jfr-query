import { describe, it, expect, vi } from 'vitest';
import { executeTool, type ToolDeps } from '../../../../services/ai/tools/runtime';

// ── mock deps factory ─────────────────────────────────────────────────────────

function mockDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn(async () => ({ columns: [{ name: 'x', type: 'INTEGER' }], rows: [{ x: 1 }] })),
        listCells: vi.fn(() => []),
        mutateCells: vi.fn(async () => ({ ok: true as const, cellId: 'new-cell-1' })),
        listPlotsInNotebook: vi.fn(() => []),
        requireApproval: vi.fn(async () => undefined),
        getVariables: vi.fn(() => ({})),
        setVariables: vi.fn(async () => ({ ok: true as const })),
        getVisibility: vi.fn(() => 'full' as const),
        getMemory: vi.fn(() => ({})),
        setMemory: vi.fn(),
        setTaskList: vi.fn(),
        ...overrides,
    };
}

// ── unknown tool ──────────────────────────────────────────────────────────────

describe('executeTool — unknown tool', () => {
    it('returns error for an unknown tool name', async () => {
        const result = await executeTool('noSuchTool', {}, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('noSuchTool');
    });
});

// ── validation ────────────────────────────────────────────────────────────────

describe('executeTool — validation', () => {
    it('returns error when required args are missing', async () => {
        const result = await executeTool('runQuery', {}, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('sql');
    });

    it('returns error when arg type is wrong', async () => {
        const result = await executeTool('runQuery', { sql: 123 }, mockDeps());
        expect(result.ok).toBe(false);
    });
});

// ── runQuery ──────────────────────────────────────────────────────────────────

describe('executeTool — runQuery', () => {
    it('returns paginated result on success', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'n', type: 'INTEGER' }],
                rows: [{ n: 1 }, { n: 2 }],
            })),
        });
        const result = await executeTool('runQuery', { sql: 'SELECT n FROM t' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.rows).toHaveLength(2);
            expect(result.data.columns[0].name).toBe('n');
        }
    });

    it('rejects SQL containing $ai_providers', async () => {
        const result = await executeTool('runQuery', { sql: 'SELECT * FROM $ai_providers' }, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('$ai_providers');
    });

    it('uses the declared limit in the response', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async (_sql: string, opts?: { limit?: number }) => ({
                columns: [],
                rows: Array.from({ length: opts?.limit ?? 0 }, (_, i) => ({ i })),
            })),
        });
        const result = await executeTool('runQuery', { sql: 'SELECT 1', limit: 50 }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.limit).toBe(50);
    });

    it('marks truncated=true when more rows than limit', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'n', type: 'INTEGER' }],
                rows: Array.from({ length: 102 }, (_, i) => ({ n: i })),
            })),
        });
        const result = await executeTool('runQuery', { sql: 'SELECT n FROM t', limit: 100 }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.truncated).toBe(true);
            expect(result.data.rows).toHaveLength(100);
        }
    });
});

// ── listPlots ─────────────────────────────────────────────────────────────────

describe('executeTool — listPlots', () => {
    it('delegates to listPlotsInNotebook', async () => {
        const plots = [{ id: 'c1', name: 'GC', config: 'BAR_CHART()' }];
        const deps = mockDeps({ listPlotsInNotebook: vi.fn(() => plots) });
        const result = await executeTool('listPlots', {}, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.plots).toEqual(plots);
    });
});

// ── addCell ───────────────────────────────────────────────────────────────────

describe('executeTool — addCell', () => {
    it('requires approval and returns cellId on success', async () => {
        const deps = mockDeps();
        const result = await executeTool('addCell', { type: 'sql', content: 'SELECT 1' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.requireApproval).toHaveBeenCalledWith('addCell', { type: 'sql', content: 'SELECT 1' });
        if (result.ok) expect(result.data.cellId).toBeDefined();
    });

    it('returns error when user declines approval', async () => {
        const deps = mockDeps({
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const result = await executeTool('addCell', { type: 'sql', content: 'SELECT 1' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('rejected');
    });

    it('returns error for multiple SQL statements in sql cell', async () => {
        const deps = mockDeps();
        const multiSql = 'SELECT 1; SELECT 2';
        const result = await executeTool('addCell', { type: 'sql', content: multiSql }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('statement');
    });

    it('allows multiple statements in markdown cell', async () => {
        const deps = mockDeps();
        const result = await executeTool('addCell', { type: 'markdown', content: 'SELECT 1; SELECT 2' }, deps);
        expect(result.ok).toBe(true);
    });
});

// ── editCell ──────────────────────────────────────────────────────────────────

describe('executeTool — editCell', () => {
    it('calls mutateCells with edit op', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'c1', type: 'markdown' as const, content: 'old' }]),
        });
        const result = await executeTool('editCell', { cellId: 'c1', content: 'new content' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.mutateCells).toHaveBeenCalledWith({ kind: 'edit', cellId: 'c1', content: 'new content' });
    });

    it('rejects multi-statement SQL in a sql cell edit', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'sql1', type: 'sql' as const, content: 'SELECT 1' }]),
        });
        const result = await executeTool('editCell', { cellId: 'sql1', content: 'SELECT 1; SELECT 2' }, deps);
        expect(result.ok).toBe(false);
    });
});

// ── listVariables ─────────────────────────────────────────────────────────────

describe('executeTool — listVariables', () => {
    it('returns variables from getVariables', async () => {
        const deps = mockDeps({ getVariables: vi.fn(() => ({ limit: '100', offset: '0' })) });
        const result = await executeTool('listVariables', {}, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.variables).toEqual({ limit: '100', offset: '0' });
        }
    });
});

// ── setVariable ───────────────────────────────────────────────────────────────

describe('executeTool — setVariable', () => {
    it('calls setVariables with updated map', async () => {
        const deps = mockDeps({
            getVariables: vi.fn(() => ({ existing: 'val' })),
            setVariables: vi.fn(async () => ({ ok: true as const })),
        });
        const result = await executeTool('setVariable', { name: 'limit', value: '50' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.setVariables).toHaveBeenCalledWith({ existing: 'val', limit: '50' });
    });
});

// ── listCells / readCell ──────────────────────────────────────────────────────

describe('executeTool — listCells', () => {
    it('returns cell list with content preview', async () => {
        const cells = [{ id: 'c1', type: 'sql' as const, content: 'SELECT * FROM events LIMIT 10' }];
        const deps = mockDeps({ listCells: vi.fn(() => cells) });
        const result = await executeTool('listCells', {}, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.cells).toHaveLength(1);
            expect(result.data.cells[0].id).toBe('c1');
        }
    });
});

describe('executeTool — readCell', () => {
    it('returns full content of a cell', async () => {
        const cells = [{ id: 'c1', type: 'sql' as const, content: 'SELECT 1' }];
        const deps = mockDeps({ listCells: vi.fn(() => cells) });
        const result = await executeTool('readCell', { cellId: 'c1' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.content).toBe('SELECT 1');
        }
    });

    it('returns error for unknown cellId', async () => {
        const deps = mockDeps({ listCells: vi.fn(() => []) });
        const result = await executeTool('readCell', { cellId: 'missing' }, deps);
        expect(result.ok).toBe(false);
    });
});

// ── previewPlot ───────────────────────────────────────────────────────────────

describe('executeTool — previewPlot', () => {
    it('returns previewId and data on success', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'x', type: 'VARCHAR' }, { name: 'y', type: 'INTEGER' }],
                rows: [{ x: 'a', y: 1 }],
            })),
        });
        const result = await executeTool('previewPlot', {
            sql: 'SELECT x, y FROM t',
            plotConfig: 'BAR_CHART(x: "x", y: ["y"])',
        }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.previewId).toBeDefined();
            expect(result.data.plotConfig).toBe('BAR_CHART(x: "x", y: ["y"])');
        }
    });

    it('rejects invalid plot DSL', async () => {
        const deps = mockDeps();
        const result = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'NOT_A_PLOT_CONFIG',
        }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('plot DSL');
    });

    it('rejects when visibility is no-data', async () => {
        const deps = mockDeps({ getVisibility: vi.fn(() => 'no-data' as const) });
        const result = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'TABLE()',
        }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('no-data');
    });
});
