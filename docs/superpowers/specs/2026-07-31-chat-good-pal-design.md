# Chat "Good Pal" Upgrade — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing chat panel into a rich, conversational JFR analyst that embeds live visualizations inline, can run its own queries with user permission, works equally well with local and remote models, and integrates fully with notebook variables and cells.

**Architecture:** Three phased deliveries — (1) visual refresh + embedded cells, (2) AI-initiated queries + data access with permissions, (3) local model routing as a first-class path. Each phase ships independently and improves the experience on its own.

**Tech Stack:** React + Tailwind, existing `AiService`/`IAiProvider` stack, `PlotRenderer`, `DataTable`, DuckDB via `DataContext`, existing `onUndoLastAction` / `onAddCell` / `onUpdateCell` callbacks.

---

## Phase 1 — Visual Refresh + Embedded Cells

### Visual design

- **Background**: darken from `bg-gray-900` (`#1a202c`) to `#0f1117`
- **AI bubbles**: `bg-gray-800` → `#161b27`, border `#1e2d3d`, asymmetric radii (`rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-xl`)
- **User bubbles**: `bg-cyan-600` → `#1e3a4a` with `border border-cyan-700/30`, asymmetric radii (`rounded-tl-xl rounded-tr-sm rounded-br-xl rounded-bl-xl`)
- **AI avatar**: 22×22 gradient circle (`from-violet-600 to-cyan-400`) with "AI" label, sits left of each AI bubble
- **Inline code**: `<code>` values styled as `bg-gray-950 text-cyan-400 px-1 rounded text-[11px]`
- **Input area**: unified rounded card `bg-gray-900 border border-gray-800 rounded-xl px-3 py-2`, single `⏎` send button with gradient
- **Header**: chat title left, model badge right — `bg-gray-900 text-cyan-400 text-[10px] px-2 py-0.5 rounded-full border border-cyan-400/20` showing provider name + `✦ local` or `✦ cloud`

### Embedded cell format

AI responses may contain one or more embedded cell fences interleaved with markdown text:

```
:::cell type=chart
sql: SELECT ...
plot: LINE_CHART(x: "bucket", y: ["avg_pause"])
:::
```

```
:::cell type=table
sql: SELECT ...
:::
```

```
:::cell type=flamegraph
sql: SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 500
:::
```

Supported types: `chart`, `table`, `flamegraph`, `sql` (raw results only).

**`ChatMarkdownView`** detects `:::cell` fences during render, replaces them with a `<ChatEmbeddedCell>` component. Everything outside fences renders as normal markdown.

### `ChatEmbeddedCell` component

`components/chat/ChatEmbeddedCell.tsx` — props:

```typescript
interface ChatEmbeddedCellProps {
  type: 'chart' | 'table' | 'flamegraph' | 'sql';
  sql: string;
  plotConfig?: string;       // for type=chart
  onAddToNotebook: () => void;
}
```

Behaviour:
- Renders a cell header bar: type badge (e.g. `FLAME GRAPH`) + truncated SQL label + `↗ Add to notebook` button
- Executes `sql` via `DataContext.query()` on mount
- For `type=chart`: passes result to `PlotRenderer` with `plotConfig`
- For `type=table` / `type=sql`: passes result to `DataTable`, max-height `200px` with scroll, row count footer
- For `type=flamegraph`: passes result to `FlameGraphPlot`
- `↗ Add to notebook` calls `onAddToNotebook` which triggers the existing `onAddCellFromAI` callback

### Variables in chat

- System prompt always includes current variable snapshot via the existing `variablesSystemPromptLine()` helper
- AI-generated SQL may reference variables as `$varName` — the cell executor substitutes them before running (same as notebook cells)
- The AI can also mutate variables via the existing `variables` tool (already wired, needs to remain available in chat mode)

---

## Phase 2 — AI-Initiated Queries + Permission System

### `query_data` tool

New tool added to `services/ai/tools/`:

```typescript
name: 'query_data',
description: 'Run a SQL query against the JFR session. Always show the user which tables you will access before running.',
parameters: {
  sql: string,        // the SQL to execute
  reason: string,     // one sentence: why this query answers the question
  tables: string[],   // list of table names the query accesses (for the permission card)
}
```

This tool is **always gated by the permission system** — it never executes silently.

### Permission card (`ChatPermissionCard`)

`components/chat/ChatPermissionCard.tsx` — appears inline in the chat when the AI emits a `query_data` or notebook-mutation tool call:

