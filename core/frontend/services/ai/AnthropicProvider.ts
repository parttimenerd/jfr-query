import { Content } from "@google/genai";
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
function anthropicMessagesFromTool(messages: ToolChatMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
        if (m.role === 'system') continue; // promoted to top-level `system` by caller
        if (m.role === 'tool') {
            const blocks = (m.toolResults ?? []).map(tr => ({
                type: 'tool_result',
                tool_use_id: tr.id,
                content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
            }));
            if (blocks.length > 0) out.push({ role: 'user', content: blocks });
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
    private readonly API_URL = 'https://api.anthropic.com/v1/messages';
    private readonly ANTHROPIC_VERSION = '2023-06-01';

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("Anthropic API key is required.");
        }
        this.apiKey = apiKey;
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

        const response = await fetch(this.API_URL, {
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

    async getAgentResponse(conversationHistory: Content[], systemInstruction: string, model: string = 'claude-sonnet-4-6'): Promise<AIResponse> {
        const messages: AnthropicMessage[] = conversationHistory.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts.map(p => (p as any).text ?? '').join('\n'),
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
        };
        if (opts?.systemInstruction) body.system = opts.systemInstruction;
        if (tools.length > 0) body.tools = toolsToAnthropic(tools);

        const response = await fetch(this.API_URL, {
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
        const data = await response.json();
        const content = data.content;
        const text = extractAnthropicText(content);
        if (text) yield { kind: 'text', delta: text };
        for (const call of parseAnthropicToolCalls(content)) {
            yield { kind: 'tool_call', id: call.id, name: call.name, args: call.args };
        }
    }

    async verifyCredentials(): Promise<boolean> {
        const response = await fetch(this.API_URL, {
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
