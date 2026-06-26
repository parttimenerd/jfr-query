import type React from 'react';
import type { Content } from "@google/genai";
import type { Settings } from '../../context/SettingsContext';
import type { Tool } from './tools';

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
    tiny: string;
    basic: string;
    advanced: string;
  };
  isInternal?: boolean;
}

export type AiProviderType = 'google' | 'openai' | 'anthropic' | 'gardener' | 'local' | 'browser';

export interface PlotSuggestContext {
    columns: { name: string; type: string }[];
    sample: any[];
}

/**
 * Wire-level message used by the tool-calling loop. Mirrors a normalized
 * provider format: a role plus either text content (string) or a list of
 * structured content blocks (tool calls, tool results) the orchestrator
 * preserves across rounds.
 */
export interface ToolChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    /** Tool calls emitted by the assistant in this message. */
    toolCalls?: Array<{ id: string; name: string; args: any }>;
    /** Tool results echoed back to the model. */
    toolResults?: Array<{ id: string; name: string; result: any }>;
}

export type ToolStreamChunk =
    | { kind: 'text'; delta: string }
    | { kind: 'tool_call'; id: string; name: string; args: any }
    | { kind: 'tool_result'; id: string; result: any };

export interface StreamChatWithToolsOpts {
    systemInstruction?: string;
    model?: string;
    signal?: AbortSignal;
}

export interface IAiProvider {
    getAgentResponse: (conversationHistory: Content[], systemInstruction: string, model?: string) => Promise<AIResponse>;
    getInlineSuggestion: (systemInstruction: string, request: string, model?: string) => Promise<AIInlineResponse>;
    getCodeFormat: (code: string, model?: string) => Promise<string | null>;
    getSuggestPlot: (systemInstruction: string, sql: string, model?: string, context?: PlotSuggestContext) => Promise<string | null>;
    getPlotFixSuggestion: (systemInstruction: string, model?: string) => Promise<AIPlotFixResponse>;
    verifyCredentials: () => Promise<boolean>;

    /**
     * Optional tool-calling streaming entry point. Implementations yield
     * text deltas and tool_call chunks; the AiService orchestrator runs the
     * tool runtime, pushes tool_result back into `messages` and re-invokes
     * the provider for the next round.
     */
    streamChatWithTools?: (
        messages: ToolChatMessage[],
        tools: Tool[],
        opts?: StreamChatWithToolsOpts,
    ) => AsyncIterable<ToolStreamChunk>;
}