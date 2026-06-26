// Print concrete example outputs for both ML models so we can eyeball
// behavior. Runs against the *current* trained artifacts.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    featurize,
    score as scoreFeatures,
} from './trainAutocompleteRanker';
import type { Weights } from './trainAutocompleteRanker';

const DIM = 384;

interface PromptEntry {
    suggestedPrompt: string;
    category: string;
}

interface SuggesterMeta {
    prompts: PromptEntry[];
}

function rankCandidates(
    context: string,
    cursorPos: number,
    candidates: string[],
    scenario: string,
    weights: Weights,
): Array<{ candidate: string; score: number }> {
    return candidates
        .map((c) => ({
            candidate: c,
            score: scoreFeatures(featurize(context, cursorPos, c, scenario), weights),
        }))
        .sort((a, b) => b.score - a.score);
}

function cosine(a: Float32Array, b: Float32Array, off: number): number {
    let s = 0;
    for (let i = 0; i < DIM; i++) s += a[i] * b[off + i];
    return s;
}

async function embed(text: string): Promise<Float32Array> {
    const { pipeline, env } = await import('@huggingface/transformers');
    (env as any).allowLocalModels = false;
    const ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q4' });
    const r: any = await ext([text], { pooling: 'mean', normalize: true });
    return (r.data as Float32Array).subarray(0, DIM);
}

const AUTO_SCENARIOS = [
    {
        title: '1) SELECT clause with partial token "dur"',
        context: 'SELECT dur',
        cursorPos: 10,
        scenario: 'select',
        candidates: ['duration', 'cause', 'gcId', 'SELECT', 'AVG(', 'startTime'],
    },
    {
        title: '2) WHERE column slot — no prefix',
        context: 'SELECT * FROM GarbageCollection WHERE ',
        cursorPos: 38,
        scenario: 'where',
        candidates: ['SELECT', 'cause', 'duration', 'gcId', 'ORDER', 'startTime'],
    },
    {
        title: '3) JOIN ON — pick columns over keywords',
        context: 'SELECT * FROM GarbageCollection g JOIN GcPhasePause p ON ',
        cursorPos: 58,
        scenario: 'join',
        candidates: ['g.gcId', 'p.gcId', 'WHERE', 'p.name', 'SELECT'],
    },
    {
        title: '4) Function argument slot',
        context: 'SELECT AVG(',
        cursorPos: 11,
        scenario: 'function-arg',
        candidates: ['duration', 'heapUsed', 'COUNT(', 'cause', 'allocSize'],
    },
    {
        title: '5) Dollar variable reference',
        context: 'SELECT * FROM GarbageCollection WHERE gcId = $',
        cursorPos: 46,
        scenario: 'dollar',
        candidates: ['${gcId}', 'gcId', '$$pinnedRow', 'duration'],
    },
];

const PROMPT_SCENARIOS = [
    '# GC pause investigation\nLooking at why pauses are spiking.\n---SQL---\nSELECT gcId, cause, duration FROM GarbageCollection ORDER BY duration DESC LIMIT 20;',
    '# Heap usage trend\n---SQL---\nSELECT when, heapUsed, heapSize FROM GcHeapSummary ORDER BY when;',
    "# Allocation hotspots\nWhich threads allocate the most?\n---SQL---\nSELECT threadName, SUM(allocSize) AS total FROM ObjectAllocationSample GROUP BY threadName ORDER BY total DESC LIMIT 10;",
    '# Pause phase breakdown\n---SQL---\nSELECT name, AVG(duration) FROM GcPhasePause GROUP BY name;',
    '# Long GC outliers\nWant to drill into the slowest GCs and their pause phases.\n---SQL---\nSELECT gcId, cause, duration FROM GarbageCollection WHERE duration > 100;',
];

async function main() {
    // ---- Autocomplete examples ----
    const rankerPath = resolve(process.cwd(), 'core/frontend/services/ml/autocompleteRanker.json');
    const ranker = JSON.parse(readFileSync(rankerPath, 'utf8'));
    const weights: Weights = ranker.weights;

    console.log('=== AUTOCOMPLETE EXAMPLES ===');
    for (const sc of AUTO_SCENARIOS) {
        console.log('\n' + sc.title);
        console.log(`  context  : ${JSON.stringify(sc.context)}`);
        console.log(`  cursorPos: ${sc.cursorPos}`);
        console.log(`  scenario : ${sc.scenario}`);
        console.log(`  input    : ${sc.candidates.join(', ')}`);
        const ranked = rankCandidates(sc.context, sc.cursorPos, sc.candidates, sc.scenario, weights);
        console.log('  ranked   :');
        for (const r of ranked) {
            console.log(`    ${r.score.toFixed(3)}  ${r.candidate}`);
        }
    }

    // ---- Prompt suggestion examples ----
    const binPath = resolve(process.cwd(), 'core/frontend/services/ml/promptSuggestions.bin');
    const jsonPath = resolve(process.cwd(), 'core/frontend/services/ml/promptSuggestions.json');
    if (!existsSync(binPath) || !existsSync(jsonPath)) {
        console.log('\n(No prompt artifact found; skipping prompt examples.)');
        return;
    }
    const meta = JSON.parse(readFileSync(jsonPath, 'utf8')) as SuggesterMeta;
    const buf = readFileSync(binPath);
    const matrix = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

    console.log('\n\n=== PROMPT SUGGESTION EXAMPLES ===');
    for (let i = 0; i < PROMPT_SCENARIOS.length; i++) {
        const ctx = PROMPT_SCENARIOS[i];
        const q = await embed(ctx);
        const sims: Array<{ idx: number; s: number }> = [];
        for (let j = 0; j < meta.prompts.length; j++) {
            sims.push({ idx: j, s: cosine(q, matrix, j * DIM) });
        }
        sims.sort((a, b) => b.s - a.s);
        console.log(`\n${i + 1}) Notebook context:`);
        console.log('  ' + ctx.replace(/\n/g, '\n  '));
        console.log('  → top-5 suggestions:');
        for (const x of sims.slice(0, 5)) {
            const p = meta.prompts[x.idx];
            console.log(`    ${x.s.toFixed(3)} [${p.category.padEnd(9)}] ${p.suggestedPrompt}`);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
