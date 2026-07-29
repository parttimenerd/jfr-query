// Train a feature-engineered linear ranker over autocomplete examples.
// We avoid heavyweight deps: each (context, candidate) pair is summarised
// by a fixed feature vector; weights are learned by coordinate-descent grid
// search maximising mean reciprocal rank of the expectedTopK[0] candidate.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AutocompleteExample } from './generateAutocompleteData';

const IN = resolve(process.cwd(), 'data/autocomplete-train.jsonl');
const OUT = resolve(
    process.cwd(),
    'core/frontend/services/ml/autocompleteRanker.json',
);

export interface RankerFeatures {
    prefixMatch: number;       // 1 if candidate starts with the cursor word
    substringMatch: number;    // 1 if cursor word is a substring of candidate
    scenarioBoost: number;     // scenario-specific boost
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

    let scenarioBoost = 0;
    if (scenario === 'where' && isCol) scenarioBoost = 1;
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

    // Context before cursor (up to 80 chars) for aggregate/context detection.
    const contextBefore = context.slice(Math.max(0, cursorPos - 80), cursorPos);

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
        (w.aggContext ?? 0) * features.aggContext
    );
}

function mrr(examples: AutocompleteExample[], w: Weights): number {
    let total = 0;
    let n = 0;
    for (const ex of examples) {
        if (ex.expectedTopK.length < 2) continue;
        const gold = ex.expectedTopK[0]!;
        const scored = ex.expectedTopK
            .map((c) => ({
                c,
                s: score(featurize(ex.context, ex.cursorPos, c, ex.scenario), w),
            }))
            .sort((a, b) => b.s - a.s);
        const rank = scored.findIndex((x) => x.c === gold);
        if (rank >= 0) total += 1 / (rank + 1);
        n++;
    }
    return n === 0 ? 0 : total / n;
}

const KEYS: (keyof Weights)[] = [
    'prefixMatch', 'substringMatch', 'scenarioBoost', 'lengthPenalty',
    'isKeyword', 'isColumn', 'isFunction',
    'prefixDepth', 'jfrHint', 'exactMatch', 'isTable', 'aggContext',
];

function gridSearch(examples: AutocompleteExample[]): { weights: Weights; mrr: number } {
    let w: Weights = {
        prefixMatch: 1, substringMatch: 0.5, scenarioBoost: 1,
        lengthPenalty: 0.1, isKeyword: 0.2, isColumn: 0.3, isFunction: 0.1,
        prefixDepth: 0.5, jfrHint: 0.3, exactMatch: 1.5, isTable: 0.2, aggContext: 0.2,
    };
    let best = mrr(examples, w);
    let bestWeights: Weights = { ...w };
    const candidates = [0, 0.1, 0.25, 0.5, 1, 1.5, 2, 3];
    let improved = true;
    let iter = 0;
    while (improved && iter < 8) {
        improved = false;
        iter++;
        for (const k of KEYS) {
            const old = w[k];
            for (const v of candidates) {
                w[k] = v;
                const s = mrr(examples, w);
                if (s > best + 1e-6) {
                    best = s;
                    bestWeights = { ...w };
                    improved = true;
                } else {
                    w[k] = old;
                }
            }
        }
    }
    return { weights: bestWeights, mrr: best };
}

function loadExamples(): AutocompleteExample[] {
    if (!existsSync(IN)) throw new Error(`Missing ${IN}; run generateAutocompleteData first`);
    return readFileSync(IN, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AutocompleteExample);
}

function main(): void {
    const examples = loadExamples();
    console.log(`Loaded ${examples.length} examples`);
    const { weights, mrr: m } = gridSearch(examples);
    writeFileSync(
        OUT,
        JSON.stringify({ version: 2, mrr: m, trainedAt: new Date().toISOString(), weights }, null, 2),
    );
    console.log(`Trained MRR=${m.toFixed(4)}; wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
