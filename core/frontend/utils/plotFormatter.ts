// A non-AI, deterministic formatter for the plot configuration language.

const formatParams = (paramsStr: string): string => {
    if (!paramsStr.trim()) return "";

    // Robustly parse parameters, respecting arrays `[]`.
    const params: string[] = [];
    let depth = 0; // for brackets
    let currentParam = "";
    for (const char of paramsStr) {
        if (char === '[') depth++;
        if (char === ']') depth--;
        if (char === ',' && depth === 0) {
            params.push(currentParam.trim());
            currentParam = "";
        } else {
            currentParam += char;
        }
    }
    params.push(currentParam.trim());
    
    if (params.length === 1 && params[0] === '') return "";

    const formattedParams = params.map(p => {
        const parts = p.match(/^\s*(\w+)\s*:\s*([\s\S]+)\s*$/);
        if (!parts) return p; // Return as-is if format is unexpected

        const key = parts[1];
        let value = parts[2].trim();

        // Standardize spacing inside arrays
        if (value.startsWith('[') && value.endsWith(']')) {
            const inner = value.substring(1, value.length - 1);
            const items = inner.split(',').map(item => item.trim()).filter(Boolean);
            value = `[${items.join(', ')}]`;
        }

        return `${key}: ${value}`;
    });

    const singleLineJoined = formattedParams.join(', ');

    // Go multi-line if there are more than two parameters, as per the original AI rules.
    if (formattedParams.length > 2) {
        return `\n  ${formattedParams.join(',\n  ')}\n`;
    } else {
        return singleLineJoined;
    }
};

/**
 * Formats a plot configuration string using deterministic rules.
 * @param code The raw plot configuration code.
 * @returns The formatted code.
 */
export const formatPlotCode = (code: string): string => {
    // This regex is sufficient for our non-nested function call syntax.
    // It finds all occurrences of `function(...)` and preserves text between them.
    const plotCallRegex = /(\w+)\s*\(([^)]*)\)/g;

    let result = code.replace(plotCallRegex, (match, funcName, paramsStr) => {
        const upperFuncName = funcName.trim().toUpperCase();
        const formattedParams = formatParams(paramsStr);
        return `${upperFuncName}(${formattedParams})`;
    });

    // Uppercase known clause keywords that appear outside of function calls.
    result = result.replace(/\b(title|on|width|height|zoom|link_x|master|clamp)\b/g, s => s.toUpperCase());

    return result;
};