```
┌─────────────────────────────────────────────────────┐
│ 🔍  Run query?                                       │
│                                                      │
│  Reason: Find top allocating classes                 │
│  Tables accessed: ObjectAllocationInNewTLAB, Thread  │
│                                                      │
│  SELECT class_name, sum(alloc_size) AS total         │
│  FROM ObjectAllocationInNewTLAB                      │
│  GROUP BY class_name ORDER BY total DESC LIMIT 20    │
│                                                      │
│  [Allow]  [Allow all queries]  [Deny]                │
└─────────────────────────────────────────────────────┘
```

- **Allow**: runs this query, returns result to AI, continues conversation
- **Allow all queries**: sets `permissions.queryData = 'always'` in session state only — never prompts again for `query_data` this session, but resets on next session. For a permanent setting, use the AI Permissions panel in Settings.
- **Deny**: returns a denial result to the AI so it can respond gracefully ("I don't have access to run queries — here's what I know from context instead")

For notebook mutations (`add_cell`, `update_cell`, `delete_cell`):

```
┌─────────────────────────────────────────────────────┐
│ ✏️  Modify notebook?                                  │
│                                                      │
│  Action: Add SQL cell after "GC Overview"            │
│  Content: SELECT gc_type, avg(pause_ms)…             │
│                                                      │
│  [Allow]  [Allow all edits]  [Deny]                  │
└─────────────────────────────────────────────────────┘
```

### Global permissions (Settings)

New section in `SettingsModal` — **AI Permissions**:

| Setting | Default | Description |
|---------|---------|-------------|
| Allow query execution | Ask every time | Never / Ask / Always |
| Allow cell creation | Ask every time | Never / Ask / Always |
| Allow cell edits | Ask every time | Never / Ask / Always |
| Allow cell deletion | Ask every time | Never / Ask / Always |
| Share query results with AI | Sanitized | None / Sanitized / Full |

`SettingsContext` gains: `aiPermQueryData`, `aiPermAddCell`, `aiPermUpdateCell`, `aiPermDeleteCell` — each typed `'never' | 'ask' | 'always'`. Existing `aiDefaultVisibility` covers data sharing.

### Revert / undo

Every AI-initiated notebook mutation goes through `onBeforeMutate()` before executing, which flushes the history debounce and creates a discrete undo step. The existing `onUndoLastAction` callback is wired to a persistent **Revert last AI action** button that appears in the chat header whenever the AI has mutated the notebook in the current session. Clicking it calls `onUndoLastAction()` and shows a toast confirming the revert.

### Data access and visibility

The existing `aiDefaultVisibility` ('no-data' | 'sanitized' | 'full') controls what result data is included in the AI context. A **per-session override toggle** appears in the chat header:

```
[🔒 No data]  [~ Sanitized]  [👁 Full]    ← current active, clickable
```

This overrides the global setting for the current chat session only. The AI always sees the schema regardless of visibility level.

---

## Phase 3 — Local Model Routing

### Routing logic

When a local model is configured (`settings.localBaseUrl` is set), the chat uses a routing layer before each request:

```typescript
function routeMessage(msg: string, tools: Tool[], visibility: VisibilityMode): 'local' | 'cloud' {
  // Always cloud if: tool calls expected that need strong reasoning,
  // full data visibility requested, or message is complex (>200 chars)
  if (visibility === 'full') return 'cloud';
  if (tools.some(t => t.name === 'query_data' || t.name === 'add_cell')) return 'cloud';
  if (msg.length > 200) return 'cloud';
  return 'local';
}
```

User can override routing per-session via a toggle in the chat header: `[⚡ local]` / `[☁ cloud]` / `[auto]`.

### Local model quality

To make local models as capable as possible:

- **Dedicated system prompt** (`localSystemPrompt` in `chatModes.ts`): shorter and more directive than the cloud prompt. Local models degrade with long system prompts — the local variant strips optional fluff and leads with the most critical instructions. Structured as: role → JFR context → output format → `:::cell` fence syntax → tool usage rules.
- **Schema injection**: full schema always included regardless of visibility setting — local models benefit more from explicit table/column context than cloud models, and schema contains no user data.
- **Few-shot examples**: 3 concrete Q→A pairs prepended to the system prompt showing: (1) a plain text answer, (2) an answer with an inline `:::cell` chart, (3) an answer that calls `query_data`. Format mirrors expected output exactly so the model can pattern-match reliably.
- **Tool subset**: local models get `query_data` only by default — notebook mutations (add/edit/delete cell) route to cloud. Rationale: mutations require stronger reasoning about cell ordering and content; small local models hallucinate here. Configurable via `localToolAccess` setting.
- **Temperature**: local requests use `temperature: 0.1` (deterministic, reduces hallucinated SQL and cell fence syntax errors)
- **Streaming**: fully supported via existing `LocalAiProvider`
- **Model badge**: shows `✦ local · <model-name>` during local inference

