// Schema-aware batched generator for autocomplete + prompt-suggestion data.
// Mirrors generateParallel.ts but embeds the *actual* JFR schemas the
// frontend works with so Haiku produces examples referencing real columns,
// real types, and real relationships (gcId joins, when/heapUsed/duration, etc).
//
// Output rows are tagged with provenance ("schemaAware": true, and a sub-tag
// for the table-focus or domain) so downstream analysis can compute deltas.
//
// Usage:
//   ANTHROPIC_AUTH_TOKEN=... ANTHROPIC_BASE_URL=... npx tsx \
//     core/frontend/scripts/training/generateSchemaAware.ts \
//     --autocomplete-target 1500 --prompt-target 1000 --concurrency 6

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Honor local proxy and either env var name.
const MODEL = process.env.SCHEMA_AWARE_MODEL ?? 'claude-haiku-latest';

interface Args {
    autocompleteTarget: number;
    promptTarget: number;
    concurrency: number;
    only: 'autocomplete' | 'prompts' | 'both';
    autoOut: string;
    promptOut: string;
}

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const get = (name: string, def?: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : def;
    };
    return {
        autocompleteTarget: Number(get('--autocomplete-target', '1500')),
        promptTarget: Number(get('--prompt-target', '1000')),
        concurrency: Number(get('--concurrency', '6')),
        only: (get('--only', 'both') as Args['only']),
        autoOut: get('--auto-out', resolve(process.cwd(), 'data/autocomplete-schema-aware.jsonl'))!,
        promptOut: get('--prompt-out', resolve(process.cwd(), 'data/prompt-suggestions-schema-aware.jsonl'))!,
    };
}

// ===================================================================
// JFR schema catalog. Matches what the frontend actually shows: see
//   core/frontend/data/demoNotebook.ts        (GarbageCollection, GCHeapSummary,
//                                              GCPhasePause, ObjectAllocationSample,
//                                              HeapSnapshot)
//   core/frontend/data/builtinSql.ts          (ActiveRecording, ExecutionSample,
//                                              YoungGarbageCollection, OldGarbageCollection,
//                                              ObjectAllocationInNewTLAB,
//                                              ObjectAllocationOutsideTLAB, JavaMonitorWait)
//   core/frontend/tests/sql/completion.dispatcher.test.ts (ActiveRecording, GarbageCollection
//                                              with their actual DuckDB column types)
// Column types use DuckDB types as in the test schema (INTEGER, BIGINT, VARCHAR,
// TIMESTAMP, INTERVAL, DOUBLE) plus the cells in demoNotebook.
// ===================================================================
export interface ColumnDef {
    name: string;
    type: string;
}
export interface TableDef {
    name: string;
    columns: ColumnDef[];
    description?: string;
}

