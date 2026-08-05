// Synthesize SQL autocomplete training data via Anthropic Haiku.
// Streams JSONL rows to data/autocomplete-train.jsonl as they arrive
// so partial runs can be resumed safely.

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MODEL = 'claude-haiku-4-5-20251001';
const TARGET = Number(process.env.AUTOCOMPLETE_TARGET ?? 5000);
const BATCH_SIZE = 25; // examples per Haiku call
const OUT = resolve(process.cwd(), 'data/autocomplete-train.jsonl');

type Scenario = 'where' | 'select' | 'join' | 'function-arg' | 'cte' | 'dollar' | 'plot';

export interface AutocompleteExample {
    context: string;
    cursorPos: number;
    expectedTopK: string[];
    scenario: Scenario;
}

const SCENARIOS: Scenario[] = ['where', 'select', 'join', 'function-arg', 'cte', 'dollar', 'plot'];

const SYSTEM = `You generate realistic DuckDB SQL autocomplete training examples for a JFR (Java Flight Recorder) GC-analysis notebook.

Tables include: ActiveRecording, GarbageCollection, GcPhasePause, GcHeapSummary, ObjectAllocationSample, ThreadCpuLoad, JfrEvent.
Common columns: gcId, cause, duration, startTime, name, eventType, heapUsed, heapSize, threadName, allocSize.
Variables use the form \${var} or $$crossCellRef.

SQL view names (hyphenated, used in FROM clauses): gc-pauses, gc-overhead, gc-throughput, gc-efficiency, heap-committed-vs-used, gc-allocation-by-class, gc-top-pauses, gc-old-gen-growth, thread-start, cpu-hot-methods, safepoints, tlab-efficiency.

Plot DSL clauses (used after plot function calls like LINE_CHART(...)): TITLE, ZOOM, LINK_X, LINK_Y, AXIS_X, AXIS_Y, DOMAIN, LABEL, FORMAT, TYPE, LEGEND, PALETTE, BRUSH, TOOLTIP, ON, WIDTH, HEIGHT, SORT, LIMIT.

Output STRICT JSON array (no prose) of examples. Each example MUST have exactly:
- context: SQL string with a cursor marker '|' replaced by an empty position (do NOT include the '|' literally in the final 'context' field; instead, compute the 0-based byte offset and put it in cursorPos)
- cursorPos: integer 0-based offset where completion should fire
- expectedTopK: array of 3-8 plausible completion strings ranked best-first
- scenario: one of "where"|"select"|"join"|"function-arg"|"cte"|"dollar"|"plot"

Diversify cursor positions: after SELECT comma, inside WHERE column slot, inside WHERE literal slot, after JOIN ON, inside function args, after WITH cte name AS (...), after $ for variable refs, after plot function call clauses.`;

function buildUserPrompt(scenario: Scenario, n: number): string {
    return `Generate ${n} examples for scenario "${scenario}". Return ONLY a JSON array.`;
}

function loadExisting(): number {
    if (!existsSync(OUT)) return 0;
    try {
        const txt = readFileSync(OUT, 'utf8');
        return txt.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
        return 0;
    }
}

function parseExamples(raw: string, scenario: Scenario): AutocompleteExample[] {
    // Haiku sometimes wraps JSON in ``` fences — strip them.
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
        .filter(
            (e): e is AutocompleteExample =>
                e &&
                typeof e.context === 'string' &&
                typeof e.cursorPos === 'number' &&
                Array.isArray(e.expectedTopK) &&
                e.expectedTopK.every((x: unknown) => typeof x === 'string'),
        )
        .map((e) => ({ ...e, scenario }));
}

async function main(): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    mkdirSync(dirname(OUT), { recursive: true });
    const client = new Anthropic({ apiKey });
    const existing = loadExisting();
    console.log(`Resuming from ${existing} existing examples; target ${TARGET}`);

    const sink = createWriteStream(OUT, { flags: 'a' });
    let total = existing;
    let scenarioIdx = 0;

    while (total < TARGET) {
        const scenario = SCENARIOS[scenarioIdx % SCENARIOS.length];
        scenarioIdx++;
        try {
            const resp = await client.messages.create({
                model: MODEL,
                max_tokens: 4096,
                system: SYSTEM,
                messages: [{ role: 'user', content: buildUserPrompt(scenario, BATCH_SIZE) }],
            });
            const text = resp.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
            const examples = parseExamples(text, scenario);
            for (const ex of examples) {
                sink.write(JSON.stringify(ex) + '\n');
                total++;
                if (total >= TARGET) break;
            }
            console.log(`[${scenario}] +${examples.length} → ${total}/${TARGET}`);
        } catch (err) {
            console.warn(`batch failed (${scenario}):`, err instanceof Error ? err.message : err);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    sink.end();
    console.log(`Done. Wrote ${total} examples to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
