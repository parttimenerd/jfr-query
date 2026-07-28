import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, ToolChatMessage, ToolStreamChunk, StreamChatWithToolsOpts } from './IAiProvider';
import type { Tool } from './tools';
import { toolsToAnthropic, parseAnthropicToolCalls, extractAnthropicText } from './tools/anthropicAdapter';
import { AnthropicIcon } from '../../components/icons/AnthropicIcon';
import { Settings } from "../../context/SettingsContext";

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Convert ToolChatMessage[] to Anthropic /v1/messages wire format. Anthropic
 * uses a top-level `system` (handled by caller), no `system` role inside
 * messages; tool_use blocks live inside assistant messages and tool_result
 * blocks live inside user messages.
 */
export function anthropicMessagesFromTool(messages: ToolChatMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
        if (m.role === 'system') continue; // promoted to top-level `system` by caller
        if (m.role === 'tool') {
            const blocks = (m.toolResults ?? []).map(tr => {
                const img = (tr.result && typeof tr.result === 'object')
                    ? (tr.result.data?.image ?? tr.result.image)
                    : null;
                if (img && typeof img.dataUrl === 'string') {
                    // Anthropic accepts a content array with image blocks for tool_result.
                    const match = /^data:([^;]+);base64,(.+)$/.exec(img.dataUrl);
                    if (match) {
                        return {
                            type: 'tool_result',
                            tool_use_id: tr.id,
                            content: [
                                { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
                            ],
                        };
                    }
                }
                return {
                    type: 'tool_result',
                    tool_use_id: tr.id,
                    content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
                };
            });
            if (blocks.length > 0) out.push({ role: 'user', content: blocks });
            else throw new Error('anthropicMessagesFromTool: tool message has no toolResults — Anthropic requires a tool_result for every tool_use');
            continue;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            const blocks: any[] = [];
            if (m.content) blocks.push({ type: 'text', text: m.content });
            for (const tc of m.toolCalls) {
                blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
            }
            out.push({ role: 'assistant', content: blocks });
            continue;
        }
        out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content ?? '' });
    }
    return out;
}

interface AnthropicRequestBody {
    model: string;
    max_tokens: number;
    system?: string;
    messages: AnthropicMessage[];
}

export class AnthropicProvider implements IAiProvider {
    private apiKey: string;
    private readonly apiUrl: string;
    private readonly ANTHROPIC_VERSION = '2023-06-01';

    constructor(apiKey: string, baseUrl?: string) {
        if (!apiKey) {
            throw new Error("Anthropic API key is required.");
        }
        this.apiKey = apiKey;
        // Strip trailing slash, then append the messages path
        const base = baseUrl ? baseUrl.replace(/\/$/, '') : 'https://api.anthropic.com';
        this.apiUrl = `${base}/v1/messages`;
    }

    public static getMetadata(): ProviderMetadata {
        return {
            id: 'anthropic',
            name: 'Anthropic Claude',
            description: 'Uses the Claude family of models from Anthropic.',
            icon: AnthropicIcon,
            isConfigured: (settings: Settings) => !!settings.anthropicApiKey,
            models: [
                { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest and most compact Claude model.' },
                { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced intelligence and speed.' },
                { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', description: 'Most powerful Claude model.' },
            ],
            defaultModels: {
                tiny: 'claude-haiku-4-5',
                basic: 'claude-sonnet-4-6',
                advanced: 'claude-sonnet-4-6',
            },
            supportsImageToolResults: true,
        };
    }

    private async callApi<T>(
        systemPrompt: string | undefined,
        messages: AnthropicMessage[],
        model: string,
        parseJson: boolean
    ): Promise<T> {
        const body: AnthropicRequestBody = {
            model,
            max_tokens: 4096,
            messages,
        };
        if (systemPrompt) {
            body.system = systemPrompt;
        }

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': this.ANTHROPIC_VERSION,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage = errorBody?.error?.message || 'Unknown Anthropic API error';
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            throw new Error(errorMessage);
        }

        const data = await response.json();
        const text: string = data.content?.[0]?.text ?? '';

        if (!parseJson) {
            return text as unknown as T;
        }

        // Strip markdown fences that Claude sometimes wraps JSON in
        const stripped = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        try {
            return JSON.parse(stripped);
        } catch {
            throw new Error(`Anthropic returned malformed JSON: ${text.slice(0, 200)}`);
        }
    }

    async getAgentResponse(conversationHistory: Array<{ role: string; parts: Array<{ text?: string }> }>, systemInstruction: string, model: string = 'claude-sonnet-4-6'): Promise<AIResponse> {
        const messages: AnthropicMessage[] = conversationHistory.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts.filter(p => typeof p.text === 'string').map(p => p.text!).join('\n'),
        }));

