# Chat "Good Pal" Upgrade — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing chat panel into a rich, conversational JFR analyst that embeds live visualizations inline, streams answers token-by-token, automatically retries failed queries with error feedback, can run its own queries and call tools with user permission, works equally well with local and remote models, and integrates fully with notebook variables and cells. The AI is a genuinely helpful performance analyst — it proactively suggests next steps, explains what it finds, and iterates autonomously when something goes wrong.

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

### Streaming

AI responses stream token-by-token into the bubble as they arrive — text appears incrementally, cell fences are detected and rendered as soon as the closing `:::` arrives. A blinking cursor shows at the end of the current streaming position. The embedded cell executes its query as soon as the fence is complete, so the chart or table renders while the AI is still writing the text below it.

### Error feedback loop (automatic retry)

When an embedded cell fails to execute (SQL error, missing table, bad plot config) or when a `query_data` result is empty:

1. The error is shown inside the cell — a red inline notice with the DuckDB error message
2. The error is automatically fed back to the AI as a follow-up system message: `"The query failed: <error>. Please fix the SQL and try again."`
3. The AI retries up to **2 times** autonomously — no user action needed
4. If still failing after 2 retries, the cell shows the final error and a `"Ask AI to fix"` button that re-prompts manually
5. Same loop applies to tool calls that return errors — the tool result includes the error string and the AI can correct its arguments

### Tool calls in chat

The full tool call loop is available in chat (already implemented in `AiService.streamChatWithTools`):

- AI can call `query_data`, `add_cell`, `update_cell`, `delete_cell`, `set_variable` in a single turn
- Tool results stream back into the conversation and the AI continues generating after each result
- Multiple sequential tool calls in one response are supported (e.g. query → inspect result → embed chart)
- Permission cards appear inline for gated tools; ungated tools (like `set_variable`) run immediately

---

## Phase 2 — AI-Initiated Queries + Permission System

### Permission model: upfront gate, then autonomous execution

Permissions are checked **once per session** (or pre-granted globally), not per tool call. Once the user grants access, the AI runs its full think→query→think→query loop without interruption.

**Permission levels (per action type):**
- `'ask'` (default): a permission card appears on the *first* tool call of that type in the session. The user approves or denies. If approved, the rest of the session runs without prompting.
- `'always'` (global setting): no card ever shown — tool calls execute immediately.
- `'never'` (global setting): tool calls of that type are auto-denied; the AI is told it cannot use them and responds gracefully.

This means: if the user clicked "Allow all queries" once this session, every subsequent `query_data` call in the same session runs silently and autonomously. The AI can call it 10 times in a single response — exploring, refining, iterating — with no user action required.

**First-call permission card for `query_data`:**

```
┌─────────────────────────────────────────────────────┐
│ 🔍  Allow AI to query your data?                     │
│                                                      │
│  First query: Find top allocating classes            │
│  Tables: ObjectAllocationInNewTLAB, Thread           │
│                                                      │
│  [Allow for this session]  [Always allow]  [Deny]    │
└─────────────────────────────────────────────────────┘
```

- **Allow for this session**: runs this and all future `query_data` calls this session without prompting again. Resets on next session.
- **Always allow**: saves `aiPermQueryData = 'always'` to settings permanently. Never prompts again.
- **Deny**: auto-denies this and all future `query_data` calls this session. AI responds gracefully.

**First-call permission card for notebook mutations:**

```
┌─────────────────────────────────────────────────────┐
│ ✏️  Allow AI to modify your notebook?                 │
│                                                      │
│  First action: Add SQL cell after "GC Overview"      │
│                                                      │
│  [Allow for this session]  [Always allow]  [Deny]    │
└─────────────────────────────────────────────────────┘
```

### Autonomous iteration loop

When `query_data` is permitted, the AI uses the existing `AiService.streamChatWithTools` multi-round loop (already caps at 10 rounds) to:

1. Think about the question
2. Call `query_data` → get results silently
3. Inspect the results, decide if it needs more data
4. Call `query_data` again if needed
5. Compose a final answer with embedded cells

All of this happens without user interruption. The user sees a progress trace while it's running (see Trace view below).

### Trace view

While the AI is iterating, a collapsible **"Thinking…"** section appears above the final answer in the message bubble:

