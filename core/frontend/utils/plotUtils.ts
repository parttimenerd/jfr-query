import type { PlotParameter } from '../components/plots/plotTypes';

export interface ParserSpec {
    [key: string]: {
        type: string;
        required: boolean;
        defaultValue?: any;
        description: string;
    };
}

export const buildParserSpec = (params: PlotParameter[]): ParserSpec => {
    const spec: ParserSpec = {};
    for (const param of params) {
        spec[param.name] = {
            type: param.type,
            required: !!param.required,
            defaultValue: param.defaultValue,
            description: param.description,
        };
    }
    return spec;
};

export const generateSignature = (params: PlotParameter[]): string => {
    if (params.length === 0) {
        return '()';
    }

    const MAX_PARAMS_TO_SHOW = 4;

    const requiredParams = params.filter(p => p.required);
    const optionalParams = params.filter(p => !p.required);

    // Show required params first, then fill with optional params, up to the limit.
    const paramsToShow = requiredParams.concat(optionalParams).slice(0, MAX_PARAMS_TO_SHOW);
    
    const paramStrings = paramsToShow.map(p => {
        const required = p.required ? '' : '?'; // Add '?' for optional params
        return `${p.name}: ${p.type}${required}`;
    });
    
    let signatureString = `(${paramStrings.join(', ')}`;
    
    // Add '...' if there are more params than we're showing
    if (params.length > paramsToShow.length) {
        if (paramStrings.length > 0) {
            signatureString += ', ...';
        } else {
            signatureString += '...';
        }
    }
    
    signatureString += ')';

    return signatureString;
};

/**
 * Finds a single matching column, handling potential multi-query prefixes.
 * A direct match is preferred over a prefixed one.
 * @param baseName The base name of the column to find (e.g., "duration").
 * @param allColumns All available column names in the dataset.
 * @returns The full column name (e.g., "duration" or "1_duration"), or the baseName if not found.
 */
export const findColumn = (baseName: string, allColumns: string[]): string => {
    if (allColumns.includes(baseName)) {
        return baseName;
    }
    const prefixedMatch = allColumns.find(c => c.match(`^\\d+_${baseName}$`));
    return prefixedMatch || baseName;
};

/**
 * Finds all matching columns, handling multi-query prefixes.
 * If 'duration' is requested and ['1_duration', '2_duration'] exist, it returns both.
 * @param baseName The base name to find (e.g., "duration").
 * @param allColumns All available column names.
 * @returns An array of matching full column names.
 */
export const findColumns = (baseName: string, allColumns: string[]): string[] => {
    // Find all columns that are prefixed versions of the base name.
    const prefixedMatches = allColumns.filter(c => c.match(`^\\d+_${baseName}$`));
    if (prefixedMatches.length > 0) {
        return prefixedMatches;
    }

    // If no prefixed columns, check for a direct match.
    if (allColumns.includes(baseName)) {
        return [baseName];
    }

    return [];
};

/**
 * Robustly converts various time-like values (nanosecond strings, millisecond numbers, Date objects)
 * into a millisecond timestamp number for consistent plotting.
 * @param value The value to convert.
 * @returns A number in milliseconds, or NaN if not convertible.
 */
export const getTimeValue = (value: any): number => {
    if (value === null || value === undefined) return NaN;
    const originalValue = String(value);
    if (typeof value === 'number' || typeof value === 'bigint') {
        const num = Number(value);
        // Heuristic: if it's a very large number (likely nanos), convert to millis.
        if (originalValue.length > 15) return num / 1_000_000;
        return num;
    }
    if (typeof value === 'string') {
        const asNumber = Number(value);
        // Check if the string is purely numeric
        if (!isNaN(asNumber) && value.match(/^\d+$/)) {
             if (value.length > 15) return asNumber / 1_000_000;
             return asNumber;
        }
        // Otherwise, parse as a date string (e.g., ISO format)
        const date = new Date(value);
        if (!isNaN(date.getTime())) return date.getTime();
    }
    return NaN;
};