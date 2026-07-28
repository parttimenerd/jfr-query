// C3 — Tool runtime + adapter round-trip tests.
//
// Covers:
//  - Input schema validation for each tool (happy path).
//  - Approval gate behaviour for mutate tools (rejection → structured error).
//  - executeTool('runQuery', …) returns rows via injected duckdbQuery.
//  - Forbidden-token (`$ai_providers`) is rejected before running.
//  - Per-provider adapter round-trips: tools wire shape + tool_call parsing.

import { describe, it, expect, vi } from 'vitest';
import { TOOLS, getTool, validateToolArgs } from '../../services/ai/tools';
import { executeTool, type ToolDeps } from '../../services/ai/tools/runtime';
import { toolsToOpenAi, parseOpenAiToolCalls } from '../../services/ai/tools/openaiAdapter';
import { toolsToAnthropic, parseAnthropicToolCalls } from '../../services/ai/tools/anthropicAdapter';
import { toolsToGemini, parseGeminiToolCalls } from '../../services/ai/tools/geminiAdapter';
import { toolsToLocal, parseLocalToolCalls } from '../../services/ai/tools/localAdapter';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn(async (_sql: string, _opts?: any) => ({
            columns: [{ name: 'col', type: 'INTEGER' }],
            rows: [{ col: 1 }, { col: 2 }],
        })),
        listCells: vi.fn(() => []),
        mutateCells: vi.fn(async () => ({ ok: true as const, cellId: 'new-cell' })),
        listPlotsInNotebook: vi.fn(() => []),
        requireApproval: vi.fn(async () => undefined),
        ...overrides,
    };
}

function makeDepsWithVars(initial: Record<string, string>, overrides: Partial<ToolDeps> = {}): {
    deps: ToolDeps;
    vars: { current: Record<string, string> };
    setSpy: ReturnType<typeof vi.fn>;
} {
    const vars = { current: { ...initial } };
    const setSpy = vi.fn(async (next: Record<string, string>) => {
        vars.current = next;
        return { ok: true as const };
    });
    const deps: ToolDeps = {
        ...makeDeps(),
        getVariables: () => vars.current,
        setVariables: setSpy,
        ...overrides,
    };
    return { deps, vars, setSpy };
}

describe('tool schema validation', () => {
    it('runQuery accepts a valid SQL string', () => {
        const t = getTool('runQuery')!;
        expect(validateToolArgs(t, { sql: 'SELECT 1' })).toBeNull();
    });
    it('describeTable accepts a valid table name', () => {
        const t = getTool('describeTable')!;
        expect(validateToolArgs(t, { name: 'foo' })).toBeNull();
    });
    it('sampleRows accepts name + limit within range', () => {
        const t = getTool('sampleRows')!;
        expect(validateToolArgs(t, { name: 'foo', limit: 10 })).toBeNull();
    });
    it('sampleRows rejects limit above maximum', () => {
        const t = getTool('sampleRows')!;
        const err = validateToolArgs(t, { name: 'foo', limit: 9999 });
        expect(err).toMatch(/exceeds maximum/);
    });
    it('addCell rejects an invalid type enum', () => {
        const t = getTool('addCell')!;
        const err = validateToolArgs(t, { type: 'bogus', content: 'x' });
        expect(err).toMatch(/must be one of/);
    });
    it('editCell requires cellId and content', () => {
        const t = getTool('editCell')!;
        expect(validateToolArgs(t, { cellId: 'c1' })).toMatch(/missing required field: content/);
    });
    it('applyPlot accepts a cellId and plotConfig', () => {
        const t = getTool('applyPlot')!;
        expect(validateToolArgs(t, { cellId: 'c1', plotConfig: 'TABLE()' })).toBeNull();
    });
    it('listPlots takes no required input', () => {
        const t = getTool('listPlots')!;
        expect(validateToolArgs(t, {})).toBeNull();
    });
});

