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
    // V4 features
    isViewName: number;        // 1 if candidate is a known builtin SQL view name (hyphenated)
    plotClause: number;        // 1 if candidate is a known plot DSL clause keyword
}

export type Weights = Record<keyof RankerFeatures, number>;

const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'JOIN', 'ON',
    'WITH', 'AS', 'LIMIT', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'CASE', 'WHEN',
    'THEN', 'ELSE', 'END', 'NULL', 'IS', 'LIKE', 'BETWEEN',
]);
const KEYWORDS_LC = new Set([...KEYWORDS].map(k => k.toLowerCase()));

// JFR domain: column name patterns that match known JFR columns.
// Using regex over a pattern set is cheaper than a full Set<string> of 200+ names.
const JFR_COLUMN_RE = /^(?:gc|heap|pause|alloc|tlab|cpu|thread|method|stack|frame|class|object|duration|start|end|cause|collector|young|old|survivor|tenured|eden|region|event|sample|retained|live|type|name|state|load|jvm|machine|commit|reserve|used|free|bytes|count|rate|size|ms|mb|kb|p\d+|avg|max|min|sum)/i;

// JFR table/view names
const JFR_TABLE_RE = /^(?:GarbageCollection|GcHeap|GcPhase|ObjectAllocation|CpuLoad|ThreadCpu|JfrEvent|ActiveRecording|gc_pauses|gc_heap|gc_phases|heap_usage|cpu_load|cpu_hot|thread_states|lock_contention|object_alloc)/i;

// Known builtin view names (hyphenated SQL view names from builtinSql.ts)
const VIEW_NAMES = new Set([
    'gc', 'gc-pauses', 'gc-pause-distribution', 'gc-pause-phases', 'gc-phase-breakdown',
    'gc-phase-stats', 'gc-young-vs-old', 'gc-young-old-time', 'gc-pause-cause-over-time',
    'gc-pause-over-time', 'gc-top-pauses', 'gc-time-split', 'gc-throughput', 'gc-overhead',
    'gc-allocation-trigger', 'gc-consecutive-full', 'gc-efficiency', 'gc-concurrent-phases',
    'gc-concurrent-phases-detail', 'gc-configuration', 'gc-memory-size', 'gc-object-stats',
    'gc-parallel-phases', 'gc-promotion-rate', 'gc-references', 'gc-safepoint-distribution',
    'gc-safepoint-summary', 'gc-eden-size', 'gc-old-gen-growth', 'gc-cpu-time',
    'gc-allocation-by-class', 'gc-thread-allocation', 'gc-duration-buckets',
    'heap-committed-vs-used', 'heap-summary-over-time', 'metaspace-over-time',
    'g1-heap-regions', 'tenuring-distribution', 'tlab-efficiency', 'tlabs', 'finalizers',
    'thread-cpu', 'thread-start', 'thread-states', 'thread-contention', 'thread-allocation',
    'cpu-hot-methods', 'cpu-flamegraph', 'cpu-flamegraph-wall', 'safepoints',
    'safepoint-overhead', 'vm-operations', 'allocation-by-site',
]);

// Plot DSL clause keywords
const PLOT_CLAUSES = new Set([
    'TITLE', 'ZOOM', 'ZOOM_X', 'WIDTH', 'HEIGHT', 'ON', 'LEGEND', 'PALETTE',
    'LINK_X', 'LINK_Y', 'LINK_XY', 'LINK_SCROLL', 'BRUSH', 'AXIS_X', 'AXIS_Y',
    'DOMAIN', 'LABEL', 'TYPE', 'FORMAT', 'NAME', 'DATASET', 'TOOLTIP', 'DISABLED',
    'MASTER', 'CLAMP', 'LET', 'SORT', 'LIMIT', 'HORIZONTAL',
]);
const PLOT_CLAUSES_LC = new Set([...PLOT_CLAUSES].map(k => k.toLowerCase()));

// Aggregate function names — if context has SUM/AVG/COUNT etc. the cursor is
// likely in a numeric column slot.
const AGG_FN_RE = /\b(?:SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|QUANTILE|VAR_POP|VAR_SAMP|FIRST|LAST|STRING_AGG|LIST|APPROX_COUNT_DISTINCT)\s*\(/i;

// Value-position detection: cursor is after a comparison operator or keyword,
// so we expect a literal/value, not a column name.
const AFTER_EQ_RE = /[=<>!]\s*$|(?:LIKE|IN|BETWEEN|IS)\s*$/i;
const _BARE_IDENT_RE = /^[a-z_][a-zA-Z0-9_]*$/;

// Reusable feature buffer — avoids one heap allocation per candidate in scoreAll.
// Single-threaded JS makes this safe; callers must score immediately after writing.
const _featureBuf: RankerFeatures = {
    prefixMatch: 0, substringMatch: 0, scenarioBoost: 0, lengthPenalty: 0,
    isKeyword: 0, isColumn: 0, isFunction: 0, prefixDepth: 0, jfrHint: 0,
    exactMatch: 0, isTable: 0, aggContext: 0, inValuePos: 0, isViewName: 0, plotClause: 0,
};

export function extractCursorWord(context: string, cursorPos: number): string {
    let i = cursorPos - 1;
    while (i >= 0) {
        const c = context.charCodeAt(i);
        if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36)) break;
        i--;
    }
    return context.slice(i + 1, cursorPos);
}

// Context-level features that are invariant across all candidates for a given
// (context, cursorPos) pair. Pre-compute once and pass to featurizeCandidate.
export interface ContextFeatures {
    word: string;
    inValuePos: boolean;
    aggContext: boolean;
}

