# Chat Good Pal — Phase 3: Local Model Routing + System Prompt Quality

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local models a first-class chat path — equal quality to cloud, not a degraded fallback. Add a routing layer that dispatches to local or cloud based on message complexity and user preference, a tuned local system prompt with few-shot examples, proper settings UI, and a comprehensive test suite covering routing, prompt shape, streaming, fallback, and the error retry loop.

**Architecture:** A new `routing.ts` module contains the routing decision function. `AiService.streamChatWithTools` gets a pre-dispatch routing hook. `chatModes.ts` gains a `buildLocalSystemPrompt(schema, variables)` function with the tuned prompt + few-shot examples. Settings panel gains local routing fields. A mock OpenAI-compatible server (built with Node `http`) is used in integration tests.

**Tech Stack:** React, Tailwind, existing `LocalAiProvider`, `AiService`, `chatModes.ts`, Node `http` for mock server in tests, Vitest.

**Prerequisite:** Phase 1 and Phase 2 complete.

---

## File Map

| File | Change |
|------|--------|
| `services/ai/routing.ts` | **Create** — routing decision function |
| `services/ai/chatModes.ts` | **Modify** — add `buildLocalSystemPrompt`, few-shot examples |
| `services/AiService.ts` | **Modify** — call routing layer before provider dispatch |
| `context/SettingsContext.tsx` | **Modify** — add `localRoutingPreference`, `localModelName`, `localToolAccess` |
| `components/SettingsModal.tsx` | **Modify** — local model routing settings section |
| `components/ChatPanel.tsx` | **Modify** — routing toggle in header (`auto`/`local`/`cloud`) |
| `tests/ai/routing.test.ts` | **Create** — routing unit tests |
| `tests/ai/localSystemPrompt.test.ts` | **Create** — system prompt shape + content tests |
| `tests/ai/localModel.test.ts` | **Create** — mock server integration, streaming, fallback, cell fence parse |

---

### Task 1: Routing module

**Files:**
- Create: `core/frontend/services/ai/routing.ts`
- Create: `core/frontend/tests/ai/routing.test.ts`

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/ai/routing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { routeMessage } from '../../services/ai/routing';
import type { Tool } from '../../services/ai/tools';

const readTool: Tool = { name: 'query_data', kind: 'read', description: '', inputSchema: { type: 'object' } };
const mutateTool: Tool = { name: 'add_cell', kind: 'mutate', description: '', inputSchema: { type: 'object' } };

