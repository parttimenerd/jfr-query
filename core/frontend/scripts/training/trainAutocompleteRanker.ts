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
}

export type Weights = Record<keyof RankerFeatures, number>;

const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'JOIN', 'ON',
    'WITH', 'AS', 'LIMIT', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'CASE', 'WHEN',
    'THEN', 'ELSE', 'END', 'NULL', 'IS', 'LIKE', 'BETWEEN',
]);

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
    const isCol = !isKw && !isFn && /^[a-z_][a-zA-Z0-9_]*$/.test(candidate);
    let scenarioBoost = 0;
    if (scenario === 'where' && isCol) scenarioBoost = 1;
    else if (scenario === 'select' && isCol) scenarioBoost = 1;
    else if (scenario === 'function-arg' && isCol) scenarioBoost = 0.5;
    else if (scenario === 'join' && isCol) scenarioBoost = 0.8;
    else if (scenario === 'cte' && isKw) scenarioBoost = 0.4;
    else if (scenario === 'dollar' && candidate.startsWith('$')) scenarioBoost = 1;
    return {
        prefixMatch: word && cand.startsWith(word) ? 1 : 0,
        substringMatch: word && cand.includes(word) ? 1 : 0,
        scenarioBoost,
        lengthPenalty: 1 / (1 + candidate.length / 20),
        isKeyword: isKw ? 1 : 0,
        isColumn: isCol ? 1 : 0,
        isFunction: isFn ? 1 : 0,
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
        w.isFunction * features.isFunction
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
];

function gridSearch(examples: AutocompleteExample[]): { weights: Weights; mrr: number } {
    let w: Weights = {
        prefixMatch: 1, substringMatch: 0.5, scenarioBoost: 1,
        lengthPenalty: 0.1, isKeyword: 0.2, isColumn: 0.3, isFunction: 0.1,
    };
    let best = mrr(examples, w);
    const candidates = [0, 0.1, 0.25, 0.5, 1, 1.5, 2, 3];
    let improved = true;
    let iter = 0;
    while (improved && iter < 5) {
        improved = false;
        iter++;
        for (const k of KEYS) {
            const old = w[k];
            for (const v of candidates) {
                w[k] = v;
                const s = mrr(examples, w);
                if (s > best + 1e-6) {
                    best = s;
                    improved = true;
                } else {
                    w[k] = old;
                }
            }
        }
    }
    return { weights: w, mrr: best };
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
        JSON.stringify({ version: 1, mrr: m, trainedAt: new Date().toISOString(), weights }, null, 2),
    );
    console.log(`Trained MRR=${m.toFixed(4)}; wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
