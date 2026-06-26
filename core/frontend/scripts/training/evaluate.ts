// Evaluation harness for the local ML artifacts.
//
// Usage (from repo root):
//   npx tsx core/frontend/scripts/training/evaluate.ts \
//     [--ranker path/to/ranker.json] \
//     [--data path/to/autocomplete-train.jsonl] \
//     [--label baseline|expanded] \
//     [--mode autocomplete|prompts|both]
//
// Output: prints JSON-friendly metrics block per model.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    featurize,
    score as scoreFeatures,
} from './trainAutocompleteRanker';
import type { Weights } from './trainAutocompleteRanker';

interface AutocompleteExample {
    context: string;
    cursorPos: number;
    expectedTopK: string[];
    scenario: string;
}

interface PromptExample {
    notebookContext: string;
    suggestedPrompt: string;
    category: string;
}

function args(): Record<string, string> {
    const a = process.argv.slice(2);
    const out: Record<string, string> = {};
    for (let i = 0; i < a.length; i++) {
        if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] ?? '';
    }
    return out;
}

function loadJsonl<T>(path: string): T[] {
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as T);
}

function mean(xs: number[]): number {
    return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ============= Autocomplete metrics =============
function dcgAt(rels: number[], k: number): number {
    let s = 0;
    for (let i = 0; i < Math.min(k, rels.length); i++) {
        s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2);
    }
    return s;
}

function ndcgAt(predicted: string[], gold: string[], k: number): number {
    // graded relevance: position in gold => 1 - i/len, top item = 1.0
    const goldRel = new Map<string, number>();
    gold.forEach((g, i) => goldRel.set(g, 1 - i / gold.length));
    const rels = predicted.slice(0, k).map((p) => goldRel.get(p) ?? 0);
    const idealRels = [...goldRel.values()].sort((a, b) => b - a);
    const idcg = dcgAt(idealRels, k);
    if (idcg === 0) return 0;
    return dcgAt(rels, k) / idcg;
}

function rank(predicted: string[], target: string): number {
    return predicted.findIndex((p) => p === target);
}

function evaluateAutocomplete(
    examples: AutocompleteExample[],
    weights: Weights,
): { n: number; mrr: number; top1: number; top3: number; ndcg5: number; perScenario: Record<string, { n: number; mrr: number; top1: number; ndcg5: number }> } {
    const recipranks: number[] = [];
    const top1: number[] = [];
    const top3: number[] = [];
    const ndcg5: number[] = [];
    const perScen: Record<string, { mrr: number[]; top1: number[]; ndcg5: number[] }> = {};

    for (const ex of examples) {
        if (ex.expectedTopK.length < 2) continue;
        const gold = ex.expectedTopK[0];
        const scored = ex.expectedTopK
            .map((c) => ({
                c,
                s: scoreFeatures(featurize(ex.context, ex.cursorPos, c, ex.scenario), weights),
            }))
            .sort((a, b) => b.s - a.s)
            .map((x) => x.c);

        const r = rank(scored, gold);
        const rr = r >= 0 ? 1 / (r + 1) : 0;
        recipranks.push(rr);
        top1.push(r === 0 ? 1 : 0);
        top3.push(r >= 0 && r < 3 ? 1 : 0);
        ndcg5.push(ndcgAt(scored, ex.expectedTopK, 5));

        const k = ex.scenario;
        (perScen[k] ??= { mrr: [], top1: [], ndcg5: [] }).mrr.push(rr);
        perScen[k].top1.push(r === 0 ? 1 : 0);
        perScen[k].ndcg5.push(ndcgAt(scored, ex.expectedTopK, 5));
    }

    const perScenario: Record<string, { n: number; mrr: number; top1: number; ndcg5: number }> = {};
    for (const [k, v] of Object.entries(perScen)) {
        perScenario[k] = {
            n: v.mrr.length,
            mrr: mean(v.mrr),
            top1: mean(v.top1),
            ndcg5: mean(v.ndcg5),
        };
    }

    return {
        n: recipranks.length,
        mrr: mean(recipranks),
        top1: mean(top1),
        top3: mean(top3),
        ndcg5: mean(ndcg5),
        perScenario,
    };
}

// ============= Prompt metrics =============
const DIM = 384;