describe('executeTool', () => {
    it('runQuery returns columns and rows via injected duckdbQuery', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT 1' }, deps);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.data.columns).toEqual([{ name: 'col', type: 'INTEGER' }]);
            expect(res.data.rows).toHaveLength(2);
        }
        expect(deps.duckdbQuery).toHaveBeenCalledWith('SELECT 1', { limit: 101 });
    });

    it('runQuery rejects SQL with $ai_providers and does NOT execute', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM $ai_providers.foo' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/\$ai_providers.*sensitive/);
        expect(deps.duckdbQuery).not.toHaveBeenCalled();
    });

    it('runQuery rejects SQL with $AI_PROVIDERS (case-insensitive) before executing', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM $AI_PROVIDERS.bar' }, deps);
        expect(res.ok).toBe(false);
        expect(deps.duckdbQuery).not.toHaveBeenCalled();
    });

    it('runQuery rejects SQL with bracket-quoted [$ai_providers] (T-SQL) before executing', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM [$ai_providers]' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/\$ai_providers.*sensitive/);
        expect(deps.duckdbQuery).not.toHaveBeenCalled();
    });

    it('runQuery rejects SQL with backtick-quoted `$ai_providers` (MySQL) before executing', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM `$ai_providers`' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/\$ai_providers.*sensitive/);
        expect(deps.duckdbQuery).not.toHaveBeenCalled();
    });

    it('mutate tools call requireApproval BEFORE executing the mutation', async () => {
        const order: string[] = [];
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { order.push('approve'); }),
            mutateCells: vi.fn(async () => { order.push('mutate'); return { ok: true as const, cellId: 'x' }; }),
        });
        await executeTool('addCell', { type: 'sql', content: 'SELECT 1' }, deps);
        expect(order).toEqual(['approve', 'mutate']);
    });

    it('mutate tools surface a structured error when the user rejects approval', async () => {
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const res = await executeTool('addCell', { type: 'sql', content: 'SELECT 1' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toBe('rejected by user');
        expect(deps.mutateCells).not.toHaveBeenCalled();
    });

    it('editCell rejection short-circuits without calling mutateCells', async () => {
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const res = await executeTool('editCell', { cellId: 'c1', content: 'new' }, deps);
        expect(res.ok).toBe(false);
        expect(deps.mutateCells).not.toHaveBeenCalled();
    });

    it('applyPlot rejection short-circuits without calling mutateCells', async () => {
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const res = await executeTool('applyPlot', { cellId: 'c1', plotConfig: 'TABLE()' }, deps);
        expect(res.ok).toBe(false);
        expect(deps.mutateCells).not.toHaveBeenCalled();
    });

    it('describeTable invokes DESCRIBE via duckdbQuery', async () => {
        const deps = makeDeps();
        await executeTool('describeTable', { name: 'foo' }, deps);
        expect(deps.duckdbQuery).toHaveBeenCalledWith('DESCRIBE "foo"');
    });

    it('sampleRows applies the runtime LIMIT cap to the SQL', async () => {
        const deps = makeDeps();
        await executeTool('sampleRows', { name: 'foo', limit: 100 }, deps);
        expect(deps.duckdbQuery).toHaveBeenCalledWith('SELECT * FROM "foo" LIMIT 100');
    });

    it('listPlots returns plots from the notebook', async () => {
        const deps = makeDeps({
            listPlotsInNotebook: () => [{ id: 'p1', name: 'p1', config: 'TABLE()' }],
        });
        const res = await executeTool('listPlots', {}, deps);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.data.plots).toHaveLength(1);
    });

    it('applyPlot forwards plotBlockIndex 0 by default when not supplied', async () => {
        const deps = makeDeps();
        await executeTool('applyPlot', { cellId: 'c1', plotConfig: 'LINE_CHART(x: t, y: v)' }, deps);
        expect(deps.mutateCells).toHaveBeenCalledWith({
            kind: 'applyPlot',
            cellId: 'c1',
            plotConfig: 'LINE_CHART(x: t, y: v)',
            plotBlockIndex: 0,
        });
    });

    it('applyPlot forwards explicit plotBlockIndex to mutateCells', async () => {
        const deps = makeDeps();
        await executeTool('applyPlot', { cellId: 'c1', plotConfig: 'BAR_CHART(x: cat, y: [])', plotBlockIndex: 2 }, deps);
        expect(deps.mutateCells).toHaveBeenCalledWith({
            kind: 'applyPlot',
            cellId: 'c1',
            plotConfig: 'BAR_CHART(x: cat, y: [])',
            plotBlockIndex: 2,
        });
    });

    it('unknown tool returns a structured error', async () => {
        const deps = makeDeps();
        const res = await executeTool('nonExistent', {}, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/not available/);
    });

    it('listCells returns id/type/contentPreview/contentLength for each cell', async () => {
        const longBody = 'x'.repeat(500);
        const deps = makeDeps({
            listCells: () => [
                { id: 'c1', type: 'sql', content: 'SELECT 1' },
                { id: 'c2', type: 'markdown', content: longBody },
            ],
        });
        const res = await executeTool('listCells', {}, deps);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.data.cells).toHaveLength(2);
            expect(res.data.cells[0]).toEqual({
                id: 'c1', type: 'sql', contentPreview: 'SELECT 1', contentLength: 8,
            });
            expect(res.data.cells[1].contentPreview).toHaveLength(201); // 200 chars + ellipsis
            expect(res.data.cells[1].contentPreview.endsWith('…')).toBe(true);
            expect(res.data.cells[1].contentLength).toBe(500);
        }
    });

    it('readCell returns the full content of a single cell', async () => {
        const deps = makeDeps({
            listCells: () => [
                { id: 'c1', type: 'sql', content: 'SELECT 1' },
                { id: 'c2', type: 'markdown', content: '# Heading' },
            ],
        });
        const res = await executeTool('readCell', { cellId: 'c2' }, deps);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.data).toEqual({ id: 'c2', type: 'markdown', content: '# Heading' });
        }
    });

    it('readCell returns an error when the cell id is unknown', async () => {
        const deps = makeDeps({ listCells: () => [] });
        const res = await executeTool('readCell', { cellId: 'missing' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/cell not found/);
    });

    it('deleteCell calls requireApproval before mutating', async () => {
        const order: string[] = [];
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { order.push('approve'); }),
            mutateCells: vi.fn(async () => { order.push('mutate'); return { ok: true as const, cellId: 'c1' }; }),
        });
        await executeTool('deleteCell', { cellId: 'c1' }, deps);
        expect(order).toEqual(['approve', 'mutate']);
        expect(deps.mutateCells).toHaveBeenCalledWith({ kind: 'delete', cellId: 'c1' });
    });

    it('deleteCell rejection short-circuits without calling mutateCells', async () => {
        const deps = makeDeps({
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const res = await executeTool('deleteCell', { cellId: 'c1' }, deps);
        expect(res.ok).toBe(false);
        expect(deps.mutateCells).not.toHaveBeenCalled();
    });

    it('moveCell forwards cellId/targetCellId/position to mutateCells', async () => {
        const deps = makeDeps();
        await executeTool('moveCell', { cellId: 'c1', targetCellId: 'c2', position: 'before' }, deps);
        expect(deps.mutateCells).toHaveBeenCalledWith({
            kind: 'move',
            cellId: 'c1',
            targetCellId: 'c2',
            position: 'before',
        });
    });

    it('moveCell rejects an invalid position via schema validation', () => {
        const t = getTool('moveCell')!;
        const err = validateToolArgs(t, { cellId: 'c1', targetCellId: 'c2', position: 'sideways' });
        expect(err).toMatch(/must be one of/);
    });

    // ───────────── Variable tools ─────────────

    it('listVariables returns the deps current variables map', async () => {
        const { deps } = makeDepsWithVars({ session_start: '2024-01-01', threshold: '100' });
        const res = await executeTool('listVariables', {}, deps);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.data.variables).toEqual({ session_start: '2024-01-01', threshold: '100' });
        }
    });

    it('listVariables returns an empty object when no vars are set', async () => {
        const { deps } = makeDepsWithVars({});
        const res = await executeTool('listVariables', {}, deps);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.data.variables).toEqual({});
    });

    it('listVariables returns an error when deps does not provide getVariables', async () => {
        const deps = makeDeps(); // no getVariables
        const res = await executeTool('listVariables', {}, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/variables not supported/);
    });

    it('setVariable requires approval before mutating', async () => {
        const order: string[] = [];
        const { deps } = makeDepsWithVars({}, {
            requireApproval: vi.fn(async () => { order.push('approve'); }),
        });
        // Wrap setVariables to track ordering
        const origSet = deps.setVariables!;
        deps.setVariables = async (next) => { order.push('set'); return origSet(next); };
        await executeTool('setVariable', { name: 'k', value: 'v' }, deps);
        expect(order).toEqual(['approve', 'set']);
    });

    it('setVariable rejection short-circuits without calling setVariables', async () => {
        const { deps, setSpy } = makeDepsWithVars({ k: 'old' }, {
            requireApproval: vi.fn(async () => { throw new Error('rejected by user'); }),
        });
        const res = await executeTool('setVariable', { name: 'k', value: 'new' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toBe('rejected by user');
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('setVariable MERGES {name: value} into the current map (does not replace it)', async () => {
        const { deps, vars, setSpy } = makeDepsWithVars({ a: '1', b: '2' });
        const res = await executeTool('setVariable', { name: 'c', value: '3' }, deps);
        expect(res.ok).toBe(true);
        // setVariables was called with the full merged map
        expect(setSpy).toHaveBeenCalledWith({ a: '1', b: '2', c: '3' });
        expect(vars.current).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('setVariable overwrites an existing key', async () => {
        const { deps, vars } = makeDepsWithVars({ a: '1' });
        await executeTool('setVariable', { name: 'a', value: '99' }, deps);
        expect(vars.current).toEqual({ a: '99' });
    });

    it('setVariable rejects an empty name', async () => {
        const { deps, setSpy } = makeDepsWithVars({});
        const res = await executeTool('setVariable', { name: '', value: 'v' }, deps);
        expect(res.ok).toBe(false);
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('deleteVariable requires approval before mutating', async () => {
        const order: string[] = [];
        const { deps } = makeDepsWithVars({ k: 'v' }, {
            requireApproval: vi.fn(async () => { order.push('approve'); }),
        });
        const origSet = deps.setVariables!;
        deps.setVariables = async (next) => { order.push('set'); return origSet(next); };
        await executeTool('deleteVariable', { name: 'k' }, deps);
        expect(order).toEqual(['approve', 'set']);
    });

    it('deleteVariable removes the named key from the map', async () => {
        const { deps, vars, setSpy } = makeDepsWithVars({ a: '1', b: '2', c: '3' });
        const res = await executeTool('deleteVariable', { name: 'b' }, deps);
        expect(res.ok).toBe(true);
        expect(setSpy).toHaveBeenCalledWith({ a: '1', c: '3' });
        expect(vars.current).toEqual({ a: '1', c: '3' });
    });

    it('deleteVariable is a no-op (no setVariables call) when the key does not exist', async () => {
        const { deps, setSpy } = makeDepsWithVars({ a: '1' });
        const res = await executeTool('deleteVariable', { name: 'missing' }, deps);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.data.deleted).toBe(false);
        expect(setSpy).not.toHaveBeenCalled();
    });
});

describe('adapter round-trips: OpenAI', () => {
    it('toolsToOpenAi produces the function-tool wire shape', () => {
        const wire = toolsToOpenAi(TOOLS);
        expect(wire[0]).toMatchObject({
            type: 'function',
            function: { name: 'runQuery', parameters: { type: 'object' } },
        });
    });
    it('includes the new previewPlot and screenshotPlot tools', () => {
        const wire = toolsToOpenAi(TOOLS);
        const names = wire.map((w: any) => w.function?.name);
        expect(names).toContain('previewPlot');
        expect(names).toContain('screenshotPlot');
        const preview = wire.find((w: any) => w.function?.name === 'previewPlot');
        expect(preview.function.parameters.required).toEqual(expect.arrayContaining(['sql', 'plotConfig']));
        const shot = wire.find((w: any) => w.function?.name === 'screenshotPlot');
        expect(shot.function.parameters.required).toEqual(['previewId']);
    });
    it('parseOpenAiToolCalls extracts {name, args} from a tool_calls message', () => {
        const sampleMessage = {
            tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'runQuery', arguments: '{"sql":"SELECT 1"}' } },
            ],
        };
        const parsed = parseOpenAiToolCalls(sampleMessage);
        expect(parsed).toEqual([{ id: 'call_1', name: 'runQuery', args: { sql: 'SELECT 1' } }]);
    });
});

describe('adapter round-trips: Anthropic', () => {
    it('toolsToAnthropic produces { name, description, input_schema }', () => {
        const wire = toolsToAnthropic(TOOLS);
        expect(wire[0]).toMatchObject({ name: 'runQuery', input_schema: { type: 'object' } });
        expect(wire[0]).not.toHaveProperty('type');
    });
    it('includes the new previewPlot and screenshotPlot tools', () => {
        const wire = toolsToAnthropic(TOOLS);
        const names = wire.map((w: any) => w.name);
        expect(names).toContain('previewPlot');
        expect(names).toContain('screenshotPlot');
        const preview = wire.find((w: any) => w.name === 'previewPlot');
        expect(preview.input_schema.required).toEqual(expect.arrayContaining(['sql', 'plotConfig']));
    });
    it('parseAnthropicToolCalls extracts {name, args} from tool_use blocks', () => {
        const sampleContent = [
            { type: 'text', text: 'sure' },
            { type: 'tool_use', id: 'toolu_1', name: 'runQuery', input: { sql: 'SELECT 2' } },
        ];
        const parsed = parseAnthropicToolCalls(sampleContent);
        expect(parsed).toEqual([{ id: 'toolu_1', name: 'runQuery', args: { sql: 'SELECT 2' } }]);
    });
});

describe('adapter round-trips: Gemini', () => {
    it('toolsToGemini wraps functions in functionDeclarations', () => {
        const wire = toolsToGemini(TOOLS);
        expect(wire.functionDeclarations[0]).toMatchObject({ name: 'runQuery' });
    });
    it('includes the new previewPlot and screenshotPlot tools', () => {
        const wire = toolsToGemini(TOOLS);
        const names = wire.functionDeclarations.map((d: any) => d.name);
        expect(names).toContain('previewPlot');
        expect(names).toContain('screenshotPlot');
    });
    it('parseGeminiToolCalls extracts {name, args} from functionCall parts', () => {
        const sampleParts = [
            { text: 'ok' },
            { functionCall: { name: 'runQuery', args: { sql: 'SELECT 3' } } },
        ];
        const parsed = parseGeminiToolCalls(sampleParts);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ name: 'runQuery', args: { sql: 'SELECT 3' } });
    });
});

