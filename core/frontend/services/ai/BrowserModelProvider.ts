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
            const generated = await PlotGenerationService.generate(
                sql,
                ctx.columns.map(c => c.name),
                this.modelId,
            );
            if (isParseablePlotConfig(generated)) return generated;
        } catch (err) {
            console.warn('[BrowserModelProvider] generation failed, falling back to heuristic:', err);
        }

        return heuristicPlot(ctx.columns, ctx.sample);
    }

    getAgentResponse: IAiProvider['getAgentResponse'] = NOT_SUPPORTED as any;
    getInlineSuggestion: IAiProvider['getInlineSuggestion'] = NOT_SUPPORTED as any;
    getCodeFormat: IAiProvider['getCodeFormat'] = NOT_SUPPORTED as any;
    getPlotFixSuggestion: IAiProvider['getPlotFixSuggestion'] = NOT_SUPPORTED as any;

    async verifyCredentials(): Promise<boolean> {
        // Always "configured" — no credentials needed.
        return true;
    }
}