export const JFR_SCHEMA_CATALOG: TableDef[] = [
    {
        name: 'ActiveRecording',
        description: 'Metadata for each JFR recording loaded.',
        columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'INTERVAL' },
        ],
    },
    {
        name: 'GarbageCollection',
        description: 'One row per GC cycle.',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'cause', type: 'VARCHAR' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'sumOfPauses', type: 'DOUBLE' },
            { name: 'longestPause', type: 'DOUBLE' },
        ],
    },
    {
        name: 'YoungGarbageCollection',
        description: 'Young-generation GC events; joins GarbageCollection on gcId.',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
            { name: 'tenuringThreshold', type: 'INTEGER' },
        ],
    },
    {
        name: 'OldGarbageCollection',
        description: 'Old-generation GC events; joins GarbageCollection on gcId.',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
        ],
    },
    {
        name: 'GCHeapSummary',
        description: 'Heap before/after each GC.',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
            { name: 'when', type: 'VARCHAR' },
            { name: 'heapUsed', type: 'BIGINT' },
            { name: 'heapCommitted', type: 'BIGINT' },
        ],
    },
    {
        name: 'GCPhasePause',
        description: 'Per-phase pause durations within a GC cycle.',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'duration', type: 'DOUBLE' },
        ],
    },
    {
        name: 'ObjectAllocationSample',
        description: 'Sampled object allocations with weight (bytes).',
        columns: [
            { name: 'objectClass', type: 'VARCHAR' },
            { name: 'weight', type: 'BIGINT' },
            { name: 'threadName', type: 'VARCHAR' },
            { name: 'startTime', type: 'TIMESTAMP' },
        ],
    },
    {
        name: 'ObjectAllocationInNewTLAB',
        description: 'Allocations inside a fresh TLAB.',
        columns: [
            { name: 'objectClass', type: 'VARCHAR' },
            { name: 'allocationSize', type: 'BIGINT' },
            { name: 'tlabSize', type: 'BIGINT' },
            { name: 'threadName', type: 'VARCHAR' },
        ],
    },
    {
        name: 'ObjectAllocationOutsideTLAB',
        description: 'Allocations that bypass TLAB.',
        columns: [
            { name: 'objectClass', type: 'VARCHAR' },
            { name: 'allocationSize', type: 'BIGINT' },
            { name: 'threadName', type: 'VARCHAR' },
        ],
    },
    {
        name: 'HeapSnapshot',
        description: 'Periodic heap snapshots.',
        columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'heapUsed', type: 'BIGINT' },
            { name: 'heapCommitted', type: 'BIGINT' },
        ],
    },
    {
        name: 'ExecutionSample',
        description: 'CPU profiling sample; stack and thread per tick.',
        columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'sampledThread', type: 'VARCHAR' },
            { name: 'state', type: 'VARCHAR' },
            { name: 'stackTrace', type: 'VARCHAR' },
        ],
    },
    {
        name: 'JavaMonitorWait',
        description: 'Thread waited on a monitor.',
        columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'monitorClass', type: 'VARCHAR' },
            { name: 'threadName', type: 'VARCHAR' },
        ],
    },
    {
        name: 'JavaMonitorEnter',
        description: 'Thread blocked entering a monitor.',
        columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'monitorClass', type: 'VARCHAR' },
            { name: 'threadName', type: 'VARCHAR' },
            { name: 'previousOwner', type: 'VARCHAR' },
        ],
    },
    {
        name: 'ThreadCPULoad',
        description: 'Per-thread CPU utilisation samples.',
        columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'eventThread', type: 'VARCHAR' },
            { name: 'user', type: 'DOUBLE' },
            { name: 'system', type: 'DOUBLE' },
        ],
    },
    {
        name: 'JfrEvent',
        description: 'Generic event row available for ad-hoc filtering.',
        columns: [
            { name: 'eventType', type: 'VARCHAR' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'DOUBLE' },
            { name: 'thread', type: 'VARCHAR' },
        ],
    },
];

function renderCatalog(catalog: TableDef[] = JFR_SCHEMA_CATALOG): string {
    return catalog
        .map((t) => {
            const cols = t.columns.map((c) => `${c.name} ${c.type}`).join(', ');
            const head = `${t.name}(${cols})`;
            return t.description ? `${head}  -- ${t.description}` : head;
        })
        .join('\n');
}

const CATALOG_TEXT = renderCatalog();

// ===================================================================
// Domain "focus" packs: pick a subset of the catalog to anchor each batch
// so the model spreads coverage rather than always reaching for the same tables.
// ===================================================================
interface FocusPack {
    tag: string;
    tables: string[];
    angle: string;
}

const AUTO_FOCUS: FocusPack[] = [
    { tag: 'gc-pause', tables: ['GarbageCollection', 'GCPhasePause'], angle: 'identifying long GC pauses and per-phase breakdown' },
    { tag: 'heap-trend', tables: ['GCHeapSummary', 'HeapSnapshot', 'GarbageCollection'], angle: 'heap occupancy trends and before/after deltas' },
    { tag: 'alloc-hotspots', tables: ['ObjectAllocationSample', 'ObjectAllocationInNewTLAB', 'ObjectAllocationOutsideTLAB'], angle: 'allocation hotspots by thread and class' },
    { tag: 'thread-blocking', tables: ['JavaMonitorWait', 'JavaMonitorEnter', 'ThreadCPULoad'], angle: 'thread blocking and contention analysis' },
    { tag: 'recording-meta', tables: ['ActiveRecording', 'JfrEvent'], angle: 'recording metadata and event-type triage' },
    { tag: 'gc-join', tables: ['GarbageCollection', 'GCPhasePause', 'GCHeapSummary', 'YoungGarbageCollection', 'OldGarbageCollection'], angle: 'joining gcId across GC-related tables' },
    { tag: 'cpu-profile', tables: ['ExecutionSample', 'ThreadCPULoad'], angle: 'CPU profiling and per-thread CPU load' },
];

