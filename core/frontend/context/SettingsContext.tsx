import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { AiProviderType } from '../services/ai/IAiProvider';
import { providerMetadataRegistry } from '../services/AiService';

export interface Settings {
    aiProvider: AiProviderType;
    googleApiKey: string;
    openaiApiKey: string;
    gardenerApiKey: string;
    googleBasicModel: string;
    googleGoodModel: string;
    openaiBasicModel: string;
    openaiGoodModel: string;
    gardenerBasicModel: string;
    gardenerGoodModel: string;
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
    googleBasicModel: providerMetadataRegistry.google.defaultModels.basic,
    googleGoodModel: providerMetadataRegistry.google.defaultModels.advanced,
    openaiBasicModel: providerMetadataRegistry.openai.defaultModels.basic,
    openaiGoodModel: providerMetadataRegistry.openai.defaultModels.advanced,
    gardenerBasicModel: providerMetadataRegistry.gardener.defaultModels.basic,
    gardenerGoodModel: providerMetadataRegistry.gardener.defaultModels.advanced,
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
