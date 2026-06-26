// OpenAI Chat Completions tool-calling adapter.
//
// Wire shapes (OpenAI Chat Completions):
//   request.tools: [{ type: 'function', function: { name, description, parameters: <JSON Schema> } }]
//   response.choices[0].message.tool_calls: [{ id, type: 'function', function: { name, arguments: <stringified JSON> } }]
//   subsequent message: { role: 'tool', tool_call_id, content: <stringified JSON> }

import type { Tool } from './index';

export interface OpenAiToolWire {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

export interface ParsedToolCall {
    id: string;
    name: string;
    args: any;
}

export function toolsToOpenAi(tools: Tool[]): OpenAiToolWire[] {
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
        },
    }));
}

export function parseOpenAiToolCalls(message: any): ParsedToolCall[] {
    const raw = message?.tool_calls;
    if (!Array.isArray(raw)) return [];
    const out: ParsedToolCall[] = [];
    for (const call of raw) {
        if (call?.type !== 'function' || !call?.function) continue;
        const id = call.id ?? '';
        const name = call.function.name ?? '';
        if (!id || !name) continue;
        let args: any = {};
        try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
            args = { _raw: call.function.arguments };
        }
        out.push({ id, name, args });
    }
    return out;
}

export function toolResultToOpenAi(call: ParsedToolCall, result: any) {
    return {
        role: 'tool' as const,
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
    };
}
