import { Content } from "@google/genai";
import { IAiProvider, AIResponse, AIInlineResponse, AIPlotFixResponse, ProviderMetadata } from './IAiProvider';
import { GardenerIcon } from '../../components/icons/GardenerIcon';
import { Settings } from "../../context/SettingsContext";

export class GardenerProvider implements IAiProvider {
    private apiKey: string;
    private readonly API_URL = 'https://models.answering-machine.utility.gardener.cloud.sap/chat/completions';
    
    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("Gardener Answering Machine API key is required.");
        }
        this.apiKey = apiKey;
    }

    public static getMetadata(): ProviderMetadata {
         return {
            id: 'gardener',
            name: 'Gardener Answering Machine',
            description: 'Uses the multi-provider models hosted by the Gardener team.',
            icon: GardenerIcon,
            isConfigured: (settings: Settings) => !!settings.gardenerApiKey,
            isInternal: true,
            models: [
                // Ranked cheap to expensive
                { id: 'gpt-50-nano', name: 'GPT-50 Nano', description: 'Fastest, for basic tasks', group: 'Azure OpenAI GPT' },
                { id: 'haiku-35', name: 'Haiku-35', description: 'Fast and capable', group: 'AWS Bedrock Claude' },
                { id: 'gemini-25-lite', name: 'Gemini-25 Lite', description: 'Lightweight and efficient', group: 'GCP VertexAI Gemini' },
                { id: 'gemini-25-flash', name: 'Gemini-25 Flash', description: 'Fast and multimodal', group: 'GCP VertexAI Gemini' },
                { id: 'sonnet-40', name: 'Sonnet-40', description: 'Balanced intelligence and speed', group: 'AWS Bedrock Claude' },
                { id: 'gpt-50-mini', name: 'GPT-50 Mini', description: 'Solid general-purpose model', group: 'Azure OpenAI GPT' },
                { id: 'sonnet-45', name: 'Sonnet-45', description: 'Strong, well-rounded model', group: 'AWS Bedrock Claude' },
                { id: 'gemini-25-pro', name: 'Gemini-25 Pro', description: 'High-capability multimodal model', group: 'GCP VertexAI Gemini' },
                { id: 'gpt-50', name: 'GPT-50', description: 'Powerful, for complex reasoning', group: 'Azure OpenAI GPT' },
                { id: 'gpt-50-codex', name: 'GPT-50 Codex', description: 'Specialized for code generation', group: 'Azure OpenAI GPT' },
                { id: 'opus-41', name: 'Opus-41', description: 'Most powerful model', group: 'AWS Bedrock Claude' },
            ],
            defaultModels: {
                basic: 'gpt-50-nano',
                advanced: 'gpt-50-mini',
            },
        };
    }

    private async handleApiCall<T>(body: object, timeoutMs = 30000): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
            response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (e: any) {
            if (e.name === 'AbortError') throw new Error('Request timed out. Check your network/VPN connection.');
            throw e;
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage = errorBody?.error?.message || `Gardener API error (Status: ${response.status})`;
            if (response.status === 401) throw new Error('Invalid API Key');
            if (response.status === 429) throw new Error('Quota Exceeded');
            throw new Error(errorMessage);
        }

        const result = await response.json();
        const content = result.choices[0]?.message?.content;
        if (!content) {
            throw new Error("Received an empty response from Gardener Answering Machine.");
        }
        try {
            // For requests that expect JSON
            return JSON.parse(content);
        } catch (e) {
            // For requests that expect plain text
            return content as unknown as T;
        }
    }
    
    async getAgentResponse(conversationHistory: Content[], systemInstruction: string, model: string = 'gpt-50-mini'): Promise<AIResponse> {
         const messages = [
            { role: "system", content: systemInstruction },
            ...conversationHistory.map(c => ({ role: c.role, content: c.parts.map(p => p.text).join('\n') }))
        ];

        // This endpoint doesn't support the response_format parameter, so we instruct it in the prompt.
        messages[0].content += "\nYour response MUST be a single, valid JSON object with keys 'text', 'code', and 'plotConfig'.";

        return this.handleApiCall<AIResponse>({ model, messages });
    }

    async getInlineSuggestion(systemInstruction: string, request: string, model: string = 'gpt-50-mini'): Promise<AIInlineResponse> {
        return this.handleApiCall<AIInlineResponse>({
            model,
            messages: [
                { role: "system", content: systemInstruction + "\nYour response MUST be a single, valid JSON object with keys 'text' and 'code'." },
                { role: "user", content: request }
            ]
        });
    }
    
    async getCodeFormat(code: string, model: string = 'gpt-50-nano'): Promise<string | null> {
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
    
    async getSuggestPlot(systemInstruction: string, sql: string, model: string = 'gpt-50-nano'): Promise<string | null> {
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

    async getPlotFixSuggestion(systemInstruction: string, model: string = 'gpt-50-nano'): Promise<AIPlotFixResponse> {
         return this.handleApiCall<AIPlotFixResponse>({
            model,
            messages: [
                { role: "system", content: systemInstruction + "\nYour response MUST be a single, valid JSON object with keys 'explanation' and 'fixedCode'." },
                { role: "user", content: "Please fix my plot configuration." }
            ]
        });
    }
    
    async verifyCredentials(): Promise<boolean> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
            response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-50-nano",
                    messages: [{ role: "user", content: "Hi" }],
                    max_tokens: 1,
                }),
                signal: controller.signal,
            });
        } catch (e: any) {
            if (e.name === 'AbortError') throw new Error('Request timed out. Check your network/VPN connection.');
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
            const errorMessage = errorBody?.error?.message || `Gardener verification failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        return true;
    }
}