        return this.callApi<AIResponse>(
            systemInstruction + '\n\nRespond with valid JSON with keys "text", "code", and "plotConfig".',
            messages,
            model,
            true
        );
    }

    async getInlineSuggestion(systemInstruction: string, request: string, model: string = 'claude-sonnet-4-6'): Promise<AIInlineResponse> {
        return this.callApi<AIInlineResponse>(
            systemInstruction + '\n\nRespond with valid JSON with keys "text" and "code".',
            [{ role: 'user', content: request }],
            model,
            true
        );
    }

    async getCodeFormat(code: string, model: string = 'claude-sonnet-4-6'): Promise<string | null> {
        const systemInstruction = `You are a SQL code formatter. Your task is to format the given SQL code.
- Use standard SQL formatting with 2-space indentation.
- Return ONLY the formatted code, with no explanations or markdown backticks.`;

        const result = await this.callApi<string>(
            systemInstruction,
            [{ role: 'user', content: code }],
            model,
            false
        );
        return (result as string).trim();
    }

    async getSuggestPlot(systemInstruction: string, sql: string, model: string = 'claude-sonnet-4-6'): Promise<string | null> {
        const result = await this.callApi<string>(
            systemInstruction,
            [{ role: 'user', content: sql }],
            model,
            false
        );
        return (result as string).trim().replace(/```plot\n?|```/g, '').trim();
    }

    async getPlotFixSuggestion(systemInstruction: string, model: string = 'claude-sonnet-4-6'): Promise<AIPlotFixResponse> {
        return this.callApi<AIPlotFixResponse>(
            systemInstruction + '\n\nRespond with valid JSON with keys "explanation" and "fixedCode".',
            [{ role: 'user', content: 'Please fix my plot configuration.' }],
            model,
            true
        );
    }

    async *streamChatWithTools(
        messages: ToolChatMessage[],
        tools: Tool[],
        opts?: StreamChatWithToolsOpts,
    ): AsyncIterable<ToolStreamChunk> {
        const model = opts?.model || 'claude-sonnet-4-6';
        const wireMessages = anthropicMessagesFromTool(messages);
        const body: any = {
            model,
            max_tokens: 4096,
            messages: wireMessages,
            stream: true,
        };
        if (opts?.systemInstruction) body.system = opts.systemInstruction;
        if (tools.length > 0) body.tools = toolsToAnthropic(tools);

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': this.ANTHROPIC_VERSION,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: opts?.signal,
        });
        if (!response.ok) {
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody?.error?.message || `Anthropic tool call failed with status ${response.status}`);
        }

        // B-103: real SSE streaming using Anthropic's event stream format.
        // Tool use blocks start with content_block_start (type=tool_use, id, name)
        // and stream argument JSON via content_block_delta (type=input_json_delta).
        const toolBlocks = new Map<number, { id: string; name: string; args: string }>();
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let leftover = '';
        try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = leftover + decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            leftover = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                let parsed: any;
                try { parsed = JSON.parse(payload); } catch { continue; }
                switch (parsed.type) {
                    case 'content_block_start': {
                        const blk = parsed.content_block;
                        if (blk?.type === 'tool_use') {
                            toolBlocks.set(parsed.index ?? 0, { id: blk.id ?? '', name: blk.name ?? '', args: '' });
                        }
                        break;
                    }
                    case 'content_block_delta': {
                        const d = parsed.delta;
                        if (d?.type === 'text_delta' && d.text) {
                            yield { kind: 'text', delta: String(d.text) };
                        } else if (d?.type === 'input_json_delta' && d.partial_json) {
                            const buf = toolBlocks.get(parsed.index ?? 0);
                            if (buf) buf.args += d.partial_json;
                        }
                        break;
                    }
                    case 'error':
                        throw new Error(parsed.error?.message ?? 'Anthropic stream error');
                    default:
                        break;
                }
            }
        }
        } finally {
            reader.releaseLock();
        }
        if (opts?.signal?.aborted) return;
        for (const buf of toolBlocks.values()) {
            if (!buf.id || !buf.name) continue;
            let args: any;
            try { args = JSON.parse(buf.args); } catch { continue; }
            yield { kind: 'tool_call', id: buf.id, name: buf.name, args };
        }
    }

    supportsImageToolResults(): boolean { return true; }

    async verifyCredentials(): Promise<boolean> {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': this.ANTHROPIC_VERSION,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody?.error?.message || `Anthropic verification failed with status ${response.status}`);
        }
        return true;
    }
}
