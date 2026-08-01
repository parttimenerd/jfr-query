import type { Content } from '@google/genai';
import {
    IAiProvider,
    AIResponse,
    AIInlineResponse,
    AIPlotFixResponse,
    ProviderMetadata,
    PlotSuggestContext,
    type ToolChatMessage,
    type ToolStreamChunk,
    type StreamChatWithToolsOpts,
} from './IAiProvider';
import { BrowserIcon } from '../../components/icons/BrowserIcon';
import { heuristicPlot } from '../ml/heuristicPlot';
import { isParseablePlotConfig } from '../ml/isParseablePlotConfig';
import * as PlotGenerationService from '../ml/PlotGenerationService';
import { CANDIDATES, DEFAULT_MODEL_ID } from '../ml/candidates';
import { suggestNaiveSql, extractPrefix, extractSchema } from './browserSqlRules';
import { generateSqlCompletion, isSqlModelReady } from '../ml/SqlGenerationService';
import { streamBrowserChat, ensureBrowserChatLoaded, DEFAULT_BROWSER_CHAT_MODEL_ID, BROWSER_CHAT_MODELS, type BrowserChatMessage } from './BrowserChatService';

const SQL_MODEL_DISABLED_KEY = 'jfr.sql-model.disabled';

function sqlModelDisabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(SQL_MODEL_DISABLED_KEY) === '1';
    } catch { return false; }
}

const NOT_SUPPORTED = () =>
    Promise.reject(
        new Error(
            'Browser provider only supports plot suggestions and autocomplete ranking. ' +
            'Configure a cloud or local provider for chat features.',
        ),
    );

export class BrowserModelProvider implements IAiProvider {
    constructor(
        private modelId = DEFAULT_MODEL_ID,
        private chatModelId = DEFAULT_BROWSER_CHAT_MODEL_ID,
    ) {}

    static getMetadata(): ProviderMetadata {
        // Chat models shown first so the dropdown defaults to a useful choice
        const chatModelLabels = Object.values(BROWSER_CHAT_MODELS)
            .map(c => ({ id: c.id, name: c.label, description: `~${c.approxSizeMb}MB download`, group: 'Chat' }));
        const chatModelIds = new Set(Object.keys(BROWSER_CHAT_MODELS));
        // Exclude plot models that share IDs with chat models to avoid duplicate keys
        const plotModelLabels = Object.values(CANDIDATES)
            .filter(c => !chatModelIds.has(c.id))
            .map(c => ({ id: c.id, name: c.label, description: `~${c.approxSizeMb}MB download`, group: 'Plot suggester' }));

        return {
            id: 'browser',
            name: 'Browser (offline)',
            description: 'Runs in your browser — no API key required. First use downloads the model.',
            icon: BrowserIcon,
            isConfigured: () => true,
            models: [...chatModelLabels, ...plotModelLabels],
            defaultModels: {
                tiny: DEFAULT_BROWSER_CHAT_MODEL_ID,
                basic: DEFAULT_BROWSER_CHAT_MODEL_ID,
                advanced: DEFAULT_BROWSER_CHAT_MODEL_ID,
            },
        };
    }

    async getSuggestPlot(
        _systemInstruction: string,
        sql: string,
        _model?: string,
        ctx?: PlotSuggestContext,
    ): Promise<string | null> {
        if (!ctx || ctx.columns.length === 0) return 'TABLE()';

        try {
            // Pass typed columns (name + type) directly — the v2 plot-suggester
            // was trained on the typed input format and column types meaningfully
            // affect plot choice (TIMESTAMP → x-axis, DOUBLE → y, VARCHAR → group).
            const generated = await PlotGenerationService.generate(
                sql,
                ctx.columns.map(c => ({ name: c.name, type: c.type })),
                this.modelId,
            );
            if (isParseablePlotConfig(generated)) return generated;
        } catch (err) {
            console.warn('[BrowserModelProvider] generation failed, falling back to heuristic:', err);
        }

        return heuristicPlot(ctx.columns, ctx.sample);
    }

