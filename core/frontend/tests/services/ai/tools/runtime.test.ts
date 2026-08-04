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
        if (!result.ok) expect((result as any).error).toContain('noSuchTool');
    });
});

// ── validation ────────────────────────────────────────────────────────────────

describe('executeTool — validation', () => {
    it('returns error when required args are missing', async () => {
        const result = await executeTool('runQuery', {}, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('sql');
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
        if (!result.ok) expect((result as any).error).toContain('$ai_providers');
    });

    it('rejects SQL containing quoted "$ai_providers"', async () => {
        const result = await executeTool('runQuery', { sql: 'SELECT * FROM "$ai_providers"' }, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('$ai_providers');
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
        if (!result.ok) expect((result as any).error).toContain('rejected');
    });

    it('returns error for multiple SQL statements in sql cell', async () => {
        const deps = mockDeps();
        const multiSql = 'SELECT 1; SELECT 2';
        const result = await executeTool('addCell', { type: 'sql', content: multiSql }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('statement');
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
        if (!result.ok) expect((result as any).error).toContain('plot DSL');
    });

    it('rejects when visibility is no-data', async () => {
        const deps = mockDeps({ getVisibility: vi.fn(() => 'no-data' as const) });
        const result = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'TABLE()',
        }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('no-data');
    });
});

// ── deleteCell ────────────────────────────────────────────────────────────────

describe('executeTool — deleteCell', () => {
    it('calls mutateCells with delete op and returns cellId', async () => {
        const deps = mockDeps();
        const result = await executeTool('deleteCell', { cellId: 'c1' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.mutateCells).toHaveBeenCalledWith({ kind: 'delete', cellId: 'c1' });
        if (result.ok) expect(result.data.cellId).toBe('c1');
    });

    it('requires approval', async () => {
        const deps = mockDeps();
        await executeTool('deleteCell', { cellId: 'c1' }, deps);
        expect(deps.requireApproval).toHaveBeenCalledWith('deleteCell', { cellId: 'c1' });
    });
});

// ── moveCell ──────────────────────────────────────────────────────────────────

describe('executeTool — moveCell', () => {
    it('calls mutateCells with move op', async () => {
        const deps = mockDeps();
        const result = await executeTool('moveCell', {
            cellId: 'c1',
            targetCellId: 'c2',
            position: 'after',
        }, deps);
        expect(result.ok).toBe(true);
        expect(deps.mutateCells).toHaveBeenCalledWith({
            kind: 'move',
            cellId: 'c1',
            targetCellId: 'c2',
            position: 'after',
        });
    });

    it('returns error for invalid position', async () => {
        const deps = mockDeps();
        const result = await executeTool('moveCell', {
            cellId: 'c1',
            targetCellId: 'c2',
            position: 'sideways',
        }, deps);
        expect(result.ok).toBe(false);
    });
});

// ── rememberFact / recallMemory ───────────────────────────────────────────────

describe('executeTool — rememberFact', () => {
    it('calls setMemory and returns stored key', async () => {
        const deps = mockDeps();
        const result = await executeTool('rememberFact', { key: 'cpu_count', value: '8' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.setMemory).toHaveBeenCalledWith('cpu_count', '8');
        if (result.ok) expect(result.data.stored).toBe('cpu_count');
    });

    it('returns error when setMemory not provided', async () => {
        const deps = mockDeps({ setMemory: undefined });
        const result = await executeTool('rememberFact', { key: 'k', value: 'v' }, deps);
        expect(result.ok).toBe(false);
    });
});

describe('executeTool — recallMemory', () => {
    it('returns current memory facts', async () => {
        const deps = mockDeps({ getMemory: vi.fn(() => ({ cpu_count: '8', gc_target: 'G1' })) });
        const result = await executeTool('recallMemory', {}, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ cpu_count: '8', gc_target: 'G1' });
        }
    });

    it('returns error when getMemory not provided', async () => {
        const deps = mockDeps({ getMemory: undefined });
        const result = await executeTool('recallMemory', {}, deps);
        expect(result.ok).toBe(false);
    });
});

// ── updateTaskList ────────────────────────────────────────────────────────────

describe('executeTool — updateTaskList', () => {
    it('calls setTaskList and returns updated count', async () => {
        const tasks = [{ id: '1', text: 'Run query', done: false }];
        const deps = mockDeps();
        const result = await executeTool('updateTaskList', { tasks }, deps);
        expect(result.ok).toBe(true);
        expect(deps.setTaskList).toHaveBeenCalledWith(tasks);
        if (result.ok) expect(result.data.updated).toBe(1);
    });

    it('accepts empty tasks array to clear list', async () => {
        const deps = mockDeps();
        const result = await executeTool('updateTaskList', { tasks: [] }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.updated).toBe(0);
    });

    it('returns error when setTaskList not provided', async () => {
        const deps = mockDeps({ setTaskList: undefined });
        const result = await executeTool('updateTaskList', { tasks: [] }, deps);
        expect(result.ok).toBe(false);
    });
});

// ── deleteVariable ────────────────────────────────────────────────────────────

describe('executeTool — deleteVariable', () => {
    it('removes the variable and returns success', async () => {
        const deps = mockDeps({
            getVariables: vi.fn(() => ({ limit: '100', offset: '0' })),
            setVariables: vi.fn(async () => ({ ok: true as const })),
        });
        const result = await executeTool('deleteVariable', { name: 'limit' }, deps);
        expect(result.ok).toBe(true);
        expect(deps.setVariables).toHaveBeenCalledWith({ offset: '0' });
    });

    it('is a no-op when variable does not exist', async () => {
        const deps = mockDeps({
            getVariables: vi.fn(() => ({ offset: '0' })),
            setVariables: vi.fn(async () => ({ ok: true as const })),
        });
        const result = await executeTool('deleteVariable', { name: 'nonexistent' }, deps);
        expect(result.ok).toBe(true);
    });
});

// ── describeTable ─────────────────────────────────────────────────────────────

describe('executeTool — describeTable', () => {
    it('calls duckdbQuery with DESCRIBE and returns columns', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'column_name', type: 'VARCHAR' }, { name: 'column_type', type: 'VARCHAR' }],
                rows: [{ column_name: 'ts', column_type: 'BIGINT' }],
            })),
        });
        const result = await executeTool('describeTable', { name: 'events' }, deps);
        expect(result.ok).toBe(true);
        expect((deps.duckdbQuery as any).mock.calls[0][0]).toContain('DESCRIBE');
        if (result.ok) expect(Array.isArray(result.data.columns)).toBe(true);
    });

    it('rejects table names containing $ai_providers', async () => {
        const deps = mockDeps();
        const result = await executeTool('describeTable', { name: '$ai_providers' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('$ai_providers');
    });
});

