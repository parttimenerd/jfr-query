import { describe, it, expect } from 'vitest';
import { parseLocalToolCalls, buildLocalToolPromptHint } from '../../services/ai/tools/localAdapter';
import type { Tool } from '../../services/ai/tools/index';

const SAMPLE_TOOLS: Tool[] = [
    {
        name: 'runQuery',
        kind: 'read',
        description: 'Execute SQL',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
    },
    {
        name: 'readCell',
        kind: 'read',
        description: 'Read cell',
        inputSchema: { type: 'object', properties: { cellId: { type: 'string' } }, required: ['cellId'] },
    },
];

// ─── buildLocalToolPromptHint ─────────────────────────────────────────────────

describe('buildLocalToolPromptHint', () => {
    it('includes all tool names', () => {
        const hint = buildLocalToolPromptHint(SAMPLE_TOOLS);
        expect(hint).toContain('runQuery');
        expect(hint).toContain('readCell');
    });

    it('includes tool descriptions', () => {
        const hint = buildLocalToolPromptHint(SAMPLE_TOOLS);
        expect(hint).toContain('Execute SQL');
        expect(hint).toContain('Read cell');
    });

    it('includes parameter names', () => {
        const hint = buildLocalToolPromptHint(SAMPLE_TOOLS);
        expect(hint).toContain('sql');
        expect(hint).toContain('cellId');
    });

    it('mentions <tool> tag syntax', () => {
        const hint = buildLocalToolPromptHint(SAMPLE_TOOLS);
        expect(hint).toContain('<tool>');
    });
});

// ─── parseLocalToolCalls — structured path ────────────────────────────────────

describe('parseLocalToolCalls — OpenAI-compatible tool_calls', () => {
    it('parses structured tool_calls from message', () => {
        const message = {
            tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'runQuery', arguments: '{"sql":"SELECT 1"}' },
            }],
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
        expect(calls[0].args).toEqual({ sql: 'SELECT 1' });
    });
});

// ─── parseLocalToolCalls — <tool> tag path ────────────────────────────────────

describe('parseLocalToolCalls — <tool> tag', () => {
    it('parses a single <tool> block', () => {
        const message = {
            content: 'I will run a query.\n<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
        expect(calls[0].args).toEqual({ sql: 'SELECT 1' });
    });

    it('parses multiple <tool> blocks', () => {
        const message = {
            content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>\n<tool>{"name":"readCell","args":{"cellId":"c1"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(2);
        expect(calls.map(c => c.name)).toEqual(['runQuery', 'readCell']);
    });

    it('handles whitespace inside <tool> tags', () => {
        const message = {
            content: '<tool>\n  {"name":"runQuery","args":{"sql":"SELECT 1"}}\n</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });

    it('deduplicates identical tool calls', () => {
        const message = {
            content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>\n<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
    });

    it('accepts "arguments" as alias for "args"', () => {
        const message = {
            content: '<tool>{"name":"runQuery","arguments":{"sql":"SELECT 1"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual({ sql: 'SELECT 1' });
    });
});

// ─── parseLocalToolCalls — fenced JSON path ───────────────────────────────────

describe('parseLocalToolCalls — fenced JSON', () => {
    it('parses ```json fenced block', () => {
        const message = {
            content: 'Here is the call:\n```json\n{"name":"runQuery","args":{"sql":"SELECT 1"}}\n```',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });

    it('parses ```tool fenced block', () => {
        const message = {
            content: '```tool\n{"name":"runQuery","args":{"sql":"SELECT 1"}}\n```',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });

    it('parses bare ``` fenced block', () => {
        const message = {
            content: '```\n{"name":"runQuery","args":{"sql":"SELECT 1"}}\n```',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
    });
});

// ─── parseLocalToolCalls — bare JSON path ─────────────────────────────────────

describe('parseLocalToolCalls — bare JSON fallback', () => {
    it('finds a bare JSON object with name/args in prose', () => {
        const message = {
            content: 'Sure, I will call {"name":"runQuery","args":{"sql":"SELECT 1"}} now.',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });
});

// ─── parseLocalToolCalls — edge cases ────────────────────────────────────────

describe('parseLocalToolCalls — edge cases', () => {
    it('returns [] for null message', () => {
        expect(parseLocalToolCalls(null)).toEqual([]);
    });

    it('returns [] for message with empty string content', () => {
        expect(parseLocalToolCalls({ content: '' })).toEqual([]);
    });

    it('returns [] for message with no content or tool_calls', () => {
        expect(parseLocalToolCalls({ role: 'assistant' })).toEqual([]);
    });

    it('returns [] when content has no tool JSON', () => {
        expect(parseLocalToolCalls({ content: 'I have no idea.' })).toEqual([]);
    });

    it('ignores <tool> tags with malformed JSON', () => {
        const message = { content: '<tool>not valid json</tool>' };
        expect(parseLocalToolCalls(message)).toHaveLength(0);
    });

    it('ignores <tool> JSON without a name field', () => {
        const message = { content: '<tool>{"args":{"sql":"SELECT 1"}}</tool>' };
        expect(parseLocalToolCalls(message)).toHaveLength(0);
    });

    it('synthesizes unique ids per call', () => {
        const message = {
            content: '<tool>{"name":"a","args":{}}</tool>\n<tool>{"name":"b","args":{}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls[0].id).not.toBe(calls[1].id);
    });
});