describe('routeMessage', () => {
    it('returns local for short message with no tools and no full visibility', () => {
        expect(routeMessage('what is avg gc pause?', [], 'no-data')).toBe('local');
    });

    it('returns local for sanitized visibility with short message', () => {
        expect(routeMessage('show heap usage', [], 'sanitized')).toBe('local');
    });

    it('returns cloud when visibility is full', () => {
        expect(routeMessage('show heap usage', [], 'full')).toBe('cloud');
    });

    it('returns cloud when message is longer than 200 chars', () => {
        const long = 'x'.repeat(201);
        expect(routeMessage(long, [], 'no-data')).toBe('cloud');
    });

    it('returns cloud when a mutate tool is in the list', () => {
        expect(routeMessage('add a cell', [mutateTool], 'no-data')).toBe('cloud');
    });

    it('returns local when only read tools present', () => {
        expect(routeMessage('top methods', [readTool], 'no-data')).toBe('local');
    });

    it('user override "local" always returns local regardless of rules', () => {
        expect(routeMessage('x'.repeat(300), [mutateTool], 'full', 'local')).toBe('local');
    });

    it('user override "cloud" always returns cloud', () => {
        expect(routeMessage('hi', [], 'no-data', 'cloud')).toBe('cloud');
    });

    it('user override "auto" respects normal rules', () => {
        expect(routeMessage('hi', [], 'no-data', 'auto')).toBe('local');
        expect(routeMessage('hi', [], 'full', 'auto')).toBe('cloud');
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/ai/routing.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `routing.ts`**

Create `core/frontend/services/ai/routing.ts`:

```typescript
import type { Tool } from './tools';

export type RouteTarget = 'local' | 'cloud';
export type RoutingPreference = 'auto' | 'local' | 'cloud';
export type VisibilityMode = 'no-data' | 'sanitized' | 'full';

/**
 * Decide whether to use the local or cloud provider for a chat message.
 * Local is used when the message is short, no mutate tools are needed,
 * and data visibility is not 'full'. User override takes precedence.
 */
export function routeMessage(
    message: string,
    tools: Tool[],
    visibility: VisibilityMode,
    userPreference: RoutingPreference = 'auto',
): RouteTarget {
    if (userPreference === 'local') return 'local';
    if (userPreference === 'cloud') return 'cloud';

    // auto routing rules
    if (visibility === 'full') return 'cloud';
    if (tools.some(t => t.kind === 'mutate')) return 'cloud';
    if (message.length > 200) return 'cloud';
    return 'local';
}
```

- [ ] **Step 4: Run tests**

```bash
cd core/frontend && npx vitest run tests/ai/routing.test.ts
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/services/ai/routing.ts core/frontend/tests/ai/routing.test.ts
git commit -m "feat(chat): add routeMessage function for local/cloud dispatch"
```

---

### Task 2: Local system prompt

**Files:**
- Modify: `core/frontend/services/ai/chatModes.ts`
- Create: `core/frontend/tests/ai/localSystemPrompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/ai/localSystemPrompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildLocalSystemPrompt } from '../../services/ai/chatModes';

const schema = [
    { name: 'GarbageCollection', columns: [{ name: 'startTime' }, { name: 'duration' }, { name: 'gcId' }] },
    { name: 'ExecutionSample', columns: [{ name: 'stackTrace' }, { name: 'samples' }] },
];

const variables = { threshold: 20, maxRows: 100 };

describe('buildLocalSystemPrompt', () => {
    it('includes all table names from schema', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('GarbageCollection');
        expect(prompt).toContain('ExecutionSample');
    });

    it('includes column names', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('startTime');
        expect(prompt).toContain('stackTrace');
    });

    it('includes variable names', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('threshold');
        expect(prompt).toContain('maxRows');
    });

    it('includes :::cell fence syntax example', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain(':::cell');
        expect(prompt).toContain(':::');
    });

    it('includes at least 2 few-shot Q&A examples', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        const qCount = (prompt.match(/^Q:/gm) ?? []).length;
        expect(qCount).toBeGreaterThanOrEqual(2);
    });

    it('works with empty schema and variables', () => {
        const prompt = buildLocalSystemPrompt([], {});
        expect(prompt).toBeTruthy();
        expect(prompt).toContain(':::cell');
    });

    it('includes instruction to suggest next steps', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt.toLowerCase()).toMatch(/suggest|next|follow/);
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/ai/localSystemPrompt.test.ts
```
Expected: FAIL — `buildLocalSystemPrompt is not exported from chatModes`.

- [ ] **Step 3: Implement `buildLocalSystemPrompt` in `chatModes.ts`**

In `core/frontend/services/ai/chatModes.ts`, add at the end of the file:

```typescript
export interface SchemaTable {
    name: string;
    columns: Array<{ name: string; type?: string }>;
}

/**
 * Build a tuned system prompt for local (small) models.
 * Shorter and more directive than the cloud prompt — local models degrade
 * with long preambles. Includes full schema, variables, :::cell syntax,
 * and 3 few-shot examples.
 */
export function buildLocalSystemPrompt(
    schema: SchemaTable[],
    variables: Record<string, unknown>,
): string {
    const schemaText = schema.length > 0
        ? schema.map(t => {
              const cols = t.columns.map(c => c.type ? `${c.name} ${c.type}` : c.name).join(', ');
              return `  ${t.name}(${cols})`;
          }).join('\n')
        : '  (no tables loaded yet)';

    const varsText = Object.keys(variables).length > 0
        ? Object.entries(variables).map(([k, v]) => `  $${k} = ${JSON.stringify(v)}`).join('\n')
        : '  (none)';

    return `You are a JFR performance analyst embedded in a notebook. Be concise, direct, and genuinely helpful.
When you find something interesting, say so. Suggest the next useful question. Don't pad answers.

Available tables:
${schemaText}

Current variables:
${varsText}

When a chart or table would make the answer clearer, embed it inline using a cell fence:
  :::cell type=chart
  sql: SELECT ...
  plot: LINE_CHART(x: "col", y: ["col2"])
  :::
Supported types: chart, table, flamegraph. Text can appear before and after each fence.

If a query fails or returns an error, fix the SQL and try again. Briefly explain what you changed.
To query data you don't have, call the query_data tool with sql, reason, and tables.
You may call tools multiple times in one response — query, check the result, then embed a chart.

--- Examples ---
Q: What is the average GC pause?
A: Average GC pause is 14ms (p99: 48ms). Mostly short Young GC — healthy. Want a breakdown by GC type?

Q: Show me heap usage over time.
A: Heap grew steadily and peaked at ~2.4 GB around t=40s:
:::cell type=chart
sql: SELECT time_bucket('1s', startTime) AS t, avg(heapUsed) AS heap_mb FROM gc_heap_summary GROUP BY t ORDER BY t
plot: LINE_CHART(x: "t", y: ["heap_mb"])
:::
No GC recovery after the peak — likely a retained reference. Want me to find the top allocating classes?

Q: Which methods consume the most CPU?
A: Let me query the execution samples.
[calls query_data: sql=SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 20, reason="Find hot CPU methods", tables=["ExecutionSample"]]`;
}
```

- [ ] **Step 4: Run tests**

```bash
cd core/frontend && npx vitest run tests/ai/localSystemPrompt.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/services/ai/chatModes.ts core/frontend/tests/ai/localSystemPrompt.test.ts
git commit -m "feat(chat): add buildLocalSystemPrompt with schema injection, variables, and few-shot examples"
```

---

### Task 3: Wire routing into `AiService`

**Files:**
- Modify: `core/frontend/services/AiService.ts`

**Context:** `streamChatWithTools` currently selects a provider via `providerOverride` or the settings default. We need to intercept before provider selection and apply the routing decision when a local model is configured. The routing decision produces `'local' | 'cloud'` — if `'local'`, use `LocalAiProvider` with `buildLocalSystemPrompt`; if `'cloud'`, proceed as today.

- [ ] **Step 1: Add routing parameters to `streamChatWithTools` opts**

In `core/frontend/services/AiService.ts`, find the `opts` parameter of `streamChatWithTools`. Add:

```typescript
opts: {
    // ... existing fields ...
    routingPreference?: 'auto' | 'local' | 'cloud';  // ADD
    schema?: SchemaTable[];                             // ADD (for local prompt)
    variablesForPrompt?: Record<string, unknown>;       // ADD (for local prompt)
}
```

- [ ] **Step 2: Apply routing before provider selection**

Inside `streamChatWithTools`, before the provider is resolved, add:

```typescript
import { routeMessage } from './routing';
import { buildLocalSystemPrompt, type SchemaTable } from './chatModes';

// After resolving tools and before selecting provider:
const hasLocalModel = !!(this.settings.localBaseUrl);
let resolvedProviderOverride = opts.providerOverride;

if (hasLocalModel && !resolvedProviderOverride) {
    const route = routeMessage(
        messages[messages.length - 1]?.content ?? '',
        tools,
        opts.visibility,
        opts.routingPreference ?? 'auto',
    );
    if (route === 'local') {
        resolvedProviderOverride = 'local';
        // Replace system prompt with local-tuned version
        if (opts.schema || opts.variablesForPrompt) {
            opts = {
                ...opts,
                customSystemPrompt: buildLocalSystemPrompt(
                    opts.schema ?? [],
                    opts.variablesForPrompt ?? {},
                ),
                replaceSystemPrompt: true,
                // local models only get read tools by default
                // (unless localToolAccess === 'full' in settings)
            };
        }
    }
}
// Use resolvedProviderOverride instead of opts.providerOverride below
```

> **Note:** Read the lines around provider resolution in `AiService.ts` (search for `providerOverride`) to find the exact place to insert this. The `opts` object may be immutable in the current code — create a local `resolvedOpts` copy instead of mutating `opts`.

- [ ] **Step 3: Restrict tools for local models**

When routing to local and `settings.localToolAccess !== 'full'`, filter out mutate tools:

```typescript
if (route === 'local' && this.settings.localToolAccess !== 'full') {
    tools = tools.filter(t => t.kind === 'read');
}
```

- [ ] **Step 4: Run existing tests**

```bash
cd core/frontend && npx vitest run
```
Expected: all existing tests pass — routing is only invoked when `localBaseUrl` is set, which isn't the case in test environments.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/services/AiService.ts
git commit -m "feat(chat): integrate routing layer into AiService - local model dispatch with tuned prompt"
```

---

### Task 4: Routing settings fields and UI

**Files:**
- Modify: `core/frontend/context/SettingsContext.tsx`
- Modify: `core/frontend/components/SettingsModal.tsx`

- [ ] **Step 1: Add routing fields to `Settings`**

In `core/frontend/context/SettingsContext.tsx`, add to `Settings` interface:

```typescript
localModelName: string;                              // e.g. "qwen3:8b"
localRoutingPreference: 'auto' | 'local' | 'cloud'; // default 'auto'
localToolAccess: 'read-only' | 'full';              // default 'read-only'
```

In `defaultSettings`:

```typescript
localModelName: '',
localRoutingPreference: 'auto',
localToolAccess: 'read-only',
```

- [ ] **Step 2: Add local model section to `SettingsModal`**

In `core/frontend/components/SettingsModal.tsx`, find the existing local model settings (search for `localBaseUrl` or `Local`). Add the new fields below the existing `localBaseUrl` and `localApiKey` inputs:

```tsx
{/* Local model name */}
<div>
    <label className="text-xs text-slate-400 block mb-1">Local model name</label>
    <input
        value={localSettings.localModelName}
        onChange={e => setLocalSettings(s => ({ ...s, localModelName: e.target.value }))}
        placeholder="e.g. qwen3:8b, llama3.2:3b"
        className="w-full bg-gray-800 border border-gray-700 text-slate-300 text-xs rounded px-2 py-1.5"
    />
</div>

{/* Routing preference */}
<div>
    <label className="text-xs text-slate-400 block mb-1">Routing preference</label>
    <select
        value={localSettings.localRoutingPreference}
        onChange={e => setLocalSettings(s => ({ ...s, localRoutingPreference: e.target.value as any }))}
        className="w-full bg-gray-800 border border-gray-700 text-slate-300 text-xs rounded px-2 py-1"
    >
        <option value="auto">Auto (local for simple, cloud for complex)</option>
        <option value="local">Prefer local</option>
        <option value="cloud">Always cloud</option>
    </select>
</div>

{/* Tool access */}
<div>
    <label className="text-xs text-slate-400 block mb-1">Local model tool access</label>
    <select
        value={localSettings.localToolAccess}
        onChange={e => setLocalSettings(s => ({ ...s, localToolAccess: e.target.value as any }))}
        className="w-full bg-gray-800 border border-gray-700 text-slate-300 text-xs rounded px-2 py-1"
    >
        <option value="read-only">Read-only queries only</option>
        <option value="full">Full tools (including notebook edits)</option>
    </select>
</div>
```

- [ ] **Step 3: Run tests + manual check**

```bash
cd core/frontend && npx vitest run
```

Open Settings in the dev server. Verify the new local model fields appear correctly.

- [ ] **Step 4: Commit**

```bash
git add core/frontend/context/SettingsContext.tsx core/frontend/components/SettingsModal.tsx
git commit -m "feat(chat): add localModelName, localRoutingPreference, localToolAccess settings"
```

---

### Task 5: Routing toggle in chat header + fallback notice

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

- [ ] **Step 1: Add session routing override state**

In `ChatPanel.tsx`, add:

```typescript
const [sessionRouting, setSessionRouting] = useState<'auto' | 'local' | 'cloud'>('auto');
```

- [ ] **Step 2: Add routing toggle to header**

In the chat header (next to the model badge and visibility toggle added in Phase 2), add:

```tsx
{settings.localBaseUrl && (
    <div className="flex items-center gap-1 text-[10px]">
        {(['auto', 'local', 'cloud'] as const).map(r => (
            <button
                key={r}
                onClick={() => setSessionRouting(r)}
                className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                    sessionRouting === r
                        ? 'bg-violet-700/30 border-violet-600/40 text-violet-400'
                        : 'bg-transparent border-gray-700 text-gray-600 hover:text-gray-400'
                }`}
            >
                {r === 'local' ? '⚡' : r === 'cloud' ? '☁' : '⟳'} {r}
            </button>
        ))}
    </div>
)}
```

- [ ] **Step 3: Pass `routingPreference` to `streamChatWithTools`**

Find every call to `aiService.streamChatWithTools` in `ChatPanel.tsx`. Add to the opts:

```typescript
routingPreference: sessionRouting,
schema: /* pass the schema from DataContext or props — check how schema is currently accessed in ChatPanel */,
variablesForPrompt: metadata?.variables ?? {},
```

> **Note:** Search `ChatPanel.tsx` for `SchemaBundle` or `schema` to find how schema is currently passed in. It may come from a prop or a context — use the same source.

- [ ] **Step 4: Add fallback notice when local model fails**

In `AiService.streamChatWithTools`, when the routing chose `'local'` but the `LocalAiProvider` throws or times out, catch the error and:

1. Yield a synthetic text chunk: `{ kind: 'text', delta: '\n\n*Local model unavailable — switching to cloud.*\n\n' }`
2. Retry the same call with `resolvedProviderOverride = undefined` (cloud)

In `AiService.ts`, wrap the local provider call:

```typescript
try {
    yield* localProvider.streamChatWithTools(messages, tools, localOpts);
} catch (localErr) {
    yield { kind: 'text', delta: '\n\n*Local model unavailable — switching to cloud for this message.*\n\n' };
    yield* cloudProvider.streamChatWithTools(messages, tools, cloudOpts);
}
```

> **Note:** The exact provider resolution pattern in `AiService.ts` may differ. Read lines 470–540 again if needed and adapt the try/catch to the actual control flow.

- [ ] **Step 5: Update model badge to show actual route**

The model badge currently shows `settings.aiProvider`. Update it to show which provider was actually used for the last message. Add state:

```typescript
const [lastRouteUsed, setLastRouteUsed] = useState<'local' | 'cloud' | null>(null);
```

After each `streamChatWithTools` call completes, set this based on what was actually used. Display in the badge:

```tsx
<span className="bg-[#1e2433] text-cyan-400 text-[10px] px-2 py-0.5 rounded-full border border-cyan-400/20">
    {lastRouteUsed === 'local'
        ? `⚡ ${settings.localModelName || 'local'}`
        : lastRouteUsed === 'cloud'
        ? `☁ ${settings.aiProvider}`
        : `${settings.aiProvider}`}
</span>
```

- [ ] **Step 6: Run full test suite**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx core/frontend/services/AiService.ts
git commit -m "feat(chat): routing toggle in header, fallback notice, model badge shows actual route"
```

---

### Task 6: Integration and streaming tests

**Files:**
- Create: `core/frontend/tests/ai/localModel.test.ts`

**Context:** These tests use a real Node `http.createServer` mock that speaks the OpenAI streaming SSE format. The `LocalAiProvider` connects to `http://localhost:<port>/v1`. We start the server before the test suite, stop it after. No external dependencies needed beyond Node's built-in `http`.

- [ ] **Step 1: Write the test file**

Create `core/frontend/tests/ai/localModel.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { LocalAiProvider } from '../../services/ai/LocalAiProvider';
import { splitCellFences, parseCellFence } from '../../components/chat/ChatEmbeddedCell';

// ── Mock OpenAI-compatible SSE server ─────────────────────────────────────────

function sseChunk(delta: string, done = false): string {
    if (done) return 'data: [DONE]\n\n';
    const payload = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [{ delta: { content: delta }, finish_reason: null, index: 0 }],
    });
    return `data: ${payload}\n\n`;
}

function startMockServer(responseChunks: string[], statusCode = 200): Promise<{ server: http.Server; port: number }> {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            res.writeHead(statusCode, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            });
            if (statusCode !== 200) { res.end(); return; }
            for (const chunk of responseChunks) res.write(chunk);
            res.write(sseChunk('', true)); // [DONE]
            res.end();
        });
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as any).port;
            resolve({ server, port });
        });
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalAiProvider streaming', () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
        ({ server, port } = await startMockServer([
            sseChunk('Hello '),
            sseChunk('world'),
            sseChunk('!'),
        ]));
    });

    afterAll(() => server.close());

    it('streams text chunks and assembles full response', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        const chunks: string[] = [];
        for await (const chunk of provider.streamChatWithTools!(
            [{ role: 'user', content: 'hi' }],
            [],
            { systemInstruction: 'You are helpful.' },
        )) {
            if (chunk.kind === 'text') chunks.push(chunk.delta);
        }
        expect(chunks.join('')).toBe('Hello world!');
    });
});

describe('LocalAiProvider streaming — cell fence detection', () => {
    let server: http.Server;
    let port: number;

    const cellResponse = [
        sseChunk('Here is the data:\n'),
        sseChunk(':::cell type=table\n'),
        sseChunk('sql: SELECT 1 AS n\n'),
        sseChunk(':::\n'),
        sseChunk('Done.'),
    ];

    beforeAll(async () => {
        ({ server, port } = await startMockServer(cellResponse));
    });
    afterAll(() => server.close());

    it('full streamed response contains the cell fence', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        let full = '';
        for await (const chunk of provider.streamChatWithTools!(
            [{ role: 'user', content: 'show me' }],
            [],
        )) {
            if (chunk.kind === 'text') full += chunk.delta;
        }
        expect(full).toContain(':::cell type=table');
        expect(full).toContain('sql: SELECT 1 AS n');
    });

    it('splitCellFences correctly parses the assembled response', async () => {
        const text = 'Here is the data:\n:::cell type=table\nsql: SELECT 1 AS n\n:::\nDone.';
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(1);
        const cell = parts.find(p => p.kind === 'cell')!;
        const parsed = parseCellFence(cell.content);
        expect(parsed?.type).toBe('table');
        expect(parsed?.sql).toBe('SELECT 1 AS n');
    });
});

describe('LocalAiProvider — 503 fallback detection', () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
        ({ server, port } = await startMockServer([], 503));
    });
    afterAll(() => server.close());

    it('throws when server returns 503', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        await expect(async () => {
            for await (const _ of provider.streamChatWithTools!(
                [{ role: 'user', content: 'hi' }],
                [],
            )) { /* consume */ }
        }).rejects.toThrow();
    });
});

describe(':::cell fence round-trip', () => {
    it('parses multiple fences interleaved with text', () => {
        const text = [
            'First chart:',
            ':::cell type=chart',
            'sql: SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket',
            'plot: LINE_CHART(x: "bucket", y: ["p"])',
            ':::',
            'And a table:',
            ':::cell type=table',
            'sql: SELECT * FROM gc LIMIT 10',
            ':::',
            'Done.',
        ].join('\n');

        const parts = splitCellFences(text);
        const cells = parts.filter(p => p.kind === 'cell');
        expect(cells).toHaveLength(2);

        const chart = parseCellFence(cells[0].content);
        expect(chart?.type).toBe('chart');
        expect(chart?.plotConfig).toBe('LINE_CHART(x: "bucket", y: ["p"])');

        const table = parseCellFence(cells[1].content);
        expect(table?.type).toBe('table');
        expect(table?.sql).toContain('SELECT * FROM gc');
    });

    it('text parts preserve surrounding content', () => {
        const text = 'Before\n:::cell type=table\nsql: SELECT 1\n:::\nAfter';
        const parts = splitCellFences(text);
        const texts = parts.filter(p => p.kind === 'text').map(p => p.content);
        expect(texts[0]).toContain('Before');
        expect(texts[1]).toContain('After');
    });
});

describe('routing + system prompt integration', () => {
    it('buildLocalSystemPrompt + routeMessage are consistent — local route uses local prompt', () => {
        // Just a smoke-test that both imports work and produce coherent output
        const { buildLocalSystemPrompt } = require('../../services/ai/chatModes');
        const { routeMessage } = require('../../services/ai/routing');

        const route = routeMessage('show gc pauses', [], 'no-data', 'auto');
        expect(route).toBe('local');

        const prompt = buildLocalSystemPrompt(
            [{ name: 'GarbageCollection', columns: [{ name: 'duration' }] }],
            { threshold: 20 },
        );
        expect(prompt).toContain('GarbageCollection');
        expect(prompt).toContain('threshold');
    });
});
```

- [ ] **Step 2: Run to verify tests pass**

```bash
cd core/frontend && npx vitest run tests/ai/localModel.test.ts
```
Expected: all tests pass. If `LocalAiProvider` constructor or `streamChatWithTools` signature differs from what's shown, adjust the calls to match the actual API (read `services/ai/LocalAiProvider.ts` lines 1–60 to verify).

- [ ] **Step 3: Run full test suite**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add core/frontend/tests/ai/localModel.test.ts
git commit -m "test(chat): add local model integration tests - streaming, cell fence round-trip, 503 fallback"
```

---

### Task 7: End-to-end manual test with a real local model

This task verifies the full Phase 3 flow with an actual Ollama or llama.cpp instance.

- [ ] **Step 1: Configure a local model**

If Ollama is installed:
```bash
ollama serve  # start if not running
ollama pull qwen2.5:3b  # or any model
```

In the app Settings:
- Local model URL: `http://localhost:11434/v1`
- Local model name: `qwen2.5:3b` (or your model)
- Routing preference: `Auto`

- [ ] **Step 2: Test auto-routing**

Load a JFR file. Send a short message: `"what is the average GC pause?"`.

Verify:
- Model badge shows `⚡ qwen2.5:3b` (local)
- Response streams in token by token
- Answer is concise and relevant

- [ ] **Step 3: Test cloud routing**

Switch the session routing toggle to `☁ cloud`. Send the same message.

Verify:
- Model badge shows `☁ <cloud provider>`
- Full visibility toggle works — switching to `👁 full` also routes to cloud automatically in `auto` mode

- [ ] **Step 4: Test cell fence with local model**

Send: `"show me GC pause distribution as a histogram"`.

Verify:
- Local model emits a `:::cell type=chart` fence
- Chart renders inside the bubble
- "↗ Add to notebook" works

- [ ] **Step 5: Test fallback**

Stop Ollama (`pkill ollama`). Send a message.

Verify:
- Fallback notice appears: `"Local model unavailable — switching to cloud"`
- Cloud provider responds normally
- Model badge shows `☁ cloud (fallback)`

- [ ] **Step 6: Final full test run**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

---

### Task 8: In-browser model graceful degradation

**Files:**
- Modify: `core/frontend/services/ai/routing.ts`
- Modify: `core/frontend/services/AiService.ts`
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** `BrowserModelProvider` (the in-process ONNX model) does not implement `streamChatWithTools` — it only supports basic completion. When the in-browser model is active, chat must degrade gracefully: no tools, no `:::cell` fences expected, schema-only context, and a header notice. The user can still ask questions about JFR concepts and schema structure.

- [ ] **Step 1: Add browser routing target**

In `core/frontend/services/ai/routing.ts`, update `RouteTarget` to include `'browser'`:

```typescript
export type RouteTarget = 'local' | 'cloud' | 'browser';
```

Update `routeMessage` to return `'browser'` when the user's routing preference is `'browser'` or when no local/cloud provider is configured and the browser model is available:

```typescript
if (userPreference === 'browser') return 'browser';
if (!hasLocalModel && !hasCloudModel && hasBrowserModel) return 'browser';
```

The `routeMessage` signature gains two boolean parameters:

```typescript
export function routeMessage(
    message: string,
    tools: Tool[],
    visibility: VisibilityMode,
    userPreference: RoutingPreference = 'auto',
    hasLocalModel = false,
    hasCloudModel = true,
    hasBrowserModel = false,
): RouteTarget
```

- [ ] **Step 2: Update routing tests for browser target**

In `core/frontend/tests/ai/routing.test.ts`, add:

```typescript
it('returns browser when preference is browser', () => {
    expect(routeMessage('hi', [], 'no-data', 'browser', false, true, true)).toBe('browser');
});

it('returns browser when no other providers configured and browser available', () => {
    expect(routeMessage('hi', [], 'no-data', 'auto', false, false, true)).toBe('browser');
});
```

Run:
```bash
cd core/frontend && npx vitest run tests/ai/routing.test.ts
```
Expected: all tests pass.

- [ ] **Step 3: Wire browser path in `AiService`**

In `core/frontend/services/AiService.ts`, in the routing block (added in Task 3), handle `route === 'browser'`:

```typescript
if (route === 'browser') {
    // BrowserModelProvider doesn't support tool calls or cell fences.
    // Use basic streamChat with a stripped system prompt (schema only, no tools section).
    const browserSystemPrompt = buildBrowserSystemPrompt(opts.schema ?? [], opts.variablesForPrompt ?? {});
    yield* this.browserProvider.streamChat(messages, { systemInstruction: browserSystemPrompt });
    return;
}
```

Add `buildBrowserSystemPrompt` to `chatModes.ts`:

```typescript
export function buildBrowserSystemPrompt(
    schema: SchemaTable[],
    variables: Record<string, unknown>,
): string {
    const tableList = schema.map(t => `- ${t.name}(${t.columns.map(c => c.name).join(', ')})`).join('\n');
    const varList = Object.keys(variables).length > 0
        ? `Current variables: ${Object.entries(variables).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`
        : '';

    return `You are a JFR performance analyst. Answer questions about JFR data concepts, schema, and analysis strategies.
You cannot query data directly in this mode.

Available tables:
${tableList}
${varList}

Be concise and helpful. Suggest SQL queries the user can run themselves.`.trim();
}
```

- [ ] **Step 4: Add browser notice to chat header in `ChatPanel`**

In `core/frontend/components/ChatPanel.tsx`, detect when the browser model is the active route. Add a notice to the header:

```tsx
{lastRouteUsed === 'browser' && (
    <span className="text-[10px] text-amber-400/70 px-2 py-0.5 rounded border border-amber-700/30">
        In-browser mode — data queries unavailable
    </span>
)}
```

Update the routing preference options in the session toggle (from Task 5) to include `'browser'`:

```tsx
{(['auto', 'local', 'cloud', 'browser'] as const).map(r => (
    <button key={r} ...>
        {r === 'local' ? '⚡' : r === 'cloud' ? '☁' : r === 'browser' ? '🧠' : '⟳'} {r}
    </button>
))}
```

Only show `browser` option when `BrowserModelProvider` is available (check `settings.useLocalModel === true` or equivalent browser model flag — read `SettingsContext` to find the correct field).

- [ ] **Step 5: Run full test suite**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Manual test with browser model**

Switch routing to `🧠 browser` in the chat header.

Verify:
- Header shows "In-browser mode — data queries unavailable"
- Sending a message like "what tables are available?" returns a schema-based answer
- No `:::cell` fences appear in responses
- No permission card appears (tools are suppressed)

- [ ] **Step 7: Commit**

```bash
git add core/frontend/services/ai/routing.ts core/frontend/services/ai/chatModes.ts core/frontend/services/AiService.ts core/frontend/components/ChatPanel.tsx core/frontend/tests/ai/routing.test.ts
git commit -m "feat(chat): add in-browser model path with graceful degradation - schema-only, no tools"
```
