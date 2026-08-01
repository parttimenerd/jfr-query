import { describe, it, expect } from 'vitest';
import { buildLocalToolPromptHint, parseLocalToolCalls } from '../../../../services/ai/tools/localAdapter';
import type { Tool } from '../../../../services/ai/tools/index';

const runQueryTool: Tool = {
    name: 'runQuery',
    kind: 'read',
    description: 'Execute a DuckDB SQL query.',
    inputSchema: {
        type: 'object',
        properties: {
            sql: { type: 'string', description: 'SQL query.' },
        },
        required: ['sql'],
    },
};

const editCellTool: Tool = {
    name: 'editCell',
    kind: 'mutate',
    description: 'Edit a notebook cell.',
    inputSchema: {
        type: 'object',
        properties: {
            cellId: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['cellId', 'content'],
    },
};

// ── buildLocalToolPromptHint ──────────────────────────────────────────────────

describe('buildLocalToolPromptHint', () => {
    it('includes the tool names', () => {
        const hint = buildLocalToolPromptHint([runQueryTool, editCellTool]);
        expect(hint).toContain('runQuery');
        expect(hint).toContain('editCell');
    });

    it('includes the tool descriptions', () => {
        const hint = buildLocalToolPromptHint([runQueryTool]);
        expect(hint).toContain('Execute a DuckDB SQL query.');
    });

    it('includes TOOL CALLING header', () => {
        const hint = buildLocalToolPromptHint([runQueryTool]);
        expect(hint).toContain('TOOL CALLING');
    });

    it('includes AVAILABLE TOOLS section', () => {
        const hint = buildLocalToolPromptHint([runQueryTool]);
        expect(hint).toContain('AVAILABLE TOOLS');
    });

    it('handles empty tools list', () => {
        const hint = buildLocalToolPromptHint([]);
        expect(typeof hint).toBe('string');
        expect(hint).toContain('TOOL CALLING');
    });
});

// ── parseLocalToolCalls ───────────────────────────────────────────────────────

describe('parseLocalToolCalls — <tool> tag format', () => {
    it('parses a <tool> tag with name and args', () => {
        const message = { content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>' };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
        expect(calls[0].args).toEqual({ sql: 'SELECT 1' });
    });

    it('deduplicates identical tool calls', () => {
        const message = {
            content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>\n' +
                     '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
    });

    it('parses multiple distinct tool calls', () => {
        const message = {
            content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>\n' +
                     '<tool>{"name":"editCell","args":{"cellId":"c1","content":"x"}}</tool>',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(2);
        expect(calls.map(c => c.name)).toEqual(['runQuery', 'editCell']);
    });
});

describe('parseLocalToolCalls — fenced JSON format', () => {
    it('parses a ```json fenced block', () => {
        const message = {
            content: '```json\n{"name":"runQuery","args":{"sql":"SELECT 1"}}\n```',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });

    it('parses a bare ``` fenced block', () => {
        const message = {
            content: '```\n{"name":"runQuery","args":{"sql":"SELECT 1"}}\n```',
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
    });
});

describe('parseLocalToolCalls — OpenAI tool_calls format', () => {
    it('parses OpenAI-style tool_calls', () => {
        const message = {
            tool_calls: [
                {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'runQuery', arguments: '{"sql":"SELECT 1"}' },
                },
            ],
        };
        const calls = parseLocalToolCalls(message);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('runQuery');
        expect(calls[0].id).toBe('call-1');
    });
});

describe('parseLocalToolCalls — edge cases', () => {
    it('returns empty array for message with no tool calls', () => {
        const message = { content: 'Just a regular assistant reply.' };
        expect(parseLocalToolCalls(message)).toEqual([]);
    });

    it('returns empty array for null/undefined content', () => {
        expect(parseLocalToolCalls({ content: null })).toEqual([]);
        expect(parseLocalToolCalls(null)).toEqual([]);
    });

    it('assigns an id to each tool call', () => {
        const message = { content: '<tool>{"name":"runQuery","args":{"sql":"SELECT 1"}}</tool>' };
        const calls = parseLocalToolCalls(message);
        expect(typeof calls[0].id).toBe('string');
        expect(calls[0].id.length).toBeGreaterThan(0);
    });
});