const PROMPT_FOCUS: FocusPack[] = [
    { tag: 'gc-pause', tables: ['GarbageCollection', 'GCPhasePause'], angle: 'why GC pauses are long, which phases dominate' },
    { tag: 'heap-trend', tables: ['GCHeapSummary', 'HeapSnapshot'], angle: 'heap usage trends, leak detection' },
    { tag: 'alloc-hotspots', tables: ['ObjectAllocationSample', 'ObjectAllocationInNewTLAB', 'ObjectAllocationOutsideTLAB'], angle: 'which classes/threads dominate allocations' },
    { tag: 'thread-blocking', tables: ['JavaMonitorWait', 'JavaMonitorEnter'], angle: 'lock contention, blocked threads' },
    { tag: 'cpu-profile', tables: ['ExecutionSample', 'ThreadCPULoad'], angle: 'CPU hotspots, per-thread CPU' },
    { tag: 'cross-event', tables: ['GarbageCollection', 'ObjectAllocationSample', 'JavaMonitorWait'], angle: 'correlating GC with allocation and contention' },
];

function focusCatalog(focus: FocusPack): string {
    const set = new Set(focus.tables);
    return renderCatalog(JFR_SCHEMA_CATALOG.filter((t) => set.has(t.name)));
}

// ===================================================================
// Autocomplete
// ===================================================================
type Scenario = 'where' | 'select' | 'join' | 'function-arg' | 'cte' | 'dollar';
const SCENARIOS: Scenario[] = ['where', 'select', 'join', 'function-arg', 'cte', 'dollar'];

interface AutocompleteExample {
    context: string;
    cursorPos: number;
    expectedTopK: string[];
    scenario: Scenario;
    schemaAware?: boolean;
    focusTag?: string;
}

function autoSystem(focus: FocusPack): string {
    return `You generate realistic DuckDB SQL autocomplete training examples for a JFR (Java Flight Recorder) analysis notebook.

The notebook works against THIS schema (use the EXACT table & column names, do not invent):

${focusCatalog(focus)}

Other tables exist but THIS batch must focus on the tables above. Domain angle: ${focus.angle}.

Variables in the notebook use \${varName} or $$crossCellRef.

Output STRICT JSON array (no prose, no markdown fences). Each example MUST have:
- context: a partial DuckDB SQL string ending exactly at the cursor (do NOT include any '|' marker)
- cursorPos: integer 0-based offset where completion fires (typically context.length)
- expectedTopK: array of 3-8 plausible completion strings, best-first. ALL items MUST be valid:
    * column names from the focused tables (bare or table-qualified like g.gcId)
    * function calls ending with '(' (COUNT(, AVG(, SUM(, MAX(, MIN(, percentile_cont(, etc.)
    * SQL keywords (UPPERCASE) when appropriate
    * variable refs ($\${name} or $$ref) for the "dollar" scenario
- scenario: "${SCENARIOS.join('"|"')}"

Mix cursor positions: after SELECT comma, in WHERE column slot, after WHERE col =, after JOIN ON (alias.col), inside aggregate args, after WITH cte AS (..., after $.

CRITICAL: completions must be column names that EXIST in the focused tables (or aliased forms thereof). Do not fabricate columns.`;
}

