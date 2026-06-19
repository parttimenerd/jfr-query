import { plotRegistry } from '../components/plots/plotRegistry';
import { parsePlotCall } from './plotParser';

/**
 * Validates a plot configuration string against a given dataset.
 * This is used by the AI agent to check its own suggestions before
 * finalizing a response.
 * @param config The full plot config string (can contain multiple plots).
 * @param data The data result from the SQL query.
 * @returns An error message string if validation fails, otherwise null.
 */
export const validatePlotConfig = (config: string, data: any[]): string | null => {
    // If there's no data, any plot is technically valid (though will render an empty state).
    // The main error to catch is using a column that doesn't exist.
    if (!data || data.length === 0 || data[0]?.error) {
        return null;
    }

    const configTrimmed = config?.trim() || 'TABLE()';
    // Join lines that are part of a multi-line function call
    const joinedConfig = configTrimmed.replace(/\(\s*\n([\s\S]*?)\n\s*\)/g, (match) => {
        return match.replace(/\s*\n\s*/g, ' ');
    });
    const configs = joinedConfig.split('\n').map(c => c.trim()).filter(Boolean);

    for (const singleConfig of configs) {
        try {
            const { mainConfig, on } = parsePlotCall(singleConfig);
            const plotTypeMatch = mainConfig.match(/^(\w+)\s*\(/);
            const plotTypeName = plotTypeMatch ? plotTypeMatch[1].toUpperCase() : 'TABLE';
            const plotRegistration = plotRegistry[plotTypeName];
    
            if (!plotRegistration) {
                return `Unknown plot type "${plotTypeName}".`;
            }

            if (on && on.length > 1 && !plotRegistration.supportsMultiQuery) {
                return `Plot type "${plotTypeName}" does not support multiple queries with the ON clause.`;
            }

            // The parseConfig function for each plot is designed to throw an error
            // if the configuration is malformed or if required columns are not
            // present in the data.
            plotRegistration.parseConfig(mainConfig, data);

        } catch (e: any) {
             return e.message;
        }
    }

    return null; // All configs are valid
};
