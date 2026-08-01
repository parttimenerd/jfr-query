import { describe, it, expect } from 'vitest';
import { openAiMessagesFromTool } from '../../../services/ai/OpenAiProvider';
import { geminiContentsFromTool } from '../../../services/ai/GeminiProvider';
import type { ToolChatMessage } from '../../../services/ai/IAiProvider';

// ── openAiMessagesFromTool ────────────────────────────────────────────────────

describe('openAiMessagesFromTool', () => {
    it('converts a user message', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'Hello' }];
        const result = openAiMessagesFromTool(msgs);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
        expect(result[0].content).toBe('Hello');
    });

    it('converts an assistant message', () => {
        const msgs: ToolChatMessage[] = [{ role: 'assistant', content: 'Hi there' }];
        const result = openAiMessagesFromTool(msgs);
        expect(result[0].role).toBe('assistant');
        expect(result[0].content).toBe('Hi there');
    });

    it('prepends system instruction as system role when provided', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'Hello' }];
        const result = openAiMessagesFromTool(msgs, 'You are a helper.');
        expect(result[0].role).toBe('system');
        expect(result[0].content).toBe('You are a helper.');
        expect(result).toHaveLength(2);
    });

    it('skips system messages already in the array', () => {
        const msgs: ToolChatMessage[] = [
            { role: 'system', content: 'System msg' },
            { role: 'user', content: 'Hello' },
        ];
        const result = openAiMessagesFromTool(msgs);
        // system role messages in the array are skipped
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
    });

    it('converts tool results to role:tool messages', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                toolResults: [{ id: 'call-1', name: 'runQuery', result: [{ a: 1 }] }],
            },
        ];
        const result = openAiMessagesFromTool(msgs);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('tool');
        expect(result[0].tool_call_id).toBe('call-1');
    });

    it('serializes tool result object to JSON string', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                toolResults: [{ id: 'call-1', name: 'runQuery', result: [{ a: 1 }] }],
            },
        ];
        const result = openAiMessagesFromTool(msgs);
        expect(typeof result[0].content).toBe('string');
        expect(result[0].content).toContain('"a"');
    });

    it('embeds tool_calls in assistant message when toolCalls present', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: 'Let me run this.',
                toolCalls: [{ id: 'tc-1', name: 'runQuery', args: { sql: 'SELECT 1' } }],
            },
        ];
        const result = openAiMessagesFromTool(msgs);
        expect(result[0].tool_calls).toHaveLength(1);
        expect(result[0].tool_calls[0].function.name).toBe('runQuery');
        expect(result[0].tool_calls[0].type).toBe('function');
    });

    it('handles empty messages array', () => {
        expect(openAiMessagesFromTool([])).toEqual([]);
    });
});

// ── geminiContentsFromTool ────────────────────────────────────────────────────

describe('geminiContentsFromTool', () => {
    it('converts a user message to role:user with text part', () => {
        const msgs: ToolChatMessage[] = [{ role: 'user', content: 'Hello' }];
        const result = geminiContentsFromTool(msgs);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
        expect(result[0].parts[0]).toEqual({ text: 'Hello' });
    });

    it('converts an assistant message to role:model', () => {
        const msgs: ToolChatMessage[] = [{ role: 'assistant', content: 'Hi' }];
        const result = geminiContentsFromTool(msgs);
        expect(result[0].role).toBe('model');
    });

    it('skips system messages', () => {
        const msgs: ToolChatMessage[] = [
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Hello' },
        ];
        const result = geminiContentsFromTool(msgs);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
    });

    it('converts tool results to functionResponse parts', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                toolResults: [{ id: 'tc-1', name: 'runQuery', result: { rows: [] } }],
            },
        ];
        const result = geminiContentsFromTool(msgs);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
        expect(result[0].parts[0].functionResponse?.name).toBe('runQuery');
    });

    it('includes functionCall parts in assistant message when toolCalls present', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: 'Calling tool.',
                toolCalls: [{ id: 'tc-1', name: 'runQuery', args: { sql: 'SELECT 1' } }],
            },
        ];
        const result = geminiContentsFromTool(msgs);
        expect(result[0].role).toBe('model');
        const funcPart = result[0].parts.find((p: any) => p.functionCall);
        expect(funcPart?.functionCall?.name).toBe('runQuery');
    });

    it('handles empty messages array', () => {
        expect(geminiContentsFromTool([])).toEqual([]);
    });

    it('wraps non-object tool results in { value: ... }', () => {
        const msgs: ToolChatMessage[] = [
            {
                role: 'tool',
                toolResults: [{ id: 'tc-1', name: 'runQuery', result: 'simple string' }],
            },
        ];
        const result = geminiContentsFromTool(msgs);
        expect(result[0].parts[0].functionResponse?.response).toEqual({ value: 'simple string' });
    });
});
