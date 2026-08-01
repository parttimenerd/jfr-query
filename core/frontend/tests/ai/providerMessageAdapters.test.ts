import { describe, it, expect } from 'vitest';
import { geminiContentsFromTool } from '../../services/ai/GeminiProvider';
import { openAiMessagesFromTool } from '../../services/ai/OpenAiProvider';
import type { ToolChatMessage } from '../../services/ai/IAiProvider';

// ─── geminiContentsFromTool ───────────────────────────────────────────────────

describe('geminiContentsFromTool', () => {
    it('converts a user message to role:user with text part', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'hello' }];
        expect(geminiContentsFromTool(msgs)).toEqual([
            { role: 'user', parts: [{ text: 'hello' }] },
        ]);
    });

    it('converts an assistant message to role:model', () => {
        const msgs: ToolChatMessage[] = [{ role: 'assistant', content: 'hi there' }];
        expect(geminiContentsFromTool(msgs)).toEqual([
            { role: 'model', parts: [{ text: 'hi there' }] },
        ]);
    });

    it('drops system messages (system goes into config.systemInstruction)', () => {
        const msgs: ToolChatMessage[] = [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'hello' },
        ];
        const out = geminiContentsFromTool(msgs);
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe('user');
    });

    it('converts tool result to role:user with functionResponse parts', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [
                    { id: 'call-1', name: 'runQuery', result: { rows: [{ n: 42 }] } },
                ],
            },
        ];
        const out = geminiContentsFromTool(msgs);
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe('user');
        expect((out[0].parts as any)[0].functionResponse).toMatchObject({
            name: 'runQuery',
            response: { rows: [{ n: 42 }] },
        });
    });

    it('wraps scalar tool result in { value }', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [{ id: 'c', name: 'readCell', result: 'cell content' }],
            },
        ];
        const out = geminiContentsFromTool(msgs);
        expect((out[0].parts as any)[0].functionResponse.response).toEqual({ value: 'cell content' });
    });

    it('throws when a toolResult is missing a name', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [{ id: 'c', result: 'oops' } as any],
            },
        ];
        expect(() => geminiContentsFromTool(msgs)).toThrow('missing name');
    });

    it('skips a tool message with empty toolResults (does not push a blank entry)', () => {
        const msgs: ToolChatMessage[] = [
            { role: 'tool', content: '', toolResults: [] },
            { role: 'user', content: 'ok' },
        ];
        const out = geminiContentsFromTool(msgs);
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe('user');
    });

    it('encodes assistant tool calls as functionCall parts', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'c1', name: 'runQuery', args: { sql: 'SELECT 1' } }],
            },
        ];
        const out = geminiContentsFromTool(msgs);
        expect(out[0].role).toBe('model');
        expect((out[0].parts as any)[0]).toEqual({
            functionCall: { name: 'runQuery', args: { sql: 'SELECT 1' } },
        });
    });

    it('includes text content alongside function call parts when both are present', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: 'Running a query now.',
                toolCalls: [{ id: 'c1', name: 'runQuery', args: {} }],
            },
        ];
        const out = geminiContentsFromTool(msgs);
        const parts = out[0].parts as any[];
        expect(parts[0]).toEqual({ text: 'Running a query now.' });
        expect(parts[1].functionCall.name).toBe('runQuery');
    });

    it('returns empty array for empty input', () => {
        expect(geminiContentsFromTool([])).toEqual([]);
    });
});

// ─── openAiMessagesFromTool ───────────────────────────────────────────────────

describe('openAiMessagesFromTool', () => {
    it('converts a user message', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'hello' }];
        expect(openAiMessagesFromTool(msgs)).toEqual([
            { role: 'user', content: 'hello' },
        ]);
    });

    it('converts an assistant message', () => {
        const msgs: ToolChatMessage[] = [{ role: 'assistant', content: 'hi' }];
        expect(openAiMessagesFromTool(msgs)).toEqual([
            { role: 'assistant', content: 'hi' },
        ]);
    });

    it('prepends system instruction when provided', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'hello' }];
        const out = openAiMessagesFromTool(msgs, 'Be helpful.');
        expect(out[0]).toEqual({ role: 'system', content: 'Be helpful.' });
        expect(out[1]).toEqual({ role: 'user', content: 'hello' });
    });

    it('drops system messages from the conversation array (already handled by systemInstruction)', () => {
        const msgs: ToolChatMessage[] = [
            { role: 'system', content: 'old system' },
            { role: 'user', content: 'hello' },
        ];
        const out = openAiMessagesFromTool(msgs);
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe('user');
    });

    it('converts tool results to role:tool messages keyed by tool_call_id', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [{ id: 'call-1', name: 'runQuery', result: { rows: [] } }],
            },
        ];
        const out = openAiMessagesFromTool(msgs);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            role: 'tool',
            tool_call_id: 'call-1',
        });
        expect(JSON.parse(out[0].content)).toEqual({ rows: [] });
    });

    it('keeps string tool results as-is without JSON.stringify', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [{ id: 'c', name: 'readCell', result: 'raw text' }],
            },
        ];
        const out = openAiMessagesFromTool(msgs);
        expect(out[0].content).toBe('raw text');
    });

    it('emits multiple role:tool messages for multiple results', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [
                    { id: 'c1', name: 'r1', result: 'a' },
                    { id: 'c2', name: 'r2', result: 'b' },
                ],
            },
        ];
        const out = openAiMessagesFromTool(msgs);
        expect(out).toHaveLength(2);
        expect(out[0].tool_call_id).toBe('c1');
        expect(out[1].tool_call_id).toBe('c2');
    });

    it('encodes assistant tool_calls as the wire format', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call-x', name: 'runQuery', args: { sql: 'SELECT 1' } }],
            },
        ];
        const out = openAiMessagesFromTool(msgs);
        expect(out[0].tool_calls).toHaveLength(1);
        expect(out[0].tool_calls[0]).toMatchObject({
            id: 'call-x',
            type: 'function',
            function: { name: 'runQuery', arguments: JSON.stringify({ sql: 'SELECT 1' }) },
        });
    });

    it('returns empty array for empty input without system instruction', () => {
        expect(openAiMessagesFromTool([])).toEqual([]);
    });

    it('uses empty string for null/undefined message content', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: undefined as any }];
        const out = openAiMessagesFromTool(msgs);
        expect(out[0].content).toBe('');
    });
});