function cosine(a: Float32Array, b: Float32Array, off = 0): number {
    let s = 0;
    for (let i = 0; i < DIM; i++) s += a[i] * b[off + i];
    return s;
}

function evaluatePrompts(matrix: Float32Array, metaPrompts: Array<{ category: string }>, sample: number): {
    n: number;
    selfRecall1: number; // is the nearest neighbor (excluding self) the same category?
    selfRecall3: number;
    avgTop1Sim: number;
    perCategory: Record<string, { n: number; recall1: number }>;
} {
    const N = metaPrompts.length;
    const indices = Array.from({ length: N }, (_, i) => i);
    // Sample without replacement
    const chosen: number[] = [];
    const seen = new Set<number>();
    while (chosen.length < Math.min(sample, N)) {
        const idx = indices[Math.floor(Math.random() * N)];
        if (!seen.has(idx)) {
            seen.add(idx);
            chosen.push(idx);
        }
    }

    const recall1: number[] = [];
    const recall3: number[] = [];
    const top1Sims: number[] = [];
    const perCat: Record<string, number[]> = {};
    for (const i of chosen) {
        const q = matrix.subarray(i * DIM, (i + 1) * DIM);
        const sims: Array<{ j: number; s: number }> = [];
        for (let j = 0; j < N; j++) {
            if (j === i) continue;
            sims.push({ j, s: cosine(q, matrix, j * DIM) });
        }
        sims.sort((a, b) => b.s - a.s);
        const top1Cat = metaPrompts[sims[0].j].category;
        const myCat = metaPrompts[i].category;
        const r1 = top1Cat === myCat ? 1 : 0;
        const r3 = sims.slice(0, 3).some((x) => metaPrompts[x.j].category === myCat) ? 1 : 0;
        recall1.push(r1);
        recall3.push(r3);
        top1Sims.push(sims[0].s);
        (perCat[myCat] ??= []).push(r1);
    }

    const perCategory: Record<string, { n: number; recall1: number }> = {};
    for (const [k, v] of Object.entries(perCat)) {
        perCategory[k] = { n: v.length, recall1: mean(v) };
    }

    return {
        n: chosen.length,
        selfRecall1: mean(recall1),
        selfRecall3: mean(recall3),
        avgTop1Sim: mean(top1Sims),
        perCategory,
    };
}

async function main(): Promise<void> {
    const a = args();
    const mode = a.mode ?? 'both';
    const label = a.label ?? 'current';

    const report: any = { label };

    if (mode === 'autocomplete' || mode === 'both') {
        const rankerPath = a.ranker ?? resolve(process.cwd(), 'core/frontend/services/ml/autocompleteRanker.json');
        const dataPath = a.data ?? resolve(process.cwd(), 'data/autocomplete-train.jsonl');
        if (!existsSync(rankerPath)) throw new Error(`Missing ranker: ${rankerPath}`);
        if (!existsSync(dataPath)) throw new Error(`Missing data: ${dataPath}`);
        const ranker = JSON.parse(readFileSync(rankerPath, 'utf8'));
        const examples = loadJsonl<AutocompleteExample>(dataPath);
        const metrics = evaluateAutocomplete(examples, ranker.weights);
        report.autocomplete = {
            rankerPath,
            dataPath,
            datasetSize: examples.length,
            ...metrics,
        };
    }

    if (mode === 'prompts' || mode === 'both') {
        const binPath = a.bin ?? resolve(process.cwd(), 'core/frontend/services/ml/promptSuggestions.bin');
        const jsonPath = a.json ?? resolve(process.cwd(), 'core/frontend/services/ml/promptSuggestions.json');
        if (!existsSync(binPath)) throw new Error(`Missing bin: ${binPath}`);
        if (!existsSync(jsonPath)) throw new Error(`Missing json: ${jsonPath}`);
        const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
        const buf = readFileSync(binPath);
        const matrix = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        // Sample size: min(meta.count, 300)
        const sample = Math.min(meta.count, 300);
        const metrics = evaluatePrompts(matrix, meta.prompts, sample);
        report.prompts = {
            binPath,
            jsonPath,
            datasetSize: meta.count,
            sampleSize: sample,
            ...metrics,
        };
    }

    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
