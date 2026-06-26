import { Content } from "@google/genai";
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, ToolChatMessage, ToolStreamChunk, StreamChatWithToolsOpts } from './IAiProvider';
import type { Tool } from './tools';
import { toolsToOpenAi, parseOpenAiToolCalls } from './tools/openaiAdapter';
import { OpenAiIcon } from '../../components/icons/OpenAiIcon';
import { Settings } from "../../context/SettingsContext";

/**
 * Convert ToolChatMessage[] into OpenAI chat-completions wire messages.
 * Keeps tool_calls / tool messages intact so multi-round tool loops stay
 * coherent across calls.
 */
function openAiMessagesFromTool(messages: ToolChatMessage[], systemInstruction?: string): any[] {
    const out: any[] = [];
    if (systemInstruction) out.push({ role: 'system', content: systemInstruction });
    for (const m of messages) {
        if (m.role === 'tool') {
            // Each tool result becomes its own role:tool message keyed by tool_call_id.
            for (const tr of m.toolResults ?? []) {
                out.push({
                    role: 'tool',
                    tool_call_id: tr.id,
                    content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
                });
            }
            continue;
        }
        const wire: any = { role: m.role, content: m.content ?? '' };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            wire.tool_calls = m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
            }));
        }
        out.push(wire);
    }
    return out;
}

export class OpenAiProvider implements IAiProvider {
    private apiKey: string;
    private readonly API_URL = 'https://api.openai.com/v1/chat/completions';
    
    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("OpenAI API key is required.");
        }
        this.apiKey = apiKey;
    }

    public static getMetadata(): ProviderMetadata {
         return {
            id: 'openai',
            name: 'OpenAI GPT',
            description: 'Uses the GPT family of models from OpenAI.',
            icon: OpenAiIcon,
            isConfigured: (settings: Settings) => !!settings.openaiApiKey,
            models: [
                { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and cost-effective for basic tasks.' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Tiny, fast, low-cost — autocomplete / plot suggest.' },
                { id: 'gpt-4o', name: 'GPT-4o', description: 'Newest, most efficient flagship model.' },
                { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Powerful and intelligent model.' },
            ],
            defaultModels: {
                tiny: 'gpt-4o-mini',
                basic: 'gpt-3.5-turbo',
                advanced: 'gpt-4o',
            },
        };
    }

    private async handleApiCall<T>(body: object): Promise<T> {
        const response = await fetch(this.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage = errorBody?.error?.message || 'Unknown OpenAI API error';
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            throw new Error(errorMessage);
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Received an empty response from OpenAI.");
        }
        try {
            return JSON.parse(content);
        } catch (e) {
            // If it's not JSON, return it as-is for non-JSON requests
            return content as unknown as T;
        }
    }
    
    async getAgentResponse(conversationHistory: Content[], systemInstruction: string, model: string = 'gpt-4o'): Promise<AIResponse> {
         const messages = [
            { role: "system", content: systemInstruction },
            ...conversationHistory.map(c => ({ role: c.role, content: c.parts.map(p => p.text).join('\n') }))
        ];

        return this.handleApiCall<AIResponse>({
            model,
            messages,
            response_format: { type: "json_object" }
        });
    }

    async getInlineSuggestion(systemInstruction: string, request: string, model: string = 'gpt-4o'): Promise<AIInlineResponse> {
        return this.handleApiCall<AIInlineResponse>({
            model,
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: request }
            ],
            response_format: { type: "json_object" }
        });
    }
    
    async getCodeFormat(code: string, model: string = 'gpt-3.5-turbo'): Promise<string | null> {
       const systemInstruction = `You are a SQL code formatter. Your task is to format the given SQL code.
- Use standard SQL formatting with 2-space indentation.
- Return ONLY the formatted code, with no explanations or markdown backticks. Do not wrap it in JSON or markdown.`;
       
        const response = await this.handleApiCall<string>({
            model,
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: code }
            ],
            temperature: 0
        });
        return response.trim().replace(/```sql\n|```/g, '').trim();
    }
    
    async getSuggestPlot(systemInstruction: string, sql: string, model: string = 'gpt-3.5-turbo'): Promise<string | null> {
         const response = await this.handleApiCall<string>({
            model,
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: sql }
            ],
            temperature: 0
        });
        return response.trim().replace(/```plot\n|```/g, '').trim();
    }

    async getPlotFixSuggestion(systemInstruction: string, model: string = 'gpt-3.5-turbo'): Promise<AIPlotFixResponse> {
         return this.handleApiCall<AIPlotFixResponse>({
            model,
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: "Please fix my plot configuration." }
            ],
            response_format: { type: "json_object" }
        });
    }
    
    async *streamChatWithTools(
        messages: ToolChatMessage[],
        tools: Tool[],
        opts?: StreamChatWithToolsOpts,
    ): AsyncIterable<ToolStreamChunk> {
        const model = opts?.model || 'gpt-4o';
        const wireMessages = openAiMessagesFromTool(messages, opts?.systemInstruction);
        const body: any = {
            model,
            messages: wireMessages,
            stream: true,
        };
        if (tools.length > 0) body.tools = toolsToOpenAi(tools);

        const response = await fetch(this.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: opts?.signal,
        });
        if (!response.ok) {
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody?.error?.message || `OpenAI tool call failed with status ${response.status}`);
        }

        // B-103: real SSE streaming — accumulate partial tool-call argument chunks
        // per tool_call index, then emit complete tool_call chunks at stream end.
        const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let leftover = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = leftover + decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            leftover = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') break;
                let parsed: any;
                try { parsed = JSON.parse(payload); } catch { continue; }
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;
                if (delta.content) yield { kind: 'text', delta: String(delta.content) };
                if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx: number = tc.index ?? 0;
                        if (!toolCallBuffers.has(idx)) {
                            toolCallBuffers.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
                        }
                        const buf = toolCallBuffers.get(idx)!;
                        if (tc.id) buf.id = tc.id;
                        if (tc.function?.name) buf.name = tc.function.name;
                        if (tc.function?.arguments) buf.args += tc.function.arguments;
                    }
                }
            }
        }
        for (const buf of toolCallBuffers.values()) {
            let args: any = {};
            try { args = JSON.parse(buf.args); } catch { args = { _raw: buf.args }; }
            yield { kind: 'tool_call', id: buf.id, name: buf.name, args };
        }
    }

    async verifyCredentials(): Promise<boolean> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
            response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                signal: controller.signal,
            });
        } catch (e: any) {
            if (e.name === 'AbortError') throw new Error('Request timed out.');
            throw e;
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API Key');
            }
            if (response.status === 429) {
                throw new Error('Quota Exceeded');
            }
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage = errorBody?.error?.message || `OpenAI verification failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        return true;
    }
}