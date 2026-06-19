import React, { createContext, useContext } from 'react';

interface DisplaySettings {
    timeFormat: string;
    decimalPlaces: number;
}

const defaultDisplaySettings: DisplaySettings = {
    timeFormat: 'HH:mm:ss.SS',
    decimalPlaces: 6,
};

export const DisplaySettingsContext = createContext<DisplaySettings>(defaultDisplaySettings);

export const DisplaySettingsProvider = DisplaySettingsContext.Provider;

export const useDisplaySettings = () => useContext(DisplaySettingsContext);