describe('adapter round-trips: Local', () => {
    it('toolsToLocal mirrors the OpenAI wire shape', () => {
        const wire = toolsToLocal(TOOLS);
        expect(wire[0]).toMatchObject({ type: 'function', function: { name: 'runQuery' } });
    });
    it('includes the new previewPlot and screenshotPlot tools', () => {
        const wire = toolsToLocal(TOOLS);
        const names = wire.map((w: any) => w.function?.name);
        expect(names).toContain('previewPlot');
        expect(names).toContain('screenshotPlot');
    });
    it('parseLocalToolCalls handles the structured tool_calls path', () => {
        const msg = {
            tool_calls: [
                { id: 'call_x', type: 'function', function: { name: 'runQuery', arguments: '{"sql":"SELECT 4"}' } },
            ],
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toEqual([{ id: 'call_x', name: 'runQuery', args: { sql: 'SELECT 4' } }]);
    });
    it('parseLocalToolCalls falls back to <tool>…</tool> text scanning', () => {
        const msg = {
            content: 'sure! <tool>{"name":"runQuery","args":{"sql":"SELECT 5"}}</tool>',
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ name: 'runQuery', args: { sql: 'SELECT 5' } });
    });
    it('parseLocalToolCalls parses a ```json fenced block', () => {
        const msg = {
            content: 'I will run:\n```json\n{"name":"runQuery","args":{"sql":"SELECT 6"}}\n```',
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ name: 'runQuery', args: { sql: 'SELECT 6' } });
    });
    it('parseLocalToolCalls parses a bare JSON object when nothing else matches', () => {
        const msg = {
            content: 'Let me check: {"name": "describeTable", "args": {"name": "Foo"}}. That should do it.',
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ name: 'describeTable', args: { name: 'Foo' } });
    });
    it('parseLocalToolCalls accepts `arguments` as an alias for `args`', () => {
        const msg = {
            content: '<tool>{"name":"runQuery","arguments":{"sql":"SELECT 7"}}</tool>',
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ name: 'runQuery', args: { sql: 'SELECT 7' } });
    });
    it('parseLocalToolCalls deduplicates identical calls across formats', () => {
        const msg = {
            content:
                '<tool>{"name":"runQuery","args":{"sql":"SELECT 8"}}</tool>\n' +
                '```json\n{"name":"runQuery","args":{"sql":"SELECT 8"}}\n```',
        };
        const parsed = parseLocalToolCalls(msg);
        expect(parsed).toHaveLength(1);
    });
    it('parseLocalToolCalls is idempotent across repeated invocations (global regex state reset)', () => {
        const msg = { content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 9"}}</tool>' };
        const first = parseLocalToolCalls(msg);
        const second = parseLocalToolCalls(msg);
        expect(first).toEqual(second);
        expect(second).toHaveLength(1);
    });
    it('parseLocalToolCalls returns [] for prose with no tool shape', () => {
        const msg = { content: 'I do not know the answer to that without running a query.' };
        expect(parseLocalToolCalls(msg)).toEqual([]);
    });
});

