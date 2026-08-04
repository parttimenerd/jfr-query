import { describe, it, expect, beforeEach } from 'vitest';
import {
    toolsToOpenAi,
    parseOpenAiToolCalls,
    toolResultToOpenAi,
} from '../../services/ai/tools/openaiAdapter';
import {
    toolsToAnthropic,
    parseAnthropicToolCalls,
    toolResultToAnthropic,
    extractAnthropicText,
} from '../../services/ai/tools/anthropicAdapter';
import {
    toolsToGemini,
    parseGeminiToolCalls,
    toolResultToGemini,
} from '../../services/ai/tools/geminiAdapter';
import type { Tool } from '../../services/ai/tools/index';

const SAMPLE_TOOLS: Tool[] = [
    {
        name: 'runQuery',
        kind: 'read',
        description: 'Execute SQL query',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
    },
    {
        name: 'readCell',
        kind: 'read',
        description: 'Read cell content',
        inputSchema: { type: 'object', properties: { cellId: { type: 'string' } }, required: ['cellId'] },
    },
];

// ─── OpenAI adapter ───────────────────────────────────────────────────────────

describe('toolsToOpenAi', () => {
    it('wraps each tool in the function wire format', () => {
        const out = toolsToOpenAi(SAMPLE_TOOLS);
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({
            type: 'function',
            function: {
                name: 'runQuery',
                description: 'Execute SQL query',
                parameters: SAMPLE_TOOLS[0].inputSchema,
            },
        });
    });

    it('returns [] for empty tools list', () => {
        expect(toolsToOpenAi([])).toEqual([]);
    });
});

describe('parseOpenAiToolCalls', () => {
    it('parses a well-formed tool_calls array', () => {
        const message = {
            tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'runQuery', arguments: '{"sql":"SELECT 1"}' },
            }],
        };
        const calls = parseOpenAiToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ id: 'call_1', name: 'runQuery', args: { sql: 'SELECT 1' } });
    });

    it('skips non-function entries', () => {
        const message = {
            tool_calls: [
                { id: 'c1', type: 'other', function: { name: 'x', arguments: '{}' } },
                { id: 'c2', type: 'function', function: { name: 'runQuery', arguments: '{}' } },
            ],
        };
        expect(parseOpenAiToolCalls(message)).toHaveLength(1);
    });

    it('handles unparseable JSON arguments gracefully', () => {
        const message = {
            tool_calls: [{
                id: 'c1', type: 'function',
                function: { name: 'runQuery', arguments: '{{bad json}}' },
            }],
        };
        const calls = parseOpenAiToolCalls(message);
        expect(calls[0].args).toHaveProperty('_raw');
    });

    it('returns [] for null/undefined', () => {
        expect(parseOpenAiToolCalls(null)).toEqual([]);
        expect(parseOpenAiToolCalls(undefined)).toEqual([]);
    });

    it('returns [] when no tool_calls field', () => {
        expect(parseOpenAiToolCalls({ content: 'hi' })).toEqual([]);
    });

    it('skips entries with missing id or name', () => {
        const message = {
            tool_calls: [
                { id: '', type: 'function', function: { name: 'runQuery', arguments: '{}' } },
                { id: 'c2', type: 'function', function: { name: '', arguments: '{}' } },
            ],
        };
        expect(parseOpenAiToolCalls(message)).toHaveLength(0);
    });
});

describe('toolResultToOpenAi', () => {
    const call = { id: 'call_1', name: 'runQuery', args: {} };

    it('stringifies object results', () => {
        const result = toolResultToOpenAi(call, { rows: [{ n: 1 }] });
        expect(result.role).toBe('tool');
        expect(result.tool_call_id).toBe('call_1');
        expect(result.content).toBe(JSON.stringify({ rows: [{ n: 1 }] }));
    });

    it('passes string results through as-is', () => {
        const result = toolResultToOpenAi(call, 'done');
        expect(result.content).toBe('done');
    });
});

// ─── Anthropic adapter ────────────────────────────────────────────────────────

describe('toolsToAnthropic', () => {
    it('produces input_schema field from tool.inputSchema', () => {
        const out = toolsToAnthropic(SAMPLE_TOOLS);
        expect(out[0]).toEqual({
            name: 'runQuery',
            description: 'Execute SQL query',
            input_schema: SAMPLE_TOOLS[0].inputSchema,
        });
    });
});

