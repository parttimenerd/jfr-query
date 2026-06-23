import type { PlotParameter } from '../components/plots/plotTypes';

export interface ParserSpec {
    [key: string]: {
        type: string;
        required: boolean;
        defaultValue?: any;
        description: string;
        options?: string[];
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
            options: param.options,
        };
    }
    // Every plot accepts an optional title parameter (rendered as a chart header).
    if (!spec['title']) {
        spec['title'] = { type: 'string', required: false, description: 'Optional title to display above the chart.' };
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
    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixedMatch = allColumns.find(c => c.match(`^\\d+_${escaped}$`));
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
    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixedMatches = allColumns.filter(c => c.match(`^\\d+_${escaped}$`));
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

/**
 * Given a plot type name and available data columns, returns a template string with
 * required column arguments pre-filled using heuristics.
 * Falls back to the plot's own blank template if columns can't be resolved.
 */
export const buildSmartTemplate = (plotName: string, columns: string[], sampleRow: Record<string, any> | null): string => {
    if (columns.length === 0) return null as any;

    // Classify each column as numeric, time-like, or categorical
    const isNumeric = (col: string) => {
        if (!sampleRow) return false;
        const v = sampleRow[col];
        return v !== null && v !== undefined && !isNaN(Number(v)) && typeof v !== 'boolean';
    };
    const isTime = (col: string) => {
        const lower = col.toLowerCase();
        // Name heuristic: contains 'time', 'date', 'ts', 'bucket', 'window', 'start', 'end'
        if (/time|date|timestamp|bucket|window|^start$|^end$/i.test(lower)) return true;
        if (!sampleRow) return false;
        const v = sampleRow[col];
        if (v instanceof Date) return true;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
        return false;
    };

    const timeCols = columns.filter(isTime);
    const numericCols = columns.filter(c => isNumeric(c) && !isTime(c));
    const categoryCols = columns.filter(c => !isNumeric(c) && !isTime(c));

    const q = (s: string) => `"${s}"`;
    const ql = (arr: string[]) => arr.map(q).join(', ');

    switch (plotName) {
        case 'TABLE':
            return 'TABLE()';
        case 'LINE_CHART': {
            const xCol = timeCols[0] ?? columns[0];
            const yCols = numericCols.length > 0 ? numericCols.slice(0, 3) : columns.filter(c => c !== xCol).slice(0, 2);
            if (yCols.length === 0) return 'LINE_CHART(x: , y: [])';
            return `LINE_CHART(x: ${q(xCol)}, y: [${ql(yCols)}])`;
        }
        case 'BAR_CHART': {
            const xCol = categoryCols[0] ?? timeCols[0] ?? columns[0];
            const yCols = numericCols.length > 0 ? numericCols.slice(0, 2) : columns.filter(c => c !== xCol).slice(0, 1);
            if (yCols.length === 0) return 'BAR_CHART(x: , y: [])';
            return `BAR_CHART(x: ${q(xCol)}, y: [${ql(yCols)}])`;
        }
        case 'PIE_CHART': {
            const nameCol = categoryCols[0] ?? columns[0];
            const valCol = numericCols[0] ?? columns.find(c => c !== nameCol) ?? columns[1];
            if (!valCol) return 'PIE_CHART(name: , value: )';
            return `PIE_CHART(name: ${q(nameCol)}, value: ${q(valCol)})`;
        }
        case 'SCATTER_PLOT': {
            const xCol = numericCols[0] ?? columns[0];
            const yCol = numericCols[1] ?? numericCols[0] ?? columns[1] ?? columns[0];
            return `SCATTER_PLOT(x: ${q(xCol)}, y: ${q(yCol)})`;
        }
        case 'HISTOGRAM': {
            const valCol = numericCols[0] ?? columns[0];
            return `HISTOGRAM(value: ${q(valCol)})`;
        }
        case 'BOX_PLOT': {
            const catCol = categoryCols[0] ?? columns[0];
            const valCol = numericCols[0] ?? columns.find(c => c !== catCol) ?? columns[1];
            if (!valCol) return 'BOX_PLOT(category: , value: )';
            return `BOX_PLOT(category: ${q(catCol)}, value: ${q(valCol)})`;
        }
        case 'HEATMAP': {
            const xCol = categoryCols[0] ?? columns[0];
            const yCol = categoryCols[1] ?? timeCols[0] ?? columns[1] ?? columns[0];
            const valCol = numericCols[0] ?? columns.find(c => c !== xCol && c !== yCol) ?? columns[2];
            if (!valCol) return 'HEATMAP(x: , y: , value: )';
            return `HEATMAP(x: ${q(xCol)}, y: ${q(yCol)}, value: ${q(valCol)})`;
        }
        case 'FLAMEGRAPH': {
            const nameCol = columns.find(c => /frame|method|stack|name|function/i.test(c)) ?? columns[0];
            const valCol = numericCols[0] ?? columns.find(c => c !== nameCol);
            if (!valCol) return 'FLAMEGRAPH(frame: , value: )';
            return `FLAMEGRAPH(frame: ${q(nameCol)}, value: ${q(valCol)})`;
        }
        default:
            return null as any;
    }
};