describe('previewPlot', () => {
    it('returns previewId + rows + plotConfig on a valid call', async () => {
        const deps = makeDeps({
            duckdbQuery: vi.fn(async () => ({
                columns: [{ name: 'x', type: 'INTEGER' }],
                rows: [{ x: 1 }, { x: 2 }, { x: 3 }],
            })),
            getVisibility: () => 'full',
        });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.previewId).toMatch(/^preview-/);
        expect(res.data.rows).toHaveLength(3);
        expect(res.data.plotConfig).toBe('BAR_CHART(x: "x", y: ["x"])');
    });

    it('rejects when visibility is "no-data"', async () => {
        const deps = makeDeps({ getVisibility: () => 'no-data' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/no-data/);
    });

    it('rejects forbidden SQL tokens', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT $ai_providers',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        expect(res.ok).toBe(false);
    });

    it('rejects invalid plot DSL', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'this is not a plot',
        }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/invalid plot DSL/);
    });
});

describe('screenshotPlot', () => {
    it('refuses without a screenshotPreview dep', async () => {
        const deps = makeDeps();
        const res = await executeTool('screenshotPlot', { previewId: 'abc' }, deps);
        expect(res.ok).toBe(false);
    });

    it('refuses when provider does not support image tool results', async () => {
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,AAA'),
            getVisibility: () => 'full',
            providerSupportsImages: () => false,
        });
        const res = await executeTool('screenshotPlot', { previewId: 'abc' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/provider/);
    });

    it('refuses when visibility is not "full"', async () => {
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,AAA'),
            getVisibility: () => 'sanitized',
            providerSupportsImages: () => true,
        });
        const res = await executeTool('screenshotPlot', { previewId: 'abc' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/full/);
    });

    it('refuses when no preview matches the id', async () => {
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => null),
            getVisibility: () => 'full',
            providerSupportsImages: () => true,
        });
        const res = await executeTool('screenshotPlot', { previewId: 'missing' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/no preview found/);
    });

    it('returns the image payload when everything aligns', async () => {
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,AAA'),
            getVisibility: () => 'full',
            providerSupportsImages: () => true,
        });
        const res = await executeTool('screenshotPlot', { previewId: 'preview-xyz' }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.image.mediaType).toBe('image/png');
        expect(res.data.image.dataUrl).toMatch(/^data:image\/png/);
    });

    it('refuses when providerSupportsImages is not wired at all (defense in depth)', async () => {
        // ChatPanel is responsible for supplying providerSupportsImages.
        // If a future call site forgets to, we must NOT silently allow images.
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,AAA'),
            getVisibility: () => 'full',
            // providerSupportsImages intentionally absent
        });
        const res = await executeTool('screenshotPlot', { previewId: 'abc' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/provider/);
    });

    it('rejects when previewId arg is missing (schema validation)', async () => {
        const deps = makeDeps({
            screenshotPreview: vi.fn(async () => 'data:image/png;base64,AAA'),
            getVisibility: () => 'full',
            providerSupportsImages: () => true,
        });
        const res = await executeTool('screenshotPlot', {}, deps);
        expect(res.ok).toBe(false);
    });
});