// ── sampleRows ────────────────────────────────────────────────────────────────

describe('executeTool — sampleRows', () => {
    it('queries the table and returns columns and rows', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'ts', type: 'BIGINT' }],
                rows: [{ ts: 1000 }],
            })),
        });
        const result = await executeTool('sampleRows', { name: 'events' }, deps);
        expect(result.ok).toBe(true);
        expect((deps.duckdbQuery as any).mock.calls[0][0]).toContain('SELECT *');
        if (result.ok) {
            expect(result.data.columns).toBeDefined();
            expect(result.data.rows).toBeDefined();
        }
    });

    it('uses default limit 10 when no limit provided', async () => {
        const deps = mockDeps();
        const result = await executeTool('sampleRows', { name: 'events' }, deps);
        expect(result.ok).toBe(true);
        const sql: string = (deps.duckdbQuery as any).mock.calls[0][0];
        expect(sql).toContain('LIMIT 10');
    });

    it('rejects table names containing $ai_providers', async () => {
        const result = await executeTool('sampleRows', { name: '$ai_providers' }, mockDeps());
        expect(result.ok).toBe(false);
    });
});

// ── applyPlot ─────────────────────────────────────────────────────────────────

describe('executeTool — applyPlot', () => {
    it('calls mutateCells with applyPlot op and returns cellId', async () => {
        const deps = mockDeps();
        const result = await executeTool('applyPlot', {
            cellId: 'c1',
            plotConfig: 'BAR_CHART(x: "ts", y: ["n"])',
        }, deps);
        expect(result.ok).toBe(true);
        expect(deps.mutateCells).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'applyPlot',
            cellId: 'c1',
        }));
        if (result.ok) expect(result.data.cellId).toBe('c1');
    });

    it('uses plotBlockIndex 0 as default', async () => {
        const deps = mockDeps();
        await executeTool('applyPlot', { cellId: 'c1', plotConfig: 'TABLE()' }, deps);
        expect(deps.mutateCells).toHaveBeenCalledWith(expect.objectContaining({
            plotBlockIndex: 0,
        }));
    });
});

// ── screenshotPlot ────────────────────────────────────────────────────────────

