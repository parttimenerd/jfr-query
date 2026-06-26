// Synthesize notebook prompt-suggestion training data via Anthropic Haiku.
// Each row: { notebookContext, suggestedPrompt, category }.

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MODEL = 'claude-haiku-4-5-20251001';
const TARGET = Number(process.env.PROMPT_TARGET ?? 3000);
const BATCH_SIZE = 20;
const OUT = resolve(process.cwd(), 'data/prompt-suggestions.jsonl');

type Category = 'explore' | 'aggregate' | 'visualize' | 'debug' | 'explain';
const CATEGORIES: Category[] = ['explore', 'aggregate', 'visualize', 'debug', 'explain'];

export interface PromptExample {
    notebookContext: string;
    suggestedPrompt: string;
    category: Category;
}

const SYSTEM = `You generate notebook prompt-suggestion training data. The notebook is a JFR (Java Flight Recorder) GC-analysis tool that mixes markdown and DuckDB SQL cells.

Each example is a short snippet (1–3 prior cells of markdown + SQL) followed by the natural-language prompt a user would plausibly type next into the AI assistant.

Output STRICT JSON array. Each item has:
- notebookContext: string (markdown then a SQL cell, separated by "\\n---SQL---\\n"; <= ~600 chars)
- suggestedPrompt: short natural-language request (5-20 words)
- category: "explore"|"aggregate"|"visualize"|"debug"|"explain"

Schemas: ActiveRecording(name, startTime, duration), GarbageCollection(gcId, cause, startTime, duration), GcPhasePause(gcId, name, duration), GcHeapSummary(gcId, when, heapUsed, heapSize), ObjectAllocationSample(threadName, allocSize, objectClass).`;

function userPrompt(cat: Category, n: number): string {
    return `Generate ${n} examples whose category is "${cat}". Return ONLY a JSON array.`;
}

function loadExisting(): number {
    if (!existsSync(OUT)) return 0;
    try {
        return readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch {
        return 0;
    }
}

function parse(raw: string, category: Category): PromptExample[] {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
        .filter(
            (e): e is PromptExample =>
                e &&
                typeof e.notebookContext === 'string' &&
                typeof e.suggestedPrompt === 'string',
        )
        .map((e) => ({ ...e, category }));
}

async function main(): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    mkdirSync(dirname(OUT), { recursive: true });
    const client = new Anthropic({ apiKey });

    const existing = loadExisting();
    console.log(`Resuming from ${existing}; target ${TARGET}`);
    const sink = createWriteStream(OUT, { flags: 'a' });
    let total = existing;
    let i = 0;

    while (total < TARGET) {
        const cat = CATEGORIES[i++ % CATEGORIES.length];
        try {
            const resp = await client.messages.create({
                model: MODEL,
                max_tokens: 4096,
                system: SYSTEM,
                messages: [{ role: 'user', content: userPrompt(cat, BATCH_SIZE) }],
            });
            const text = resp.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
            const examples = parse(text, cat);
            for (const ex of examples) {
                sink.write(JSON.stringify(ex) + '\n');
                total++;
                if (total >= TARGET) break;
            }
            console.log(`[${cat}] +${examples.length} → ${total}/${TARGET}`);
        } catch (err) {
            console.warn(`batch failed (${cat}):`, err instanceof Error ? err.message : err);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    sink.end();
    console.log(`Done. Wrote ${total} to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
