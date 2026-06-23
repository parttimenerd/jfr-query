import type { Content } from "@google/genai";
import type { TableSchema, ViewSchema, MacroSchema } from '../types';
import { plotRegistry } from '../components/plots/plotRegistry';
import { generateSignature } from '../utils/plotUtils';
import type { PlotRegistration } from '../components/plots/plotTypes';
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, AiProviderType, PlotSuggestContext } from './ai/IAiProvider';
import { GeminiProvider } from './ai/GeminiProvider';
import { OpenAiProvider } from './ai/OpenAiProvider';
import { GardenerProvider } from './ai/GardenerProvider';
import { LocalAiProvider } from './ai/LocalAiProvider';
import { BrowserModelProvider } from './ai/BrowserModelProvider';
import { Settings } from '../context/SettingsContext';

// Each provider may need provider-specific construction args (e.g. base URL,
// max tokens). The factory below constructs the right one given current settings.
type ProviderFactory = (settings: Settings) => IAiProvider;

export const providerFactoryRegistry: Record<AiProviderType, ProviderFactory> = {
    google: (s) => new GeminiProvider(AiService.getEffectiveApiKey('google', s)),
    openai: (s) => new OpenAiProvider(AiService.getEffectiveApiKey('openai', s)),
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
    gardener: GardenerProvider,
    local: LocalAiProvider as unknown as new (apiKey: string) => IAiProvider,
    browser: BrowserModelProvider as unknown as new (apiKey: string) => IAiProvider,
};

export const providerMetadataRegistry: Record<AiProviderType, ProviderMetadata> = {
    google: GeminiProvider.getMetadata(),
    openai: OpenAiProvider.getMetadata(),
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
            gardener: process.env.GARDENER_API_KEY,
            local: process.env.LOCAL_AI_API_KEY,
            browser: undefined,
        };
        const settingsKey = provider === 'google' ? settings.googleApiKey
            : provider === 'openai' ? settings.openaiApiKey
            : provider === 'gardener' ? settings.gardenerApiKey
            : provider === 'local' ? settings.localApiKey
            : ''; // browser has no API key
        return settingsKey || envKeys[provider] || '';
    }

    initialize(settings: Settings): boolean {
        this.settings = settings;
        const { aiProvider } = settings;
        const factory = providerFactoryRegistry[aiProvider];

        // Local provider doesn't need an API key — it's "configured" as long as
        // the base URL is set. All other providers require a key.
        const hasCredentials = aiProvider === 'local'
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
            throw new Error("AI Service not initialized.");
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
        doc += '- `... LINK_X($start, $end, [master], [clamp])`: Links a plot\'s X-axis to local variables for interactive zooming and panning. All plots linked to the same variables are synchronized.\n';
        doc += '  - `master`: This plot will set the initial values of the variables to its full data range.\n';
        doc += '  - `clamp`: Prevents zooming or panning beyond this plot\'s own data range.\n\n';
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
    
    private getModelFor(tier: 'basic' | 'advanced'): string {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const { aiProvider } = this.settings;
        const suffix = tier === 'advanced' ? 'GoodModel' : 'BasicModel';
        const key = `${aiProvider}${suffix}` as keyof Settings;
        return (this.settings[key] as string) ?? '';
    }

    // --- Public API Methods ---

    async getAiAgentResponse(conversationHistory: Content[], tables: TableSchema[], views: ViewSchema[], macros: MacroSchema[], customPromptOverride?: string): Promise<AIResponse> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('advanced');

        const schemaDescription = this.generateSchemaDescription(tables, views, macros);
        const plottingDocs = this.generatePlottingDocsPrompt();
        let systemInstruction = `You are an expert DuckDB and data visualization assistant for analyzing Java Flight Recorder (JFR) data.
Your goal is to help users by writing SQL queries and suggesting appropriate visualizations.
${schemaDescription}
${plottingDocs}
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
    
    async getAiInlineSuggestion(request: string, targetType: 'sql' | 'plot', targetValue: string, cellContext: string, fullNotebookContext?: string, data?: any[], customPromptOverride?: string): Promise<AIInlineResponse> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('advanced');
        
        const dataSample = data ? `The current query produces this data sample (top 5 rows): ${JSON.stringify(data.slice(0, 5))}` : '';
        let systemInstruction = `You are an expert assistant helping a user refine a piece of code inside a data notebook.
The user wants to modify a block of ${targetType} code.
Your task is to understand their request, modify the original code, and provide the updated code block along with a brief explanation.
CONTEXT:
- The current cell's content is: \`\`\`\n${cellContext}\n\`\`\`
${fullNotebookContext ? `- The rest of the notebook is:\n${fullNotebookContext}` : ''}
- The user is specifically editing this ${targetType} block: \`\`\`${targetType}\n${targetValue}\n\`\`\`
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

    async getAiCodeFormat(code: string): Promise<string | null> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('basic');
        return this.handleApiCall(() => this.provider!.getCodeFormat(code, model));
    }

    async getAiSuggestPlot(sql: string, customPromptOverride?: string, context?: PlotSuggestContext): Promise<string | null> {
        if (!this.settings) throw new Error("AI Service not initialized with settings.");
        const model = this.getModelFor('basic');
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
The most common error is using a column name in the plot config that does not exist in the SQL query's result set.
CONTEXT:
- The error message was: "${errorMessage}"
- The user's SQL query is: \`\`\`sql\n${sqlQuery}\n\`\`\`
- The invalid plot configuration is: \`\`\`plot\n${plotConfig}\n\`\`\`
- ${dataSample}
- The full content of the notebook cell is: \`\`\`markdown\n${cellContext}\n\`\`\`
GUIDELINES:
1.  Analyze the error, the SQL query, and the available columns.
2.  Rewrite the plot configuration to be valid for the data.
3.  Provide a brief, helpful explanation of what was wrong and how you fixed it.
4.  Return the response in JSON format. The 'fixedCode' field must contain ONLY the new, corrected plot configuration code.`;

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
}

export const aiService = new AiService();