import type React from 'react';
import type { Content } from "@google/genai";
import type { Settings } from '../../context/SettingsContext';

export interface AIResponse {
    text: string;
    code: string | null;
    plotConfig: string | null;
}

export interface AIInlineResponse {
    text: string;
    code: string | null;
}

export interface AIPlotFixResponse {
    explanation: string;
    fixedCode: string;
}

export interface ModelDefinition {
  id: string; // The API model ID, e.g., 'gemini-2.5-flash'
  name: string; // User-friendly name, e.g., 'Gemini 2.5 Flash'
  description: string; // e.g., 'Fast and cost-effective'
  group?: string; // Optional grouping for UI, e.g., 'Azure OpenAI'
}

export interface ProviderMetadata {
  id: AiProviderType;
  name: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  isConfigured: (settings: Settings) => boolean;
  models: ModelDefinition[];
  defaultModels: {
    basic: string;
    advanced: string;
  };
  isInternal?: boolean;
}

export type AiProviderType = 'google' | 'openai' | 'gardener' | 'local' | 'browser';

export interface PlotSuggestContext {
    columns: { name: string; type: string }[];
    sample: any[];
}

export interface IAiProvider {
    getAgentResponse: (conversationHistory: Content[], systemInstruction: string, model?: string) => Promise<AIResponse>;
    getInlineSuggestion: (systemInstruction: string, request: string, model?: string) => Promise<AIInlineResponse>;
    getCodeFormat: (code: string, model?: string) => Promise<string | null>;
    getSuggestPlot: (systemInstruction: string, sql: string, model?: string, context?: PlotSuggestContext) => Promise<string | null>;
    getPlotFixSuggestion: (systemInstruction: string, model?: string) => Promise<AIPlotFixResponse>;
    verifyCredentials: () => Promise<boolean>;
}