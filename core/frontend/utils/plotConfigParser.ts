import { ParserSpec } from './plotUtils';

// A simple parser for a function-call-like configuration string.
// It handles strings, numbers, booleans, and arrays of those.
// It does NOT handle nested objects or nested arrays.
const parseValue = (valueStr: string, expectedType: string, data: any[]): any => {
    const trimmed = valueStr.trim();

    if (expectedType.endsWith('[]')) {
        if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
            throw new Error(`Expected an array (e.g., [item1, item2]) but got "${valueStr}"`);
        }
        const inner = trimmed.substring(1, trimmed.length - 1).trim();
        if (inner === '') return [];
        return inner.split(',').map(item => parseValue(item, expectedType.replace('[]', ''), data));
    }
    
    // Column type
    if (expectedType === 'column') {
        const colName = trimmed.replace(/["']/g, '');
        if (data.length > 0 && data[0]) {
            const allColumns = Object.keys(data[0]);
            const directMatch = allColumns.includes(colName);
            // Check for prefixed columns like "1_colName", "2_colName" etc.
            const prefixedMatch = allColumns.some(c => c.match(new RegExp(`^\\d+_${colName}$`)));
            
            if (!directMatch && !prefixedMatch) {
                const available = allColumns.join(', ');
                throw new Error(`Column "${colName}" not found in query results.\nAvailable columns are: ${available}`);
            }
        }
        return colName;
    }

    // String literal
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.substring(1, trimmed.length - 1);
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
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

    // Default to treating it as a string if no other type matches (e.g. for options)
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

export const createConfigParser = <TConfig extends object>(spec: ParserSpec) => {
    return (configStr: string, data: any[]): TConfig => {
        const result: Partial<TConfig> = {};
        
        const funcNameMatch = configStr.match(/^\w+/);
        const funcName = funcNameMatch ? funcNameMatch[0].toUpperCase() : 'FUNCTION';
        const match = configStr.match(/^\w+\s*\((.*)\)\s*$/);
        
        if (!match) {
            throw new Error(`Invalid function call syntax. Expected ${funcName}(...).`);
        }
        
        const paramsStr = match[1].trim();

        if (paramsStr) {
            // This regex splits by comma, but not inside brackets `[]`.
            const paramParts = splitParams(paramsStr);

            for (const part of paramParts) {
                const [key, ...valueParts] = part.split(':');
                if (!key || valueParts.length === 0) {
                    if (part.trim() === '') continue;
                     const signature = Object.entries(spec)
                        .map(([name, p]) => `${name}: ...`)
                        .join(', ');
                    throw new Error(`Invalid parameter format: "${part}". All parameters must be named (e.g., 'key: value').\n\nUsage: ${funcName}(${signature})`);
                }
                const paramKey = key.trim();
                const paramSpec = spec[paramKey];
                if (!paramSpec) {
                    const knownParams = Object.keys(spec);
                    const suggestion = knownParams.find(p => p.toLowerCase().includes(paramKey.toLowerCase())) || '';
                    const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
                    throw new Error(`Unknown parameter "${paramKey}".\nAvailable parameters for ${funcName} are: ${knownParams.join(', ')}.${didYouMean}`);
                }
                try {
                    result[paramKey as keyof TConfig] = parseValue(valueParts.join(':'), paramSpec.type, data);
                } catch (e: any) {
                    throw new Error(`Error in parameter "${paramKey}":\n${e.message}\n\nHint: ${paramSpec.description}`);
                }
            }
        }

        // Check for required params and apply defaults
        for (const key in spec) {
            if (result[key as keyof TConfig] === undefined) {
                if (spec[key].required) {
                    const signature = Object.entries(spec)
                        .map(([name, p]) => `  ${name}: ${p.type}${p.required ? ' -- Required' : ''}`)
                        .join(',\n');
                    throw new Error(`Missing required parameter "${key}".\n\nUsage for ${funcName}:\n${funcName}(\n${signature}\n)`);
                }
                if (spec[key].defaultValue !== undefined) {
                    result[key as keyof TConfig] = spec[key].defaultValue;
                }
            }
        }
        
        return result as TConfig;
    };
};