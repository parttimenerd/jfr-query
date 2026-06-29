import { Content } from "@google/genai";
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, ToolChatMessage, ToolStreamChunk, StreamChatWithToolsOpts } from './IAiProvider';
import type { Tool } from './tools';
import { toolsToLocal, parseLocalToolCalls, buildLocalToolPromptHint } from './tools/localAdapter';
import { LocalAiIcon } from '../../components/icons/LocalAiIcon';
import { Settings } from "../../context/SettingsContext";
import { extractJson, extractText } from './jsonExtract';
import { cleanPlotConfig } from '../ml/candidates';

// LocalAi provider: any OpenAI-compatible /v1/chat/completions endpoint.
//
// Tested against llama.cpp `llama-server` (port 8080), Ollama (port 11434),
// vLLM, LM Studio, and LocalAI. Plays well with 9B-class quantized models such
// as Qwen3-9B-GGUF and the smaller Qwen3-1.7B per jstall's eval harness:
// /Users/i560383_1/code/experiments/jstall/ai-eval/.
//
// Differences from the cloud OpenAI provider:
//  - Configurable base URL (no hardcoded api.openai.com).
//  - API key is OPTIONAL — local servers usually don't require auth. Only
//    sends Authorization when a key is set.
//  - Does NOT use response_format:json_object; many local servers ignore or
//    reject it. Instead requests JSON in the system prompt and parses the
//    response defensively (strips ```json fences, finds first balanced {…}).
//  - Caps `max_tokens` to bound generation time on slow CPUs.
//  - Emits `chat_template_kwargs.enable_thinking=false` (llama-server extension
//    that suppresses Qwen3 chain-of-thought; ignored by other servers).
//  - Retries on 429/503 with exponential backoff.

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_BASIC_MODEL = 'qwen3:1.7b';
const DEFAULT_GOOD_MODEL = 'qwen3:9b';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — local CPUs are slow
const MAX_RETRIES = 3;

const JSON_REQUIRED_INSTRUCTION =
    'CRITICAL: Your response MUST be a single, valid JSON object — nothing else. ' +
    'No markdown fences, no explanation before or after. Begin your response with `{`.';

export class LocalAiProvider implements IAiProvider {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly maxTokens: number;

    constructor(apiKey: string, baseUrl?: string, maxTokens?: number) {
        // Empty API key is OK for local servers. The factory in AiService passes
        // the value of `localApiKey` from settings, which defaults to ''.
        this.apiKey = apiKey || '';
        this.baseUrl = stripTrailingSlash(baseUrl || DEFAULT_BASE_URL);
        this.maxTokens = maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;
    }

    public static getMetadata(): ProviderMetadata {
        return {
            id: 'local',
            name: 'Local OpenAI-compatible',
            description: 'llama.cpp, Ollama, vLLM, LM Studio — any /v1/chat/completions server.',
            icon: LocalAiIcon,
            // Local servers don't need a key; consider "configured" as soon as
            // a base URL is set (default localhost:8080 is preconfigured).
            isConfigured: (settings: Settings) => !!settings.localBaseUrl,
            models: [
                { id: 'qwen3:1.7b', name: 'Qwen3 1.7B', description: 'Fast — basic tasks, ~13s/scenario in jstall eval.' },
                { id: 'qwen3:9b', name: 'Qwen3 9B', description: 'Stronger — agent tasks, ~26s/scenario in jstall eval.' },
                { id: 'llama3.1:8b', name: 'Llama 3.1 8B', description: 'General-purpose 8B model.' },
                { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', description: 'Larger open-weights model.' },
                // Users can also type any free-form model id in the settings field.
            ],
            defaultModels: {
                tiny: DEFAULT_BASIC_MODEL,
                basic: DEFAULT_BASIC_MODEL,
                advanced: DEFAULT_GOOD_MODEL,
            },
        };
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        return headers;
    }

    private buildBody(model: string, messages: Array<{ role: string; content: string }>, opts?: { temperature?: number }) {
        return {
            model,
            messages,
            stream: false,
            max_tokens: this.maxTokens,
            temperature: opts?.temperature ?? 0,
            // llama-server extension to suppress Qwen3 chain-of-thought (~2× speedup).
            // Unknown to other backends, which ignore unrecognized fields.
            chat_template_kwargs: { enable_thinking: false },
        };
    }

    private async sendWithRetry(body: object, signal?: AbortSignal): Promise<string> {
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            if (signal?.aborted) throw new Error('Request aborted.');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
            const onAbort = () => controller.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            let response: Response;
            try {
                response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: this.buildHeaders(),
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            } catch (e: any) {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                if (signal?.aborted) throw new Error('Request aborted.');
                if (e.name === 'AbortError') {
                    throw new Error(`Request to ${this.baseUrl} timed out after ${Math.floor(DEFAULT_REQUEST_TIMEOUT_MS / 60000)} min.`);
                }
                // Network error — likely server is down. Don't retry; surface clearly.
                throw new Error(`Cannot reach local AI server at ${this.baseUrl}: ${e.message ?? e}`);
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
            }

            if (response.ok) {
                const result = await response.json();
                const content = result?.choices?.[0]?.message?.content;
                if (typeof content !== 'string' || content.length === 0) {
                    throw new Error('Local AI server returned an empty response.');
                }
                return content;
            }

            // Retry only on 429 (rate limit) and 503 (service unavailable).
            if (response.status === 429 || response.status === 503) {
                const backoff = 1000 * Math.pow(2, attempt);
                lastErr = new Error(`Server returned ${response.status}; retrying in ${backoff}ms`);
                // B-105: honour AbortSignal during backoff wait so cancel requests aren't delayed.
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(resolve, backoff);
                    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
                });
                if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
                continue;
            }

