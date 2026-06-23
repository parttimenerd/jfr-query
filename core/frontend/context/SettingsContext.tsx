import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { AiProviderType } from '../services/ai/IAiProvider';
import { providerMetadataRegistry } from '../services/AiService';
import { DEFAULT_MODEL_ID } from '../services/ml/candidates';

export interface Settings {
    aiProvider: AiProviderType;
    googleApiKey: string;
    openaiApiKey: string;
    gardenerApiKey: string;
    localApiKey: string;
    localBaseUrl: string;
    localMaxTokens: number;
    googleBasicModel: string;
    googleGoodModel: string;
    openaiBasicModel: string;
    openaiGoodModel: string;
    gardenerBasicModel: string;
    gardenerGoodModel: string;
    localBasicModel: string;
    localGoodModel: string;
    browserModelId: string;
    customSystemPrompt: string;
    timeFormat: string;
    decimalPlaces: number;
}

interface SettingsContextType {
    settings: Settings;
    saveSettings: (newSettings: Partial<Settings>) => void;
}

const SETTINGS_KEY = 'jfr-notebook-settings';

const defaultSettings: Settings = {
    aiProvider: 'google',
    googleApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    gardenerApiKey: process.env.GARDENER_API_KEY || '',
    localApiKey: process.env.LOCAL_AI_API_KEY || '',
    localBaseUrl: process.env.LOCAL_AI_BASE_URL || 'http://localhost:8080',
    localMaxTokens: 2048,
    googleBasicModel: providerMetadataRegistry.google.defaultModels.basic,
    googleGoodModel: providerMetadataRegistry.google.defaultModels.advanced,
    openaiBasicModel: providerMetadataRegistry.openai.defaultModels.basic,
    openaiGoodModel: providerMetadataRegistry.openai.defaultModels.advanced,
    gardenerBasicModel: providerMetadataRegistry.gardener.defaultModels.basic,
    gardenerGoodModel: providerMetadataRegistry.gardener.defaultModels.advanced,
    localBasicModel: providerMetadataRegistry.local.defaultModels.basic,
    localGoodModel: providerMetadataRegistry.local.defaultModels.advanced,
    browserModelId: DEFAULT_MODEL_ID,
    customSystemPrompt: '',
    timeFormat: 'HH:mm:ss.SS',
    decimalPlaces: 6,
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

    return (
        <SettingsContext.Provider value={{ settings, saveSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};
