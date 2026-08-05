// Train a feature-engineered linear ranker over autocomplete examples.
// We avoid heavyweight deps: each (context, candidate) pair is summarised
// by a fixed feature vector; weights are learned by coordinate-descent grid
// search maximising mean reciprocal rank of the expectedTopK[0] candidate.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AutocompleteExample } from './generateAutocompleteData';
import { featurize, score } from './rankerCore';
import type { Weights } from './rankerCore';

export type { RankerFeatures, Weights } from './rankerCore';
export { featurize, score, extractCursorWord } from './rankerCore';

const IN = resolve(process.cwd(), 'data/autocomplete-train.jsonl');
const OUT = resolve(
    process.cwd(),
    'core/frontend/services/ml/autocompleteRanker.json',
);

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
    'prefixDepth', 'jfrHint', 'exactMatch', 'isTable', 'aggContext', 'inValuePos',
    'isViewName', 'plotClause',
];

function gridSearch(examples: AutocompleteExample[]): { weights: Weights; mrr: number } {
    let w: Weights = {
        prefixMatch: 1, substringMatch: 0.5, scenarioBoost: 1,
        lengthPenalty: 0.1, isKeyword: 0.2, isColumn: 0.3, isFunction: 0.1,
        prefixDepth: 0.5, jfrHint: 0.3, exactMatch: 1.5, isTable: 0.2, aggContext: 0.2,
        inValuePos: 0, isViewName: 0.3, plotClause: 0.3,
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
        JSON.stringify({ version: 4, mrr: m, trainedAt: new Date().toISOString(), weights }, null, 2),
    );
    console.log(`Trained MRR=${m.toFixed(4)}; wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