### Local model system prompt (template)

```
You are a JFR performance analyst embedded in a notebook tool.
The user has loaded a Java Flight Recording. Answer questions about it concisely and precisely.

Available tables: {schema}
Current variables: {variables}

When a chart or table would make the answer clearer, embed it using:
  :::cell type=chart
  sql: SELECT ...
  plot: LINE_CHART(x: "col", y: ["col2"])
  :::
or :::cell type=table / :::cell type=flamegraph

To query data you don't have, call the query_data tool with the SQL, a one-sentence reason, and the table names accessed.

--- Examples ---
Q: What is the average GC pause?
A: The average GC pause is 14ms. (queried from GarbageCollection.duration)

Q: Show me heap usage over time.
A: Here is heap usage over the session:
:::cell type=chart
sql: SELECT time_bucket('1s', ts) AS t, avg(heapUsed) AS heap_mb FROM gc_heap_summary GROUP BY t ORDER BY t
plot: LINE_CHART(x: "t", y: ["heap_mb"])
:::
Heap peaks at 2.4 GB around the 40s mark.

Q: Which methods are consuming the most CPU?
A: [calls query_data tool with sql=SELECT stackTrace, sum(samples)... reason="Find hot methods" tables=["ExecutionSample"]]
```

### Local model testing

A new test file `tests/ai/localModel.test.ts` covers:

- **Routing unit tests**: `routeMessage()` returns correct provider for all combinations of message length, tool list, visibility setting, and user override
- **System prompt tests**: `buildLocalSystemPrompt(schema, variables)` produces output that:
  - Contains all table names from schema
  - Contains all variable names
  - Contains at least one `:::cell` example
- **Few-shot format tests**: the 3 example pairs parse correctly as valid chat turns
- **Mock server integration test**: spins up a minimal OpenAI-compatible mock server (using `msw` or a simple `http.createServer`), sends a chat message through `LocalAiProvider`, verifies streaming chunks arrive and the full response assembles correctly
- **Fallback test**: mock server returns 503, verify `AiService` retries with cloud provider and emits the fallback notice message
- **`:::cell` parse round-trip**: generate a response containing cell fences, verify `ChatMarkdownView` parser extracts `type`, `sql`, `plotConfig` correctly

### Local model settings (Settings panel additions)

| Field | Description |
|-------|-------------|
| Local model URL | e.g. `http://localhost:11434/v1` (Ollama default) |
| Local model name | e.g. `qwen3:8b`, `llama3.2:3b` |
| Max tokens (local) | Already exists (`localMaxTokens`) |
| Routing preference | Auto / Prefer local / Always cloud |
| Local tool access | Read-only queries only / Full tools |

### Fallback behaviour

If the local model times out (>30s) or returns an error:
- Show a non-blocking notice in the chat: `"Local model unavailable — switching to cloud for this message"`
- Retry the same message with the cloud provider
- The model badge updates to show `☁ cloud (fallback)`

---

## File Map

### New files
- `components/chat/ChatEmbeddedCell.tsx` — renders a live cell (chart/table/flamegraph) inside a chat bubble
- `components/chat/ChatPermissionCard.tsx` — inline approval card for query/mutation tool calls
- `services/ai/tools/queryData.ts` — `query_data` tool definition + handler
- `services/ai/routing.ts` — local vs cloud routing logic
- `tests/ai/localModel.test.ts` — routing unit tests, system prompt tests, mock server integration, fallback, cell fence parse round-trip

### Modified files
- `components/chat/ChatMarkdownView.tsx` — detect + render `:::cell` fences
- `components/ChatPanel.tsx` — new visual layout, model badge, session visibility toggle, revert button
- `context/SettingsContext.tsx` — add `aiPermQueryData`, `aiPermAddCell`, `aiPermUpdateCell`, `aiPermDeleteCell`, `localRoutingPreference`, `localToolAccess`
- `components/SettingsModal.tsx` — new AI Permissions section, local model routing settings
- `services/ai/chatModes.ts` — inject few-shot examples for local model system prompt, add `localSystemPrompt` variant
- `services/AiService.ts` — integrate routing layer before provider dispatch

### Unchanged
- `PlotRenderer`, `DataTable`, `FlameGraphPlot` — reused as-is inside `ChatEmbeddedCell`
- `LocalAiProvider` — already complete, no changes needed
- `onUndoLastAction`, `onBeforeMutate` callbacks — already wired in App.tsx

---

## Out of Scope

- BrowserModelProvider is not used for chat (offline only, no chat support)
- No new ONNX model for chat — local chat uses the configured OpenAI-compatible server
- No UI for conversation history export
- No multi-turn context compression (existing truncation behaviour unchanged)
