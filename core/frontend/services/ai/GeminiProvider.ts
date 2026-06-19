import { GoogleGenAI, Content, Type, GenerateContentResponse } from "@google/genai";
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata } from './IAiProvider';
import { GeminiIcon } from '../../components/icons/GeminiIcon';
import { Settings } from "../../context/SettingsContext";

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
            ],
            defaultModels: {
                basic: 'gemini-2.5-flash',
                advanced: 'gemini-2.5-flash',
            },
        };
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
        try {
            return JSON.parse(response.text);
        } catch {
            throw new Error(`AI returned malformed JSON: ${response.text?.slice(0, 200)}`);
        }
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
        try {
            return JSON.parse(response.text);
        } catch {
            throw new Error(`AI returned malformed JSON: ${response.text?.slice(0, 200)}`);
        }
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
        return response.text.trim();
    }
    
    async getSuggestPlot(systemInstruction: string, sql: string, model: string = 'gemini-2.5-flash'): Promise<string | null> {
        const response: GenerateContentResponse = await this.handleApiCall(() =>
            this.ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: sql }] }],
                config: { systemInstruction, temperature: 0 }
            })
        );
        return response.text.trim();
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
        try {
            return JSON.parse(response.text);
        } catch {
            throw new Error(`AI returned malformed JSON: ${response.text?.slice(0, 200)}`);
        }
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
}