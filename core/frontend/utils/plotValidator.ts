import { plotRegistry } from '../components/plots/plotRegistry';
import { normalizePlotName } from '../components/plots/plotNames';
import { parsePlotCall, parseComposite } from './plotParser';
import { expandPlotConstants } from './plotConstants';
import type { ParsedPlotCall } from './plotParser';

/**
 * Validates a plot configuration string against a given dataset.
 * This is used by the AI agent to check its own suggestions before
 * finalizing a response.
 * @param config The full plot config string (can contain multiple plots or composite layouts).
 * @param data The data result from the SQL query.
 * @returns An error message string if validation fails, otherwise null.
 */
export const validatePlotConfig = (config: string, data: any[]): string | null => {
    // If there's no data, any plot is technically valid (though will render an empty state).
    // The main error to catch is using a column that doesn't exist.
    if (!data || data.length === 0 || data[0]?.error) {
        return null;
    }

    // Expand LET constants first; bail out with all constant errors if any (B-190).
    const expansion = expandPlotConstants(config?.trim() || 'TABLE()');
    if (expansion.errors.length > 0) {
        return expansion.errors.join('\n');
    }

    const configTrimmed = expansion.expanded.trim() || 'TABLE()';

    return validateSingleOrComposite(configTrimmed, data);
};

function validateSingleOrComposite(configTrimmed: string, data: any[]): string | null {
    const parsed = parseComposite(configTrimmed);
    return validateParsedNode(parsed, data);
}

function validateParsedNode(parsed: ParsedPlotCall, data: any[]): string | null {
    // Composite (ROW, COL, overlay +) — recurse into children directly on the
    // already-parsed node to avoid losing clauses (ON, WIDTH, TITLE, etc.) that
    // parsePlotCall strips from mainConfig into separate fields.
    if (parsed.composite) {
        for (const child of parsed.composite.children) {
            const err = validateParsedNode(child, data);
            if (err) return err;
        }
        return null;
    }

    // Single plot call.
    return validateLeaf(parsed, data);
}

function validateLeaf(leaf: ReturnType<typeof parsePlotCall>, data: any[]): string | null {
    try {
        const { mainConfig, on } = leaf;
        const plotTypeMatch = mainConfig.match(/^(\w+)\s*\(/);
        const plotTypeName = plotTypeMatch ? normalizePlotName(plotTypeMatch[1]) : 'TABLE';
        const plotRegistration = plotRegistry[plotTypeName];

        if (!plotRegistration) {
            return `Unknown plot type "${plotTypeName}".`;
        }

        // Use strict === false check: only error when the field is explicitly
        // false, not when it's absent (undefined). Most plot types simply
        // don't declare the field at all.
        if (on && on.length > 1 && plotRegistration.supportsMultiQuery === false) {
            return `Plot type "${plotTypeName}" does not support multiple queries with the ON clause.`;
        }

        // The parseConfig function for each plot is designed to throw an error
        // if the configuration is malformed or if required columns are not
        // present in the data.
        plotRegistration.parseConfig(mainConfig, data);

    } catch (e: any) {
        return e instanceof Error ? e.message : String(e);
    }
    return null;
}