function parseAutocomplete(raw: string, scenario: Scenario, focusTag: string): AutocompleteExample[] {
    let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
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
                    e.expectedTopK.length >= 2 &&
                    e.expectedTopK.every((x: unknown) => typeof x === 'string' && (x as string).length > 0),
            )
            .map((e: AutocompleteExample) => ({
                context: e.context,
                cursorPos: e.cursorPos,
                expectedTopK: e.expectedTopK,
                scenario,
                schemaAware: true,
                focusTag,
            }));
    } catch {
        return [];
    }
}

// ===================================================================
// Prompts
// ===================================================================
type Category = 'explore' | 'aggregate' | 'visualize' | 'debug' | 'explain';
const CATEGORIES: Category[] = ['explore', 'aggregate', 'visualize', 'debug', 'explain'];

interface PromptExample {
    notebookContext: string;
    suggestedPrompt: string;
    category: Category;
    schemaAware?: boolean;
    focusTag?: string;
}

function promptSystem(focus: FocusPack): string {
    return `You generate notebook prompt-suggestion training data for a JFR (Java Flight Recorder) analysis tool.

The notebook works against THIS schema (use the EXACT table & column names):

${focusCatalog(focus)}

Domain angle for this batch: ${focus.angle}.

Each example is a short snippet (1-3 prior cells of markdown + a SQL cell) followed by the natural-language question a user would plausibly ask the AI next.

Output STRICT JSON array (no prose, no markdown fences). Each item has:
- notebookContext: string (markdown then SQL cell, separated by "\\n---SQL---\\n"; under ~700 chars). The SQL MUST reference real tables/columns from the focused schema above.
- suggestedPrompt: a natural-language analyst question (5-25 words). It SHOULD mention specific JFR event names or columns (e.g. "GarbageCollection.duration", "GCPhasePause name", "heapUsed").
- category: "explore"|"aggregate"|"visualize"|"debug"|"explain"

Make prompts realistic for a Java performance engineer triaging a recording. Examples of useful phrasing: "Plot heapUsed before vs after GC over time", "Which GCPhasePause name dominates total pause time?", "Find threads blocked the longest in JavaMonitorWait".`;
}

function parsePrompts(raw: string, category: Category, focusTag: string): PromptExample[] {
    let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
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
                    e.notebookContext.length > 10 &&
                    typeof e.suggestedPrompt === 'string' &&
                    e.suggestedPrompt.length > 4,
            )
            .map((e: PromptExample) => ({
                notebookContext: e.notebookContext,
                suggestedPrompt: e.suggestedPrompt,
                category,
                schemaAware: true,
                focusTag,
            }));
    } catch {
        return [];
    }
}