describe('parseAnthropicToolCalls', () => {
    it('parses tool_use blocks', () => {
        const content = [
            { type: 'text', text: 'I will call runQuery.' },
            { type: 'tool_use', id: 'toolu_1', name: 'runQuery', input: { sql: 'SELECT 1' } },
        ];
        const calls = parseAnthropicToolCalls(content);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ id: 'toolu_1', name: 'runQuery', args: { sql: 'SELECT 1' } });
    });

    it('ignores non-tool_use blocks', () => {
        const content = [{ type: 'text', text: 'hello' }];
        expect(parseAnthropicToolCalls(content)).toHaveLength(0);
    });

    it('returns [] for non-array input', () => {
        expect(parseAnthropicToolCalls(null)).toEqual([]);
        expect(parseAnthropicToolCalls('string')).toEqual([]);
    });

    it('handles missing id and name gracefully', () => {
        const content = [{ type: 'tool_use' }];
        const calls = parseAnthropicToolCalls(content);
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('');
        expect(calls[0].name).toBe('');
    });
});

describe('toolResultToAnthropic', () => {
    const call = { id: 'toolu_1', name: 'runQuery', args: {} };

    it('produces tool_result block', () => {
        const result = toolResultToAnthropic(call, { rows: [] });
        expect(result.type).toBe('tool_result');
        expect(result.tool_use_id).toBe('toolu_1');
    });

    it('passes string content through', () => {
        const result = toolResultToAnthropic(call, 'ok');
        expect(result.content).toBe('ok');
    });

    it('stringifies object content', () => {
        const result = toolResultToAnthropic(call, { n: 5 });
        expect(result.content).toBe('{"n":5}');
    });
});

describe('extractAnthropicText', () => {
    it('joins all text blocks', () => {
        const content = [
            { type: 'text', text: 'Hello ' },
            { type: 'tool_use', id: 'x', name: 'y', input: {} },
            { type: 'text', text: 'world' },
        ];
        expect(extractAnthropicText(content)).toBe('Hello world');
    });

    it('returns empty string for non-array', () => {
        expect(extractAnthropicText(null)).toBe('');
    });

    it('returns empty string for empty array', () => {
        expect(extractAnthropicText([])).toBe('');
    });
});

// ─── Gemini adapter ───────────────────────────────────────────────────────────

describe('toolsToGemini', () => {
    it('wraps in functionDeclarations', () => {
        const out = toolsToGemini(SAMPLE_TOOLS);
        expect(out.functionDeclarations).toHaveLength(2);
        expect(out.functionDeclarations[0]).toEqual({
            name: 'runQuery',
            description: 'Execute SQL query',
            parameters: SAMPLE_TOOLS[0].inputSchema,
        });
    });
});

describe('parseGeminiToolCalls', () => {
    it('parses functionCall parts', () => {
        const parts = [
            { text: 'calling...' },
            { functionCall: { name: 'runQuery', args: { sql: 'SELECT 1' } } },
        ];
        const calls = parseGeminiToolCalls(parts);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
        expect(calls[0].args).toEqual({ sql: 'SELECT 1' });
        expect(calls[0].id).toMatch(/^gemini-runQuery-/);
    });

    it('skips parts without functionCall', () => {
        const parts = [{ text: 'hi' }];
        expect(parseGeminiToolCalls(parts)).toHaveLength(0);
    });

    it('returns [] for non-array input', () => {
        expect(parseGeminiToolCalls(null)).toEqual([]);
    });

    it('synthesizes unique ids across calls', () => {
        const parts = [
            { functionCall: { name: 'a', args: {} } },
            { functionCall: { name: 'b', args: {} } },
        ];
        const calls = parseGeminiToolCalls(parts);
        expect(calls[0].id).not.toBe(calls[1].id);
    });
});

describe('toolResultToGemini', () => {
    const call = { id: 'gemini-runQuery-0', name: 'runQuery', args: {} };

    it('wraps in functionResponse', () => {
        const result = toolResultToGemini(call, { rows: [] });
        expect(result.functionResponse.name).toBe('runQuery');
        expect(result.functionResponse.response).toEqual({ rows: [] });
    });

    it('wraps scalar result in {value: ...}', () => {
        const result = toolResultToGemini(call, 'done');
        expect(result.functionResponse.response).toEqual({ value: 'done' });
    });

    it('wraps null result in {value: null}', () => {
        const result = toolResultToGemini(call, null);
        expect(result.functionResponse.response).toEqual({ value: null });
    });
});
