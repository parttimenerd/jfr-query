// Local-server tool-calling adapter.
//
// Strategy: many OpenAI-compatible local servers (llama.cpp, Ollama recent
// versions, vLLM, LM Studio) accept the OpenAI tool wire format, but a lot
// of small models won't reliably emit a `tool_calls` field. To stay robust
// we ALSO support a prompt-engineered fallback where the model emits:
//
//   <tool>{"name":"runQuery","args":{"sql":"…"}}</tool>
//
// In practice small quantised models also emit the JSON in other shapes:
// inside ```json fenced blocks, or bare on a line. We accept all three.

import type { Tool } from './index';
import { toolsToOpenAi, parseOpenAiToolCalls, type ParsedToolCall, toolResultToOpenAi } from './openaiAdapter';

export { toolsToOpenAi as toolsToLocal };

// `g` flag means we must reset `lastIndex` each invocation — otherwise calling
// the parser twice on the same string starts mid-stream and misses matches.
const TOOL_TAG_RE = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/g;
const FENCED_JSON_RE = /```(?:json|tool)?\s*(\{[\s\S]*?\})\s*```/g;

export function buildLocalToolPromptHint(tools: Tool[]): string {
    const list = tools
        .map(t => `- ${t.name}(${Object.keys(t.inputSchema.properties ?? {}).join(', ')}): ${t.description}`)
        .join('\n');
    return (
        'TOOL CALLING:\n' +
        'When you need data or a notebook mutation, emit a tool call. Prefer the structured\n' +
        '`tool_calls` field if your runtime supports it. Otherwise emit, on its own line:\n' +
        '<tool>{"name":"<toolName>","args":{ … }}</tool>\n' +
        'A ```json fenced block with the same JSON shape is also accepted.\n' +
        'AVAILABLE TOOLS:\n' +
        list
    );
}

export function parseLocalToolCalls(message: any): ParsedToolCall[] {
    // Path 1: OpenAI-compatible `tool_calls`.
    const structured = parseOpenAiToolCalls(message);
    if (structured.length > 0) return structured;

    const text = typeof message?.content === 'string' ? message.content : '';
    if (!text) return [];

    const out: ParsedToolCall[] = [];
    const seen = new Set<string>();
    let idx = 0;

    const tryPush = (raw: string): void => {
        const obj = safeParseJson(raw);
        if (!obj || typeof obj !== 'object') return;
        const name = typeof obj.name === 'string' ? obj.name : null;
        if (!name) return;
        const args = obj.args && typeof obj.args === 'object'
            ? obj.args
            : (obj.arguments && typeof obj.arguments === 'object' ? obj.arguments : {});
        const key = name + '|' + JSON.stringify(args);
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ id: `local-${name}-${idx++}`, name, args });
    };

    // Path 2: <tool>{...}</tool>.
    TOOL_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOOL_TAG_RE.exec(text)) !== null) tryPush(m[1]);

    // Path 3: ```json {...} ``` (or ```tool, or bare ```).
    FENCED_JSON_RE.lastIndex = 0;
    while ((m = FENCED_JSON_RE.exec(text)) !== null) tryPush(m[1]);

    // Path 4: bare JSON object somewhere in the response that has the
    // characteristic `{ "name": "...", "args": ... }` shape. Only attempt this
    // if nothing was found via the structured paths — bare scanning is
    // expensive and risks false positives on prose containing braces.
    if (out.length === 0) {
        for (const candidate of extractBalancedJsonCandidates(text)) {
            tryPush(candidate);
        }
    }
    return out;
}

function safeParseJson(raw: string): any | null {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Scans a string for top-level JSON objects by counting balanced braces.
// Cheap heuristic; ignores objects inside strings only insofar as the JSON.parse
// step will reject malformed slices. Yields candidates rather than allocating
// the full list up front.
function* extractBalancedJsonCandidates(text: string): Iterable<string> {
    const MAX_CANDIDATES = 8;
    let yielded = 0;
    for (let i = 0; i < text.length && yielded < MAX_CANDIDATES; i++) {
        if (text[i] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let j = i; j < text.length; j++) {
            const ch = text[j];
            if (inString) {
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    yield text.slice(i, j + 1);
                    yielded++;
                    i = j; // skip past this object
                    break;
                }
            }
        }
    }
}

export { toolResultToOpenAi as toolResultToLocal };
