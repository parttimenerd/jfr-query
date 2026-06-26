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
        expect(deps.duckdbQuery).toHaveBeenCalledWith('SELECT 1', { limit: 100 });
    });

    it('runQuery rejects SQL with $ai_providers and does NOT execute', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM $ai_providers.foo' }, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toBe('forbidden token');
        expect(deps.duckdbQuery).not.toHaveBeenCalled();
    });

    it('runQuery rejects SQL with $AI_PROVIDERS (case-insensitive) before executing', async () => {
        const deps = makeDeps();
        const res = await executeTool('runQuery', { sql: 'SELECT * FROM $AI_PROVIDERS.bar' }, deps);
        expect(res.ok).toBe(false);
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

    it('unknown tool returns a structured error', async () => {
        const deps = makeDeps();
        const res = await executeTool('nonExistent', {}, deps);
        expect(res.ok).toBe(false);
        expect((res as { ok: false; error: string }).error).toMatch(/unknown tool/);
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
