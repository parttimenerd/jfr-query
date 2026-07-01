import { ParserSpec } from './plotUtils';
import { warnDeprecated } from '../components/plots/deprecation';

// A simple parser for a function-call-like configuration string.
// Handles strings, numbers, booleans, and arrays of those (one level deep).

/**
 * Levenshtein distance — small, used only for "did you mean" suggestions on
 * unknown parameter names and unknown columns. O(n*m) but inputs are short
 * identifier-length strings so this is fine.
 */
function editDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const prev = new Array(n + 1);
    const curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
}

/** Pick the closest candidate to `input` from `candidates`, if any is "close enough". */
function closestMatch(input: string, candidates: string[]): string | null {
    if (candidates.length === 0) return null;
    const lower = input.toLowerCase();
    let best: string | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
        const d = editDistance(lower, c.toLowerCase());
        if (d < bestScore) { bestScore = d; best = c; }
    }
    // Threshold: tolerate up to ~50% of input length, capped at 3, but at least 2
    // so simple transpositions (cost 2 in pure Levenshtein) like "tiem" → "time" still match.
    const threshold = Math.min(3, Math.max(2, Math.floor(input.length * 0.5)));
    return best && bestScore <= threshold ? best : null;
}

/**
 * W12 — Strip `#`-to-end-of-line comments from a config string while preserving
 * `#` inside single- or double-quoted strings (e.g. a CSS color `#abc`).
 */
function stripComments(s: string): string {
    let out = '';
    let inStr: string | null = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (ch === inStr && s[i - 1] !== '\\') inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inStr = ch;
            out += ch;
            continue;
        }
        if (ch === '#') {
            // skip to next newline
            while (i < s.length && s[i] !== '\n') i++;
            // preserve the newline (loop's i++ will advance past it)
            if (i < s.length) out += s[i];
            continue;
        }
        out += ch;
    }
    return out;
}

const parseValue = (valueStr: string, expectedType: string, data: any[], paramName?: string): any => {
    const trimmed = valueStr.trim();

    if (expectedType.endsWith('[]')) {
        // Auto-coerce a bare string/value to a single-element array for friendlier authoring.
        // e.g. y: "Count"  →  ["Count"]  (instead of requiring y: ["Count"])
        if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
            const singleVal = parseValue(trimmed, expectedType.replace('[]', ''), data, paramName);
            return [singleVal];
        }
        const inner = trimmed.substring(1, trimmed.length - 1).trim();
        if (inner === '') return [];
        return splitParams(inner).map(item => parseValue(item, expectedType.replace('[]', ''), data, paramName));
    }

    // Column type — must exist in the dataset (if dataset is non-empty)
    if (expectedType === 'column') {
        const colName = trimmed.replace(/^["'](.*)["']$/, '$1');
        if (data.length > 0 && data[0]) {
            const allColumns = Object.keys(data[0]);
            const directMatch = allColumns.includes(colName);
            const escapedColName = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const prefixedMatch = allColumns.some(c => c.match(new RegExp(`^\\d+_${escapedColName}$`)));

            if (!directMatch && !prefixedMatch) {
                const suggestion = closestMatch(colName, allColumns.map(c => c.replace(/^\d+_/, '')));
                const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
                const available = allColumns.length > 12
                    ? allColumns.slice(0, 12).join(', ') + `, ... (+${allColumns.length - 12} more)`
                    : allColumns.join(', ');
                throw new Error(
                    `Column "${colName}" not found in query results.${didYouMean}\nAvailable columns: ${available}`
                );
            }
        }
        return colName;
    }

    // String literal
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.substring(1, trimmed.length - 1);
    }

    // Boolean
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;

    // Number
    const num = parseFloat(trimmed);
    if (!isNaN(num) && /^-?\d+(\.\d+)?(e\d+)?$/i.test(trimmed)) {
        return num;
    }

    // For string-typed params with restricted options, validate
    return trimmed;
};

function splitParams(paramsStr: string): string[] {
    const parts: string[] = [];
    let depth = 0, inStr = false, strChar = '', curr = '';
    for (const ch of paramsStr) {
        if (!inStr && (ch === '"' || ch === "'")) { inStr = true; strChar = ch; }
        else if (inStr && ch === strChar) { inStr = false; }
        else if (!inStr && (ch === '[' || ch === '(')) depth++;
        else if (!inStr && (ch === ']' || ch === ')')) depth--;
        if (ch === ',' && !inStr && depth === 0) {
            const trimmed = curr.trim();
            if (trimmed) parts.push(trimmed);
            curr = '';
            continue;
        }
        curr += ch;
    }
    const trimmed = curr.trim();
    if (trimmed) parts.push(trimmed);
    return parts;
}

function buildUsage(funcName: string, spec: ParserSpec): string {
    const required = Object.entries(spec).filter(([, p]) => p.required && !p.aliasFor && !p.deprecated);
    const optional = Object.entries(spec).filter(([, p]) => !p.required && !p.aliasFor && !p.deprecated);
    const fmt = ([name, p]: [string, any]) =>
        `  ${name}: ${p.type}${p.required ? '  (required)' : p.defaultValue !== undefined ? `  (default: ${JSON.stringify(p.defaultValue)})` : ''}`;
    const lines = [
        ...required.map(fmt),
        ...(optional.length ? ['  ---', ...optional.map(fmt)] : []),
    ];
    return `${funcName}(\n${lines.join('\n')}\n)`;
}

