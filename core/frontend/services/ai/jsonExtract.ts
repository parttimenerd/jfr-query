// Robust JSON extraction for LLM responses.
//
// Local 9B-class models often violate "respond with only JSON" — they wrap the
// answer in ```json fences, prepend chain-of-thought, or append a short
// explanation. This helper recovers the JSON body in a few escalating passes:
//
//   1. Direct parse (works for well-behaved cloud models).
//   2. Strip ```json / ``` fences.
//   3. Slice from the first `{` to the matching `}` (or `[` … `]`), respecting
//      string literals and escape sequences. This handles a "preamble {…} tail"
//      response without being fooled by braces inside strings.
//
// Throws an Error when no JSON object can be located.

export function extractJson<T = unknown>(raw: string): T {
    if (!raw) throw new Error('Empty response from LLM.');

    // Pass 1: direct parse
    try {
        return JSON.parse(raw) as T;
    } catch { /* fall through */ }

    // Pass 2: strip ```json / ```jsonc / ``` fences
    const fenceMatch = raw.match(/```(?:json5?|jsonc)?\s*\n?([\s\S]*?)\n?```/i);
    if (fenceMatch) {
        const inner = fenceMatch[1].trim();
        try {
            return JSON.parse(inner) as T;
        } catch { /* fall through */ }
    }

    // Pass 3: locate balanced { … } or [ … ] respecting strings
    const sliced = sliceBalanced(raw);
    if (sliced) {
        try {
            return JSON.parse(sliced) as T;
        } catch { /* fall through */ }
    }

    throw new Error(
        `Could not parse LLM response as JSON.\n` +
        `First 200 chars: ${raw.slice(0, 200).replace(/\n/g, ' ')}…`
    );
}

/** Plain-text extraction: strip code fences if the response is wrapped in one. */
export function extractText(raw: string): string {
    if (!raw) return '';
    const fenceMatch = raw.match(/```[\w-]*\s*\n?([\s\S]*?)\n?```/);
    return fenceMatch ? fenceMatch[1].trim() : raw.trim();
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