// Reusable ContextFeatures buffer for scoreAll path. Callers must not retain the reference.
const _ctxBuf: ContextFeatures = { word: '', inValuePos: false, aggContext: false };

export function extractContextFeatures(context: string, cursorPos: number): ContextFeatures {
    const word = extractCursorWord(context, cursorPos).toLowerCase();
    const contextBefore = context.slice(Math.max(0, cursorPos - 80), cursorPos);
    return {
        word,
        inValuePos: AFTER_EQ_RE.test(contextBefore),
        aggContext: AGG_FN_RE.test(contextBefore),
    };
}

/** Like extractContextFeatures but writes into _ctxBuf — avoids allocation in scoreAll path. */
export function extractContextFeaturesInto(context: string, cursorPos: number): ContextFeatures {
    _ctxBuf.word = extractCursorWord(context, cursorPos).toLowerCase();
    const start = Math.max(0, cursorPos - 80);
    // Test regexes directly on a slice — one allocation vs two (contextBefore + object).
    const slice = context.slice(start, cursorPos);
    _ctxBuf.inValuePos = AFTER_EQ_RE.test(slice);
    _ctxBuf.aggContext = AGG_FN_RE.test(slice);
    return _ctxBuf;
}

export function featurizeCandidate(
    cf: ContextFeatures,
    candidate: string,
    scenario: string,
): RankerFeatures {
    const { word, inValuePos, aggContext } = cf;
    const cand = candidate.toLowerCase();
    const isKw = KEYWORDS_LC.has(cand);
    const isFn = candidate.endsWith('(');
    const isCol = !isKw && !isFn && _BARE_IDENT_RE.test(candidate) &&
        !JFR_TABLE_RE.test(candidate);

    let scenarioBoost = 0;
    if (scenario === 'where' && isCol && !inValuePos) scenarioBoost = 1;
    else if (scenario === 'select' && isCol) scenarioBoost = 1;
    else if (scenario === 'function-arg' && isCol) scenarioBoost = 0.5;
    else if (scenario === 'join' && isCol) scenarioBoost = 0.8;
    else if (scenario === 'cte' && isKw) scenarioBoost = 0.4;
    else if (scenario === 'dollar' && candidate.startsWith('$')) scenarioBoost = 1;
    else if (scenario === 'plot' && PLOT_CLAUSES_LC.has(cand)) scenarioBoost = 1.2;

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
        aggContext: aggContext ? 1 : 0,
        inValuePos: inValuePos ? 1 : 0,
        isViewName: VIEW_NAMES.has(candidate) ? 1 : 0,
        plotClause: PLOT_CLAUSES_LC.has(cand) ? 1 : 0,
    };
}

/** Write features into `_featureBuf` and return it. Call `score()` immediately; do not retain the reference. */
export function featurizeCandidateInto(
    cf: ContextFeatures,
    candidate: string,
    scenario: string,
): RankerFeatures {
    const { word, inValuePos, aggContext } = cf;
    const cand = candidate.toLowerCase();
    const isKw = KEYWORDS_LC.has(cand);
    const isFn = candidate.endsWith('(');
    const isCol = !isKw && !isFn && _BARE_IDENT_RE.test(candidate) && !JFR_TABLE_RE.test(candidate);

    let scenarioBoost = 0;
    if (scenario === 'where' && isCol && !inValuePos) scenarioBoost = 1;
    else if (scenario === 'select' && isCol) scenarioBoost = 1;
    else if (scenario === 'function-arg' && isCol) scenarioBoost = 0.5;
    else if (scenario === 'join' && isCol) scenarioBoost = 0.8;
    else if (scenario === 'cte' && isKw) scenarioBoost = 0.4;
    else if (scenario === 'dollar' && candidate.startsWith('$')) scenarioBoost = 1;
    else if (scenario === 'plot' && PLOT_CLAUSES_LC.has(cand)) scenarioBoost = 1.2;

    let matchLen = 0;
    if (word) { let k = 0; while (k < word.length && k < cand.length && word[k] === cand[k]) k++; matchLen = k; }

    _featureBuf.prefixMatch = word && cand.startsWith(word) ? 1 : 0;
    _featureBuf.substringMatch = word && cand.includes(word) ? 1 : 0;
    _featureBuf.scenarioBoost = scenarioBoost;
    _featureBuf.lengthPenalty = 1 / (1 + candidate.length / 20);
    _featureBuf.isKeyword = isKw ? 1 : 0;
    _featureBuf.isColumn = isCol ? 1 : 0;
    _featureBuf.isFunction = isFn ? 1 : 0;
    _featureBuf.prefixDepth = Math.min(matchLen / 4, 1);
    _featureBuf.jfrHint = JFR_COLUMN_RE.test(candidate) ? 1 : 0;
    _featureBuf.exactMatch = word && word === cand ? 1 : 0;
    _featureBuf.isTable = JFR_TABLE_RE.test(candidate) ? 1 : 0;
    _featureBuf.aggContext = aggContext ? 1 : 0;
    _featureBuf.inValuePos = inValuePos ? 1 : 0;
    _featureBuf.isViewName = VIEW_NAMES.has(candidate) ? 1 : 0;
    _featureBuf.plotClause = PLOT_CLAUSES_LC.has(cand) ? 1 : 0;
    return _featureBuf;
}

export function featurize(
    context: string,
    cursorPos: number,
    candidate: string,
    scenario: string,
): RankerFeatures {
    return featurizeCandidate(extractContextFeatures(context, cursorPos), candidate, scenario);
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
        (w.inValuePos ?? 0) * features.inValuePos +
        (w.isViewName ?? 0) * features.isViewName +
        (w.plotClause ?? 0) * features.plotClause
    );
}
