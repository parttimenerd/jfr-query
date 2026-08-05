import { grammar as ohmGrammar, type Semantics, type NonterminalNode } from 'ohm-js';
import { type ParserSpec } from './plotUtils';
import { warnDeprecated } from '../components/plots/deprecation';

// ---------------------------------------------------------------------------
// Ohm.js grammar — loaded once, lazily
// ---------------------------------------------------------------------------

let _grammarSrc: string | null = null;

async function _loadGrammarSrc(): Promise<string> {
    if (_grammarSrc !== null) return _grammarSrc;
    try {
        const mod = await import('./plotInnerGrammar.ohm?raw');
        _grammarSrc = mod.default as string;
    } catch {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, join } = await import('path');
        const dir = dirname(fileURLToPath(import.meta.url));
        _grammarSrc = readFileSync(join(dir, 'plotInnerGrammar.ohm'), 'utf8');
    }
    return _grammarSrc!;
}

let _g: ReturnType<typeof ohmGrammar> | null = null;
let _s: Semantics | null = null;

// Build semantics once the grammar source is available.
function _buildSemantics(g: ReturnType<typeof ohmGrammar>): Semantics {
    const s = g.createSemantics();

    function extractStr(node: any): string {
        // node is dqString or sqString: [open, chars*, close]
        // Each char is either _esc (backslash + any) or _plain (any).
        return node.children[1].children.map((c: any) => {
            const src = c.sourceString as string;
            // Escape sequence: the literal char after backslash.
            if (src.startsWith('\\')) return src[1] ?? '';
            return src;
        }).join('');
    }

    // toValue(): returns the parsed JS value for any Value node.
    s.addOperation<any>('toValue()', {
        Value(alt) { return (alt as any).toValue(); },

        Array(_open, _sp1, items, _sp2, _close) {
            return (items as any).toItemList();
        },
        ArrayItem(_sp1, val, _sp2) { return (val as any).toValue(); },

        Object(_open, _sp1, list, _sp2, _close) {
            const obj: Record<string, any> = {};
            for (const pair of (list as any).asIteration().children) {
                const [k, v] = (pair as any).toKV();
                obj[k] = v;
            }
            return obj;
        },
        ObjPair(_sp1, _k, _sp2, _colon, _sp3, val, _sp4) {
            return (val as any).toValue(); // key handled via toKV
        },

        dqString(_open, _chars, _close) { return extractStr(this); },
        sqString(_open, _chars, _close) { return extractStr(this); },

        boolTrue(_tok) { return true; },
        boolFalse(_tok) { return false; },

        number_float(_minus, _int, _dot, _frac, _exp) {
            return parseFloat((this as any).sourceString);
        },
        number_leadDot(_minus, _dot, _frac, _exp) {
            return parseFloat((this as any).sourceString);
        },
        number_int(_minus, _int, _exp) {
            return parseFloat((this as any).sourceString);
        },

        bareWord(_chars) { return (this as any).sourceString.trim(); },
    });

    // toKV(): returns [key, value] for ObjPair or Arg.
    s.addOperation<[string, any]>('toKV()', {
        ObjPair(_sp1, k, _sp2, _colon, _sp3, val, _sp4) {
            return [(k as any).sourceString.trim(), (val as any).toValue()];
        },
        Arg(_sp1, k, _sp2, _colon, _sp3, val, _sp4) {
            return [(k as any).sourceString.trim(), (val as any).toValue()];
        },
    });

    // toArgs(): { name, params }
    s.addOperation<{ name: string; params: Record<string, any> }>('toArgs()', {
        Call(name, _open, _sp1, argList, _sp2, _close, _sp3, _end) {
            const params: Record<string, any> = {};
            for (const arg of (argList as any).toArgList()) {
                const [k, v] = (arg as any).toKV();
                params[k] = v;
            }
            return { name: (name as any).sourceString.trim(), params };
        },
    });

    // toArgList(): returns an array of Arg nodes.
    s.addOperation<any[]>('toArgList()', {
        ArgList(alt) { return (alt as any).toArgList(); },
        NonemptyArgList(first, _commas, rest, _trailingComma) {
            return [first, ...(rest as any).children];
        },
        EmptyArgList() { return []; },
    });

    // toItemList(): returns an array of values from an Array node's items.
    s.addOperation<any[]>('toItemList()', {
        ArrayItems_nonempty(first, _commas, rest, _trailing) {
            return [first, ...(rest as any).children].map((n: any) => n.toValue());
        },
        ArrayItems_empty() { return []; },
    });

    return s;
}

