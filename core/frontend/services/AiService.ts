import type { Content } from "@google/genai";
import type { TableSchema, ViewSchema, MacroSchema } from '../types';
import { plotRegistry } from '../components/plots/plotRegistry';
import { generateSignature } from '../utils/plotUtils';
import { normalizeChannelTitle } from '../components/chat/channelTitle';
import type { PlotRegistration } from '../components/plots/plotTypes';
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, AiProviderType, PlotSuggestContext, type ToolChatMessage, type ToolStreamChunk } from './ai/IAiProvider';
import { GeminiProvider } from './ai/GeminiProvider';
import { OpenAiProvider } from './ai/OpenAiProvider';
import { AnthropicProvider } from './ai/AnthropicProvider';
import { GardenerProvider } from './ai/GardenerProvider';
import { LocalAiProvider } from './ai/LocalAiProvider';
import { BrowserModelProvider } from './ai/BrowserModelProvider';
import { Settings } from '../context/SettingsContext';
import {
    buildContextPayload,
    type VisibilityMode,
    type RecentResult,
    type SchemaBundle,
} from './ai/visibility';
import { TOOLS, executeTool, type ToolDeps, type Tool } from './ai/tools/runtime';

export type { VisibilityMode, RecentResult } from './ai/visibility';

/**
 * Thrown by AiService when a feature is invoked against a cloud provider while
 * its offline-only switch is enabled in Settings (e.g. autocompleteOfflineOnly
 * is true and the active aiProvider is a cloud provider). Callers can catch
 * this and degrade silently (autocomplete UI just stops suggesting) instead
 * of surfacing a toast on every keystroke.
 */
export class AiOfflineEnforcedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AiOfflineEnforcedError';
    }
}

export type AiFeature = 'autocomplete' | 'plotSuggest' | 'chat';
export type AiTier = 'tiny' | 'basic' | 'advanced';

// Each provider may need provider-specific construction args (e.g. base URL,
// max tokens). The factory below constructs the right one given current settings.
type ProviderFactory = (settings: Settings) => IAiProvider;

export const providerFactoryRegistry: Record<AiProviderType, ProviderFactory> = {
    google: (s) => new GeminiProvider(AiService.getEffectiveApiKey('google', s)),
    openai: (s) => new OpenAiProvider(AiService.getEffectiveApiKey('openai', s)),
    anthropic: (s) => new AnthropicProvider(AiService.getEffectiveApiKey('anthropic', s), s.anthropicBaseUrl || undefined),
    gardener: (s) => new GardenerProvider(AiService.getEffectiveApiKey('gardener', s)),
    local: (s) => new LocalAiProvider(
        AiService.getEffectiveApiKey('local', s),
        s.localBaseUrl,
        s.localMaxTokens,
    ),
    browser: (s) => new BrowserModelProvider(s.browserModelId),
};

// Backward-compat: existing call sites construct directly with `new ProviderClass(apiKey)`.
// SettingsModal still uses this for the "Test Key" button.
export const providerRegistry: Record<AiProviderType, new (apiKey: string) => IAiProvider> = {
    google: GeminiProvider,
    openai: OpenAiProvider,
    anthropic: AnthropicProvider,
    gardener: GardenerProvider,
    local: LocalAiProvider as unknown as new (apiKey: string) => IAiProvider,
    browser: BrowserModelProvider as unknown as new (apiKey: string) => IAiProvider,
};

export const providerMetadataRegistry: Record<AiProviderType, ProviderMetadata> = {
    google: GeminiProvider.getMetadata(),
    openai: OpenAiProvider.getMetadata(),
    anthropic: AnthropicProvider.getMetadata(),
    gardener: GardenerProvider.getMetadata(),
    local: LocalAiProvider.getMetadata(),
    browser: BrowserModelProvider.getMetadata(),
};

class AiService {
    private provider: IAiProvider | null = null;
    private onCriticalError: (() => void) | null = null;
    private settings: Settings | null = null;

    /**
     * Returns the effective API key for a provider: settings value takes priority,
     * then the corresponding process.env variable (injected by vite.config.ts).
     */
    static getEffectiveApiKey(provider: AiProviderType, settings: Settings): string {
        const envKeys: Record<AiProviderType, string | undefined> = {
            google: process.env.GEMINI_API_KEY || process.env.API_KEY,
            openai: process.env.OPENAI_API_KEY,
            anthropic: process.env.ANTHROPIC_API_KEY,
            gardener: process.env.GARDENER_API_KEY,
            local: process.env.LOCAL_AI_API_KEY,
            browser: undefined,
        };
        const settingsKey = provider === 'google' ? settings.googleApiKey
            : provider === 'openai' ? settings.openaiApiKey
            : provider === 'anthropic' ? settings.anthropicApiKey
            : provider === 'gardener' ? settings.gardenerApiKey
            : provider === 'local' ? settings.localApiKey
            : ''; // browser has no API key
        return settingsKey || envKeys[provider] || '';
    }