// ===================================================================
// Common
// ===================================================================
function countLines(path: string): number {
    if (!existsSync(path)) return 0;
    try {
        return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch {
        return 0;
    }
}

// Stats accumulator passed into runParallel so we can report parse failures.
interface RunStats {
    callsAttempted: number;
    callsSucceeded: number;
    parseFailures: number;
    rateLimited: number;
    otherErrors: number;
}

async function runParallel<T>(
    target: number,
    existing: number,
    concurrency: number,
    label: string,
    outPath: string,
    fetchBatch: (i: number) => Promise<{ examples: T[]; tag: string }>,
    stats: RunStats,
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
                stats.callsAttempted++;
                fetchBatch(myIdx)
                    .then(({ examples, tag }) => {
                        if (examples.length === 0) {
                            stats.parseFailures++;
                        } else {
                            stats.callsSucceeded++;
                        }
                        for (const ex of examples) {
                            if (total >= target) break;
                            sink.write(JSON.stringify(ex) + '\n');
                            total++;
                        }
                        process.stdout.write(`[${label}/${tag}] +${examples.length} → ${total}/${target}\n`);
                    })
                    .catch((err) => {
                        const msg = err?.message ?? String(err);
                        if (/429|rate.?limit/i.test(msg)) stats.rateLimited++;
                        else stats.otherErrors++;
                        process.stdout.write(`[${label}] batch failed: ${msg}\n`);
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

async function callWithRetry(
    client: Anthropic,
    body: Anthropic.MessageCreateParamsNonStreaming,
    retries = 3,
): Promise<string> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= retries) {
        try {
            const resp = await client.messages.create(body);
            return resp.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
        } catch (err: any) {
            lastErr = err;
            const status = err?.status ?? err?.statusCode;
            if (status === 429 || status === 529 || (status >= 500 && status < 600)) {
                const backoff = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                await new Promise((r) => setTimeout(r, backoff));
                attempt++;
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

async function main() {
    const args = parseArgs();
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) not set');

    const client = new Anthropic({
        apiKey,
        // Honor local proxy explicitly; SDK won't pick it up otherwise.
        baseURL: process.env.ANTHROPIC_BASE_URL,
        defaultHeaders: {
            // Some proxies expect Bearer; the SDK already sets x-api-key.
            authorization: `Bearer ${apiKey}`,
        },
    });

    const AUTO_OUT = args.autoOut;
    const PROMPT_OUT = args.promptOut;
    const BATCH_SIZE = 25;
    const PROMPT_BATCH = 20;

    if (args.only === 'autocomplete' || args.only === 'both') {
        const existing = countLines(AUTO_OUT);
        console.log(`[autocomplete] resuming from ${existing}; target ${args.autocompleteTarget}; concurrency ${args.concurrency}; model=${MODEL}`);
        const stats: RunStats = { callsAttempted: 0, callsSucceeded: 0, parseFailures: 0, rateLimited: 0, otherErrors: 0 };
        const t0 = Date.now();
        const total = await runParallel(
            args.autocompleteTarget,
            existing,
            args.concurrency,
            'auto-sa',
            AUTO_OUT,
            async (idx) => {
                const scenario = SCENARIOS[idx % SCENARIOS.length];
                const focus = AUTO_FOCUS[Math.floor(idx / SCENARIOS.length) % AUTO_FOCUS.length];
                const text = await callWithRetry(client, {
                    model: MODEL,
                    max_tokens: 4096,
                    system: autoSystem(focus),
                    messages: [{ role: 'user', content: `Generate ${BATCH_SIZE} examples for scenario "${scenario}" using ONLY the focused tables. Return ONLY a JSON array.` }],
                });
                return { examples: parseAutocomplete(text, scenario, focus.tag), tag: `${scenario}/${focus.tag}` };
            },
            stats,
        );
        console.log(`[autocomplete] done: ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s; stats=${JSON.stringify(stats)}`);
        appendFileSync(args.autoOut + '.stats.json', JSON.stringify({ at: new Date().toISOString(), total, stats }) + '\n');
    }

    if (args.only === 'prompts' || args.only === 'both') {
        const existing = countLines(PROMPT_OUT);
        console.log(`[prompts] resuming from ${existing}; target ${args.promptTarget}; concurrency ${args.concurrency}; model=${MODEL}`);
        const stats: RunStats = { callsAttempted: 0, callsSucceeded: 0, parseFailures: 0, rateLimited: 0, otherErrors: 0 };
        const t0 = Date.now();
        const total = await runParallel(
            args.promptTarget,
            existing,
            args.concurrency,
            'prompt-sa',
            PROMPT_OUT,
            async (idx) => {
                const cat = CATEGORIES[idx % CATEGORIES.length];
                const focus = PROMPT_FOCUS[Math.floor(idx / CATEGORIES.length) % PROMPT_FOCUS.length];
                const text = await callWithRetry(client, {
                    model: MODEL,
                    max_tokens: 4096,
                    system: promptSystem(focus),
                    messages: [{ role: 'user', content: `Generate ${PROMPT_BATCH} examples whose category is "${cat}", using the focused schema. Return ONLY a JSON array.` }],
                });
                return { examples: parsePrompts(text, cat, focus.tag), tag: `${cat}/${focus.tag}` };
            },
            stats,
        );
        console.log(`[prompts] done: ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s; stats=${JSON.stringify(stats)}`);
        appendFileSync(args.promptOut + '.stats.json', JSON.stringify({ at: new Date().toISOString(), total, stats }) + '\n');
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

export { CATALOG_TEXT };