// Initialise grammar synchronously when grammar source is already cached.
function _ensureGrammarSync(): boolean {
    if (_g && _s) return true;
    if (_grammarSrc === null) return false;
    _g = ohmGrammar(_grammarSrc);
    _s = _buildSemantics(_g);
    return true;
}

// Pre-load asynchronously so the first parse call is sync.
_loadGrammarSrc().then(src => {
    _grammarSrc = src;
    _ensureGrammarSync();
}).catch(() => { /* will retry on first parse call */ });

// ---------------------------------------------------------------------------
// Levenshtein / "did you mean" — unchanged from original
// ---------------------------------------------------------------------------

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

function closestMatch(input: string, candidates: string[]): string | null {
    if (candidates.length === 0) return null;
    const lower = input.toLowerCase();
    let best: string | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
        const d = editDistance(lower, c.toLowerCase());
        if (d < bestScore) { bestScore = d; best = c; }
    }
    const threshold = Math.min(3, Math.max(2, Math.floor(input.length * 0.5)));
    return best && bestScore <= threshold ? best : null;
}

// ---------------------------------------------------------------------------
// Column validation (unchanged from original)
// ---------------------------------------------------------------------------

function validateColumn(colName: string, data: any[], paramName: string): string {
    if (data.length > 0 && data[0]) {
        const allColumns = Object.keys(data[0]);
        const lc = colName.toLowerCase();
        const directMatch = allColumns.some(c => c.toLowerCase() === lc);
        const escapedColName = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefixedMatch = allColumns.some(c => c.match(new RegExp(`^\\d+_${escapedColName}$`, 'i')));
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

// Validate/coerce a parsed value against the spec type.
function coerceValue(rawVal: any, expectedType: string, data: any[], paramName: string): any {
    if (expectedType.endsWith('[]')) {
        const itemType = expectedType.slice(0, -2);
        // Auto-wrap bare scalars into single-element arrays.
        if (!Array.isArray(rawVal)) {
            return [coerceValue(rawVal, itemType, data, paramName)];
        }
        return rawVal.map(item => coerceValue(item, itemType, data, paramName));
    }

    if (expectedType === 'column') {
        const colName = typeof rawVal === 'string' ? rawVal : String(rawVal);
        return validateColumn(colName, data, paramName);
    }

    // referenceLine / object — pass through as-is (already parsed by grammar)
    if (typeof rawVal === 'object' && rawVal !== null && !Array.isArray(rawVal)) {
        return rawVal;
    }

    return rawVal;
}

// ---------------------------------------------------------------------------
// Usage string generator (unchanged from original)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const createConfigParser = <TConfig extends object>(spec: ParserSpec) => {
    return (configStr: string, data: any[]): TConfig => {
        // Strip # comments (outside strings) — keep for backward compat.
        configStr = _stripComments(configStr.trim());

        if (!configStr) {
            const funcName = 'FUNCTION';
            throw new Error(`Plot configuration is empty.\n\nUsage:\n${buildUsage(funcName, spec)}`);
        }

        // Derive function name for error messages.
        const funcNameMatch = configStr.match(/^(\w+)/);
        const funcName = funcNameMatch ? funcNameMatch[1].toUpperCase() : 'FUNCTION';

        // Ensure grammar is loaded (should always be true after module init).
        if (!_ensureGrammarSync()) {
            // Grammar not yet loaded — fall back to legacy parser.
            return _legacyParse<TConfig>(configStr, spec, data, funcName);
        }

        const matchResult = _g!.match(configStr);
        if (matchResult.failed()) {
            // Provide friendly error messages for the common structural mistakes.
            if (!configStr.includes('(')) {
                throw new Error(
                    `Missing "(" in plot call. A plot config looks like ${funcName}(...)\n\nGot: ${configStr}`
                );
            }
            if (!configStr.trimEnd().endsWith(')')) {
                throw new Error(
                    `Missing closing ")" in plot call.\n\nGot: ${configStr}`
                );
            }
            // Detect positional (unnamed) argument: value without a preceding "key:".
            // A positional arg has no colon before the first comma or closing paren.
            const innerMatch = configStr.match(/^\w+\s*\(([\s\S]*)\)\s*$/);
            if (innerMatch) {
                const inner = innerMatch[1].trim();
                // If the inner content has a token that doesn't look like "key: ..."
                // it's a positional argument.
                if (inner && !/^\s*([\w_][\w_-]*)\s*:/.test(inner)) {
                    throw new Error(
                        `Invalid parameter: "${inner}". All parameters must be named (e.g., key: value).`
                    );
                }
                // Empty value after colon: "key:" with nothing following.
                const emptyValMatch = inner.match(/([\w_][\w_-]*)\s*:\s*(?:,|$)/);
                if (emptyValMatch) {
                    throw new Error(`Missing value for parameter "${emptyValMatch[1]}".`);
                }
                // Empty key: starts with colon.
                if (/^\s*:/.test(inner)) {
                    throw new Error(`Empty parameter name in "${inner}". Expected: key: value`);
                }
            }
            throw new Error(
                `Invalid plot configuration syntax.\n${matchResult.message ?? ''}\n\nGot: ${configStr}`
            );
        }

        const { params } = _s!(matchResult).toArgs();
        return _applyParams<TConfig>(params, spec, data, funcName);
    };
};

// ---------------------------------------------------------------------------
// Internal: apply a key→value map against the spec (shared by Ohm + legacy paths)
// ---------------------------------------------------------------------------

function _applyParams<TConfig extends object>(
    params: Record<string, any>,
    spec: ParserSpec,
    data: any[],
    funcName: string,
): TConfig {
    const result: Partial<TConfig> = {};

    for (const [rawKey, rawVal] of Object.entries(params)) {
        // Case-insensitive key lookup.
        let specKey = spec[rawKey] ? rawKey : undefined;
        if (!specKey) {
            specKey = Object.keys(spec).find(k => k.toLowerCase() === rawKey.toLowerCase());
        }
        const paramSpec = specKey ? spec[specKey] : undefined;
        if (!paramSpec) {
            const knownParams = Object.keys(spec).filter(k => !spec[k].aliasFor && !spec[k].deprecated);
            const suggestion = closestMatch(rawKey, knownParams);
            const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
            throw new Error(
                `Unknown parameter "${rawKey}".\nAvailable parameters for ${funcName}: ${knownParams.join(', ')}.${didYouMean}`
            );
        }

        // Resolve alias → canonical.
        let canonicalKey = specKey!;
        let canonicalSpec = paramSpec;
        if (paramSpec.aliasFor) {
            canonicalKey = paramSpec.aliasFor;
            canonicalSpec = spec[canonicalKey] ?? paramSpec;
            if (paramSpec.deprecated) {
                warnDeprecated(funcName, specKey!, canonicalKey);
            }
        }

        try {
            const coerced = coerceValue(rawVal, canonicalSpec.type, data, canonicalKey);

            // Enforce options for string-typed params.
            if (canonicalSpec.options && canonicalSpec.type === 'string' && typeof coerced === 'string') {
                if (!canonicalSpec.options.includes(coerced)) {
                    const suggestion = closestMatch(coerced, canonicalSpec.options);
                    const didYouMean = suggestion ? `\nDid you mean "${suggestion}"?` : '';
                    throw new Error(
                        `Invalid value "${coerced}" for "${canonicalKey}". Allowed: ${canonicalSpec.options.map(o => `"${o}"`).join(', ')}.${didYouMean}`
                    );
                }
            }

            result[canonicalKey as keyof TConfig] = coerced;
        } catch (e: any) {
            throw new Error(`Parameter "${canonicalKey}": ${e.message}\n\n${canonicalSpec.description}`);
        }
    }

    // Apply defaults and check required params.
    for (const key in spec) {
        if (spec[key].aliasFor) continue;
        if (result[key as keyof TConfig] === undefined) {
            if (spec[key].required) {
                throw new Error(`Missing required parameter "${key}".\n\nUsage:\n${buildUsage(funcName, spec)}`);
            }
            if (spec[key].defaultValue !== undefined) {
                result[key as keyof TConfig] = spec[key].defaultValue;
            }
        }
    }

    return result as TConfig;
}

// ---------------------------------------------------------------------------
// Comment stripper (W12 — preserve # inside strings)
// ---------------------------------------------------------------------------

function _stripComments(s: string): string {
    let out = '';
    let inStr: string | null = null;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; out += ch; continue; }
        if (ch === '#') {
            while (i < s.length && s[i] !== '\n') i++;
            if (i < s.length && s[i] === '\n') out += '\n';
            continue;
        }
        out += ch;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Legacy fallback (used only when grammar hasn't loaded yet at first call)
// ---------------------------------------------------------------------------

function _legacyParse<TConfig extends object>(
    configStr: string,
    spec: ParserSpec,
    data: any[],
    funcName: string,
): TConfig {
    const match = configStr.match(/^\w+\s*\(([\s\S]*)\)\s*$/);
    if (!match) {
        throw new Error(`Invalid function call syntax. Expected ${funcName}(...).\n\nGot: ${configStr}`);
    }
    const paramsStr = match[1].trim();
    const params: Record<string, any> = {};
    if (paramsStr) {
        for (const part of _splitParams(paramsStr)) {
            if (!part.trim()) continue;
            const colonIdx = part.indexOf(':');
            if (colonIdx === -1) continue;
            const key = part.slice(0, colonIdx).trim();
            const value = part.slice(colonIdx + 1).trim();
            params[key] = _parseScalar(value, data);
        }
    }
    return _applyParams<TConfig>(params, spec, data, funcName);
}

function _parseScalar(valueStr: string, data: any[]): any {
    const t = valueStr.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
        return t.slice(1, -1);
    if (t.toLowerCase() === 'true') return true;
    if (t.toLowerCase() === 'false') return false;
    const n = parseFloat(t);
    if (!isNaN(n) && /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return n;
    if (t.startsWith('[') && t.endsWith(']')) {
        const inner = t.slice(1, -1).trim();
        if (!inner) return [];
        return _splitParams(inner).map(item => _parseScalar(item, data));
    }
    if (t.startsWith('{') && t.endsWith('}')) {
        const inner = t.slice(1, -1).trim();
        const obj: Record<string, any> = {};
        for (const pair of _splitParams(inner)) {
            const ci = pair.indexOf(':');
            if (ci === -1) continue;
            obj[pair.slice(0, ci).trim()] = _parseScalar(pair.slice(ci + 1).trim(), data);
        }
        return obj;
    }
    return t;
}

function _splitParams(s: string): string[] {
    const parts: string[] = [];
    let depth = 0, inStr = false, strChar = '', curr = '', escaped = false;
    for (const ch of s) {
        if (inStr) {
            curr += ch;
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === strChar) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strChar = ch; curr += ch; continue; }
        if (ch === '[' || ch === '(' || ch === '{') depth++;
        else if (ch === ']' || ch === ')' || ch === '}') depth--;
        if (ch === ',' && depth === 0) {
            if (curr.trim()) parts.push(curr.trim());
            curr = '';
            continue;
        }
        curr += ch;
    }
    if (curr.trim()) parts.push(curr.trim());
    return parts;
}

// ---------------------------------------------------------------------------
// Re-export helpers used by other modules
// ---------------------------------------------------------------------------
export { closestMatch };
