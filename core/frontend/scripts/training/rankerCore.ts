// Browser-safe core: pure featurization and scoring functions shared between
// the browser runtime (AutocompleteRanker.ts) and the Node training script
// (trainAutocompleteRanker.ts). This file MUST NOT import from 'node:fs',
// 'node:path', or any other Node-only module.

export interface RankerFeatures {
    prefixMatch: number;       // 1 if candidate starts with the cursor word
    substringMatch: number;    // 1 if cursor word is a substring of candidate
    scenarioBoost: number;     // scenario-specific boost (where boost suppressed in value position)
    lengthPenalty: number;     // normalized 1/(1+len)
    isKeyword: number;         // 1 if candidate is a known SQL keyword
    isColumn: number;          // 1 if candidate looks like a column (snake/camel)
    isFunction: number;        // 1 if candidate ends with '('
    // V2 features
    prefixDepth: number;       // chars matched / 4, capped at 1 — rewards longer prefix matches
    jfrHint: number;           // 1 if candidate matches a known JFR column pattern
    exactMatch: number;        // 1 if candidate equals the cursor word exactly
    isTable: number;           // 1 if candidate looks like a JFR table/view name
    aggContext: number;        // 1 if context has an aggregate function before cursor
    // V3 features
    inValuePos: number;        // 1 if cursor is after = / LIKE / BETWEEN / IS (value position, not column)
}

export type Weights = Record<keyof RankerFeatures, number>;

const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'JOIN', 'ON',
    'WITH', 'AS', 'LIMIT', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'CASE', 'WHEN',
    'THEN', 'ELSE', 'END', 'NULL', 'IS', 'LIKE', 'BETWEEN',
]);

// JFR domain: column name patterns that match known JFR columns.
// Using regex over a pattern set is cheaper than a full Set<string> of 200+ names.
const JFR_COLUMN_RE = /^(?:gc|heap|pause|alloc|tlab|cpu|thread|method|stack|frame|class|object|duration|start|end|cause|collector|young|old|survivor|tenured|eden|region|event|sample|retained|live|type|name|state|load|jvm|machine|commit|reserve|used|free|bytes|count|rate|size|ms|mb|kb|p\d+|avg|max|min|sum)/i;

// JFR table/view names
const JFR_TABLE_RE = /^(?:GarbageCollection|GcHeap|GcPhase|ObjectAllocation|CpuLoad|ThreadCpu|JfrEvent|ActiveRecording|gc_pauses|gc_heap|gc_phases|heap_usage|cpu_load|cpu_hot|thread_states|lock_contention|object_alloc)/i;

// Aggregate function names — if context has SUM/AVG/COUNT etc. the cursor is
// likely in a numeric column slot.
const AGG_FN_RE = /\b(?:SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|QUANTILE|VAR_POP|VAR_SAMP|FIRST|LAST|STRING_AGG|LIST|APPROX_COUNT_DISTINCT)\s*\(/i;

// Value-position detection: cursor is after a comparison operator or keyword,
// so we expect a literal/value, not a column name.
const AFTER_EQ_RE = /[=<>!]\s*$|(?:LIKE|IN|BETWEEN|IS)\s*$/i;

export function extractCursorWord(context: string, cursorPos: number): string {
    let i = cursorPos - 1;
    while (i >= 0 && /[A-Za-z0-9_$]/.test(context[i]!)) i--;
    return context.slice(i + 1, cursorPos);
}

export function featurize(
    context: string,
    cursorPos: number,
    candidate: string,
    scenario: string,
): RankerFeatures {
    const word = extractCursorWord(context, cursorPos).toLowerCase();
    const cand = candidate.toLowerCase();
    const isKw = KEYWORDS.has(candidate.toUpperCase());
    const isFn = candidate.endsWith('(');
    const isCol = !isKw && !isFn && /^[a-z_][a-zA-Z0-9_]*$/.test(candidate) &&
        !JFR_TABLE_RE.test(candidate);

    // Context before cursor (up to 80 chars) for aggregate/context detection.
    const contextBefore = context.slice(Math.max(0, cursorPos - 80), cursorPos);

    // Value-position: cursor appears after a comparison operator or keyword,
    // meaning the user expects a literal/value, not a column name.
    const inValuePos = AFTER_EQ_RE.test(contextBefore);

    let scenarioBoost = 0;
    if (scenario === 'where' && isCol && !inValuePos) scenarioBoost = 1;
    else if (scenario === 'select' && isCol) scenarioBoost = 1;
    else if (scenario === 'function-arg' && isCol) scenarioBoost = 0.5;
    else if (scenario === 'join' && isCol) scenarioBoost = 0.8;
    else if (scenario === 'cte' && isKw) scenarioBoost = 0.4;
    else if (scenario === 'dollar' && candidate.startsWith('$')) scenarioBoost = 1;

    // Prefix depth: how many chars of the cursor word match the candidate prefix.
    // Normalized to [0,1] by dividing by 4 (≥4 chars = maximum signal).
    const matchLen = word
        ? (() => { let k = 0; while (k < word.length && k < cand.length && word[k] === cand[k]) k++; return k; })()
        : 0;
    const prefixDepth = Math.min(matchLen / 4, 1);

    return {
        prefixMatch: word && cand.startsWith(word) ? 1 : 0,
        substringMatch: word && cand.includes(word) ? 1 : 0,
        scenarioBoost,
        lengthPenalty: 1 / (1 + candidate.length / 20),
        isKeyword: isKw ? 1 : 0,
        isColumn: isCol ? 1 : 0,
        isFunction: isFn ? 1 : 0,
        prefixDepth,
        jfrHint: JFR_COLUMN_RE.test(candidate) ? 1 : 0,
        exactMatch: word && word === cand ? 1 : 0,
        isTable: JFR_TABLE_RE.test(candidate) ? 1 : 0,
        aggContext: AGG_FN_RE.test(contextBefore) ? 1 : 0,
        inValuePos: inValuePos ? 1 : 0,
    };
}

export function score(features: RankerFeatures, w: Weights): number {
    return (
        w.prefixMatch * features.prefixMatch +
        w.substringMatch * features.substringMatch +
        w.scenarioBoost * features.scenarioBoost +
        w.lengthPenalty * features.lengthPenalty +
        w.isKeyword * features.isKeyword +
        w.isColumn * features.isColumn +
        w.isFunction * features.isFunction +
        (w.prefixDepth ?? 0) * features.prefixDepth +
        (w.jfrHint ?? 0) * features.jfrHint +
        (w.exactMatch ?? 0) * features.exactMatch +
        (w.isTable ?? 0) * features.isTable +
        (w.aggContext ?? 0) * features.aggContext +
        (w.inValuePos ?? 0) * features.inValuePos
    );
}