describe('previewPlot — additional coverage', () => {
    it('rejects an out-of-range limit at the schema layer (max 500)', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
            limit: 9999,
        }, deps);
        expect(res.ok).toBe(false);
    });

    it('applies the limit to the underlying duckdbQuery call', async () => {
        const duckdbQuery = vi.fn(async () => ({
            columns: [{ name: 'x', type: 'INTEGER' }],
            rows: [{ x: 1 }],
        }));
        const deps = makeDeps({ duckdbQuery, getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT x FROM t',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
            limit: 50,
        }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.limit).toBe(50);
        expect(duckdbQuery).toHaveBeenLastCalledWith('SELECT x FROM t', { limit: 51 });
    });

    it('defaults the limit to 200 when not provided', async () => {
        const duckdbQuery = vi.fn(async () => ({
            columns: [{ name: 'x', type: 'INTEGER' }],
            rows: [{ x: 1 }],
        }));
        const deps = makeDeps({ duckdbQuery, getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.limit).toBe(200);
        expect(duckdbQuery).toHaveBeenLastCalledWith('SELECT 1', { limit: 201 });
    });

    it('flags truncation when the dep returns more than the requested limit', async () => {
        const rows = Array.from({ length: 250 }, (_, i) => ({ x: i }));
        const deps = makeDeps({
            duckdbQuery: vi.fn(async () => ({ columns: [{ name: 'x', type: 'INTEGER' }], rows })),
            getVisibility: () => 'full',
        });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT x FROM t',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
            limit: 100,
        }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.limit).toBe(100);
        expect(res.data.rows).toHaveLength(100);
        expect(res.data.returned).toBe(100);
        expect(res.data.truncated).toBe(true);
    });

    it('does not flag truncation when the dep returns exactly the limit', async () => {
        const rows = Array.from({ length: 50 }, (_, i) => ({ x: i }));
        const deps = makeDeps({
            duckdbQuery: vi.fn(async () => ({ columns: [{ name: 'x', type: 'INTEGER' }], rows })),
            getVisibility: () => 'full',
        });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT x FROM t',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
            limit: 100,
        }, deps);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.returned).toBe(50);
        expect(res.data.truncated).toBe(false);
    });

    it('accepts a composite DSL (ROW with two children)', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1 AS x',
            plotConfig: 'ROW(BAR_CHART(x: "x", y: ["x"]), LINE_CHART(x: "x", y: ["x"]))',
        }, deps);
        expect(res.ok).toBe(true);
    });

    it('accepts an overlay composite (a + b)', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', {
            sql: 'SELECT 1 AS x',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"]) + LINE_CHART(x: "x", y: ["x"])',
        }, deps);
        expect(res.ok).toBe(true);
    });

    it('rejects when required plotConfig is missing (schema validation)', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const res = await executeTool('previewPlot', { sql: 'SELECT 1' }, deps);
        expect(res.ok).toBe(false);
    });

    it('returns a unique previewId on each call', async () => {
        const deps = makeDeps({ getVisibility: () => 'full' });
        const a = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        const b = await executeTool('previewPlot', {
            sql: 'SELECT 1',
            plotConfig: 'BAR_CHART(x: "x", y: ["x"])',
        }, deps);
        if (!a.ok || !b.ok) throw new Error('expected both ok');
        expect(a.data.previewId).not.toBe(b.data.previewId);
    });
});
