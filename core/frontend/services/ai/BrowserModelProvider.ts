import type { Content } from '@google/genai';
import {
    IAiProvider,
    AIResponse,
    AIInlineResponse,
    AIPlotFixResponse,
    ProviderMetadata,
    PlotSuggestContext,
} from './IAiProvider';
import { BrowserIcon } from '../../components/icons/BrowserIcon';
import { heuristicPlot } from '../ml/heuristicPlot';
import { isParseablePlotConfig } from '../ml/isParseablePlotConfig';
import * as PlotGenerationService from '../ml/PlotGenerationService';
import { CANDIDATES, DEFAULT_MODEL_ID } from '../ml/candidates';
import { suggestNaiveSql, extractPrefix, extractSchema } from './browserSqlRules';
import { generateSqlCompletion, isSqlModelReady } from '../ml/SqlGenerationService';

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
    constructor(private modelId = DEFAULT_MODEL_ID) {}

    static getMetadata(): ProviderMetadata {
        const modelLabels = Object.values(CANDIDATES)
            .map(c => ({ id: c.id, name: c.label, description: `~${c.approxSizeMb}MB download`, group: 'Browser' }));

        return {
            id: 'browser',
            name: 'Browser (offline)',
            description: 'Runs in your browser — no API key required. First use downloads the model.',
            icon: BrowserIcon,
            isConfigured: () => true,
            models: modelLabels,
            defaultModels: {
                tiny: DEFAULT_MODEL_ID,
                basic: DEFAULT_MODEL_ID,
                advanced: DEFAULT_MODEL_ID,
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

    // streamChatWithTools intentionally omitted — browser-side models can't
    // run multi-round tool loops; AiService will throw a clear error if the
    // user tries to chat against this provider.

    async verifyCredentials(): Promise<boolean> {
        // Always "configured" — no credentials needed.
        return true;
    }
}