describe('executeTool — screenshotPlot', () => {
    it('returns error when screenshotPreview not provided', async () => {
        const result = await executeTool('screenshotPlot', { previewId: 'p1' }, mockDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('not supported');
    });

    it('returns error when provider does not support images', async () => {
        const deps = mockDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,...'),
            providerSupportsImages: vi.fn(() => false),
        });
        const result = await executeTool('screenshotPlot', { previewId: 'p1' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('not supported by the current AI provider');
    });

    it('returns error when visibility is not full', async () => {
        const deps = mockDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,...'),
            providerSupportsImages: vi.fn(() => true),
            getVisibility: vi.fn(() => 'sanitized' as const),
        });
        const result = await executeTool('screenshotPlot', { previewId: 'p1' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain("full");
    });

    it('returns image data when all conditions are met', async () => {
        const deps = mockDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,abc123'),
            providerSupportsImages: vi.fn(() => true),
            getVisibility: vi.fn(() => 'full' as const),
        });
        const result = await executeTool('screenshotPlot', { previewId: 'p1' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.image.dataUrl).toBe('data:image/png;base64,abc123');
    });

    it('returns error when no preview found for given id', async () => {
        const deps = mockDeps({
            screenshotPreview: vi.fn(async () => null),
            providerSupportsImages: vi.fn(() => true),
        });
        const result = await executeTool('screenshotPlot', { previewId: 'missing' }, deps);
        expect(result.ok).toBe(false);
    });
});

// ── explainCell ───────────────────────────────────────────────────────────────

describe('executeTool — explainCell', () => {
    it('returns cell content and instruction for a sql cell', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'c1', type: 'sql' as const, content: 'SELECT * FROM events' }]),
        });
        const result = await executeTool('explainCell', { cellId: 'c1' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.content).toBe('SELECT * FROM events');
            expect(result.data.cellType).toBe('sql');
            expect(typeof result.data.instruction).toBe('string');
        }
    });

    it('returns appropriate instruction for a markdown cell', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'md1', type: 'markdown' as const, content: '# Header' }]),
        });
        const result = await executeTool('explainCell', { cellId: 'md1' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.cellType).toBe('markdown');
    });

    it('returns error when cell not found', async () => {
        const deps = mockDeps({ listCells: vi.fn(() => []) });
        const result = await executeTool('explainCell', { cellId: 'missing' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('not found');
    });
});

// ── suggestPlot ───────────────────────────────────────────────────────────────

describe('executeTool — suggestPlot', () => {
    it('returns column info string and instruction for a sql cell', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'c1', type: 'sql' as const, content: 'SELECT ts, n FROM events' }]),
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'ts', type: 'BIGINT' }, { name: 'n', type: 'INTEGER' }],
                rows: [],
            })),
        });
        const result = await executeTool('suggestPlot', { cellId: 'c1' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.cellId).toBe('c1');
            expect(typeof result.data.columns).toBe('string');
            expect(typeof result.data.instruction).toBe('string');
        }
    });

    it('returns error for a non-sql cell', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'md1', type: 'markdown' as const, content: '# Header' }]),
        });
        const result = await executeTool('suggestPlot', { cellId: 'md1' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('not a SQL cell');
    });

    it('returns error when cell not found', async () => {
        const deps = mockDeps({ listCells: vi.fn(() => []) });
        const result = await executeTool('suggestPlot', { cellId: 'missing' }, deps);
        expect(result.ok).toBe(false);
    });

    it('rejects sql containing $ai_providers', async () => {
        const deps = mockDeps({
            listCells: vi.fn(() => [{ id: 'c1', type: 'sql' as const, content: 'SELECT * FROM $ai_providers' }]),
        });
        const result = await executeTool('suggestPlot', { cellId: 'c1' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('$ai_providers');
    });
});

// ── query_data (legacy alias) ─────────────────────────────────────────────────

describe('executeTool — query_data (legacy alias)', () => {
    it('runs the query and returns columns + rows', async () => {
        const mockRows = [{ id: 1 }, { id: 2 }];
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'id', type: 'INTEGER' }],
                rows: mockRows,
            })),
        });
        const result = await executeTool(
            'query_data',
            { sql: 'SELECT id FROM events', reason: 'find ids', tables: ['events'] },
            deps,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.columns).toEqual(['id']);
            expect(result.data.rows).toEqual(mockRows);
        }
    });

    it('returns ok:false when duckdbQuery throws', async () => {
        const deps = mockDeps({
            duckdbQuery: vi.fn(async () => { throw new Error('table not found'); }),
        });
        const result = await executeTool(
            'query_data',
            { sql: 'SELECT 1', reason: 'test', tables: [] },
            deps,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect((result as any).error).toContain('table not found');
    });

    it('calls checkQueryPermission when provided', async () => {
        const checkQueryPermission = vi.fn(async () => {});
        const deps = mockDeps({
            checkQueryPermission,
            duckdbQuery: vi.fn(async () => ({ columns: [], rows: [] })),
        });
        await executeTool(
            'query_data',
            { sql: 'SELECT 1', reason: 'test', tables: ['t'] },
            deps,
        );
        expect(checkQueryPermission).toHaveBeenCalledWith(
            expect.objectContaining({ sql: 'SELECT 1', tables: ['t'] }),
        );
    });
});
