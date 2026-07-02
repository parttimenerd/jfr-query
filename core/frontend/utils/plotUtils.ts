import type { PlotParameter } from '../components/plots/plotTypes';

// Named color palettes for the PALETTE clause.
const PALETTES: Record<string, string[]> = {
    category10: ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'],
    tableau10:  ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'],
    pastel1:    ['#fbb4ae','#b3cde3','#ccebc5','#decbe4','#fed9a6','#ffffcc','#e5d8bd','#fddaec','#f2f2f2'],
    dark2:      ['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#666666'],
    set2:       ['#66c2a5','#fc8d62','#8da0cb','#e78ac3','#a6d854','#ffd92f','#e5c494','#b3b3b3'],
};

/**
 * Returns the color array for the given palette name, or the default COLORS
 * array if the name is unrecognized.
 */
export function getPaletteColors(palette: string | undefined, fallback: string[]): string[] {
    if (!palette) return fallback;
    return PALETTES[palette.toLowerCase()] ?? fallback;
}

export interface ParserSpec {
    [key: string]: {
        type: string;
        required: boolean;
        defaultValue?: any;
        description: string;
        options?: string[];
        aliasFor?: string;
        deprecated?: boolean;
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
            aliasFor: param.aliasFor,
            deprecated: param.deprecated,
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
    // B-073: case-insensitive fallback for quoted-vs-unquoted name mismatches.
    const lc = baseName.toLowerCase();
    const ciMatch = allColumns.find(c => c.toLowerCase() === lc);
    if (ciMatch) return ciMatch;
    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixedMatch = allColumns.find(c => new RegExp(`^\\d+_${escaped}$`, 'i').test(c));
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
    const prefixedMatches = allColumns.filter(c => new RegExp(`^\\d+_${escaped}$`, 'i').test(c));
    if (prefixedMatches.length > 0) {
        return prefixedMatches;
    }

    // If no prefixed columns, check for a direct match (case-insensitive).
    const lc = baseName.toLowerCase();
    const ciMatch = allColumns.find(c => c.toLowerCase() === lc);
    if (ciMatch) return [ciMatch];
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
    if (value instanceof Date) {
        const t = value.getTime();
        return normalizeEpochNumber(t);
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        const num = Number(value);
        if (!Number.isFinite(num)) return NaN;
        return normalizeEpochNumber(num);
    }
    if (typeof value === 'string') {
        if (/^-?\d+$/.test(value)) {
            const asInt = Number(value);
            if (!Number.isFinite(asInt)) return NaN;
            return normalizeEpochInteger(asInt, value.length);
        }
        const asNumber = Number(value);
        if (!isNaN(asNumber) && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) {
            return normalizeEpochNumber(asNumber);
        }
        const date = new Date(value);
        if (!isNaN(date.getTime())) return date.getTime();
    }
    return NaN;
};

// Heuristic conversion of a numeric epoch into milliseconds.
// - Float with 10-digit integer part: epoch-seconds → ×1000.
// - Integer length 16 (or 15–17): microseconds → ÷1000.
// - Integer length 19 (or 18–20): nanoseconds → ÷1_000_000.
// - Otherwise: already milliseconds.
function normalizeEpochNumber(n: number): number {
    if (!Number.isFinite(n)) return NaN;
    if (!Number.isInteger(n)) {
        const intPart = Math.trunc(Math.abs(n));
        const digits = intPart === 0 ? 1 : Math.floor(Math.log10(intPart)) + 1;
        if (digits === 10) return n * 1000;
        return n;
    }
    const digits = n === 0 ? 1 : Math.floor(Math.log10(Math.abs(n))) + 1;
    return normalizeEpochInteger(n, digits);
}

function normalizeEpochInteger(n: number, digits: number): number {
    if (digits >= 18) return n / 1_000_000;
    if (digits >= 15) return n / 1_000;
    return n;
}

// Matches columns that store durations (not absolute timestamps). Mirrors classifyColumns.ts DURATION_NAMES_RE.
const DURATION_COL_RE = /(duration|elapsed|latency|pause|wait|delay|interval|lag|_ns|nanos)/i;

/** True when the column name suggests it stores a duration value (likely nanoseconds from JFR). */
export function isDurationColumnName(name: string): boolean {
    return DURATION_COL_RE.test(name);
}

/**
 * Formats a nanosecond duration value as a human-readable string.
 * ≥ 1s → "1.23s", ≥ 1ms → "1.23ms", else → "123ns"
 */
export function formatDurationNs(ns: any): string {
    const n = Number(ns);
    if (!Number.isFinite(n)) return String(ns);
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toPrecision(3)}s`;
    if (abs >= 1e6) return `${(n / 1e6).toPrecision(3)}ms`;
    if (abs >= 1e3) return `${(n / 1e3).toPrecision(3)}µs`;
    return `${n}ns`;
}

/**
 * Returns true when the sample values for the given columns are all large
 * enough that they are likely nanoseconds (> 1ms = 1e6 ns).
 */
export function sampleLooksLikeNanoseconds(data: any[], cols: string[]): boolean {
    if (!data.length || !cols.length) return false;
    let checkedAny = false;
    for (const col of cols) {
        const sample = data.find(row => row[col] != null)?.[col];
        if (sample == null) continue;
        checkedAny = true;
        if (Math.abs(Number(sample)) < 1e6) return false;
    }
    return checkedAny;
}

/**
 * Given a plot type name and available data columns, returns a template string with
 * required column arguments pre-filled using heuristics.
 * Falls back to the plot's own blank template if columns can't be resolved.
 */
export const buildSmartTemplate = (plotName: string, columns: string[], sampleRow: Record<string, any> | null): string | null => {
    if (columns.length === 0) return null;

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
            if (!valCol) return 'PIE_CHART(category: , value: )';
            return `PIE_CHART(category: ${q(nameCol)}, value: ${q(valCol)})`;
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
            return null;
    }
};