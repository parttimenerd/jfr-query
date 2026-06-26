// Parallel batched generator for autocomplete + prompt-suggestion data.
// Reuses prompts/system from the sibling scripts but issues N concurrent
// Haiku calls. Resumable: appends to the existing JSONL files.
//
// Usage:
//   ANTHROPIC_API_KEY=... npx tsx generateParallel.ts \
//     --autocomplete-target 4500 --prompt-target 2700 --concurrency 6

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MODEL = 'claude-haiku-4-5-20251001';

interface Args {
    autocompleteTarget: number;
    promptTarget: number;
    concurrency: number;
    only: 'autocomplete' | 'prompts' | 'both';
}

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const get = (name: string, def?: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : def;
    };
    return {
        autocompleteTarget: Number(get('--autocomplete-target', '4500')),
        promptTarget: Number(get('--prompt-target', '2700')),
        concurrency: Number(get('--concurrency', '6')),
        only: (get('--only', 'both') as Args['only']),
    };
}

// ============ Autocomplete ============
type Scenario = 'where' | 'select' | 'join' | 'function-arg' | 'cte' | 'dollar';
const SCENARIOS: Scenario[] = ['where', 'select', 'join', 'function-arg', 'cte', 'dollar'];

interface AutocompleteExample {
    context: string;
    cursorPos: number;
    expectedTopK: string[];
    scenario: Scenario;
}

const AUTO_SYSTEM = `You generate realistic DuckDB SQL autocomplete training examples for a JFR (Java Flight Recorder) GC-analysis notebook.

Tables include: ActiveRecording, GarbageCollection, GcPhasePause, GcHeapSummary, ObjectAllocationSample, ThreadCpuLoad, JfrEvent.
Common columns: gcId, cause, duration, startTime, name, eventType, heapUsed, heapSize, threadName, allocSize.
Variables use the form \${var} or $$crossCellRef.

Output STRICT JSON array (no prose) of examples. Each example MUST have exactly:
- context: SQL string with a cursor marker '|' replaced by an empty position (do NOT include the '|' literally in the final 'context' field; instead, compute the 0-based byte offset and put it in cursorPos)
- cursorPos: integer 0-based offset where completion should fire
- expectedTopK: array of 3-8 plausible completion strings ranked best-first
- scenario: one of "where"|"select"|"join"|"function-arg"|"cte"|"dollar"

Diversify cursor positions: after SELECT comma, inside WHERE column slot, inside WHERE literal slot, after JOIN ON, inside function args, after WITH cte name AS (...), after $ for variable refs.`;

function parseAutocomplete(raw: string, scenario: Scenario): AutocompleteExample[] {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try {
        const arr = JSON.parse(cleaned.slice(start, end + 1));
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(
                (e: any): e is AutocompleteExample =>
                    e &&
                    typeof e.context === 'string' &&
                    typeof e.cursorPos === 'number' &&
                    Array.isArray(e.expectedTopK) &&
                    e.expectedTopK.every((x: unknown) => typeof x === 'string'),
            )
            .map((e: AutocompleteExample) => ({ ...e, scenario }));
    } catch {
        return [];
    }
}

// ============ Prompts ============
type Category = 'explore' | 'aggregate' | 'visualize' | 'debug' | 'explain';
const CATEGORIES: Category[] = ['explore', 'aggregate', 'visualize', 'debug', 'explain'];

interface PromptExample {
    notebookContext: string;
    suggestedPrompt: string;
    category: Category;
}

const PROMPT_SYSTEM = `You generate notebook prompt-suggestion training data. The notebook is a JFR (Java Flight Recorder) GC-analysis tool that mixes markdown and DuckDB SQL cells.

Each example is a short snippet (1–3 prior cells of markdown + SQL) followed by the natural-language prompt a user would plausibly type next into the AI assistant.

Output STRICT JSON array. Each item has:
- notebookContext: string (markdown then a SQL cell, separated by "\\n---SQL---\\n"; <= ~600 chars)
- suggestedPrompt: short natural-language request (5-20 words)
- category: "explore"|"aggregate"|"visualize"|"debug"|"explain"

Schemas: ActiveRecording(name, startTime, duration), GarbageCollection(gcId, cause, startTime, duration), GcPhasePause(gcId, name, duration), GcHeapSummary(gcId, when, heapUsed, heapSize), ObjectAllocationSample(threadName, allocSize, objectClass).`;

