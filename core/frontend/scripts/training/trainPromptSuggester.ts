// Build a retrieval index for prompt suggestions: embed each notebookContext
// once with MiniLM, store as a flat Float32 matrix + parallel JSON of prompts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PromptExample } from './generatePromptSuggestions';

const DIM = 384;
const IN = resolve(process.cwd(), 'data/prompt-suggestions.jsonl');
const OUT_BIN = resolve(
    process.cwd(),
    'core/frontend/services/ml/promptSuggestions.bin',
);
const OUT_META = resolve(
    process.cwd(),
    'core/frontend/services/ml/promptSuggestions.json',
);

function loadExamples(): PromptExample[] {
    if (!existsSync(IN)) throw new Error(`Missing ${IN}; run generatePromptSuggestions first`);
    return readFileSync(IN, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as PromptExample);
}

async function embedAll(texts: string[]): Promise<Float32Array> {
    // Dynamic import so unit tests don't need transformers installed.
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q4' });
    const out = new Float32Array(texts.length * DIM);
    const BATCH = 16;
    for (let i = 0; i < texts.length; i += BATCH) {
        const slice = texts.slice(i, i + BATCH);
        const r: any = await ext(slice, { pooling: 'mean', normalize: true });
        out.set(r.data as Float32Array, i * DIM);
        if (i % (BATCH * 10) === 0) {
            console.log(`embedded ${i}/${texts.length}`);
        }
    }
    return out;
}

async function main(): Promise<void> {
    const examples = loadExamples();
    console.log(`Loaded ${examples.length} examples`);
    mkdirSync(dirname(OUT_BIN), { recursive: true });

    const matrix = await embedAll(examples.map((e) => e.notebookContext));
    writeFileSync(OUT_BIN, Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength));
    writeFileSync(
        OUT_META,
        JSON.stringify(
            {
                version: 1,
                dim: DIM,
                count: examples.length,
                trainedAt: new Date().toISOString(),
                prompts: examples.map((e) => ({
                    suggestedPrompt: e.suggestedPrompt,
                    category: e.category,
                })),
            },
            null,
            2,
        ),
    );
    console.log(`Wrote matrix (${matrix.length * 4} bytes) and metadata for ${examples.length} prompts`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
