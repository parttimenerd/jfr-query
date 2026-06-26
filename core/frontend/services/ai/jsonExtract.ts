// Robust JSON / text extraction for LLM responses.
//
// Local 9B-class and smaller models routinely violate "respond with only JSON":
//   - They wrap the answer in ```json fences.
//   - They prepend chain-of-thought (Qwen3, DeepSeek-R1) in <think>…</think>
//     blocks before the actual reply.
//   - They prepend prose preambles ("Sure! Here's the JSON: …").
//   - They append trailing prose after the JSON.
//   - They emit single-quoted JSON, trailing commas, or JS-style comments.
//   - They render smart quotes when markdown rendering is in the loop.
//
// This module recovers the JSON body (extractJson) or plain text (extractText)
// through escalating passes. Both functions are pure and side-effect-free.

/** Strip reasoning blocks emitted by chain-of-thought models. Public so other
 *  callers (plot-config extractor, agent-response cleaner) can share it.
 *  Handles `<think>…</think>`, `<thinking>…</thinking>`, and `<|reasoning|>…<|/reasoning|>`. */
export function stripReasoningBlocks(s: string): string {
    if (!s) return '';
    let out = s;
    out = out.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    out = out.replace(/<\|reasoning\|>[\s\S]*?<\|\/reasoning\|>/gi, '');
    // Unclosed <think> at the end — strip from the tag to EOL/EOF.
    out = out.replace(/<think(?:ing)?>[\s\S]*$/i, '');
    return out;
}

/** Normalise typographic quotes the markdown renderer sometimes injects. */
function normalizeSmartQuotes(s: string): string {
    return s
        .replace(/[‘’‚‛]/g, "'")  // ‘ ’ ‚ ‛ → '
        .replace(/[“”„‟]/g, '"'); // “ ” „ ‟ → "
}

/** Remove JS-style // line comments and /* block * / comments that some local
 *  models add inside JSON. Skip when inside a string literal. */
function stripJsonComments(s: string): string {
    let out = '';
    let i = 0;
    let inStr: string | null = null;
    let escape = false;
    while (i < s.length) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (escape) { escape = false; i++; continue; }
            if (ch === '\\') { escape = true; i++; continue; }
            if (ch === inStr) inStr = null;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; out += ch; i++; continue; }
        if (ch === '/' && s[i + 1] === '/') {
            // Skip to end of line.
            i += 2;
            while (i < s.length && s[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && s[i + 1] === '*') {
            i += 2;
            while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

/** Strip trailing commas before `}` or `]`. Aware of string literals. */
function stripTrailingCommas(s: string): string {
    let out = '';
    let inStr: string | null = null;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; out += ch; continue; }
        if (ch === ',') {
            // Lookahead: any whitespace, then `}` or `]`?
            let j = i + 1;
            while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '}' || s[j] === ']') continue; // drop the comma
        }
        out += ch;
    }
    return out;
}

/** Convert single-quoted JSON to double-quoted. Naïve but effective on small-
 *  model output; bails out if the result still won't parse. */
function singleToDoubleQuotes(s: string): string {
    // Only safe to do this if the input has no double quotes at all (otherwise
    // we risk corrupting valid JSON containing apostrophes inside strings).
    if (s.includes('"')) return s;
    return s.replace(/'/g, '"');
}

function tryParseRelaxed<T>(candidate: string): T | null {
    try {
        return JSON.parse(candidate) as T;
    } catch { /* fall through */ }
    // Strip JS comments + trailing commas, retry.
    try {
        const relaxed = stripTrailingCommas(stripJsonComments(candidate));
        return JSON.parse(relaxed) as T;
    } catch { /* fall through */ }
    // Single → double quotes, retry.
    try {
        const dq = singleToDoubleQuotes(candidate);
        if (dq !== candidate) return JSON.parse(dq) as T;
    } catch { /* fall through */ }
    return null;
}

export function extractJson<T = unknown>(raw: string): T {
    if (!raw) throw new Error('Empty response from LLM.');

    // Pre-process: strip reasoning blocks and normalise smart quotes.
    const cleaned = normalizeSmartQuotes(stripReasoningBlocks(raw));

    // Pass 1: direct parse on cleaned input.
    const direct = tryParseRelaxed<T>(cleaned);
    if (direct !== null) return direct;

    // Pass 2: strip ```json / ```jsonc / ``` fences.
    const fenceMatch = cleaned.match(/```(?:json5?|jsonc)?\s*\n?([\s\S]*?)\n?```/i);
    if (fenceMatch) {
        const inner = fenceMatch[1].trim();
        const parsed = tryParseRelaxed<T>(inner);
        if (parsed !== null) return parsed;
    }

    // Pass 3: locate balanced { … } or [ … ] respecting strings.
    const sliced = sliceBalanced(cleaned);
    if (sliced) {
        const parsed = tryParseRelaxed<T>(sliced);
        if (parsed !== null) return parsed;
    }

    throw new Error(
        `Could not parse LLM response as JSON.\n` +
        `First 200 chars: ${raw.slice(0, 200).replace(/\n/g, ' ')}…`
    );
}

/** Plain-text extraction:
 *   1. Strip chain-of-thought reasoning blocks.
 *   2. Unwrap a single ``` fenced block if present.
 *   3. Drop leading prose like "Sure, here's the answer: …" before a colon
 *      on the same line, only when nothing recognisable follows otherwise.
 *   4. Trim whitespace and stray special tokens.
 */
export function extractText(raw: string): string {
    if (!raw) return '';
    const stripped = stripReasoningBlocks(raw);
    const fenceMatch = stripped.match(/```[\w-]*\s*\n?([\s\S]*?)\n?```/);
    let out = fenceMatch ? fenceMatch[1] : stripped;
    // Strip common HF special tokens that small models occasionally emit.
    out = out.replace(/<\|?(?:endoftext|im_start|im_end|s|pad|eot_id|begin_of_text|end_of_text)\|?>/gi, '');
    out = out.replace(/<\/?s>/gi, '');
    return out.trim();
}

function sliceBalanced(s: string): string | null {
    // Find the first { or [ that begins a balanced span.
    for (let start = 0; start < s.length; start++) {
        const ch = s[start];
        if (ch !== '{' && ch !== '[') continue;
        const end = findMatch(s, start);
        if (end !== -1) return s.slice(start, end + 1);
    }
    return null;
}

function findMatch(s: string, start: number): number {
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === open) depth++;
        else if (c === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}
