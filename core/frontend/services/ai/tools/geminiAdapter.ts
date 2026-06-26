// Gemini function-calling adapter.
//
// Wire shapes (Google Gemini generateContent):
//   request.tools: [{ functionDeclarations: [{ name, description, parameters: <JSON Schema> }] }]
//   response.candidates[0].content.parts: [
//     { text: '…' },
//     { functionCall: { name, args: { … } } },
//   ]
//   subsequent message:
//     { role: 'user', parts: [{ functionResponse: { name, response: { … } } }] }

import type { Tool } from './index';
import type { ParsedToolCall } from './openaiAdapter';

export interface GeminiFunctionDecl {
    name: string;
    description: string;
    parameters: any;
}

export function toolsToGemini(tools: Tool[]): { functionDeclarations: GeminiFunctionDecl[] } {
    return {
        functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
        })),
    };
}

export function parseGeminiToolCalls(parts: any): ParsedToolCall[] {
    if (!Array.isArray(parts)) return [];
    const out: ParsedToolCall[] = [];
    let idx = 0;
    for (const part of parts) {
        const fc = part?.functionCall;
        if (!fc?.name) continue;
        out.push({
            // Gemini doesn't return an id with the call; synthesize a stable one
            // from the call name + index so we can correlate tool_result back.
            id: `gemini-${fc.name}-${idx++}`,
            name: fc.name,
            args: fc.args ?? {},
        });
    }
    return out;
}

export function toolResultToGemini(call: ParsedToolCall, result: any) {
    return {
        functionResponse: {
            name: call.name,
            response: typeof result === 'object' && result !== null ? result : { value: result },
        },
    };
}