export const createConfigParser = <TConfig extends object>(spec: ParserSpec) => {
    return (configStr: string, data: any[]): TConfig => {
        const result: Partial<TConfig> = {};

        // W12: strip `#`-to-EOL comments (outside string literals).
        configStr = stripComments(configStr);

        const funcNameMatch = configStr.match(/^\w+/);
        const funcName = funcNameMatch ? funcNameMatch[0].toUpperCase() : 'FUNCTION';
        const match = configStr.match(/^\w+\s*\(([\s\S]*)\)\s*$/);

        if (!match) {
            // Be specific about what went wrong.
            if (!configStr.trim()) {
                throw new Error(`Plot configuration is empty.\n\nUsage:\n${buildUsage(funcName, spec)}`);
            }
            if (!configStr.includes('(')) {
                throw new Error(
                    `Missing "(" in plot call. A plot config looks like ${funcName}(...)\n\nGot: ${configStr.trim()}`
                );
            }
            if (!configStr.trim().endsWith(')')) {
                throw new Error(
                    `Missing closing ")" in plot call.\n\nGot: ${configStr.trim()}`
                );
            }
            throw new Error(`Invalid function call syntax. Expected ${funcName}(...).\n\nGot: ${configStr.trim()}`);
        }

        const paramsStr = match[1].trim();

        if (paramsStr) {
            const paramParts = splitParams(paramsStr);

            for (const part of paramParts) {
                if (part.trim() === '') continue;

                // A named parameter is "name: value". Reject positional / unnamed.
                const colonIdx = part.indexOf(':');
                if (colonIdx === -1) {
                    throw new Error(
                        `Invalid parameter: "${part}". All parameters must be named (e.g., key: value).\n\nUsage:\n${buildUsage(funcName, spec)}`
                    );
                }
                const key = part.substring(0, colonIdx).trim();
                const value = part.substring(colonIdx + 1).trim();
                if (!key) {
                    throw new Error(
                        `Empty parameter name in "${part}".\n\nExpected: key: value`
                    );
                }
                if (!value) {
                    throw new Error(
                        `Missing value for parameter "${key}".\n\nExpected: ${key}: ${spec[key]?.type ?? 'value'}`
                    );
                }

                // W12: case-insensitive param name lookup. Resolve user's typed key
                // to the spec's canonical-cased key so downstream code stores under it.
                let specKey: string | undefined = spec[key] ? key : undefined;
                if (!specKey) {
                    specKey = Object.keys(spec).find(k => k.toLowerCase() === key.toLowerCase());
                }
                const paramSpec = specKey ? spec[specKey] : undefined;
                if (!paramSpec) {
                    const knownParams = Object.keys(spec).filter(k => !spec[k].aliasFor && !spec[k].deprecated);
                    const suggestion = closestMatch(key, knownParams);
                    const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
                    throw new Error(
                        `Unknown parameter "${key}".\nAvailable parameters for ${funcName}: ${knownParams.join(', ')}.${didYouMean}`
                    );
                }
                // Resolve alias → canonical, emit one-shot deprecation warning if alias is marked deprecated.
                let canonicalKey: string = specKey!;
                let canonicalSpec = paramSpec;
                if (paramSpec.aliasFor) {
                    canonicalKey = paramSpec.aliasFor;
                    canonicalSpec = spec[canonicalKey] ?? paramSpec;
                    if (paramSpec.deprecated) {
                        warnDeprecated(funcName, specKey!, canonicalKey);
                    }
                }
                try {
                    const parsed = parseValue(value, canonicalSpec.type, data, canonicalKey);

                    // Enforce options for string-typed params
                    if (canonicalSpec.options && canonicalSpec.type === 'string' && typeof parsed === 'string') {
                        if (!canonicalSpec.options.includes(parsed)) {
                            const suggestion = closestMatch(parsed, canonicalSpec.options);
                            const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
                            throw new Error(
                                `Invalid value "${parsed}" for "${canonicalKey}". Allowed: ${canonicalSpec.options.map(o => `"${o}"`).join(', ')}.${didYouMean}`
                            );
                        }
                    }

                    result[canonicalKey as keyof TConfig] = parsed;
                } catch (e: any) {
                    throw new Error(
                        `Parameter "${canonicalKey}": ${e.message}\n\n${canonicalSpec.description}`
                    );
                }
            }
        }

        // Required-param check (skip alias entries — they redirect to canonical).
        for (const key in spec) {
            if (spec[key].aliasFor) continue;
            if (result[key as keyof TConfig] === undefined) {
                if (spec[key].required) {
                    throw new Error(
                        `Missing required parameter "${key}".\n\nUsage:\n${buildUsage(funcName, spec)}`
                    );
                }
                if (spec[key].defaultValue !== undefined) {
                    result[key as keyof TConfig] = spec[key].defaultValue;
                }
            }
        }

        return result as TConfig;
    };
};
