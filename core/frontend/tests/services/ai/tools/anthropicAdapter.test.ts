import { describe, it, expect } from 'vitest';
import { toolsToAnthropic, parseAnthropicToolCalls, toolResultToAnthropic, extractAnthropicText } from '../../../../services/ai/tools/anthropicAdapter';
import type { Tool } from '../../../../services/ai/tools/index';

const dummyTool: Tool = {
    name: 'runQuery',
    description: 'Run a SQL query',
    kind: 'read',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
};

// ---------------------------------------------------------------------------
// toolsToAnthropic
// ---------------------------------------------------------------------------
describe('toolsToAnthropic', () => {
    it('maps tool to anthropic wire format', () => {
        const [wire] = toolsToAnthropic([dummyTool]);
        expect(wire.name).toBe('runQuery');
        expect(wire.description).toBe('Run a SQL query');
        expect(wire.input_schema).toBe(dummyTool.inputSchema);
    });

    it('returns empty array for empty input', () => {
        expect(toolsToAnthropic([])).toEqual([]);
    });

    it('preserves all tools', () => {
        const tools: Tool[] = [
            dummyTool,
            { name: 'addCell', description: 'Add a cell', kind: 'mutate', inputSchema: {} },
        ];
        expect(toolsToAnthropic(tools)).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// parseAnthropicToolCalls
// ---------------------------------------------------------------------------
describe('parseAnthropicToolCalls', () => {
    it('returns empty array for non-array input', () => {
        expect(parseAnthropicToolCalls(null)).toEqual([]);
        expect(parseAnthropicToolCalls('text')).toEqual([]);
    });

    it('ignores non-tool_use blocks', () => {
        const content = [{ type: 'text', text: 'hello' }];
        expect(parseAnthropicToolCalls(content)).toHaveLength(0);
    });

    it('parses a tool_use block', () => {
        const content = [{
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'runQuery',
            input: { sql: 'SELECT 1' },
        }];
        const [call] = parseAnthropicToolCalls(content);
        expect(call.id).toBe('toolu_abc');
        expect(call.name).toBe('runQuery');
        expect(call.args).toEqual({ sql: 'SELECT 1' });
    });

    it('handles missing id with empty string', () => {
        const content = [{ type: 'tool_use', name: 'runQuery', input: {} }];
        const [call] = parseAnthropicToolCalls(content);
        expect(call.id).toBe('');
    });

    it('handles missing input with empty object', () => {
        const content = [{ type: 'tool_use', id: 'x', name: 'runQuery' }];
        const [call] = parseAnthropicToolCalls(content);
        expect(call.args).toEqual({});
    });

    it('parses multiple tool_use blocks', () => {
        const content = [
            { type: 'tool_use', id: 'id1', name: 'runQuery', input: {} },
            { type: 'text', text: 'some text' },
            { type: 'tool_use', id: 'id2', name: 'addCell', input: {} },
        ];
        expect(parseAnthropicToolCalls(content)).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// toolResultToAnthropic
// ---------------------------------------------------------------------------
describe('toolResultToAnthropic', () => {
    const call = { id: 'toolu_abc', name: 'runQuery', args: {} };

    it('produces a tool_result block', () => {
        const result = toolResultToAnthropic(call, { ok: true });
        expect(result.type).toBe('tool_result');
        expect(result.tool_use_id).toBe('toolu_abc');
    });

    it('passes string result as-is', () => {
        const result = toolResultToAnthropic(call, 'hello');
        expect(result.content).toBe('hello');
    });

    it('JSON-stringifies non-string result', () => {
        const result = toolResultToAnthropic(call, { rows: [1, 2] });
        expect(result.content).toBe('{"rows":[1,2]}');
    });
});

// ---------------------------------------------------------------------------
// extractAnthropicText
// ---------------------------------------------------------------------------
describe('extractAnthropicText', () => {
    it('returns empty string for non-array', () => {
        expect(extractAnthropicText(null)).toBe('');
        expect(extractAnthropicText('text')).toBe('');
    });

    it('concatenates text blocks', () => {
        const content = [
            { type: 'text', text: 'hello ' },
            { type: 'tool_use', id: 'x', name: 'y', input: {} },
            { type: 'text', text: 'world' },
        ];
        expect(extractAnthropicText(content)).toBe('hello world');
    });

    it('returns empty string when no text blocks present', () => {
        const content = [{ type: 'tool_use', id: 'x', name: 'y', input: {} }];
        expect(extractAnthropicText(content)).toBe('');
    });
});
