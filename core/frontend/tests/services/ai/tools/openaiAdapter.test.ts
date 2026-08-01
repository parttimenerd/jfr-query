import { describe, it, expect } from 'vitest';
import { toolsToOpenAi, parseOpenAiToolCalls, toolResultToOpenAi } from '../../../../services/ai/tools/openaiAdapter';
import type { Tool } from '../../../../services/ai/tools/index';

const dummyTool: Tool = {
    name: 'runQuery',
    description: 'Run a SQL query',
    kind: 'read',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
};

// ---------------------------------------------------------------------------
// toolsToOpenAi
// ---------------------------------------------------------------------------
describe('toolsToOpenAi', () => {
    it('maps tool to OpenAI function wire format', () => {
        const [wire] = toolsToOpenAi([dummyTool]);
        expect(wire.type).toBe('function');
        expect(wire.function.name).toBe('runQuery');
        expect(wire.function.description).toBe('Run a SQL query');
        expect(wire.function.parameters).toBe(dummyTool.inputSchema);
    });

    it('returns empty array for empty input', () => {
        expect(toolsToOpenAi([])).toEqual([]);
    });

    it('converts all provided tools', () => {
        const tools: Tool[] = [
            dummyTool,
            { name: 'addCell', description: 'Add cell', kind: 'mutate', inputSchema: {} },
        ];
        expect(toolsToOpenAi(tools)).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// parseOpenAiToolCalls
// ---------------------------------------------------------------------------
describe('parseOpenAiToolCalls', () => {
    it('returns empty array when tool_calls is absent', () => {
        expect(parseOpenAiToolCalls({})).toEqual([]);
        expect(parseOpenAiToolCalls(null)).toEqual([]);
    });

    it('returns empty array when tool_calls is not an array', () => {
        expect(parseOpenAiToolCalls({ tool_calls: 'bad' })).toEqual([]);
    });

    it('parses a valid function call', () => {
        const msg = {
            tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'runQuery', arguments: '{"sql":"SELECT 1"}' },
            }],
        };
        const [call] = parseOpenAiToolCalls(msg);
        expect(call.id).toBe('call_1');
        expect(call.name).toBe('runQuery');
        expect(call.args).toEqual({ sql: 'SELECT 1' });
    });

    it('stores malformed JSON in _raw fallback', () => {
        const msg = {
            tool_calls: [{
                id: 'call_2',
                type: 'function',
                function: { name: 'addCell', arguments: 'not-json' },
            }],
        };
        const [call] = parseOpenAiToolCalls(msg);
        expect(call.args._raw).toBe('not-json');
    });

    it('skips entries without id or name', () => {
        const msg = {
            tool_calls: [
                { type: 'function', function: { name: 'addCell', arguments: '{}' } },
                { id: 'ok_id', type: 'function', function: { name: 'runQuery', arguments: '{}' } },
            ],
        };
        const calls = parseOpenAiToolCalls(msg);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });

    it('skips non-function type entries', () => {
        const msg = {
            tool_calls: [
                { id: 'x', type: 'retrieval', function: { name: 'foo', arguments: '{}' } },
            ],
        };
        expect(parseOpenAiToolCalls(msg)).toHaveLength(0);
    });

    it('handles empty arguments string as empty object', () => {
        const msg = {
            tool_calls: [{
                id: 'call_3',
                type: 'function',
                function: { name: 'listCells', arguments: '' },
            }],
        };
        const [call] = parseOpenAiToolCalls(msg);
        expect(call.args).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// toolResultToOpenAi
// ---------------------------------------------------------------------------
describe('toolResultToOpenAi', () => {
    const call = { id: 'call_1', name: 'runQuery', args: {} };

    it('produces role=tool message', () => {
        const result = toolResultToOpenAi(call, { rows: [] });
        expect(result.role).toBe('tool');
        expect(result.tool_call_id).toBe('call_1');
    });

    it('passes string content as-is', () => {
        const result = toolResultToOpenAi(call, 'done');
        expect(result.content).toBe('done');
    });

    it('JSON-stringifies object content', () => {
        const result = toolResultToOpenAi(call, { ok: true });
        expect(result.content).toBe('{"ok":true}');
    });
});
