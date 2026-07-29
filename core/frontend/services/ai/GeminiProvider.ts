import { GoogleGenAI, Content, Type, GenerateContentResponse } from "@google/genai";
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata, ToolChatMessage, ToolStreamChunk, StreamChatWithToolsOpts } from './IAiProvider';
import type { Tool } from './tools';
import { toolsToGemini, parseGeminiToolCalls } from './tools/geminiAdapter';
import { GeminiIcon } from '../../components/icons/GeminiIcon';
import { Settings } from "../../context/SettingsContext";

/**
 * Convert ToolChatMessage[] to Gemini Content[] preserving function calls and
 * function responses. Gemini uses role 'model' for assistant; tool_results
 * are sent as role 'user' with functionResponse parts.
 */
function geminiContentsFromTool(messages: ToolChatMessage[]): Content[] {
    const out: Content[] = [];
    for (const m of messages) {
        if (m.role === 'system') continue; // system goes into config.systemInstruction
        if (m.role === 'tool') {
            const parts = (m.toolResults ?? []).map(tr => {
                if (!tr.name) throw new Error(`geminiContentsFromTool: toolResult missing name for id ${tr.id}`);
                return {
                    functionResponse: {
                        name: tr.name,
                        response: typeof tr.result === 'object' && tr.result !== null
                            ? tr.result
                            : { value: tr.result },
                    },
                };
            });
            if (parts.length > 0) out.push({ role: 'user', parts: parts as any });
            continue;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            const parts: any[] = [];
            if (m.content) parts.push({ text: m.content });
            for (const tc of m.toolCalls) {
                parts.push({ functionCall: { name: tc.name, args: tc.args ?? {} } });
            }
            out.push({ role: 'model', parts });
            continue;
        }
        out.push({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content ?? '' }],
        });
    }
    return out;
}

export class GeminiProvider implements IAiProvider {
    private ai: GoogleGenAI;
    private apiKey: string;
    
    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("Google Gemini API key is required.");
        }
        this.apiKey = apiKey;
        this.ai = new GoogleGenAI({ apiKey });
    }

    public static getMetadata(): ProviderMetadata {
        return {
            id: 'google',
            name: 'Google Gemini',
            description: 'Uses the Gemini family of models from Google.',
            icon: GeminiIcon,
            isConfigured: (settings: Settings) => !!settings.googleApiKey,
            models: [
                { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Google\'s fastest and most cost-effective model.' },
                { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Smallest, cheapest Gemini variant — used for autocomplete / plot suggest.' },
            ],
            defaultModels: {
                tiny: 'gemini-2.5-flash-lite',
                basic: 'gemini-2.5-flash',
                advanced: 'gemini-2.5-flash',
            },
        };
    }

    private parseJsonResponse<T>(response: GenerateContentResponse): T {
        const text = response.text;
        if (!text) throw new Error('Gemini returned empty response');
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new Error(`AI returned malformed JSON: ${text.slice(0, 200)}`);
        }
    }

    private async handleApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
        try {
            return await apiCall();
        } catch (error: any) {
            const errorMessage = (error.message || String(error)).toLowerCase();
            if (errorMessage.includes('api key not valid')) {
                throw new Error('Invalid API Key');
            }
            if (errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
                throw new Error('Quota Exceeded');
            }
            throw error; // Re-throw other errors
        }
    }
    
    async getAgentResponse(conversationHistory: Content[], systemInstruction: string, model: string = 'gemini-2.5-flash'): Promise<AIResponse> {
        const response: GenerateContentResponse = await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model,
                contents: conversationHistory,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            text: { type: Type.STRING, description: "A friendly, conversational explanation of the query and visualization." },
                            code: { type: Type.STRING, description: "The DuckDB SQL query to run. Null if not applicable." },
                            plotConfig: { type: Type.STRING, description: "The configuration for the plot. Null if not applicable." }
                        },
                        required: ["text", "code", "plotConfig"]
                    }
                }
            })
        );
        return this.parseJsonResponse(response);
    }

    async getInlineSuggestion(systemInstruction: string, request: string, model: string = 'gemini-2.5-flash'): Promise<AIInlineResponse> {
        const response: GenerateContentResponse = await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: request }] }],
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            text: { type: Type.STRING, description: "A brief, conversational explanation of the changes." },
                            code: { type: Type.STRING, description: `The complete, updated code block.` }
                        },
                        required: ["text", "code"]
                    }
                }
            })
        );
        return this.parseJsonResponse(response);
    }

    async getCodeFormat(code: string, model: string = 'gemini-2.5-flash'): Promise<string | null> {
        const systemInstruction = `You are a SQL code formatter. Your task is to format the given SQL code.
- Use standard SQL formatting with 2-space indentation.
- Return ONLY the formatted code, with no explanations or markdown backticks.
`;
        const response: GenerateContentResponse = await this.handleApiCall(() => 
            this.ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: code }] }],
                config: { systemInstruction, temperature: 0 }
            })
        );
        return response.text != null ? response.text.trim() : null;
    }

    async getSuggestPlot(systemInstruction: string, sql: string, model: string = 'gemini-2.5-flash'): Promise<string | null> {
        const response: GenerateContentResponse = await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: sql }] }],
                config: { systemInstruction, temperature: 0 }
            })
        );
        return response.text != null ? response.text.trim() : null;
    }

    async getPlotFixSuggestion(systemInstruction: string, model: string = 'gemini-2.5-flash'): Promise<AIPlotFixResponse> {
        const response: GenerateContentResponse = await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: "Please fix my plot configuration." }] }],
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            explanation: { type: Type.STRING, description: "A brief, conversational explanation of the fix." },
                            fixedCode: { type: Type.STRING, description: "The complete, updated, and corrected plot configuration code." }
                        },
                        required: ["explanation", "fixedCode"]
                    }
                }
            })
        );
        return this.parseJsonResponse(response);
    }

    async verifyCredentials(): Promise<boolean> {
        // A very cheap and fast call to verify the key, wrapped in the handler
        await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: 'h' }] }]
            })
        );
        return true;
    }

    async *streamChatWithTools(
        messages: ToolChatMessage[],
        tools: Tool[],
        opts?: StreamChatWithToolsOpts,
    ): AsyncIterable<ToolStreamChunk> {
        const model = opts?.model || 'gemini-2.5-flash';
        const contents = geminiContentsFromTool(messages);
        const config: any = {};
        if (opts?.systemInstruction) config.systemInstruction = opts.systemInstruction;
        if (tools.length > 0) config.tools = [toolsToGemini(tools)];
        if (opts?.signal) config.abortSignal = opts.signal;

        // B-103: use generateContentStream for real token-by-token streaming.
        // Accumulate tool-call parts across chunks, emit complete tool_calls at end.
        const toolCallAcc = new Map<string, { id: string; name: string; args: any }>();
        const stream = await this.handleApiCall(() =>
            this.ai.models.generateContentStream({
                model,
                contents,
                config,
            })
        );
        for await (const chunk of stream) {
            if (opts?.signal?.aborted) return;
            const parts: any[] = (chunk as any)?.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) {
                if (typeof p?.text === 'string' && p.text) {
                    yield { kind: 'text', delta: p.text };
                }
                if (p?.functionCall) {
                    const id = p.functionCall.id ?? `fc_${toolCallAcc.size}`;
                    toolCallAcc.set(id, { id, name: p.functionCall.name ?? '', args: p.functionCall.args ?? {} });
                }
            }
        }
        if (opts?.signal?.aborted) return;
        for (const call of toolCallAcc.values()) {
            yield { kind: 'tool_call', id: call.id, name: call.name, args: call.args };
        }
    }
}