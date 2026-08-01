import { describe, it, expect } from 'vitest';
import { toolsToGemini, parseGeminiToolCalls, toolResultToGemini } from '../../../../services/ai/tools/geminiAdapter';
import type { Tool } from '../../../../services/ai/tools/index';

const dummyTool: Tool = {
    name: 'runQuery',
    description: 'Run a SQL query',
    kind: 'read',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
};

// ---------------------------------------------------------------------------
// toolsToGemini
// ---------------------------------------------------------------------------
describe('toolsToGemini', () => {
    it('wraps tools in functionDeclarations array', () => {
        const result = toolsToGemini([dummyTool]);
        expect(result.functionDeclarations).toHaveLength(1);
    });

    it('maps name, description, parameters correctly', () => {
        const [decl] = toolsToGemini([dummyTool]).functionDeclarations;
        expect(decl.name).toBe('runQuery');
        expect(decl.description).toBe('Run a SQL query');
        expect(decl.parameters).toBe(dummyTool.inputSchema);
    });

    it('returns empty functionDeclarations for empty input', () => {
        expect(toolsToGemini([]).functionDeclarations).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// parseGeminiToolCalls
// ---------------------------------------------------------------------------
describe('parseGeminiToolCalls', () => {
    it('returns empty array for non-array input', () => {
        expect(parseGeminiToolCalls(null)).toEqual([]);
        expect(parseGeminiToolCalls('text')).toEqual([]);
    });

    it('ignores parts without functionCall', () => {
        const parts = [{ text: 'hello' }];
        expect(parseGeminiToolCalls(parts)).toHaveLength(0);
    });

    it('parses a functionCall part', () => {
        const parts = [{ functionCall: { name: 'runQuery', args: { sql: 'SELECT 1' } } }];
        const [call] = parseGeminiToolCalls(parts);
        expect(call.name).toBe('runQuery');
        expect(call.args).toEqual({ sql: 'SELECT 1' });
    });

    it('synthesizes a unique id for each call', () => {
        const parts = [
            { functionCall: { name: 'runQuery', args: {} } },
            { functionCall: { name: 'runQuery', args: {} } },
        ];
        const calls = parseGeminiToolCalls(parts);
        expect(calls[0].id).not.toBe(calls[1].id);
    });

    it('id contains the tool name', () => {
        const parts = [{ functionCall: { name: 'addCell', args: {} } }];
        const [call] = parseGeminiToolCalls(parts);
        expect(call.id).toContain('addCell');
    });

    it('uses empty object when args is absent', () => {
        const parts = [{ functionCall: { name: 'listCells' } }];
        const [call] = parseGeminiToolCalls(parts);
        expect(call.args).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// toolResultToGemini
// ---------------------------------------------------------------------------
describe('toolResultToGemini', () => {
    const call = { id: 'gemini-runQuery-0', name: 'runQuery', args: {} };

    it('produces a functionResponse message', () => {
        const result = toolResultToGemini(call, { rows: [] });
        expect(result.functionResponse.name).toBe('runQuery');
        expect(result.functionResponse.response).toEqual({ rows: [] });
    });

    it('wraps non-object result in {value}', () => {
        const result = toolResultToGemini(call, 'done');
        expect(result.functionResponse.response).toEqual({ value: 'done' });
    });

    it('wraps null result in {value}', () => {
        const result = toolResultToGemini(call, null);
        expect(result.functionResponse.response).toEqual({ value: null });
    });

    it('passes object result through as-is', () => {
        const data = { ok: true, rows: [1, 2] };
        const result = toolResultToGemini(call, data);
        expect(result.functionResponse.response).toBe(data);
    });
});