            // Non-retryable error — extract a useful message.
            const errBody = await response.text().catch(() => '');
            let msg = `Local AI server error ${response.status}`;
            try {
                const parsed = JSON.parse(errBody);
                if (parsed?.error?.message) msg = parsed.error.message;
                else if (typeof parsed?.error === 'string') msg = parsed.error;
            } catch { /* not JSON, stick with status */ }
            if (response.status === 401) throw new Error('Local AI server rejected the API key (401).');
            if (response.status === 404) throw new Error(`Local AI endpoint not found (404). Check the base URL and that the server exposes /v1/chat/completions: ${this.baseUrl}`);
            throw new Error(msg);
        }
        throw lastErr ?? new Error('Local AI request failed after retries.');
    }

    async getAgentResponse(conversationHistory: Content[], systemInstruction: string, model: string = DEFAULT_GOOD_MODEL): Promise<AIResponse> {
        const messages = [
            { role: 'system', content: `${systemInstruction}\n\n${JSON_REQUIRED_INSTRUCTION}\nThe JSON object must have keys "text" (string), "code" (string or null), and "plotConfig" (string or null).` },
            ...conversationHistory.map(c => ({ role: c.role, content: c.parts.map(p => p.text).join('\n') })),
        ];
        const raw = await this.sendWithRetry(this.buildBody(model, messages));
        return extractJson<AIResponse>(raw);
    }

    async getInlineSuggestion(systemInstruction: string, request: string, model: string = DEFAULT_GOOD_MODEL): Promise<AIInlineResponse> {
        const messages = [
            { role: 'system', content: `${systemInstruction}\n\n${JSON_REQUIRED_INSTRUCTION}\nThe JSON object must have keys "text" (string) and "code" (string or null).` },
            { role: 'user', content: request },
        ];
        const raw = await this.sendWithRetry(this.buildBody(model, messages));
        return extractJson<AIInlineResponse>(raw);
    }

    async getCodeFormat(code: string, model: string = DEFAULT_BASIC_MODEL): Promise<string | null> {
        const systemInstruction = `You are a SQL code formatter. Format the given SQL using 2-space indentation.\n` +
            `Return ONLY the formatted SQL — no explanation, no markdown fences, no JSON.`;
        const messages = [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: code },
        ];
        const raw = await this.sendWithRetry(this.buildBody(model, messages, { temperature: 0 }));
        return extractText(raw);
    }

    async getSuggestPlot(systemInstruction: string, sql: string, model: string = DEFAULT_BASIC_MODEL): Promise<string | null> {
        const messages = [
            { role: 'system', content: `${systemInstruction}\n\nReturn ONLY the plot configuration string. No explanation, no markdown fences, no JSON.` },
            { role: 'user', content: sql },
        ];
        const raw = await this.sendWithRetry(this.buildBody(model, messages, { temperature: 0 }));
        const text = extractText(raw);
        if (!text) return null;
        // Small local LLMs often add prose, fences, or special tokens despite
        // the instruction. Route through the same cleaner the local-model
        // path uses so the output is consistently a parseable plot config.
        const cleaned = cleanPlotConfig(text);
        return cleaned || null;
    }

    async getPlotFixSuggestion(systemInstruction: string, model: string = DEFAULT_BASIC_MODEL): Promise<AIPlotFixResponse> {
        const messages = [
            { role: 'system', content: `${systemInstruction}\n\n${JSON_REQUIRED_INSTRUCTION}\nThe JSON object must have keys "explanation" (string) and "fixedCode" (string).` },
            { role: 'user', content: 'Please fix my plot configuration.' },
        ];
        const raw = await this.sendWithRetry(this.buildBody(model, messages));
        return extractJson<AIPlotFixResponse>(raw);
    }

    /**
     * Tool-calling for local OpenAI-compatible servers. Goes through the
     * structured `tools` field on the wire AND injects the local prompt hint
     * (a <tool>{…}</tool> textual fallback) into the system instruction. The
     * adapter parses both shapes — see `parseLocalToolCalls`.
     *
     * B-103: uses real SSE streaming (stream:true) so tokens appear progressively
     * instead of all at once after the full response is received.
     */
    async *streamChatWithTools(
        messages: ToolChatMessage[],
        tools: Tool[],
        opts?: StreamChatWithToolsOpts,
    ): AsyncIterable<ToolStreamChunk> {
        const model = opts?.model || DEFAULT_GOOD_MODEL;
        const wireMessages: any[] = [];
        const sysExtras = tools.length > 0 ? `\n\n${buildLocalToolPromptHint(tools)}` : '';
        if (opts?.systemInstruction || sysExtras) {
            wireMessages.push({ role: 'system', content: (opts?.systemInstruction ?? '') + sysExtras });
        }
        for (const m of messages) {
            if (m.role === 'tool') {
                for (const tr of m.toolResults ?? []) {
                    wireMessages.push({
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
            wireMessages.push(wire);
        }

        const body: any = {
            model,
            messages: wireMessages,
            stream: true,
            max_tokens: this.maxTokens,
            temperature: 0,
            chat_template_kwargs: { enable_thinking: false },
        };
        if (tools.length > 0) body.tools = toolsToLocal(tools);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
        const onAbort = () => controller.abort();
        opts?.signal?.addEventListener('abort', onAbort, { once: true });

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (e: any) {
            clearTimeout(timer);
            opts?.signal?.removeEventListener('abort', onAbort);
            if (opts?.signal?.aborted || e.name === 'AbortError') throw new Error('Request aborted.');
            throw new Error(`Cannot reach local AI server at ${this.baseUrl}: ${e.message ?? e}`);
        } finally {
            clearTimeout(timer);
            opts?.signal?.removeEventListener('abort', onAbort);
        }

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            let msg = `Local AI server error ${response.status}`;
            try {
                const parsed = JSON.parse(errBody);
                if (parsed?.error?.message) msg = parsed.error.message;
                else if (typeof parsed?.error === 'string') msg = parsed.error;
            } catch { /* not JSON */ }
            if (response.status === 401) throw new Error('Local AI server rejected the API key (401).');
            if (response.status === 404) throw new Error(`Local AI endpoint not found (404). Check the base URL: ${this.baseUrl}`);
            throw new Error(msg);
        }

        // Accumulate partial tool-call argument chunks per index, emit at stream end.
        const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
        let fullText = '';
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
                    if (payload === '[DONE]') break;
                    let parsed: any;
                    try { parsed = JSON.parse(payload); } catch { continue; }
                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta) continue;
                    if (delta.content) {
                        fullText += delta.content;
                        yield { kind: 'text', delta: String(delta.content) };
                    }
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
        } finally {
            reader.releaseLock();
        }

        // If the model used textual <tool>…</tool> fallback instead of structured tool_calls,
        // parse it out of the accumulated text buffer.
        if (toolCallBuffers.size === 0 && tools.length > 0 && fullText) {
            const calls = parseLocalToolCalls({ content: fullText });
            for (const call of calls) {
                yield { kind: 'tool_call', id: call.id, name: call.name, args: call.args };
            }
            return;
        }

        for (const buf of toolCallBuffers.values()) {
            let args: any = {};
            try { args = JSON.parse(buf.args); } catch { args = { _raw: buf.args }; }
            yield { kind: 'tool_call', id: buf.id, name: buf.name, args };
        }
    }

    async verifyCredentials(): Promise<boolean> {
        // Probe /v1/models — every OpenAI-compatible server exposes it. Avoids
        // running an actual chat completion (which would download/load the
        // model and take seconds-to-minutes).
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
                signal: controller.signal,
            });
        } catch (e: any) {
            if (e.name === 'AbortError') throw new Error(`Could not reach ${this.baseUrl} within 10s. Is the server running?`);
            throw new Error(`Cannot reach ${this.baseUrl}: ${e.message ?? e}`);
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            if (response.status === 401) throw new Error('API key rejected by local server.');
            if (response.status === 404) throw new Error(`${this.baseUrl}/v1/models not found — is this an OpenAI-compatible server?`);
            throw new Error(`Local server returned ${response.status} on /v1/models.`);
        }
        return true;
    }
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