    getAgentResponse: IAiProvider['getAgentResponse'] = NOT_SUPPORTED as any;

    async getInlineSuggestion(
        _systemInstruction: string,
        request: string,
        _model?: string,
    ): Promise<AIInlineResponse> {
        // Plot mode: the orchestrator routes through `getInlineSuggestion`
        // for SQL only; plot ghost-text goes through a dedicated path. So
        // we treat anything here as SQL.

        // Try the trained T5-small SQL model first (offline, in-tree) —
        // but ONLY when it's already warmed. Calling generateSqlCompletion
        // when the model isn't loaded would trigger a ~630MB ONNX fetch on
        // a hot keystroke. Warmup happens out-of-band (settings panel /
        // explicit preload), and we fall through to the naive rules
        // until ready. On any error, fall through to the rules too.
        if (!sqlModelDisabled() && isSqlModelReady()) {
            const prefix = extractPrefix(request);
            if (prefix !== null && prefix.trim().length > 0) {
                try {
                    const schema = extractSchema(request);
                    const completion = await generateSqlCompletion(prefix, schema);
                    if (completion && completion.length > 0 && !completion.includes('<<CURSOR>>')) {
                        return { text: completion, code: completion };
                    }
                } catch (err) {
                    console.warn('[BrowserModelProvider] SQL T5 generation failed, falling back to rules:', err);
                }
            }
        }

        const completion = suggestNaiveSql(request);
        if (completion === null) {
            return { text: '', code: null };
        }
        return { text: completion, code: completion };
    }

    async *stream(
        systemInstruction: string,
        request: string,
        signal: AbortSignal,
        _model: 'cloud-tiny' | 'browser',
    ): AsyncIterable<string> {
        const resp = await this.getInlineSuggestion(systemInstruction, request);
        if (signal.aborted) return;
        const text = resp?.text?.trim();
        if (text) yield text;
    }

    getCodeFormat: IAiProvider['getCodeFormat'] = NOT_SUPPORTED as any;
    getPlotFixSuggestion: IAiProvider['getPlotFixSuggestion'] = NOT_SUPPORTED as any;

    /**
     * Streaming chat using the in-browser causal-LM (Qwen2.5-0.5B-Instruct).
     * No tool calls — yields only text deltas. The AiService browser path
     * already guards against tool dispatch before reaching this method.
     */
    async *streamChatWithTools(
        messages: ToolChatMessage[],
        _tools: any[],
        opts?: StreamChatWithToolsOpts & { onLoadProgress?: (p: number) => void },
    ): AsyncIterable<ToolStreamChunk> {
        const signal = opts?.signal;

        // Convert ToolChatMessage[] → BrowserChatMessage[], injecting the
        // system prompt from opts if present (replaces any existing system msg).
        const chatMessages: BrowserChatMessage[] = [];
        if (opts?.systemInstruction) {
            chatMessages.push({ role: 'system', content: opts.systemInstruction });
        }
        for (const m of messages) {
            if (m.role === 'system' && opts?.systemInstruction) continue; // already injected
            if (m.role === 'tool') continue; // no tool results in browser mode
            if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
                chatMessages.push({ role: m.role, content: m.content ?? '' });
            }
        }

        // Ensure at least one user message exists.
        if (!chatMessages.some(m => m.role === 'user')) return;

        // Respect model override if it names a known chat model; otherwise use the configured chat model.
        const effectiveChatModelId = (opts?.model && opts.model in BROWSER_CHAT_MODELS)
            ? opts.model
            : this.chatModelId;
        for await (const delta of streamBrowserChat(chatMessages, opts?.onLoadProgress, signal, effectiveChatModelId)) {
            yield { kind: 'text', delta };
        }
    }

    async verifyCredentials(): Promise<boolean> {
        return true;
    }
}