    initialize(settings: Settings): boolean {
        this.settings = settings;
        const { aiProvider } = settings;
        const factory = providerFactoryRegistry[aiProvider];

        // Browser provider needs no credentials; local needs a base URL; others need an API key.
        const hasCredentials = aiProvider === 'browser'
            ? true
            : aiProvider === 'local'
            ? !!settings.localBaseUrl
            : !!AiService.getEffectiveApiKey(aiProvider, settings);

        if (factory && hasCredentials) {
            try {
                this.provider = factory(settings);
                return true;
            } catch (error) {
                console.error(`Failed to initialize AI provider '${aiProvider}':`, error);
                this.provider = null;
                return false;
            }
        }

        this.provider = null;
        return false;
    }

    registerErrorCallback(callback: (() => void) | null) {
        this.onCriticalError = callback;
    }
    
    isInitialized(): boolean {
        return this.provider !== null;
    }

    private async handleApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
        if (!this.provider) {
            throw new Error("AI Service not initialized — configure an API key in ⚙ Settings first.");
        }
        try {
            return await apiCall();
        } catch (error: any) {
            if (error.message === 'Invalid API Key' || error.message === 'Quota Exceeded') {
                this.onCriticalError?.();
            }
            throw error;
        }
    }
    
    // --- Prompt Generation ---

    private generateSchemaDescription(tables: TableSchema[], views: ViewSchema[], macros: MacroSchema[]): string {
      let description = 'You can use the following tables, views, and macros in your DuckDB SQL queries.\n\n';
      description += 'TABLES:\n' + tables.map(t => `- "${t.name}": (${t.columns.map(c => `"${c.name}" ${c.type}`).join(', ')})`).join('\n');
      description += '\n\nVIEWS:\n' + views.map(v => `- "${v.name}": A view with the query: ${v.query}`).join('\n');
      description += '\n\nMACROS:\n' + macros.map(m => `- ${m.name}(${m.parameters.join(', ')}): A macro with the definition: ${m.sql}`).join('\n');
      return description;
    }

    private generatePlottingDocsPrompt(): string {
        let doc = 'PLOTTING DOCUMENTATION:\n\n';
        doc += 'You can render plots using function-call syntax. You can arrange them in a grid.\n';
        doc += '- Side-by-side: `PLOT_A(...); PLOT_B(...)` (use semicolon or single newline).\n';
        doc += '- New row: `PLOT_A(...)` then an empty line, then `PLOT_B(...)`.\n\n';
        doc += 'ADVANCED SYNTAX (appended to a plot call):\n';
        doc += '- `... TITLE "My Title"`: Add a title above the plot.\n';
        doc += '- `... ON query_ref`: Specify which query result to use. `query_ref` is a 1-based index (e.g., `ON 1`) or a query alias defined with `CREATE VIEW ...`.\n';
        doc += '- `... ON q1, q2`: For supported plots, combine data from multiple queries.\n';
        doc += '- `... WIDTH size`: Set width (e.g., `WIDTH 300px`, `WIDTH 50%`).\n';
        doc += '- `... HEIGHT size`: Set height (e.g., `HEIGHT 300px`).\n';
        doc += '- `... ZOOM factor`: Scale the plot visually (e.g., `ZOOM 0.9` for 90%).\n';
        doc += '- `... ZOOM_X factor`: Scale only the horizontal axis (e.g., `ZOOM_X 1.5`).\n';
        doc += '- `... LEGEND AT RIGHT|LEFT|TOP|BOTTOM|NONE`: Position the legend. Use `LEGEND HIDDEN` to suppress it.\n';
        doc += '- `... PALETTE "palette_name"`: Set color palette. Named: category10, tableau10, pastel1, dark2, set2. Or hex list: `"#e41a1c,#377eb8"`.\n';
        doc += '- `... AXIS_X TYPE time FORMAT "HH:mm" LABEL "label" DOMAIN [min,max]`: Configure X axis. TYPE: linear|log|time|band.\n';
        doc += '- `... AXIS_Y TYPE log DOMAIN [0, 100]`: Configure Y axis. Same sub-clauses as AXIS_X.\n';
        doc += '- `... BRUSH $var MODE X|Y|XY`: Add a brush overlay; for X/Y mode writes `$var.brush.lo`/`$var.brush.hi`; for XY mode writes `$var.brush.x_lo`, `$var.brush.x_hi`, `$var.brush.y_lo`, `$var.brush.y_hi`. Use in SQL like `WHERE col BETWEEN $$var.brush.lo AND $$var.brush.hi`.\n';
        doc += '- `... LINK_X($start, $end, [master], [clamp])`: Links a plot\'s X-axis to local variables for interactive zooming and panning. All plots linked to the same variables are synchronized.\n';
        doc += '  - `master`: This plot will set the initial values of the variables to its full data range.\n';
        doc += '  - `clamp`: Prevents zooming or panning beyond this plot\'s own data range.\n';
        doc += '- `... LINK_Y $var`: Link Y-axis viewport to a cell variable for shared Y-range.\n';
        doc += '- `... LINK_SCROLL "group"`: Synchronise scroll position with other plots in the same named group.\n';
        doc += '- `... TOOLTIP COLUMNS [col1, col2]`: Limit hover tooltip to specific columns.\n';
        doc += '- `... ON HOVER TOOLTIP "{col1}: {col2}"`: Custom tooltip template with {column} placeholders.\n';
        doc += '- `... DATASET table_name`: Use a DuckDB table/view as data source instead of query result.\n';
        doc += '- `... DISABLED`: Suppress rendering of this plot — shows a placeholder. Use to temporarily hide without deleting config.\n\n';
        doc += 'AVAILABLE PLOT FUNCTIONS:\n---\n';
        for (const plot of Object.values(plotRegistry) as PlotRegistration[]) {
            doc += `FUNCTION: ${plot.name}${generateSignature(plot.params)}\nDESCRIPTION: ${plot.description}\n`;
            if (plot.supportsMultiQuery) doc += 'SUPPORTS MULTIPLE QUERIES: Yes\n';
            if (plot.params.length > 0) {
                doc += 'PARAMETERS:\n' + plot.params.map(p => `  - ${p.name} (${p.type}): ${p.description} ${p.required ? '(Required)' : ''}`).join('\n') + '\n';
            }
            if (plot.examples.length > 0) {
                doc += 'EXAMPLES:\n' + plot.examples.map(ex => `  - ${ex.description}\n    \`\`\`plot\n    ${ex.code}\n    \`\`\``).join('\n') + '\n';
            }
            doc += '---\n';
        }
        return doc;
    }
    
    private getModelFor(tier: AiTier, feature?: AiFeature): string {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const { aiProvider } = this.settings;

        // Per-feature override may short-circuit tier resolution.
        if (feature === 'autocomplete') {
            const override = this.settings.autocompleteModelOverride;
            if (override === 'custom') {
                const custom = this.settings.autocompleteCustomModel?.trim();
                if (custom) return custom;
            } else if (override === 'tiny' || override === 'basic') {
                tier = override;
            }
        } else if (feature === 'plotSuggest') {
            const override = this.settings.plotSuggestModelOverride;
            if (override === 'custom') {
                const custom = this.settings.plotSuggestCustomModel?.trim();
                if (custom) return custom;
            } else if (override === 'tiny' || override === 'basic') {
                tier = override;
            }
        }

        const validProviders: Record<string, true> = {
            google: true, openai: true, anthropic: true, gardener: true, local: true, browser: true,
        };
        if (!validProviders[aiProvider]) {
            throw new Error(`Unknown AI provider: ${aiProvider}`);
        }

        let key: keyof Settings;
        if (tier === 'tiny') {
            key = `${aiProvider}TinyModel` as keyof Settings;
            const tinyModel = (this.settings[key] as string) ?? '';
            if (tinyModel && tinyModel.trim()) return tinyModel;
            // Fall back to basic if tiny is empty.
            key = `${aiProvider}BasicModel` as keyof Settings;
        } else if (tier === 'advanced') {
            key = `${aiProvider}GoodModel` as keyof Settings;
        } else {
            key = `${aiProvider}BasicModel` as keyof Settings;
        }
        return (this.settings[key] as string) ?? '';
    }

    /**
     * Throws AiOfflineEnforcedError when the feature is restricted to offline
     * models in Settings and the active provider is not local/browser. Chat
     * has no offline switch and is always allowed.
     */
    private assertOfflineAllowed(feature: AiFeature): void {
        if (!this.settings) return;
        const key = feature === 'autocomplete' ? 'autocompleteOfflineOnly'
                  : feature === 'plotSuggest'  ? 'plotSuggestOfflineOnly'
                  : null;
        if (!key) return;
        if (!this.settings[key]) return;
        const provider = this.settings.aiProvider;
        if (provider === 'browser' || provider === 'local') return;
        throw new AiOfflineEnforcedError(
            `${feature} is restricted to offline models in Settings; switch the active provider to 'local' or 'browser', or disable the offline restriction.`
        );
    }

    // --- Public API Methods ---

    async getAiAgentResponse(conversationHistory: Content[], tables: TableSchema[], views: ViewSchema[], macros: MacroSchema[], customPromptOverride?: string, visibility: VisibilityMode = 'no-data', recentResult?: RecentResult | null): Promise<AIResponse> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('advanced');

        const schemaDescription = this.generateSchemaDescription(tables, views, macros);
        const plottingDocs = this.generatePlottingDocsPrompt();
        // C2 — Build the visibility-controlled context block. Single point of
        // construction for any view of recent query data; also scrubs the
        // protected token. Schema block above remains for prompt-shape
        // backwards compatibility.
        const visibilityBlock = buildContextPayload(
            visibility,
            { tables, views, macros },
            recentResult ?? null,
            this.settings.visibilityFullRowLimit,
        );
        let systemInstruction = `You are an expert DuckDB and data visualization assistant for analyzing Java Flight Recorder (JFR) data.
Your goal is to help users by writing SQL queries and suggesting appropriate visualizations.
${schemaDescription}
${plottingDocs}
DATA CONTEXT (visibility=${visibility}):
${visibilityBlock}
GUIDELINES:
1.  Understand the user's request from the conversation history.
2.  If a query is needed, generate valid DuckDB SQL. Use \`CREATE VIEW descriptive_name AS SELECT ...\` for complex queries.
3.  To filter by time, use a WHERE clause with the make_timestamp_ns() function. Example: WHERE "startTime" >= make_timestamp_ns($start_ns) AND "startTime" <= make_timestamp_ns($end_ns). The user is responsible for defining the $start_ns and $end_ns variables.
4.  Suggest a suitable plot configuration. Prefer rich visualizations (e.g., LINE_CHART) over TABLE() when appropriate.
5.  For time-series data, you MUST suggest a LINE_CHART.
6.  To create interactive dashboards, suggest multiple plots linked with the same \`LINK_X($start, $end)\` variables. This is great for comparing related time-series data.
7.  Provide a brief, friendly explanation.
8.  If the request is conversational, respond naturally without code.
9.  All responses must be in JSON format with keys "text", "code", and "plotConfig".
10. SQL table/column names are case-sensitive; enclose them in double quotes.`;
        
        const finalCustomPrompt = customPromptOverride ?? this.settings.customSystemPrompt;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }
        
        return this.handleApiCall(() => this.provider!.getAgentResponse(conversationHistory, systemInstruction, model));
    }
    
    async getAiInlineSuggestion(request: string, targetType: 'sql' | 'plot', targetValue: string, cellContext: string, fullNotebookContext?: string, data?: any[], customPromptOverride?: string, visibility: VisibilityMode = 'no-data', recentResult?: RecentResult | null, tier: AiTier = 'advanced', variables?: Record<string, string>): Promise<AIInlineResponse> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        this.assertOfflineAllowed('autocomplete');
        const model = this.getModelFor(tier, 'autocomplete');

        // C2 — Visibility-aware data sample. When the caller passes a structured
        // `recentResult`, route through the central buildContextPayload so
        // sanitized/full modes apply uniformly. Fall back to the legacy `data`
        // array (top-5 raw rows) for back-compat when `recentResult` is not
        // provided AND visibility allows it (no-data suppresses leakage).
        let dataSample = '';
        if (recentResult) {
            dataSample = `\nDATA CONTEXT (visibility=${visibility}):\n${buildContextPayload(
                visibility,
                null,
                recentResult,
                this.settings.visibilityFullRowLimit,
            )}`;
        } else if (data && visibility !== 'no-data') {
            dataSample = `The current query produces this data sample (top 5 rows): ${JSON.stringify(data.slice(0, 5))}`;
        }
        let systemInstruction = `You are an expert assistant helping a user refine a piece of code inside a data notebook.
The user wants to modify a block of ${targetType} code.
Your task is to understand their request, modify the original code, and provide the updated code block along with a brief explanation.
CONTEXT:
- The current cell's content is: \`\`\`\n${cellContext}\n\`\`\`
${fullNotebookContext ? `- The rest of the notebook is:\n${fullNotebookContext}` : ''}
- The user is specifically editing this ${targetType} block: \`\`\`${targetType}\n${targetValue}\n\`\`\`
${variables && Object.keys(variables).length > 0 ? `- Variables in scope: ${Object.entries(variables).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}
${dataSample}
GUIDELINES:
1.  Read the user's request.
2.  Modify only the target code block based on the request.
3.  Provide a brief, friendly explanation of the changes you made.
4.  Return the response in JSON format. The 'code' field must contain ONLY the new code for the block.`;

        const finalCustomPrompt = customPromptOverride ?? this.settings.customSystemPrompt;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }
        
        return this.handleApiCall(() => this.provider!.getInlineSuggestion(systemInstruction, request, model));
    }

    /**
     * Given a SQL query that produced a parse/execution error, ask the AI to
     * return a corrected version. Returns the fixed SQL string, or null if the
     * AI is unavailable or returns nothing useful.
     */
    async fixBrokenSql(brokenSql: string, errorMessage: string, schemaHint: string): Promise<string | null> {
        if (!this.settings) return null;
        if (!this.isInitialized()) return null;
        const model = this.getModelFor('basic');
        const systemInstruction = `You are an expert DuckDB SQL assistant. A SQL query failed with a parse or execution error. Fix it and return ONLY the corrected SQL — no explanation, no markdown fences, no extra text.
