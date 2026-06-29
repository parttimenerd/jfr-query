// Anthropic provider tool-result wire-format tests. Targets the two non-obvious
// branches in anthropicMessagesFromTool: structured tool_result text content
// vs. multimodal image blocks (used by screenshotPlot). Also pins the
// supportsImageToolResults capability flag the runtime uses to refuse
// screenshotPlot on text-only providers.

import { describe, it, expect } from 'vitest';
import { AnthropicProvider, anthropicMessagesFromTool } from '../services/ai/AnthropicProvider';
import type { ToolChatMessage } from '../services/ai/IAiProvider';

const makeProvider = () => new AnthropicProvider({} as any);

describe('AnthropicProvider.supportsImageToolResults', () => {
    it('returns true (multimodal tool results are supported)', () => {
        expect(makeProvider().supportsImageToolResults?.()).toBe(true);
    });
});

describe('anthropicMessagesFromTool', () => {
    it('drops system messages — Anthropic carries them at the top level', () => {
        const out = anthropicMessagesFromTool([
            { role: 'system', content: 'You are a helper.' },
            { role: 'user', content: 'hi' },
        ]);
        expect(out).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('serializes a plain tool_result as a JSON string under user role', () => {
        const messages: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [
                    { id: 'call_1', name: 'runQuery', result: { ok: true, data: { rows: [{ a: 1 }] } } },
                ],
            },
        ];
        const out = anthropicMessagesFromTool(messages);
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe('user');
        expect(out[0].content).toEqual([
            {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: JSON.stringify({ ok: true, data: { rows: [{ a: 1 }] } }),
            },
        ]);
    });

    it('emits an image content block when the tool result carries data.image with a base64 data URL', () => {
        const dataUrl = 'data:image/png;base64,AAAA';
        const messages: ToolChatMessage[] = [
            {
                role: 'tool',
                content: '',
                toolResults: [
                    {
                        id: 'call_shot',
                        name: 'screenshotPlot',
                        result: { ok: true, data: { image: { mediaType: 'image/png', dataUrl } } },
                    },
                ],
            },
        ];
        const out = anthropicMessagesFromTool(messages);
        expect(out[0]).toEqual({
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'call_shot',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
                    ],
                },
            ],
        });
    });

    it('also accepts the legacy shape where image lives directly on result.image', () => {
        const dataUrl = 'data:image/jpeg;base64,ZZZZ';
        const out = anthropicMessagesFromTool([
            {
                role: 'tool',
                content: '',
                toolResults: [
                    { id: 'c2', name: 'screenshotPlot', result: { image: { dataUrl } } },
                ],
            },
        ]);
        expect(out[0].content[0].content[0]).toEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'ZZZZ' },
        });
    });

    it('falls back to a JSON string when image.dataUrl is not a parseable base64 data URL', () => {
        const out = anthropicMessagesFromTool([
            {
                role: 'tool',
                content: '',
                toolResults: [
                    { id: 'c3', name: 'screenshotPlot', result: { ok: true, data: { image: { dataUrl: 'https://example.com/img.png' } } } },
                ],
            },
        ]);
        expect(typeof out[0].content[0].content).toBe('string');
        expect(out[0].content[0].content).toContain('example.com');
    });

    it('encodes assistant tool_use blocks alongside any text content', () => {
        const messages: ToolChatMessage[] = [
            {
                role: 'assistant',
                content: 'I will run a query.',
                toolCalls: [{ id: 'q1', name: 'runQuery', args: { sql: 'SELECT 1' } }],
            },
        ];
        const out = anthropicMessagesFromTool(messages);
        expect(out[0]).toEqual({
            role: 'assistant',
            content: [
                { type: 'text', text: 'I will run a query.' },
                { type: 'tool_use', id: 'q1', name: 'runQuery', input: { sql: 'SELECT 1' } },
            ],
        });
    });

    it('omits the text block when assistant content is empty but tool calls exist', () => {
        const out = anthropicMessagesFromTool([
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'q2', name: 'listCells', args: {} }],
            },
        ]);
        expect(out[0].content).toEqual([
            { type: 'tool_use', id: 'q2', name: 'listCells', input: {} },
        ]);
    });

    it('passes through plain user / assistant turns unchanged', () => {
        const out = anthropicMessagesFromTool([
            { role: 'user', content: 'what tables are there?' },
            { role: 'assistant', content: 'There are three tables.' },
        ]);
        expect(out).toEqual([
            { role: 'user', content: 'what tables are there?' },
            { role: 'assistant', content: 'There are three tables.' },
        ]);
    });
});
