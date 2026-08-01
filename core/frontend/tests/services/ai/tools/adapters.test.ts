import { describe, it, expect, beforeEach } from 'vitest';
import {
    toolsToAnthropic,
    parseAnthropicToolCalls,
    toolResultToAnthropic,
    extractAnthropicText,
} from '../../../../services/ai/tools/anthropicAdapter';
import {
    toolsToOpenAi,
    parseOpenAiToolCalls,
    toolResultToOpenAi,
} from '../../../../services/ai/tools/openaiAdapter';
import {
    toolsToGemini,
    parseGeminiToolCalls,
    toolResultToGemini,
} from '../../../../services/ai/tools/geminiAdapter';
import type { Tool } from '../../../../services/ai/tools/index';

// Minimal tool fixture
const sampleTool: Tool = {
    name: 'runQuery',
    kind: 'read',
    description: 'Run a SQL query.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
};

// ─── Anthropic adapter ────────────────────────────────────────────────────────

describe('toolsToAnthropic', () => {
    it('converts a tool to Anthropic wire format', () => {
        const result = toolsToAnthropic([sampleTool]);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('runQuery');
        expect(result[0].description).toBe('Run a SQL query.');
        expect(result[0].input_schema).toEqual(sampleTool.inputSchema);
    });

    it('returns empty array for empty input', () => {
        expect(toolsToAnthropic([])).toEqual([]);
    });

    it('converts multiple tools', () => {
        const t2: Tool = { name: 'describeTable', kind: 'read', description: 'Describe.', inputSchema: { type: 'object' } };
        expect(toolsToAnthropic([sampleTool, t2])).toHaveLength(2);
    });
});

describe('parseAnthropicToolCalls', () => {
    it('returns empty array for non-array input', () => {
        expect(parseAnthropicToolCalls(null)).toEqual([]);
        expect(parseAnthropicToolCalls('string')).toEqual([]);
    });

    it('returns empty array for empty array', () => {
        expect(parseAnthropicToolCalls([])).toEqual([]);
    });

    it('skips non-tool_use blocks', () => {
        const content = [{ type: 'text', text: 'hi' }];
        expect(parseAnthropicToolCalls(content)).toEqual([]);
    });

    it('parses a tool_use block', () => {
        const content = [{ type: 'tool_use', id: 'toolu_1', name: 'runQuery', input: { sql: 'SELECT 1' } }];
        const result = parseAnthropicToolCalls(content);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('toolu_1');
        expect(result[0].name).toBe('runQuery');
        expect(result[0].args).toEqual({ sql: 'SELECT 1' });
    });

    it('handles missing id/input gracefully', () => {
        const content = [{ type: 'tool_use', name: 'runQuery' }];
        const result = parseAnthropicToolCalls(content);
        expect(result[0].id).toBe('');
        expect(result[0].args).toEqual({});
    });

    it('skips mixed content and returns only tool calls', () => {
        const content = [
            { type: 'text', text: 'thinking...' },
            { type: 'tool_use', id: 'id1', name: 'runQuery', input: { sql: 'SELECT 1' } },
        ];
        expect(parseAnthropicToolCalls(content)).toHaveLength(1);
    });
});

describe('toolResultToAnthropic', () => {
    const call = { id: 'toolu_1', name: 'runQuery', args: {} };

    it('formats string result as-is', () => {
        const r = toolResultToAnthropic(call, 'hello');
        expect(r.type).toBe('tool_result');
        expect(r.tool_use_id).toBe('toolu_1');
        expect(r.content).toBe('hello');
    });

    it('JSON-stringifies non-string result', () => {
        const r = toolResultToAnthropic(call, { rows: [{ x: 1 }] });
        expect(r.content).toBe(JSON.stringify({ rows: [{ x: 1 }] }));
    });
});

describe('extractAnthropicText', () => {
    it('returns empty string for non-array', () => {
        expect(extractAnthropicText(null)).toBe('');
        expect(extractAnthropicText('text')).toBe('');
    });

    it('extracts text from text blocks', () => {
        const content = [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }];
        expect(extractAnthropicText(content)).toBe('Hello world');
    });

    it('ignores non-text blocks', () => {
        const content = [{ type: 'tool_use', id: 'x' }, { type: 'text', text: 'hi' }];
        expect(extractAnthropicText(content)).toBe('hi');
    });

    it('returns empty string for empty array', () => {
        expect(extractAnthropicText([])).toBe('');
    });
});

// ─── OpenAI adapter ───────────────────────────────────────────────────────────