Schema context:
${schemaHint}
Rules:
- Return exactly one corrected SELECT/WITH statement
- Do not wrap in markdown code fences
- Do not add any explanation text`;
        const request = `The following SQL failed with error: ${errorMessage}

SQL:
${brokenSql}

Return the fixed SQL only.`;
        try {
            const resp = await this.handleApiCall(() => this.provider!.getInlineSuggestion(systemInstruction, request, model));
            const fixed = (resp.code ?? resp.text ?? '').trim();
            // Strip accidental markdown fences the model might add despite instructions
            const stripped = fixed.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            return stripped || null;
        } catch {
            return null;
        }
    }

    async getAiCodeFormat(code: string): Promise<string | null> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('basic');
        return this.handleApiCall(() => this.provider!.getCodeFormat(code, model));
    }

    /**
     * Summarise a chat thread's opening user message into a short tab title.
     * Returns null on any failure so callers can fall back to the default name.
     */
    async getAiChannelTitle(firstMessage: string): Promise<string | null> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('basic');
        const systemInstruction = `You generate short titles for chat threads. Given the user's first message, reply with a 2-4 word title (no quotes, no punctuation, no trailing period). Title only — nothing else.`;
        try {
            const resp = await this.handleApiCall(() =>
                this.provider!.getInlineSuggestion(systemInstruction, firstMessage, model)
            );
            const text = (resp && typeof resp === 'object' && 'text' in resp && typeof (resp as any).text === 'string')
                ? (resp as any).text as string
                : '';
            return normalizeChannelTitle(text);
        } catch {
            return null;
        }
    }

    async getAiSuggestPlot(sql: string, customPromptOverride?: string, context?: PlotSuggestContext, tier: AiTier = 'basic'): Promise<string | null> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        this.assertOfflineAllowed('plotSuggest');
        const model = this.getModelFor(tier, 'plotSuggest');
        const plottingDocs = this.generatePlottingDocsPrompt();
        let systemInstruction = `You are a data visualization expert. Given a DuckDB SQL query, suggest the best plot configuration.
${plottingDocs}
Analyze the SQL query to understand the data it will produce. Based on the likely columns and data shape, choose the most appropriate plot function and configure its parameters.
**CRITICAL RULE: If a query selects a column that looks like a time-series (e.g., name contains "time", "timestamp", "date"), you MUST suggest a LINE_CHART with the time column as the 'x' axis.**
Default to 'TABLE()' if unsure, but prefer other plot types.
Return ONLY the plot configuration string, with no explanation or markdown backticks.`;
        
        const finalCustomPrompt = customPromptOverride ?? this.settings.customSystemPrompt;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }

        return this.handleApiCall(() => this.provider!.getSuggestPlot(systemInstruction, sql, model, context));
    }
    
    async getAiPlotFixSuggestion(errorMessage: string, sqlQuery: string, data: any[], plotConfig: string, cellContext: string, customPromptOverride?: string): Promise<AIPlotFixResponse> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('basic');
        const columns = data && data.length > 0 ? Object.keys(data[0]) : [];
        const dataSample = data ? `The SQL query returned these available columns: [${columns.join(', ')}]` : '';
        let systemInstruction = `You are an expert data visualization assistant. A user's plot configuration has failed. Your task is to analyze the context and provide a corrected plot configuration.
CONTEXT:
- The error message was: "${errorMessage}"
- The user's SQL query is: \`\`\`sql\n${sqlQuery}\n\`\`\`
- The invalid plot configuration is: \`\`\`plot\n${plotConfig}\n\`\`\`
- ${dataSample}
- The full content of the notebook cell is: \`\`\`markdown\n${cellContext}\n\`\`\`
GUIDELINES:
1.  Read the error message carefully — it describes exactly what is wrong.
2.  Common causes: wrong column name, missing required parameter, unknown plot type name, wrong parameter value.
3.  Rewrite the plot configuration to be valid for the data and fix the specific error.
4.  Provide a brief, helpful explanation of what was wrong and how you fixed it.
5.  Return the response in JSON format. The 'fixedCode' field must contain ONLY the new, corrected plot configuration code.`;

        const finalCustomPrompt = customPromptOverride ?? this.settings.customSystemPrompt;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }

        return this.handleApiCall(() => this.provider!.getPlotFixSuggestion(systemInstruction, model));
    }

    async verifyCredentials(): Promise<boolean> {
        return this.handleApiCall(async () => {
             await this.provider!.verifyCredentials();
             return true;
        });
    }

    /**
     * C3 — Tool-calling orchestrator. Wraps the provider's `streamChatWithTools`
     * with a multi-round loop: it yields text deltas straight to the caller,
     * routes `tool_call` chunks through the local tool runtime, and feeds the
     * results back into the next round as `role: 'tool'` messages.
     *
     * Bounded to 10 rounds to prevent infinite back-and-forth from a confused
     * model. The provider is responsible for stopping when it has nothing more
     * to say; we stop when no tool calls were emitted in a round.
     */
    async *streamChatWithTools(
        messages: ToolChatMessage[],
        schema: SchemaBundle | null,
        tools: Tool[],
        deps: ToolDeps,
        opts: {
            visibility: VisibilityMode;
            recentResult?: RecentResult | null;
            signal?: AbortSignal;
            tier?: AiTier;
            feature?: AiFeature;
            providerOverride?: AiProviderType;
            modelOverride?: string;
            customSystemPrompt?: string;
            /** When true, `customSystemPrompt` REPLACES the entire built-in
             *  notebook system prompt instead of being appended to it. Used by
             *  the BTW caller so the model only sees the BTW context. */
            replaceSystemPrompt?: boolean;
        },
    ): AsyncIterable<ToolStreamChunk> {
        if (!this.provider) throw new Error('AI Service not initialized — configure an API key in ⚙ Settings first.');
        const feature: AiFeature = opts.feature ?? 'chat';
        const tier: AiTier = opts.tier ?? 'advanced';

        // No-op for chat per the plan, but call for symmetry with other paths.
        this.assertOfflineAllowed(feature);

        let provider: IAiProvider = this.provider;
        if (opts.providerOverride && opts.providerOverride !== this.settings?.aiProvider && this.settings) {
            const factory = providerFactoryRegistry[opts.providerOverride];
            if (factory) provider = factory(this.settings);
        }

        if (!provider.streamChatWithTools) {
            throw new Error(
                "Active AI provider does not support tool calling. Switch to Gemini, OpenAI, Anthropic, Gardener or a local OpenAI-compatible server.",
            );
        }

        const model = opts.modelOverride && opts.modelOverride.trim().length > 0
            ? opts.modelOverride.trim()
            : this.getModelFor(tier, feature);
        // B-102: prepend role + tool-use guidance to the schema/data payload so
        // the model knows it is operating in a notebook and has tools available.
        const schemaPayload = buildContextPayload(
            opts.visibility,
            schema,
            opts.recentResult ?? null,
            this.settings?.visibilityFullRowLimit,
        );
        const customPrompt = (opts.customSystemPrompt ?? this.settings?.customSystemPrompt ?? '').trim();
        // When replaceSystemPrompt is set the caller wants its own system
        // prompt used verbatim — skip the full notebook preamble entirely.
        const systemInstruction = opts.replaceSystemPrompt
            ? (customPrompt || '')
            :
            `You are an expert DuckDB and data visualization assistant for analyzing Java Flight Recorder (JFR) data inside a notebook.\n` +
            `\n` +
            `TOOLS — group by purpose, prefer the lightest tool that answers the question:\n` +
            `  Explore data (read-only, never modifies the notebook):\n` +
            `    • describeTable(name) — column list + types. Cheap; call before writing non-trivial SQL.\n` +
            `    • sampleRows(name, limit?) — a handful of rows to see real values.\n` +
            `    • runQuery(sql, limit?, offset?) — full ad-hoc SQL. Results render inline as a table the user can see; do not re-paste rows in your reply.\n` +
            `  Preview a chart inline (read-only, the user sees the chart and gets a one-click "Add to Notebook"):\n` +
            `    • previewPlot(sql, plotConfig, limit?) — preferred way to PROPOSE a chart. After a successful previewPlot, DO NOT also call addCell for the same chart — the user has a button for that.\n` +
            `    • screenshotPlot(previewId) — capture the rendered chart as a PNG so YOU can see it. Use rarely: only when the visual matters (label readability, layout, color overlap) and you cannot judge it from the DSL alone. Requires chat visibility 'full' and an image-capable provider; otherwise it errors.\n` +
            `  Inspect the notebook (read-only):\n` +
            `    • listCells() — id, type, content preview for every cell.\n` +
            `    • readCell(cellId) — full content of one cell.\n` +
            `    • explainCell(cellId) — returns cell content with an instruction to explain it in plain language. Useful for helping users understand what a cell does or what its data means.\n` +
            `    • suggestPlot(cellId) — fetches a SQL cell's result schema and returns an instruction to produce a plot DSL snippet. Use when the user asks "what chart should I use?" or "can you plot this?".\n` +
            `    • listPlots() — id + config of every plot cell.\n` +
            `    • listVariables() — current notebook variables (name → string).\n` +
            `  Modify the notebook (require user approval per call):\n` +
            `    • addCell(type, content, afterCellId?) — create sql / plot / markdown cell.\n` +
            `    • editCell(cellId, content) — replace cell content.\n` +
            `    • applyPlot(cellId, plotConfig, plotBlockIndex?) — replace a plot block inside an existing cell.\n` +
            `    • deleteCell(cellId), moveCell(cellId, targetCellId, position).\n` +
            `    • setVariable(name, value), deleteVariable(name).\n` +
            `  Session memory (lightweight key/value store, max 10 facts, visible to user as chips):\n` +
            `    • rememberFact(key, value) — store a short fact that persists across turns (user prefs, constraints, findings).\n` +
            `    • recallMemory() — list all stored facts.\n` +
            `    • updateTaskList(tasks) — show a task checklist to the user. Pass [] to clear. Use at start of multi-step work.\n` +
            `\n` +
            `WORKING RULES:\n` +
            `  1. Explore before you act: describeTable → maybe sampleRows → runQuery. Do not invent columns; if unsure, call describeTable first.\n` +
            `  2. Proposing a chart? Use previewPlot, then stop and let the user decide. Skip addCell for that chart.\n` +
            `  3. Mutations need user approval — batch related changes into the smallest set of calls that makes sense; don't spam approvals.\n` +
            `  4. Once you have answered the user's question, stop calling tools. Don't loop "just to double-check".\n` +
            `  5. Visibility modes affect what you can see and do:\n` +
            `     • 'no-data' — runQuery / sampleRows / previewPlot results are returned to you redacted or refused; you must rely on schema + describeTable. previewPlot is disabled and will error.\n` +
            `     • 'sanitized' — row values are sanitized in the payload you see; screenshotPlot still refuses.\n` +
            `     • 'full' — you see real values; screenshotPlot is allowed.\n` +
            `  6. Be concise in your text replies — the inline tables/plots already show the data, so summarize the finding rather than repeating numbers.\n` +
            `\n` +
            `SQL RULES:\n` +
            `  • DuckDB syntax. Quote identifiers with double quotes ("My Column"), strings with single quotes.\n` +
            `  • Read-only only: SELECT / WITH / DESCRIBE / SHOW / EXPLAIN. No INSERT / UPDATE / DELETE / CREATE / DROP / ATTACH.\n` +
            `  • Add a LIMIT for exploratory queries unless the user asked for the full set.\n` +
            `\n` +
            `JFR DATA MODEL — key conventions for working with JFR tables:\n` +
            `  • Tables are created lazily — a table only exists if that event type was present in the recording. Always check with describeTable or information_schema.tables before querying an unfamiliar table.\n` +
            `  • Time columns (startTime, endTime) are DuckDB TIMESTAMP. Durations are stored as fractional SECONDS (DOUBLE) — multiply by 1000 for milliseconds.\n` +
            `  • recording_start() and recording_end() are macros returning the earliest/latest event timestamp in the recording. Use them for time-window filtering.\n` +
            `  • time_bucket(INTERVAL '1 second', startTime) groups events into 1-second buckets — handy for time-series queries.\n` +
            `  • Many tables have FK columns that reference other tables by integer _id. Common FK patterns:\n` +
            `      stackTrace → StackTrace._id (the call stack)\n` +
            `      thread → Thread._id (the Java thread)\n` +
            `      eventThread → Thread._id (the thread that produced the event)\n` +
            `      type / klass / objectClass → Class._id (the Java class)\n` +
            `  • Flat shortcut columns (no JOIN needed):\n` +
            `      stackTrace$topMethod — top frame method name on ExecutionSample/ObjectAllocationInNewTLAB etc.\n` +
            `      stackTrace$topApplicationMethod — same but skips JVM/JDK frames to find the first app frame.\n` +
            `      thread$javaName — thread name without a join to Thread table.\n` +
            `  • format_duration(seconds) returns a human-readable string ("1.23 ms"). Never use this in a column you intend to plot — the chart requires a numeric value. Use round(seconds * 1000, 2) instead.\n` +
            `  • Views (e.g. "latencies-by-type") are pre-built aggregations; they may use format_duration() making them unsuitable for charts. Prefer writing raw SQL with numeric casts for chart cells.\n` +
            `\n` +
            `PLOT DSL — plot cells and previewPlot's plotConfig MUST use this custom DSL (NOT Observable Plot, NOT Vega):\n` +
            `  BAR_CHART(x: "col", y: ["col2"])   LINE_CHART(x: "col", y: ["col2"])   SCATTER_PLOT(x: "col", y: "col2")\n` +
            `  AREA_CHART(x: "col", y: ["col2"])  PIE_CHART(category: "col", value: "col2")  TABLE()\n` +
            `  • Column names are ALWAYS quoted strings. y is ALWAYS an array (even for a single series).\n` +
            `  • In-call params (inside parens): logScale: true  layout: "stacked"|"grouped"  horizontal: true\n` +
            `  • Tail modifiers (after closing paren): TITLE "string"  LINK_X($start, $end)  PALETTE "tableau10"  AXIS_Y TYPE log\n` +
            `  • Example: BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "Top Classes"\n` +
            `\n` +
            `BUILT-IN TEMPLATES — tell users about these when their question maps to one; the template gallery (📄 button) loads them:\n` +
            `  • Recording Overview — adaptive first-look: shows GC, CPU, allocation, contention, I/O, exceptions, leaks, container sections only when relevant events exist\n` +
            `  • GC Pause Analysis — pause time by cause, phase breakdown, heap over time, allocation rate\n` +
            `  • CPU Profiling — CPU load over time, top hot methods, flame graph\n` +
            `  • Heap Allocation — top allocating classes, allocation rate over time\n` +
            `  • Memory Leak Detection — long-lived objects (OldObjectSample), allocation sites, heap-after-GC trend\n` +
            `  • Threading & Contention — thread counts, CPU per thread, monitor contention, park/sleep over time, virtual thread pinning\n` +
            `  • I/O & Latency — combined latency overview, file I/O by path, socket I/O by host\n` +
            `  • JVM Internals — safepoints, VM operations, JIT deoptimizations, class loading, compiler phases\n` +
            `  • Container & Cloud — CPU throttling %, memory vs limit, I/O (for Docker/Kubernetes JVMs)\n` +
            `  • Exceptions & Errors — top thrown exception types\n` +
            `\n` +
            `${schemaPayload}` +
            (customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : '');

        const convo: ToolChatMessage[] = [...messages];
        const MAX_ROUNDS = 10;
        for (let round = 0; round < MAX_ROUNDS; round++) {
            if (opts.signal?.aborted) return;

            const pendingCalls: Array<{ id: string; name: string; args: any }> = [];
            const assistantText: string[] = [];

            const stream = provider.streamChatWithTools(convo, tools, {
                systemInstruction,
                model,
                signal: opts.signal,
            });

            try {
                for await (const chunk of stream) {
                    if (opts.signal?.aborted) return;
                    if (chunk.kind === 'text') {
                        assistantText.push(chunk.delta);
                        yield chunk;
                    } else if (chunk.kind === 'tool_call') {
                        pendingCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
                        yield chunk;
                    } else {
                        yield chunk;
                    }
                }
            } catch (e: any) {
                if (opts.signal?.aborted || e?.name === 'AbortError') return;
                throw e;
            }

            // Append the assistant turn that produced this round's output.
            convo.push({
                role: 'assistant',
                content: assistantText.join(''),
                toolCalls: pendingCalls.length > 0 ? pendingCalls : undefined,
            });

            if (pendingCalls.length === 0) {
                // Assistant has nothing more to do — exit the loop.
                return;
            }

            // Execute each tool sequentially, surface results back as a single
            // tool-role message and as tool_result chunks to the caller.
            // B-195: wrap each call in try/catch so one failing tool doesn't abort
            // the rest — every tool_call must receive a tool_result.
            const toolResults: Array<{ id: string; name: string; result: any }> = [];
            for (const call of pendingCalls) {
                let result: any;
                try {
                    result = await executeTool(call.name, call.args, deps);
                } catch (toolErr: any) {
                    result = { error: toolErr?.message ?? String(toolErr) };
                }
                toolResults.push({ id: call.id, name: call.name, result });
                yield { kind: 'tool_result', id: call.id, result };
            }
            convo.push({
                role: 'tool',
                content: '',
                toolResults,
            });
            if (opts.signal?.aborted) return;
        }
    }
}

export const aiService = new AiService();