```
▶ Thinking  (3 queries · 1.2s)          ← collapsed by default, click to expand
──────────────────────────────────────
  🔍 queried GarbageCollection (14 rows)
  🔍 queried ExecutionSample (500 rows)
  🔍 queried ObjectAllocationInNewTLAB (200 rows)
──────────────────────────────────────
Here is what I found…                   ← final answer
```

Expanded view shows each tool call: tool name, SQL (truncated), row count returned, and duration. A "Show full trace" button reveals the complete SQL for each call.

The trace is stored on the `ChatMessage` as `meta.trace: TraceStep[]`:

```typescript
interface TraceStep {
  tool: string;          // 'query_data' | 'add_cell' | etc.
  args: any;             // full args
  result: any;           // full result
  durationMs: number;
  rowCount?: number;     // for query_data
}
```

The trace is always captured regardless of permission level and shown as a collapsed block. Users who want the full picture can expand it.

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
You are a JFR performance analyst embedded in a notebook tool. Be concise, direct, and genuinely helpful.
When you find something interesting, say so. Suggest the next useful question. Don't pad answers.

Available tables: {schema}
Current variables: {variables}

When a chart or table would make the answer clearer, embed it inline:
  :::cell type=chart
  sql: SELECT ...
  plot: LINE_CHART(x: "col", y: ["col2"])
  :::
Supported types: chart, table, flamegraph. Embed cells naturally within your answer — text can appear before and after.

If a query result is empty or an error is returned, fix the SQL and try again. Explain what you changed.

To query data you don't have, call the query_data tool with the SQL, a one-sentence reason, and the table names accessed.
You may call tools multiple times in one response — query, inspect the result, then embed a chart.

--- Examples ---
Q: What is the average GC pause?
A: Average GC pause is 14ms (p99: 48ms). Mostly short Young GC — looks healthy. Want a breakdown by GC type?

Q: Show me heap usage over time.
A: Heap grew steadily over the session — peaked at 2.4 GB around t=40s:
:::cell type=chart
sql: SELECT time_bucket('1s', ts) AS t, avg(heapUsed) AS heap_mb FROM gc_heap_summary GROUP BY t ORDER BY t
plot: LINE_CHART(x: "t", y: ["heap_mb"])
:::
No GC recovery after the peak — likely a retained reference. Want me to find the top allocating classes?

Q: Which methods are consuming the most CPU?
A: [calls query_data: sql=SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 20, reason="Find hot methods", tables=["ExecutionSample"]]
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
- **Streaming test**: mock server sends response in 10-character chunks, verify the assembled text matches expected and that `:::cell` fences trigger cell render at fence-close not at stream-end
- **Error retry test**: mock server returns a valid response containing a `:::cell` with bad SQL; verify the error is fed back as a system message and the AI is re-invoked; verify it stops after 2 retries and shows the "Ask AI to fix" button
- **Tool call loop test**: mock server returns a `query_data` tool call, then a follow-up text response; verify the full loop (tool call → permission → result → continuation) assembles the correct final message
- **Fallback test**: mock server returns 503, verify `AiService` retries with cloud provider and emits the fallback notice message
- **`:::cell` parse round-trip**: generate a response containing multiple cell fences interleaved with text, verify `ChatMarkdownView` parser extracts `type`, `sql`, `plotConfig` for each fence and leaves surrounding text intact

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

## In-Browser Model Compatibility

`BrowserModelProvider` (the in-process ONNX model) does not support `streamChatWithTools`. Chat with the in-browser model degrades gracefully:

- **No `query_data` tool**: tool calls are suppressed entirely; the system prompt omits the tool instructions section.
- **Schema-context-only answers**: the AI can reference schema and variable names but cannot query live data.
- **No `:::cell` fences expected**: the system prompt's few-shot examples are omitted; the AI responds with plain markdown text (possibly including code blocks, but no embedded chart/table cells).
- **Model badge**: shows `✦ browser · <model-name>` during in-browser inference.
- **Routing**: `BrowserModelProvider` is always selected if the user's routing preference is `'browser'` (new option), or if no local/cloud provider is configured.

The degraded experience is still useful for schema questions, JFR concept explanations, and general analysis discussion without live data. The user sees a notice in the chat header: `"In-browser mode — data queries unavailable"`.

---

## Out of Scope

- No new ONNX model for chat — local chat uses the configured OpenAI-compatible server (or existing BrowserModelProvider in degraded mode)
- No UI for conversation history export
- No multi-turn context compression (existing truncation behaviour unchanged)
