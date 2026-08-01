import React, { createContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { AiProviderType } from '../services/ai/IAiProvider';
import { providerMetadataRegistry } from '../services/AiService';
import { DEFAULT_MODEL_ID } from '../services/ml/candidates';
import { setSuppressDeprecationWarnings } from '../components/plots/deprecation';

export interface Settings {
    aiProvider: AiProviderType;
    googleApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    anthropicBaseUrl: string;
    gardenerApiKey: string;
    localApiKey: string;
    localBaseUrl: string;
    localMaxTokens: number;
    googleBasicModel: string;
    googleGoodModel: string;
    googleTinyModel: string;
    openaiBasicModel: string;
    openaiGoodModel: string;
    openaiTinyModel: string;
    anthropicBasicModel: string;
    anthropicGoodModel: string;
    anthropicTinyModel: string;
    gardenerBasicModel: string;
    gardenerGoodModel: string;
    gardenerTinyModel: string;
    localBasicModel: string;
    localGoodModel: string;
    localTinyModel: string;
    browserTinyModel: string;
    browserModelId: string;
    browserChatModelId: string;
    customSystemPrompt: string;
    timeFormat: string;
    decimalPlaces: number;
    // C1 — Per-feature model selection.
    autocompleteModelOverride: 'tiny' | 'basic' | 'custom';
    autocompleteCustomModel: string;
    plotSuggestModelOverride: 'tiny' | 'basic' | 'custom';
    plotSuggestCustomModel: string;
    plotSuggestSource: 'local-trained' | 'cloud-tiny' | 'cloud-basic' | 'auto';
    // C1 — Hard offline-only switches per feature.
    autocompleteOfflineOnly: boolean;
    plotSuggestOfflineOnly: boolean;
    // C2 — AI Data Visibility. Controls what slice of the most recent
    // query result the AI can see. Per-chat dropdown initializes from
    // this default; visibilityFullRowLimit caps `full` mode (max 500).
    aiDefaultVisibility: 'no-data' | 'sanitized' | 'full';
    visibilityFullRowLimit: number;
    // P5 — plot-mode AI ghost-text. Separate toggle from any SQL ghost-text
    // setting (default off) so users can iterate on plot DSL without inline
    // completion noise. Honors `aiAutocompleteModel`: 'off' / 'cloud-tiny' /
    // 'browser' (browser mode is a no-op in P5's first cut — Qwen can't follow
    // the grammar reliably).
    aiAutocompleteModel: 'off' | 'cloud-tiny' | 'browser';
    plotAiAutocompleteEnabled: boolean;
    plotAiAutocompleteDebounceMs: number;
    // C5 — Auto-plot suggestion chip enable/disable.
    autoPlotSuggestionEnabled: boolean;
    // P2 — plot DSL companion-SQL schema discovery (DESCRIBE queries).
    plotSchemaDiscoveryEnabled: boolean;
    // W11 — Suppress one-shot deprecation warnings for renamed plot DSL params.
    // Default false (warnings on). When true, warnDeprecated() is a no-op.
    suppressDeprecationWarnings: boolean;
    // Phase 2 — AI permission defaults. 'ask' shows a one-time session card;
    // 'always' never asks; 'never' blocks silently.
    aiPermQueryData: 'never' | 'ask' | 'always';
    aiPermAddCell: 'never' | 'ask' | 'always';
    aiPermUpdateCell: 'never' | 'ask' | 'always';
    aiPermDeleteCell: 'never' | 'ask' | 'always';
    // Phase 3 — Local model routing.
    localModelName: string;
    localRoutingPreference: 'auto' | 'local' | 'cloud';
    localToolAccess: 'read-only' | 'full';
}

interface SettingsContextType {
    settings: Settings;
    saveSettings: (newSettings: Partial<Settings>) => void;
}

const SETTINGS_KEY = 'jfr-notebook-settings';

const defaultSettings: Settings = {
    aiProvider: 'browser',
    googleApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || '',
    gardenerApiKey: process.env.GARDENER_API_KEY || '',
    localApiKey: process.env.LOCAL_AI_API_KEY || '',
    localBaseUrl: process.env.LOCAL_AI_BASE_URL || 'http://localhost:8080',
    localMaxTokens: 16384,
    googleBasicModel: providerMetadataRegistry.google.defaultModels.basic,
    googleGoodModel: providerMetadataRegistry.google.defaultModels.advanced,
    googleTinyModel: providerMetadataRegistry.google.defaultModels.tiny,
    openaiBasicModel: providerMetadataRegistry.openai.defaultModels.basic,
    openaiGoodModel: providerMetadataRegistry.openai.defaultModels.advanced,
    openaiTinyModel: providerMetadataRegistry.openai.defaultModels.tiny,
    anthropicBasicModel: providerMetadataRegistry.anthropic.defaultModels.basic,
    anthropicGoodModel: providerMetadataRegistry.anthropic.defaultModels.advanced,
    anthropicTinyModel: providerMetadataRegistry.anthropic.defaultModels.tiny,
    gardenerBasicModel: providerMetadataRegistry.gardener.defaultModels.basic,
    gardenerGoodModel: providerMetadataRegistry.gardener.defaultModels.advanced,
    gardenerTinyModel: providerMetadataRegistry.gardener.defaultModels.tiny,
    localBasicModel: providerMetadataRegistry.local.defaultModels.basic,
    localGoodModel: providerMetadataRegistry.local.defaultModels.advanced,
    localTinyModel: providerMetadataRegistry.local.defaultModels.tiny,
    browserTinyModel: providerMetadataRegistry.browser.defaultModels.tiny,
    browserModelId: DEFAULT_MODEL_ID,
    browserChatModelId: 'qwen2.5-0.5b',
    customSystemPrompt: '',
    timeFormat: 'HH:mm:ss.SS',
    decimalPlaces: 6,
    autocompleteModelOverride: 'tiny',
    autocompleteCustomModel: '',
    plotSuggestModelOverride: 'tiny',
    plotSuggestCustomModel: '',
    plotSuggestSource: 'local-trained',
    autocompleteOfflineOnly: false,
    plotSuggestOfflineOnly: false,
    aiDefaultVisibility: 'no-data',
    visibilityFullRowLimit: 50,
    aiAutocompleteModel: 'browser',
    plotAiAutocompleteEnabled: false,
    plotAiAutocompleteDebounceMs: 250,
    autoPlotSuggestionEnabled: true,
    plotSchemaDiscoveryEnabled: true,
    suppressDeprecationWarnings: false,
    aiPermQueryData: 'always',
    aiPermAddCell: 'ask',
    aiPermUpdateCell: 'ask',
    aiPermDeleteCell: 'ask',
    localModelName: '',
    localRoutingPreference: 'auto',
    localToolAccess: 'read-only',
};

export const SettingsContext = createContext<SettingsContextType>({
    settings: defaultSettings,
    saveSettings: () => {},
});

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<Settings>(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_KEY);
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                const merged = { ...defaultSettings, ...parsed };
                // Env var keys take precedence over empty stored values so that
                // setting a .env.local key works without clearing localStorage first.
                if (!merged.googleApiKey) merged.googleApiKey = defaultSettings.googleApiKey;
                if (!merged.openaiApiKey) merged.openaiApiKey = defaultSettings.openaiApiKey;
                if (!merged.anthropicApiKey) merged.anthropicApiKey = defaultSettings.anthropicApiKey;
                // Env-provided base URL always wins (the Vite define rewrites it to /anthropic-proxy
                // when ANTHROPIC_BASE_URL is set, avoiding CORS). Override any stored value.
                if (defaultSettings.anthropicBaseUrl) merged.anthropicBaseUrl = defaultSettings.anthropicBaseUrl;
                if (!merged.gardenerApiKey) merged.gardenerApiKey = defaultSettings.gardenerApiKey;
                if (!merged.localApiKey) merged.localApiKey = defaultSettings.localApiKey;
                if (!merged.localBaseUrl) merged.localBaseUrl = defaultSettings.localBaseUrl;
                if (typeof merged.localMaxTokens !== 'number' || merged.localMaxTokens <= 0) {
                    merged.localMaxTokens = defaultSettings.localMaxTokens;
                }
                return merged;
            }
        } catch (error) {
            console.error("Failed to load settings from localStorage:", error);
        }
        return defaultSettings;
    });

    const saveSettings = useCallback((newSettings: Partial<Settings>) => {
        setSettings(prevSettings => {
            const updatedSettings = { ...prevSettings, ...newSettings };
            try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(updatedSettings));
            } catch (error) {
                console.error("Failed to save settings to localStorage:", error);
            }
            return updatedSettings;
        });
    }, []);

    // W11 — Propagate suppressDeprecationWarnings to the module-level singleton
    // used by warnDeprecated(). useEffect so SSR/test environments don't run it
    // before the module is loaded.
    useEffect(() => {
        setSuppressDeprecationWarnings(settings.suppressDeprecationWarnings);
    }, [settings.suppressDeprecationWarnings]);

    return (
        <SettingsContext.Provider value={useMemo(() => ({ settings, saveSettings }), [settings, saveSettings])}>
            {children}
        </SettingsContext.Provider>
    );
};
