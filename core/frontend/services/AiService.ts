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
import { routeMessage, type RoutingPreference } from './ai/routing';
import { buildLocalSystemPrompt, buildBrowserSystemPrompt, type SchemaTable } from './ai/chatModes';

export type { VisibilityMode, RecentResult } from './ai/visibility';
export type { SchemaTable } from './ai/chatModes';

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
    browser: (s) => new BrowserModelProvider(s.browserModelId, s.browserChatModelId),
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
        // Build the dynamic per-plot section from the registry.
        let plotFunctionDocs = '';
        for (const plot of Object.values(plotRegistry) as PlotRegistration[]) {
            plotFunctionDocs += `FUNCTION: ${plot.name}${generateSignature(plot.params)}\nDESCRIPTION: ${plot.description}\n`;
            if (plot.supportsMultiQuery) plotFunctionDocs += 'SUPPORTS MULTIPLE QUERIES: Yes\n';
            if (plot.params.length > 0) {
                plotFunctionDocs += 'PARAMETERS:\n' + plot.params.map(p => `  - ${p.name} (${p.type}): ${p.description} ${p.required ? '(Required)' : ''}`).join('\n') + '\n';
            }
            if (plot.examples.length > 0) {
                plotFunctionDocs += 'EXAMPLES:\n' + plot.examples.map(ex => `  - ${ex.description}\n    ${ex.code}`).join('\n') + '\n';
            }
            plotFunctionDocs += '---\n';
        }

        return `PLOTTING DOCUMENTATION:

## Layout
- Side-by-side on one row: \`PLOT_A(...); PLOT_B(...)\` (semicolon or single newline separator)
- New row: blank line between plot calls
- Example: two charts side by side then a table below:
  \`\`\`
  BAR_CHART(x: "cause", y: ["count"]) TITLE "By Cause"; PIE_CHART(category: "cause", value: "count")

  TABLE()
  \`\`\`

## Chart Type Selection Guide
Choose the right chart based on the data shape:

| Data shape | Best chart |
|---|---|
| Time column + 1-4 numeric series | LINE_CHART |
| Time column + many stacked series | AREA_CHART with layout: "stacked" |
| Category + 1 numeric (rank/compare) | BAR_CHART (use horizontal: true for long labels) |
| Category + multiple numerics | BAR_CHART with layout: "grouped" or "stacked" |
| Distribution of one numeric | HISTOGRAM |
| Two numeric columns (correlation) | SCATTER_PLOT |
| Part-of-whole (≤8 categories) | PIE_CHART |
| Tabular / many columns / raw events | TABLE |
| Single KPI number | BIG_NUMBER |
| Time + heat intensity grid | HEATMAP |
| Events with start+duration (Gantt-like) | GANTT |
| Raw data rows always visible | TABLE |

**Never** use PIE_CHART with more than 8 categories — use BAR_CHART instead.
**Always** prefer LINE_CHART over SCATTER_PLOT when x is a timestamp.
Use HISTOGRAM when you want to show the distribution/spread, not rank.

## Available Plot Functions
---
${plotFunctionDocs}
## TABLE() Modifiers
TABLE() accepts tail clauses to control display:
- \`TABLE() SORT ASC|DESC\` — default sort direction
- \`TABLE() LIMIT 50\` — cap rows shown (default 200)
- \`TABLE() TITLE "My Table"\`
- \`TABLE() ON alias\` — bind to a named query

## BAR_CHART Special Parameters
- \`horizontal: true\` — rotate bars (essential when category labels are long strings)
- \`layout: "stacked"\` — stack multiple y series
- \`layout: "grouped"\` — group multiple y series side by side
- \`SORT DESC LIMIT 20\` — show top-N bars only

## AREA_CHART Special Parameters
- \`layout: "stacked"\` — stacked area (for part-of-whole over time)
- \`layout: "normalized"\` — 100% stacked area
- \`color: "col"\` — color series by a column (for stacked areas per category)
- \`y2: "col"\` — secondary Y axis for a second metric

## LINE_CHART Tips
- Use \`color: "col"\` to split a single y series into per-category lines
- Use \`AXIS_Y DOMAIN [0, 100] LABEL "%"\` for percentage axes
- Use \`AXIS_Y TYPE log\` for data spanning many orders of magnitude

## SCATTER_PLOT Tips
- Use \`color: "col"\` to distinguish categories
- Use \`size: "col"\` to encode a third dimension as point size
- Use \`trendline: "linear"\` to overlay a linear regression line

## HISTOGRAM Tips
- Use \`logBins: true\` for data spanning many orders of magnitude (e.g. latency)
- The x column must be numeric

## HEATMAP Tips
- Requires exactly: x (category/time), y (category), value (numeric)
- Best for showing activity density over a two-dimensional grid

## Tail Clauses (append to any plot call)
- \`TITLE "text"\` — title above the chart
- \`ON alias\` — bind to a named SQL query (e.g. \`-- alias foo\` in a SQL cell)
- \`ON #1\` — bind to query by 1-based index
- \`WIDTH 50%\` or \`WIDTH 300px\` — fixed or relative width
- \`HEIGHT 300px\` — fixed height
- \`LEGEND AT RIGHT|LEFT|TOP|BOTTOM|NONE\` — legend position
- \`LEGEND HIDDEN\` — hide legend entirely
- \`PALETTE "tableau10"\` — named palette: category10, tableau10, pastel1, dark2, set2, spectral
- \`PALETTE "#e41a1c,#377eb8,#4daf4a"\` — custom hex palette
- \`AXIS_X LABEL "Time" TYPE time FORMAT "HH:mm"\` — X axis: label, type (linear|log|time|band), format
- \`AXIS_Y LABEL "ms" DOMAIN [0, 500] TYPE log FORMAT ".1f"\` — Y axis config
- \`AXIS_Y DOMAIN [0, 100] LABEL "%"\` — percentage Y axis
- \`ZOOM\` — enable scroll/pinch zoom on the chart
- \`LINK_X($start, $end)\` — link X pan/zoom to variables; add \`master\` on the primary chart
- \`LINK_X($start, $end, master)\` — this chart sets the initial range for all linked charts
- \`LINK_Y $var\` — link Y viewport
- \`BRUSH $sel MODE X\` — drag-to-select region, writes \`$sel.brush.lo\` / \`$sel.brush.hi\`
- \`BRUSH $sel MODE XY\` — 2D brush, writes \`$sel.brush.x_lo\`, \`$sel.brush.y_lo\`, etc.
- \`TOOLTIP COLUMNS ["col1", "col2"]\` — limit tooltip columns
- \`ON HOVER TOOLTIP "{col1}: {col2}"\` — custom tooltip template
- \`DATASET view_name\` — data source is a DuckDB view/table, not a query result
- \`DISABLED\` — placeholder, suppresses rendering

## Practical Examples

### Timeline with linked zoom + brush
\`\`\`plot
SCATTER_PLOT(x: "startTime", y: "duration_ms", color: "cause") TITLE "GC Pause Timeline" LINK_X($start, $end, master) ZOOM AXIS_Y LABEL "ms"

LINE_CHART(x: "Window", y: ["Throughput %"]) TITLE "GC Throughput" LINK_X($start, $end) AXIS_Y DOMAIN [0, 100] LABEL "%"
\`\`\`

### Stacked area by category
\`\`\`plot
AREA_CHART(x: "Window", y: ["Pause (ms)"], color: "Cause", layout: "stacked") TITLE "Pause by Cause" ZOOM
\`\`\`

### Histogram of latency (log scale)
\`\`\`plot
HISTOGRAM(x: "duration_ms", logBins: true) TITLE "Pause Duration Distribution" AXIS_X LABEL "ms"
\`\`\`

### Horizontal bar — top N
\`\`\`plot
BAR_CHART(x: "class", y: ["alloc_mb"], horizontal: true) TITLE "Top Allocating Classes" SORT DESC LIMIT 20 AXIS_Y LABEL "MB"
\`\`\`

### Side-by-side summary cards
\`\`\`plot
BIG_NUMBER(value: "total_pauses", label: "Total GC Pauses"); BIG_NUMBER(value: "worst_pause_ms", label: "Worst Pause (ms)")
\`\`\`
`;
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

    /**
     * Summarise a conversation into a compact context block that an LLM can use
     * as a replacement for the full history. SQL queries are preserved verbatim
     * so the model knows they can be re-executed; raw result rows are dropped.
     */
    async getCompactSummary(conversationText: string): Promise<string | null> {
        if (!this.settings) return null;
        const model = this.getModelFor('basic');
        const systemInstruction = `You are a conversation summariser for a data-analysis chat assistant.
Produce a concise summary (≤400 words) of the conversation below so the assistant can continue with full context.

Rules:
- Preserve every SQL query verbatim in a \`\`\`sql block so it can be re-run.
- For query results, keep only the key findings (totals, counts, notable values). Drop raw row data entirely.
- Keep the user's original questions and the assistant's final conclusions.
- Omit pleasantries, filler text, and redundant explanations.
- Use bullet points where possible to save space.

Output format:
**Summary**
<concise bullets>

**SQL queries used**
\`\`\`sql
-- <description>
<query>
\`\`\`
(repeat for each distinct query)`;
        try {
            const resp = await this.handleApiCall(() =>
                this.provider!.getInlineSuggestion(systemInstruction, conversationText, model)
            );
            const text = (resp && typeof resp === 'object' && 'text' in resp && typeof (resp as any).text === 'string')
                ? (resp as any).text as string
                : '';
            return text.trim() || null;
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
            /** Routing preference for local vs cloud dispatch. */
            routingPreference?: RoutingPreference;
            /** Schema tables for injecting into local model system prompt. */
            schemaForLocalPrompt?: SchemaTable[];
            /** Variables for injecting into local model system prompt. */
            variablesForPrompt?: Record<string, unknown>;
            /** Progress callback (0–1) while the browser model is downloading/loading. */
            onBrowserLoadProgress?: (progress: number) => void;
        },
    ): AsyncIterable<ToolStreamChunk> {
        if (!this.provider) throw new Error('AI Service not initialized — configure an API key in ⚙ Settings first.');
        const feature: AiFeature = opts.feature ?? 'chat';
        const tier: AiTier = opts.tier ?? 'advanced';

        // No-op for chat per the plan, but call for symmetry with other paths.
        this.assertOfflineAllowed(feature);

        // Routing: when a local model is configured and no explicit override is set,
        // route simple messages to the local provider with a tuned prompt.
        let resolvedProviderOverride = opts.providerOverride;
        let resolvedTools = tools;
        let resolvedCustomSystemPrompt = opts.customSystemPrompt;
        let resolvedReplaceSystemPrompt = opts.replaceSystemPrompt;

        const hasLocalModel = !!(this.settings?.localBaseUrl);
        const isLocalProvider = this.settings?.aiProvider === 'local';
        const effectiveRoutingPref = opts.routingPreference ?? this.settings?.localRoutingPreference;
        // Routing only activates when the user's default provider is local
        // (or routing is explicitly requested) and a local model URL is configured.
        if (hasLocalModel && isLocalProvider && effectiveRoutingPref !== 'cloud' && !resolvedProviderOverride) {
            const lastMessage = messages[messages.length - 1];
            const msgText = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
            const route = routeMessage(
                msgText,
                tools,
                opts.visibility,
                effectiveRoutingPref,
            );
            if (route === 'local') {
                resolvedProviderOverride = 'local';
                if (opts.schemaForLocalPrompt !== undefined || opts.variablesForPrompt !== undefined) {
                    resolvedCustomSystemPrompt = buildLocalSystemPrompt(
                        opts.schemaForLocalPrompt ?? [],
                        opts.variablesForPrompt ?? {},
                    );
                    resolvedReplaceSystemPrompt = true;
                }
                // Local models only get read tools unless settings say otherwise
                if (this.settings?.localToolAccess !== 'full') {
                    resolvedTools = tools.filter(t => t.kind === 'read');
                }
            }
        }

        // Browser path: use in-browser LLM for real chat inference.
        // No tool calling — the model answers from schema context only.
        const isBrowserRoute = opts.routingPreference === 'browser' || this.settings?.aiProvider === 'browser';
        if (isBrowserRoute) {
            const browserSystemPrompt = buildBrowserSystemPrompt(
                opts.schemaForLocalPrompt ?? [],
                opts.variablesForPrompt ?? {},
            );

            // Build a provider that can stream from the in-browser model.
            const browserProvider = this.settings?.aiProvider === 'browser'
                ? this.provider  // already a BrowserModelProvider
                : new (await import('./ai/BrowserModelProvider').then(m => m.BrowserModelProvider))(this.settings?.browserModelId, this.settings?.browserChatModelId);

            if (browserProvider?.streamChatWithTools) {
                yield* browserProvider.streamChatWithTools(messages, [], {
                    systemInstruction: browserSystemPrompt,
                    signal: opts.signal,
                    ...(opts.onBrowserLoadProgress
                        ? { onLoadProgress: opts.onBrowserLoadProgress }
                        : {}),
                });
            } else {
                yield { kind: 'text', delta: '*Browser chat unavailable — no in-browser model loaded.*' };
            }
            return;
        }

        let provider: IAiProvider = this.provider;
        if (resolvedProviderOverride && resolvedProviderOverride !== this.settings?.aiProvider && this.settings) {
            const factory = providerFactoryRegistry[resolvedProviderOverride];
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
        const customPrompt = (resolvedCustomSystemPrompt ?? this.settings?.customSystemPrompt ?? '').trim();
        // When replaceSystemPrompt is set the caller wants its own system
        // prompt used verbatim — skip the full notebook preamble entirely.
        const systemInstruction = resolvedReplaceSystemPrompt
            ? (customPrompt || '')
            :
            `You are an expert DuckDB and data visualization assistant for analyzing Java Flight Recorder (JFR) data inside a notebook.\n` +
            `\n` +
            `TOOLS — group by purpose, prefer the lightest tool that answers the question:\n` +
            `  Explore data (read-only, never modifies the notebook):\n` +
            `    • describeTable(name) — column list + types. Cheap; call before writing non-trivial SQL.\n` +
            `    • sampleRows(name, limit?) — a handful of rows to see real values.\n` +
            `    • runQuery(sql, limit?, offset?) — full ad-hoc SQL. Results render inline as a table the user can see; do not re-paste rows in your reply.\n` +
            `    • query_data(sql, reason, tables) — like runQuery but accepts a reason string (shown to the user) and a tables array (for permission display). Use instead of runQuery when you want the user to understand why you are querying.\n` +
            `  Show a chart inline in chat (read-only; user gets a one-click "Add to Notebook" that saves SQL+plot as one cell):\n` +
            `    • previewPlot(sql, plotConfig, limit?) — renders the chart live in the chat thread. Use for ALL charts — during exploration AND when proposing notebook content. Do NOT also call addCell for the same chart; the "Add to Notebook" button handles that. Chain multiple previewPlot calls in one turn to show a full analysis sweep.\n` +
            `    • screenshotPlot(previewId) — capture a PNG of a previewed chart so YOU can see it. Use only when visual layout matters and you cannot judge from the DSL alone. Requires visibility 'full'.\n` +
            `  Inspect the notebook (read-only):\n` +
            `    • listCells() — id, type, content preview for every cell.\n` +
            `    • readCell(cellId) — full content of one cell.\n` +
            `    • explainCell(cellId) — returns cell content with an instruction to explain it in plain language. Useful for helping users understand what a cell does or what its data means.\n` +
            `    • suggestPlot(cellId) — fetches a SQL cell's result schema and returns an instruction to produce a plot DSL snippet. Use when the user asks "what chart should I use?" or "can you plot this?".\n` +
            `    • listPlots() — id + config of every plot cell.\n` +
            `    • listVariables() — current notebook variables (name → string).\n` +
            `  Modify the notebook (require user approval per call):\n` +
            `    • addCell(type, content, afterCellId?) — create sql / plot / markdown cell.\n` +
            `    • editCell(cellId, content) — replace cell content. ALWAYS call readCell(cellId) first to get the current content; preserve existing structure (headings, SQL blocks, plot blocks) and only change what the user asked for.\n` +
            `    • applyPlot(cellId, plotConfig, plotBlockIndex?) — replace a plot block inside an existing cell.\n` +
            `    • deleteCell(cellId), moveCell(cellId, targetCellId, position).\n` +
            `    • setVariable(name, value), deleteVariable(name).\n` +
            `  Session memory (lightweight key/value store, max 10 facts, visible to user as chips):\n` +
            `    • rememberFact(key, value) — store a short fact that persists across turns (user prefs, constraints, findings).\n` +
            `    • recallMemory() — list all stored facts.\n` +
            `    • updateTaskList(tasks) — show a task checklist to the user. Pass [] to clear. Use at start of multi-step work.\n` +
            `\n` +
            `WORKING RULES:\n` +
            `\n` +
            `  CORE PHILOSOPHY — two phases, keep them separate:\n` +
            `    Phase 1 — Explore in chat. The chat thread IS the analysis workspace. Run queries, show full scrollable tables, render charts — all inline, nothing written to the notebook yet. The user sees everything live and can steer the analysis without touching the notebook at all.\n` +
            `    Phase 2 — Promote to notebook. Only when the user says "add to notebook", "save this", "make a dashboard", or similar do you touch the notebook. Every inline chart has an "Add to Notebook" button the user clicks to promote it — you don't need to recreate cells.\n` +
            `\n` +
            `  SPECIFIC RULES:\n` +
            `  1. Explore before you write SQL: describeTable → sampleRows if needed → then write the query. Don't invent columns.\n` +
            `  2. Answering a question with data? Use runQuery — the result renders as a full scrollable table the user can read, filter, and sort directly in the chat. NEVER use addCell(sql) just to answer a question. For large result sets use limit + offset to page; tell the user if results were truncated.\n` +
            `  3. Showing a chart? ALWAYS use previewPlot. Never addCell(sql) + addCell(plot) separately — that forces two approvals and splits the cell. previewPlot renders the chart live inline at full height; the user promotes it with one click. Chain multiple previewPlot calls in one reply to deliver a full analysis sweep.\n` +
            `  4. Full analysis workflow: When asked to analyse a topic (e.g. "analyse GC", "show me what's interesting"), do a COMPLETE sweep in one turn:\n` +
            `     (a) runQuery for key aggregate metrics — show them as inline tables.\n` +
            `     (b) previewPlot for each meaningful chart — show them all inline.\n` +
            `     (c) End with 3-5 bullet findings summarising what you found. Don't narrate what the tables/charts show — the user can see them. Focus on the insight ("GC pauses spike after 14:32 — correlates with peak allocation rate").\n` +
            `     The chat IS the analysis workspace. Give the user a complete, self-contained analysis they can explore without touching the notebook.\n` +
            `  5. Making a dashboard: When asked to create a dashboard or "add the important views to the notebook", do this in order: (a) call previewPlot for each key view you haven't already shown — this renders them inline so the user can review; (b) write a short text summary listing which views you showed and recommending which ones to add; (c) add a markdown section header via addCell(markdown) if the user confirms; (d) remind the user to click "Add to Notebook" on each inline chart they want to keep — that creates the combined SQL+plot cell. Do NOT try to reconstruct previously-shown plots via addCell — the inline "Add to Notebook" button is the correct path for combined cells.\n` +
            `  6. Don't run the same SQL twice. If you already called runQuery for a dataset, reuse that SQL in previewPlot — don't re-fetch.\n` +
            `  7. Once you've answered the question, stop calling tools. Don't loop to double-check.\n` +
            `  8. Visibility modes:\n` +
            `     • 'no-data' — query results are redacted; previewPlot is disabled. Work from schema only.\n` +
            `     • 'sanitized' — values sanitized in the payload you see.\n` +
            `     • 'full' — real values visible; screenshotPlot allowed.\n` +
            `  9. Text replies: be concise. The inline tables and charts already show the data — don't repeat numbers. Do write insight bullets (what it MEANS, not what it shows).\n` +
            `  10. When the user asks "what can I explore here?" or "what's interesting?", do a full sweep (rule 4) and end by listing 3 suggested follow-up questions they could ask.\n` +
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

            const stream = provider.streamChatWithTools(convo, resolvedTools, {
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
                // Local model failed: fall back to cloud for this round
                if (resolvedProviderOverride === 'local' && round === 0 && assistantText.length === 0 && pendingCalls.length === 0) {
                    yield { kind: 'text', delta: '\n\n*Local model unavailable — switching to cloud for this message.*\n\n' };
                    const cloudProvider = this.provider!;
                    const cloudStream = cloudProvider.streamChatWithTools!(convo, tools, { systemInstruction: opts.customSystemPrompt ? (opts.replaceSystemPrompt ? opts.customSystemPrompt : systemInstruction) : systemInstruction, model: this.getModelFor(tier, feature), signal: opts.signal });
                    for await (const chunk of cloudStream) {
                        if (opts.signal?.aborted) return;
                        if (chunk.kind === 'text') { assistantText.push(chunk.delta); yield chunk; }
                        else if (chunk.kind === 'tool_call') { pendingCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args }); yield chunk; }
                        else yield chunk;
                    }
                } else {
                    throw e;
                }
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