function parsePrompts(raw: string, category: Category): PromptExample[] {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try {
        const arr = JSON.parse(cleaned.slice(start, end + 1));
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(
                (e: any): e is PromptExample =>
                    e &&
                    typeof e.notebookContext === 'string' &&
                    typeof e.suggestedPrompt === 'string',
            )
            .map((e: PromptExample) => ({ ...e, category }));
    } catch {
        return [];
    }
}

// ============ Common ============
function countLines(path: string): number {
    if (!existsSync(path)) return 0;
    try {
        return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch {
        return 0;
    }
}

async function runParallel<T>(
    target: number,
    existing: number,
    concurrency: number,
    label: string,
    outPath: string,
    fetchBatch: (i: number) => Promise<{ examples: T[]; tag: string }>,
): Promise<number> {
    mkdirSync(dirname(outPath), { recursive: true });
    const sink = createWriteStream(outPath, { flags: 'a' });
    let total = existing;
    let batchIdx = 0;
    let inflight = 0;
    let done = false;

    return await new Promise<number>((resolveOuter) => {
        function maybeFinish() {
            if (done && inflight === 0) {
                sink.end();
                resolveOuter(total);
            }
        }

        function dispatch() {
            while (!done && inflight < concurrency && total + inflight * 25 < target + concurrency * 25) {
                if (total >= target) {
                    done = true;
                    maybeFinish();
                    return;
                }
                const myIdx = batchIdx++;
                inflight++;
                fetchBatch(myIdx)
                    .then(({ examples, tag }) => {
                        for (const ex of examples) {
                            if (total >= target) break;
                            sink.write(JSON.stringify(ex) + '\n');
                            total++;
                        }
                        process.stdout.write(`[${label}/${tag}] +${examples.length} → ${total}/${target}\n`);
                    })
                    .catch((err) => {
                        process.stdout.write(`[${label}] batch failed: ${err?.message ?? err}\n`);
                    })
                    .finally(() => {
                        inflight--;
                        if (total >= target) {
                            done = true;
                            maybeFinish();
                        } else {
                            dispatch();
                        }
                    });
            }
            if (!done && inflight === 0 && total >= target) {
                done = true;
                maybeFinish();
            }
        }
        dispatch();
    });
}

async function main() {
    const args = parseArgs();
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) not set');

    const client = new Anthropic({
        apiKey,
        baseURL: process.env.ANTHROPIC_BASE_URL,
    });

    const AUTO_OUT = resolve(process.cwd(), 'data/autocomplete-train.jsonl');
    const PROMPT_OUT = resolve(process.cwd(), 'data/prompt-suggestions.jsonl');
    const BATCH_SIZE = 25;

    if (args.only === 'autocomplete' || args.only === 'both') {
        const existing = countLines(AUTO_OUT);
        console.log(`[autocomplete] resuming from ${existing}; target ${args.autocompleteTarget}; concurrency ${args.concurrency}`);
        const t0 = Date.now();
        const total = await runParallel(
            args.autocompleteTarget,
            existing,
            args.concurrency,
            'autocomplete',
            AUTO_OUT,
            async (idx) => {
                const scenario = SCENARIOS[idx % SCENARIOS.length];
                const resp = await client.messages.create({
                    model: MODEL,
                    max_tokens: 4096,
                    system: AUTO_SYSTEM,
                    messages: [{ role: 'user', content: `Generate ${BATCH_SIZE} examples for scenario "${scenario}". Return ONLY a JSON array.` }],
                });
                const text = resp.content
                    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n');
                return { examples: parseAutocomplete(text, scenario), tag: scenario };
            },
        );
        console.log(`[autocomplete] done: ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    if (args.only === 'prompts' || args.only === 'both') {
        const existing = countLines(PROMPT_OUT);
        console.log(`[prompts] resuming from ${existing}; target ${args.promptTarget}; concurrency ${args.concurrency}`);
        const t0 = Date.now();
        const PROMPT_BATCH = 20;
        const total = await runParallel(
            args.promptTarget,
            existing,
            args.concurrency,
            'prompts',
            PROMPT_OUT,
            async (idx) => {
                const cat = CATEGORIES[idx % CATEGORIES.length];
                const resp = await client.messages.create({
                    model: MODEL,
                    max_tokens: 4096,
                    system: PROMPT_SYSTEM,
                    messages: [{ role: 'user', content: `Generate ${PROMPT_BATCH} examples whose category is "${cat}". Return ONLY a JSON array.` }],
                });
                const text = resp.content
                    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n');
                return { examples: parsePrompts(text, cat), tag: cat };
            },
        );
        console.log(`[prompts] done: ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