describe('toolsToOpenAi', () => {
    it('converts a tool to OpenAI wire format', () => {
        const result = toolsToOpenAi([sampleTool]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('function');
        expect(result[0].function.name).toBe('runQuery');
        expect(result[0].function.description).toBe('Run a SQL query.');
        expect(result[0].function.parameters).toEqual(sampleTool.inputSchema);
    });

    it('returns empty array for empty input', () => {
        expect(toolsToOpenAi([])).toEqual([]);
    });
});

describe('parseOpenAiToolCalls', () => {
    it('returns empty array when message has no tool_calls', () => {
        expect(parseOpenAiToolCalls({ content: 'hi' })).toEqual([]);
    });

    it('returns empty array for null message', () => {
        expect(parseOpenAiToolCalls(null)).toEqual([]);
    });

    it('parses a tool call', () => {
        const msg = {
            tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'runQuery', arguments: JSON.stringify({ sql: 'SELECT 1' }) },
            }],
        };
        const result = parseOpenAiToolCalls(msg);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('call_1');
        expect(result[0].name).toBe('runQuery');
        expect(result[0].args.sql).toBe('SELECT 1');
    });

    it('handles malformed JSON arguments gracefully', () => {
        const msg = {
            tool_calls: [{
                id: 'x',
                type: 'function',
                function: { name: 'runQuery', arguments: '{broken json' },
            }],
        };
        const result = parseOpenAiToolCalls(msg);
        expect(result[0].args._raw).toBe('{broken json');
    });

    it('skips non-function type tool calls', () => {
        const msg = {
            tool_calls: [{ id: 'x', type: 'unknown', function: { name: 'f', arguments: '{}' } }],
        };
        expect(parseOpenAiToolCalls(msg)).toEqual([]);
    });

    it('skips calls missing id or name', () => {
        const msg = {
            tool_calls: [{ type: 'function', function: { name: '', arguments: '{}' } }],
        };
        expect(parseOpenAiToolCalls(msg)).toEqual([]);
    });
});

describe('toolResultToOpenAi', () => {
    const call = { id: 'call_1', name: 'runQuery', args: {} };

    it('formats string result as-is', () => {
        const r = toolResultToOpenAi(call, 'ok');
        expect(r.role).toBe('tool');
        expect(r.tool_call_id).toBe('call_1');
        expect(r.content).toBe('ok');
    });

    it('JSON-stringifies non-string result', () => {
        const r = toolResultToOpenAi(call, { count: 5 });
        expect(r.content).toBe(JSON.stringify({ count: 5 }));
    });
});

// ─── Gemini adapter ───────────────────────────────────────────────────────────

describe('toolsToGemini', () => {
    it('converts a tool to Gemini functionDeclarations format', () => {
        const result = toolsToGemini([sampleTool]);
        expect(result.functionDeclarations).toHaveLength(1);
        expect(result.functionDeclarations[0].name).toBe('runQuery');
        expect(result.functionDeclarations[0].description).toBe('Run a SQL query.');
        expect(result.functionDeclarations[0].parameters).toEqual(sampleTool.inputSchema);
    });

    it('returns empty functionDeclarations for empty input', () => {
        expect(toolsToGemini([]).functionDeclarations).toEqual([]);
    });
});

describe('parseGeminiToolCalls', () => {
    beforeEach(() => {
        // Reset the Gemini call sequence counter between tests by re-importing
        // is not straightforward; instead use predictable test isolation
    });

    it('returns empty array for non-array input', () => {
        expect(parseGeminiToolCalls(null)).toEqual([]);
        expect(parseGeminiToolCalls('text')).toEqual([]);
    });

    it('returns empty array for empty array', () => {
        expect(parseGeminiToolCalls([])).toEqual([]);
    });

    it('parses a functionCall part', () => {
        const parts = [{ functionCall: { name: 'runQuery', args: { sql: 'SELECT 1' } } }];
        const result = parseGeminiToolCalls(parts);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('runQuery');
        expect(result[0].args).toEqual({ sql: 'SELECT 1' });
        expect(result[0].id).toMatch(/^gemini-runQuery-/);
    });

    it('synthesizes unique ids per call', () => {
        const parts = [
            { functionCall: { name: 'f', args: {} } },
            { functionCall: { name: 'f', args: {} } },
        ];
        const result = parseGeminiToolCalls(parts);
        expect(result[0].id).not.toBe(result[1].id);
    });

    it('skips parts without functionCall', () => {
        const parts = [{ text: 'hi' }, { functionCall: { name: 'f', args: {} } }];
        expect(parseGeminiToolCalls(parts)).toHaveLength(1);
    });

    it('uses empty object for missing args', () => {
        const parts = [{ functionCall: { name: 'f' } }];
        expect(parseGeminiToolCalls(parts)[0].args).toEqual({});
    });
});

describe('toolResultToGemini', () => {
    const call = { id: 'gemini-f-0', name: 'runQuery', args: {} };

    it('wraps object result in functionResponse', () => {
        const r = toolResultToGemini(call, { rows: [] });
        expect(r.functionResponse.name).toBe('runQuery');
        expect(r.functionResponse.response).toEqual({ rows: [] });
    });

    it('wraps non-object result in { value: ... }', () => {
        const r = toolResultToGemini(call, 'ok');
        expect(r.functionResponse.response).toEqual({ value: 'ok' });
    });

    it('wraps null in { value: null }', () => {
        const r = toolResultToGemini(call, null);
        expect(r.functionResponse.response).toEqual({ value: null });
    });
});
