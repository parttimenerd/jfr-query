// Anthropic Messages tool-calling adapter.
//
// Wire shapes (Anthropic /v1/messages):
//   request.tools: [{ name, description, input_schema: <JSON Schema> }]
//   response.content: [
//     { type: 'text', text: '...' },
//     { type: 'tool_use', id: 'toolu_…', name, input: { … } },
//   ]
//   subsequent message:
//     { role: 'user', content: [{ type: 'tool_result', tool_use_id, content }] }

import type { Tool } from './index';
import type { ParsedToolCall } from './openaiAdapter';

export interface AnthropicToolWire {
    name: string;
    description: string;
    input_schema: any;
}

export function toolsToAnthropic(tools: Tool[]): AnthropicToolWire[] {
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
    }));
}

export function parseAnthropicToolCalls(content: any): ParsedToolCall[] {
    if (!Array.isArray(content)) return [];
    const out: ParsedToolCall[] = [];
    for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        out.push({
            id: block.id ?? '',
            name: block.name ?? '',
            args: block.input ?? {},
        });
    }
    return out;
}

export function toolResultToAnthropic(call: ParsedToolCall, result: any) {
    return {
        type: 'tool_result' as const,
        tool_use_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
    };
}

export function extractAnthropicText(content: any): string {
    if (!Array.isArray(content)) return '';
    return content
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text ?? '')
        .join('');
}
