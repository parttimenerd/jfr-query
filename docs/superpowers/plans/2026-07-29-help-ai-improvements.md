# Help & AI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve discoverability and quality of AI features and help content across four work streams: AI mode cards in Settings, column-aware completion validation, two new agent tools (`explainCell` / `suggestPlot`), and PlotHelpModal search + cheat sheet + onboarding cell.

**Architecture:** Four independent tasks, each self-contained. Streams 1 (hover/lint) and 3 (Fix with AI) were found already implemented during planning; only the genuinely missing pieces are listed below. No new context providers needed.

**Tech Stack:** React 18, TypeScript, Vitest, CodeMirror 6, Tailwind CSS (dark theme classes)

---

## Pre-task: Run the existing test suite

Before changing anything, verify the baseline passes.

- [ ] **Step 1: Run tests**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass (no failures).

---

## Task 1: AI mode cards in SettingsModal

Adds three informational cards to `SettingsModal.tsx` explaining how to invoke each AI entry point (ghost-text, inline chat, command palette). Cards are muted when AI is not configured.

**Files:**
- Modify: `core/frontend/components/SettingsModal.tsx`

### Context

`SettingsModal.tsx` already has: provider selection, API key input with a "Test" button (`handleTestKey`), and model configuration. The AI mode cards go in the same AI settings section, below the existing provider/key fields but above the model selectors.

The `localSettings.aiProvider` field holds the active provider (`'browser' | 'google' | 'openai' | 'anthropic' | 'gardener' | 'local'`). When the provider is `'browser'`, it's always "active" (no key needed). For other providers, AI is active if the corresponding API key field has a value.

The section containing the Test button ends around line 270. Look for the comment `{/* Local-only: max_tokens cap */}` — insert the mode cards section just above the model selectors block.

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/settingsModal.aiModeCards.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Minimal stub for the mode cards — test the pure logic/rendering of the
// AiModeCards component once it's extracted, or just test the content rendered
// by SettingsModal. We'll test the card labels are present when AI is active.

// Import the component we're about to create:
import { AiModeCards } from '../../components/SettingsModal';

describe('AiModeCards', () => {
    it('renders all three mode labels', () => {
        render(<AiModeCards isAiActive={true} />);
        expect(screen.getByText('Ghost-text')).toBeTruthy();
        expect(screen.getByText('Inline chat')).toBeTruthy();
        expect(screen.getByText('Command palette')).toBeTruthy();
    });

    it('applies muted styling when AI is not active', () => {
        const { container } = render(<AiModeCards isAiActive={false} />);
        // The wrapper div should carry the opacity-50 class when inactive.
        expect(container.firstChild).toHaveClass('opacity-50');
    });

    it('does not apply muted styling when AI is active', () => {
        const { container } = render(<AiModeCards isAiActive={true} />);
        expect(container.firstChild).not.toHaveClass('opacity-50');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/settingsModal.aiModeCards.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `AiModeCards` not exported from `SettingsModal`.

- [ ] **Step 3: Add AiModeCards component to SettingsModal.tsx**

In `core/frontend/components/SettingsModal.tsx`, add this exported component near the top of the file (after existing imports, before the main component):

```typescript
export const AiModeCards: React.FC<{ isAiActive: boolean }> = ({ isAiActive }) => (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${isAiActive ? '' : 'opacity-50'}`}>
        {[
            {
                label: 'Ghost-text',
                shortcut: 'Tab to accept',
                desc: 'Inline completion appears as you type in SQL and Plot cells.',
            },
            {
                label: 'Inline chat',
                shortcut: '⌘K / Ctrl+K',
                desc: 'Context-aware chat attached to any cell. Understands your data schema.',
            },
            {
                label: 'Command palette',
                shortcut: '⌘⇧P → >',
                desc: 'Type > in the command palette for freeform AI actions across the notebook.',
            },
        ].map(({ label, shortcut, desc }) => (
            <div key={label} className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-1">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200">{label}</span>
                    <kbd className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono">{shortcut}</kbd>
                </div>
                <p className="text-xs text-gray-400">{desc}</p>
            </div>
        ))}
    </div>
);
```

Then, inside the main `SettingsModal` component, find the section that renders the API key / Test button block. Just below where the model selectors begin (search for the `{/* Local-only: max_tokens cap */}` comment, or the `autocompleteModelOverride` block — it's around line 470), add the cards:

```tsx
{/* AI entry-point mode cards */}
<div>
    <label className="block text-sm font-medium text-gray-300 mb-2">AI Entry Points</label>
    <AiModeCards isAiActive={
        localSettings.aiProvider === 'browser' ||
        !!(localSettings as any)[`${localSettings.aiProvider}ApiKey`]
    } />
</div>
```

The `isAiActive` expression is `true` for the browser provider (no key needed) and `true` for any other provider when its API key field is non-empty.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd core/frontend && npx vitest run tests/settingsModal.aiModeCards.test.tsx 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add core/frontend/components/SettingsModal.tsx core/frontend/tests/settingsModal.aiModeCards.test.tsx
git commit -m "feat(settings): add AI mode cards to SettingsModal"
```

---

## Task 2: Column-aware completion validation

After the AI returns a plot ghost-text suggestion, strip it if it contains identifiers that don't appear in the current cell's result schema. This prevents the model from hallucinating column names.

**Files:**
- Modify: `core/frontend/components/editor/aiAutocomplete/index.ts`
- Modify: `core/frontend/components/editor/plot/aiPlotContext.ts` (tighten prompt instruction)
- Test: `core/frontend/tests/columnValidation.test.ts`

### Context

`core/frontend/components/editor/aiAutocomplete/index.ts` calls `aiService.getPlotSuggestion(...)` and dispatches the result as ghost text. The `cellResultSchema` (array of `{ name: string; type: string }`) is available via `deps.getCellResultSchema?.()` (line ~69 of that file) and is already threaded into the context builder.

The validation runs on the raw suggestion string before dispatch. An "identifier token that looks like a column reference" means: a bare lowercase word (no leading `$`, `@`, `#`, or `"`) that is not a plot DSL keyword (shape name, tail keyword, param key) and not a number/string literal.

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/columnValidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterSuggestionBySchema } from '../../components/editor/aiAutocomplete/columnValidation';

const schema = [
    { name: 'ts', type: 'TIMESTAMP' },
    { name: 'duration', type: 'BIGINT' },
    { name: 'thread', type: 'VARCHAR' },
];

describe('filterSuggestionBySchema', () => {
    it('returns suggestion unchanged when all column refs are in schema', () => {
        const s = `LINE_CHART(x: "ts", y: "duration")`;
        expect(filterSuggestionBySchema(s, schema)).toBe(s);
    });

    it('returns empty string when suggestion contains an unknown column ref', () => {
        const s = `LINE_CHART(x: "ts", y: "cpu_usage")`;
        expect(filterSuggestionBySchema(s, schema)).toBe('');
    });

    it('allows DSL keywords even if not in schema', () => {
        const s = `LINE_CHART(x: "ts", y: "duration") TITLE "test"`;
        expect(filterSuggestionBySchema(s, schema)).toBe(s);
    });

    it('returns suggestion unchanged when schema is null (no validation possible)', () => {
        const s = `LINE_CHART(x: "ts", y: "unknown")`;
        expect(filterSuggestionBySchema(s, null)).toBe(s);
    });

    it('returns suggestion unchanged when schema is empty', () => {
        const s = `LINE_CHART(x: "ts", y: "something")`;
        expect(filterSuggestionBySchema(s, [])).toBe(s);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/columnValidation.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create columnValidation.ts**

Create `core/frontend/components/editor/aiAutocomplete/columnValidation.ts`:

```typescript
import type { ResultColumn } from './contextBuilder';

// DSL keywords that should never be treated as column references.
// Shape names (uppercase) and tail keywords are filtered by the quoted-string
// check below, but we include common param keys here as a safeguard.
const DSL_KEYWORDS = new Set([
    'LINE_CHART', 'BAR_CHART', 'AREA_CHART', 'SCATTER_PLOT', 'PIE_CHART',
    'BOX_PLOT', 'HISTOGRAM', 'HEATMAP', 'FLAMEGRAPH', 'GANTT', 'RANGE', 'TABLE',
    'line', 'bar', 'area', 'scatter', 'pie', 'box', 'hist', 'heatmap',
    'flame', 'gantt', 'range', 'table',
    'TITLE', 'NAME', 'WIDTH', 'HEIGHT', 'ZOOM', 'ZOOM_X', 'DISABLED',
    'ON', 'LINK_X', 'LINK_Y', 'LINK_XY', 'LINK_SCROLL', 'LET',
    'LEGEND', 'PALETTE', 'BRUSH', 'AXIS_X', 'AXIS_Y', 'TOOLTIP', 'DATASET',
    'MODE', 'TYPE', 'FORMAT', 'LABEL', 'DOMAIN', 'HIDDEN', 'AT',
    'LINEAR', 'LOG', 'TIME', 'BAND', 'COLUMNS', 'HOVER',
    'x', 'y', 'color', 'size', 'name', 'value', 'label', 'fill',
    'stack', 'group', 'bin', 'bins', 'row', 'col',
    'master', 'clamp', 'percent', 'horizontal', 'vertical',
    'true', 'false', 'null',
]);

/**
 * Extract all quoted string values from a plot DSL suggestion.
 * These are the user-supplied column name literals (e.g. "ts", "duration").
 */
function extractQuotedStrings(s: string): string[] {
    const out: string[] = [];
    const re = /"([^"\\]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        out.push(m[1]);
    }
    return out;
}

/**
 * Returns `suggestion` unchanged if it passes column validation, or `''` if
 * any quoted string value looks like a column reference that isn't in `schema`.
 *
 * Only validates when schema is non-null and non-empty; passes through
 * unconditionally otherwise (no schema = no basis to reject).
 */
export function filterSuggestionBySchema(
    suggestion: string,
    schema: ResultColumn[] | null | undefined,
): string {
    if (!schema || schema.length === 0) return suggestion;
    const knownColumns = new Set(schema.map(c => c.name.toLowerCase()));
    const quoted = extractQuotedStrings(suggestion);
    for (const token of quoted) {
        const lower = token.toLowerCase();
        if (DSL_KEYWORDS.has(lower) || DSL_KEYWORDS.has(token)) continue;
        // If it looks like a column reference (no spaces, not a number/boolean)
        // and is not in the schema — reject the suggestion.
        if (/^[a-z_][a-z0-9_]*$/i.test(token) && !knownColumns.has(lower)) {
            return '';
        }
    }
    return suggestion;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd core/frontend && npx vitest run tests/columnValidation.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Wire validation into the autocomplete pipeline**

In `core/frontend/components/editor/aiAutocomplete/index.ts`, find the section where `result` from `aiService.getPlotSuggestion(...)` is dispatched. It will look like:

```typescript
if (result) recent = { upTo, suggestion: result };
```

Add an import at the top of the file:

```typescript
import { filterSuggestionBySchema } from './columnValidation';
```

Then wrap the result before assigning to `recent`:

```typescript
const schema = deps.getCellResultSchema?.() ?? null;
const filteredResult = filterSuggestionBySchema(result, schema);
if (filteredResult) recent = { upTo, suggestion: filteredResult };
```

Also tighten the system prompt instruction in `core/frontend/components/editor/plot/aiPlotContext.ts`. Find the line in `SYSTEM_PROMPT` that says:

```
Return ONLY the next 1-80 tokens that naturally continue at the cursor.
```

And prepend a column constraint sentence to the section with result columns. In `buildPlotAiContext`, find this block:

```typescript
if (resultColsBlock) sections.push(`# Current cell's SQL result columns\n${resultColsBlock}`);
```

Change it to:

```typescript
if (resultColsBlock) sections.push(`# Current cell's SQL result columns (ONLY reference these — do not invent column names)\n${resultColsBlock}`);
```

- [ ] **Step 6: Run full test suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/editor/aiAutocomplete/columnValidation.ts \
        core/frontend/components/editor/aiAutocomplete/index.ts \
        core/frontend/components/editor/plot/aiPlotContext.ts \
        core/frontend/tests/columnValidation.test.ts
git commit -m "feat(ai): add column-aware validation for plot ghost-text suggestions"
```

---

## Task 3: explainCell agent tool

Adds an `explainCell` tool to the AI agent tool registry. When called with a `cellId`, it reads the cell's SQL, result data, and plot config, then asks the model to explain what the data shows in plain language with JFR-specific pattern recognition.

**Files:**
- Modify: `core/frontend/services/ai/tools/index.ts` (add tool schema)
- Modify: `core/frontend/services/ai/tools/runtime.ts` (add handler)
- Modify: `core/frontend/services/AiService.ts` (add to tool guidance string)
- Test: `core/frontend/tests/services/tools.explainCell.test.ts`

### Context

Tool schemas live in `core/frontend/services/ai/tools/index.ts` — add to the `TOOLS` array. Handlers live in the `executeTool` switch statement in `core/frontend/services/ai/tools/runtime.ts`.

The `ToolDeps` interface already has `listCells` (returns `{ id, type, content }[]`). We also need access to query results, but `ToolDeps` doesn't have that. The `explainCell` tool will instead construct a prompt from the cell's SQL and ask the model to run `runQuery` itself if needed — keeping the tool self-contained with just the deps that already exist.

`explainCell` is a `'read'` kind tool. The handler:
1. Finds the cell via `deps.listCells().find(c => c.id === args.cellId)`
2. Returns a structured result that the orchestrator (in `AiService`) injects into the conversation as context, prompting the model to explain the cell

The result shape: `{ ok: true, data: { cellType, content, explanation_prompt } }` — the orchestrator already handles tool results as context messages; the model will produce the explanation in its next response.

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/services/tools.explainCell.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../services/ai/tools/runtime';
import type { ToolDeps } from '../../services/ai/tools/runtime';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
        listCells: vi.fn().mockReturnValue([
            { id: 'cell-1', type: 'sql', content: 'SELECT event_type, count(*) FROM jfr GROUP BY 1' },
            { id: 'cell-2', type: 'plot', content: 'LINE_CHART(x: "ts", y: "duration")' },
        ]),
        mutateCells: vi.fn().mockResolvedValue({ ok: true }),
        listPlotsInNotebook: vi.fn().mockReturnValue([]),
        requireApproval: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('executeTool — explainCell', () => {
    it('returns a prompt context for a known cell', async () => {
        const result = await executeTool('explainCell', { cellId: 'cell-1' }, makeDeps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toHaveProperty('content');
        expect(result.data.content).toContain('SELECT');
    });

    it('returns an error for an unknown cell id', async () => {
        const result = await executeTool('explainCell', { cellId: 'not-found' }, makeDeps());
        expect(result.ok).toBe(false);
    });

    it('tool is in the TOOLS registry', async () => {
        const { TOOLS } = await import('../../services/ai/tools/index');
        const tool = TOOLS.find(t => t.name === 'explainCell');
        expect(tool).toBeTruthy();
        expect(tool!.kind).toBe('read');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/services/tools.explainCell.test.ts 2>&1 | tail -10
```

Expected: FAIL — `explainCell` not in TOOLS.

- [ ] **Step 3: Add explainCell schema to tools/index.ts**

In `core/frontend/services/ai/tools/index.ts`, append to the `TOOLS` array (before the closing `]`):

```typescript
    {
        name: 'explainCell',
        kind: 'read',
        description: 'Explain what a notebook cell does and what its results mean. ' +
            'Pass the cellId from listCells(). The tool returns the cell content so you can provide an explanation. ' +
            'Useful for JFR analysis: the tool hints about GC pause patterns, flamegraph hotspots, and thread contention.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string', description: 'ID of the cell to explain (from listCells).' },
            },
            required: ['cellId'],
        },
    },
```

- [ ] **Step 4: Add explainCell handler to runtime.ts**

In `core/frontend/services/ai/tools/runtime.ts`, inside the `executeTool` switch, add a new case after the existing `case 'readCell':` block:

```typescript
            case 'explainCell': {
                const cell = deps.listCells().find(c => c.id === args.cellId);
                if (!cell) {
                    return { ok: false, error: `Cell "${args.cellId}" not found. Call listCells() to see available cell IDs.` };
                }
                const typeLabel = cell.type === 'sql' ? 'SQL query' : cell.type === 'plot' ? 'Plot config' : 'Markdown';
                return {
                    ok: true,
                    data: {
                        cellId: cell.id,
                        cellType: cell.type,
                        content: cell.content,
                        instruction: `Explain this ${typeLabel} in plain language. ` +
                            (cell.type === 'sql'
                                ? 'Describe what data it retrieves, what patterns it might reveal, and — if it looks like JFR data — call out GC pause patterns (e.g. long STW pauses), flamegraph hotspot signatures, or thread contention indicators.'
                                : cell.type === 'plot'
                                ? 'Describe what the chart will show visually, which axes represent what, and what the user should look for.'
                                : 'Summarise the content.'),
                    },
                };
            }
```

- [ ] **Step 5: Add explainCell to AiService tool guidance**

In `core/frontend/services/AiService.ts`, find the block that builds the tool guidance string (around line 541). It lists tools like `describeTable`, `sampleRows`, etc. Add after the `readCell` line:

```typescript
            `    • explainCell(cellId) — returns cell content with an instruction to explain it in plain language. Useful for helping users understand what a cell does or what its data means.\n` +
```

- [ ] **Step 6: Run tests**

```bash
cd core/frontend && npx vitest run tests/services/tools.explainCell.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 7: Run full suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add core/frontend/services/ai/tools/index.ts \
        core/frontend/services/ai/tools/runtime.ts \
        core/frontend/services/AiService.ts \
        core/frontend/tests/services/tools.explainCell.test.ts
git commit -m "feat(ai): add explainCell agent tool"
```

---

## Task 4: suggestPlot agent tool

Adds a `suggestPlot` tool that reads a cell's SQL and result schema, then asks the model to suggest the best plot type and produce a minimal DSL snippet.

**Files:**
- Modify: `core/frontend/services/ai/tools/index.ts`
- Modify: `core/frontend/services/ai/tools/runtime.ts`
- Modify: `core/frontend/services/AiService.ts`
- Test: `core/frontend/tests/services/tools.suggestPlot.test.ts`

### Context

Same pattern as `explainCell`. The tool returns the cell's SQL content and a schema-derived hint so the model can choose a plot shape and write the DSL. The model produces the DSL suggestion in its next response turn as normal assistant text (shown in inline-chat with an "Apply" button via the existing `applyPlot` flow).

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/services/tools.suggestPlot.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../services/ai/tools/runtime';
import type { ToolDeps } from '../../services/ai/tools/runtime';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    return {
        duckdbQuery: vi.fn().mockResolvedValue({
            columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'duration_ms', type: 'BIGINT' },
                { name: 'thread', type: 'VARCHAR' },
            ],
            rows: [],
        }),
        listCells: vi.fn().mockReturnValue([
            { id: 'cell-1', type: 'sql', content: 'SELECT ts, duration_ms, thread FROM gc_pauses' },
        ]),
        mutateCells: vi.fn().mockResolvedValue({ ok: true }),
        listPlotsInNotebook: vi.fn().mockReturnValue([]),
        requireApproval: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('executeTool — suggestPlot', () => {
    it('returns schema and instruction for a SQL cell', async () => {
        const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toHaveProperty('columns');
        expect(result.data.columns).toContain('ts (TIMESTAMP)');
    });

    it('returns an error for an unknown cell id', async () => {
        const result = await executeTool('suggestPlot', { cellId: 'bad-id' }, makeDeps());
        expect(result.ok).toBe(false);
    });

    it('returns an error for a non-SQL cell', async () => {
        const deps = makeDeps({
            listCells: vi.fn().mockReturnValue([
                { id: 'cell-p', type: 'plot', content: 'LINE_CHART(x: "ts", y: "v")' },
            ]),
        });
        const result = await executeTool('suggestPlot', { cellId: 'cell-p' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/SQL/);
    });

    it('tool is in the TOOLS registry', async () => {
        const { TOOLS } = await import('../../services/ai/tools/index');
        const tool = TOOLS.find(t => t.name === 'suggestPlot');
        expect(tool).toBeTruthy();
        expect(tool!.kind).toBe('read');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/services/tools.suggestPlot.test.ts 2>&1 | tail -10
```

Expected: FAIL — `suggestPlot` not in TOOLS.

- [ ] **Step 3: Add suggestPlot schema to tools/index.ts**

In `core/frontend/services/ai/tools/index.ts`, append after the `explainCell` entry:

```typescript
    {
        name: 'suggestPlot',
        kind: 'read',
        description: 'Suggest the best plot type and a minimal DSL config for a SQL cell\'s result schema. ' +
            'Pass the cellId of a SQL cell. ' +
            'The tool returns the column names and types so you can write a ready-to-paste DSL snippet. ' +
            'After calling this tool, respond with the suggested DSL wrapped in a plot code block so the user can apply it.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string', description: 'ID of the SQL cell whose result schema to use.' },
            },
            required: ['cellId'],
        },
    },
```

- [ ] **Step 4: Add suggestPlot handler to runtime.ts**

In `core/frontend/services/ai/tools/runtime.ts`, add after the `explainCell` case:

```typescript
            case 'suggestPlot': {
                const cell = deps.listCells().find(c => c.id === args.cellId);
                if (!cell) {
                    return { ok: false, error: `Cell "${args.cellId}" not found. Call listCells() to see available cell IDs.` };
                }
                if (cell.type !== 'sql') {
                    return { ok: false, error: `Cell "${args.cellId}" is a ${cell.type} cell, not a SQL cell. suggestPlot requires a SQL cell to read its result schema.` };
                }
                // Fetch the schema by running a LIMIT 0 query.
                let columns: string[] = [];
                try {
                    const result = await deps.duckdbQuery(cell.content, { limit: 0 });
                    columns = result.columns.map(c => `${c.name} (${c.type})`);
                } catch {
                    // Schema fetch failed — return what we know from the SQL text.
                    columns = [];
                }
                return {
                    ok: true,
                    data: {
                        cellId: cell.id,
                        sql: cell.content,
                        columns: columns.join(', ') || '(schema unavailable — inspect the cell manually)',
                        instruction: 'Based on these column names and types, suggest the most appropriate plot shape and write a minimal DSL config. ' +
                            'Consider: timestamps → LINE_CHART; categorical + numeric → BAR_CHART; ' +
                            'two numerics → SCATTER_PLOT; single numeric distribution → HISTOGRAM; ' +
                            'hierarchical call stacks → FLAMEGRAPH; time-range events → GANTT. ' +
                            'Return a plot DSL code block the user can copy.',
                    },
                };
            }
```

- [ ] **Step 5: Add suggestPlot to AiService tool guidance**

In `core/frontend/services/AiService.ts`, in the tool guidance string, add after the `explainCell` line you added in Task 3:

```typescript
            `    • suggestPlot(cellId) — fetches a SQL cell's result schema and returns an instruction to produce a plot DSL snippet. Use when the user asks "what chart should I use?" or "can you plot this?".\n` +
```

- [ ] **Step 6: Run tests**

```bash
cd core/frontend && npx vitest run tests/services/tools.suggestPlot.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 7: Run full suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add core/frontend/services/ai/tools/index.ts \
        core/frontend/services/ai/tools/runtime.ts \
        core/frontend/services/AiService.ts \
        core/frontend/tests/services/tools.suggestPlot.test.ts
git commit -m "feat(ai): add suggestPlot agent tool"
```

---

## Task 5: PlotHelpModal — search + cheat sheet tab + insert example

Adds full-text search filtering, a compact "Cheat sheet" tab, and a per-example "Insert" button (with clipboard fallback) to `PlotHelpModal`.

**Files:**
- Modify: `core/frontend/components/PlotHelpModal.tsx`
- Modify: `core/frontend/components/NotebookCell.tsx` (wire `onInsertExample`)
- Test: `core/frontend/tests/plotHelpModal.test.tsx`

### Context

`PlotHelpModal` is 487 lines. Its current state: `editableExamples`, `generalExample`, `interactiveExampleConfig`. It has no tabs — it's a single scrollable page.

**Search:** Add `filterTerm: string` state. Filter `plotDocs` (shape list, line ~12) and `plotClauseDocs` entries. A shape matches if `filterTerm` appears in `doc.name` or `doc.description`; a clause matches similarly. When `filterTerm` is non-empty, show matching entries; when empty, show all (current behaviour).

**Cheat sheet tab:** Add an `activeTab: 'shapes' | 'clauses' | 'cheatsheet'` state. The existing content is the "shapes" and "clauses" view (currently unsplit — treat the whole existing content as the default). The cheat sheet tab renders a `<table>` from `Object.values(plotClauseDocs)`, two columns: `signature` and `description`.

**Insert example button:** `PlotHelpModal` receives an optional `onInsertExample?: (code: string) => void` prop. When present, each example block shows an "Insert" button. When absent (or when `onInsertExample` is undefined), show a "Copy" button that calls `navigator.clipboard.writeText(code)`.

`NotebookCell` opens `PlotHelpModal` at line 1533:
```tsx
<PlotHelpModal isOpen={isPlotHelpModalOpen} onClose={() => setIsPlotHelpModalOpen(false)} />
```

Wire `onInsertExample` there, using the plot editor ref for the cell that owns the "help" button. The plot editor ref is accessible via `plotEditorRefs[plotUid]` or similar — check the existing editor ref pattern in the file.

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/plotHelpModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// We test the search filter logic as a pure function extracted from the component.
// Import the helper once it's created:
import { matchesFilter } from '../../components/PlotHelpModal';

describe('PlotHelpModal — matchesFilter', () => {
    it('returns true when filter is empty', () => {
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', '')).toBe(true);
    });

    it('matches by name (case-insensitive)', () => {
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', 'line')).toBe(true);
        expect(matchesFilter('LINE_CHART', 'A line chart over time.', 'LINE')).toBe(true);
    });

    it('matches by description', () => {
        expect(matchesFilter('BAR_CHART', 'Show values by category.', 'category')).toBe(true);
    });

    it('returns false when no match', () => {
        expect(matchesFilter('BAR_CHART', 'Show values by category.', 'zzz')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/plotHelpModal.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `matchesFilter` not exported.

- [ ] **Step 3: Implement search + cheat sheet tab + insert button in PlotHelpModal**

Open `core/frontend/components/PlotHelpModal.tsx` and apply the following changes:

**3a. Add import for plotClauseDocs:**

```typescript
import { plotClauseDocs } from '../utils/plotClauseDocs';
```

**3b. Export the matchesFilter helper (add near top, after imports):**

```typescript
export function matchesFilter(name: string, description: string, term: string): boolean {
    if (!term) return true;
    const t = term.toLowerCase();
    return name.toLowerCase().includes(t) || description.toLowerCase().includes(t);
}
```

**3c. Add `filterTerm` and `activeTab` state inside the component:**

```typescript
const [filterTerm, setFilterTerm] = useState('');
const [activeTab, setActiveTab] = useState<'all' | 'cheatsheet'>('all');
```

**3d. Update the `PlotHelpModalProps` interface:**

```typescript
interface PlotHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInsertExample?: (code: string) => void;
}
```

And update the destructuring:

```typescript
const PlotHelpModal: React.FC<PlotHelpModalProps> = ({ isOpen, onClose, onInsertExample }) => {
```

**3e. Add a search bar and tab switcher at the top of the modal content** (find the main `<main>` or first scrollable div and prepend):

```tsx
{/* Search + tab bar */}
<div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-700 space-y-2">
    <input
        type="search"
        placeholder="Search shapes and clauses…"
        aria-label="Search plot help"
        value={filterTerm}
        onChange={e => setFilterTerm(e.target.value)}
        className="w-full bg-gray-900/50 border border-gray-700 rounded-md py-1.5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
    />
    <div className="flex gap-2">
        {(['all', 'cheatsheet'] as const).map(tab => (
            <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    activeTab === tab
                        ? 'bg-cyan-700 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
                {tab === 'all' ? 'Shapes & Clauses' : 'Cheat Sheet'}
            </button>
        ))}
    </div>
</div>
```

**3f. Wrap existing content with `activeTab === 'all'` guard:**

Find the opening tag of the section that renders `plotDocs.map(...)` and wrap it:

```tsx
{activeTab === 'all' && (
    <> {/* existing shapes + clauses content here */} </>
)}
```

Apply `matchesFilter` to `plotDocs` rendering — wrap the map:

```tsx
{plotDocs
    .filter(doc => matchesFilter(doc.name, doc.description ?? '', filterTerm))
    .map(doc => ( /* existing per-doc JSX */ ))}
```

Do the same for any clause sections.

**3g. Add cheat sheet tab content** (after the `activeTab === 'all'` block):

```tsx
{activeTab === 'cheatsheet' && (
    <div className="px-4 py-3 overflow-auto">
        <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-800">
                <tr>
                    <th className="text-left py-1 pr-4 font-medium text-gray-400 w-48">Clause</th>
                    <th className="text-left py-1 pr-4 font-medium text-gray-400 w-64">Signature</th>
                    <th className="text-left py-1 font-medium text-gray-400">Description</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
                {Object.values(plotClauseDocs)
                    .filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i) // deduplicate
                    .filter(c => matchesFilter(c.name, c.description, filterTerm))
                    .map(c => (
                        <tr key={c.name} className="hover:bg-gray-700/20">
                            <td className="py-1.5 pr-4 font-mono text-xs text-cyan-300 align-top">{c.name}</td>
                            <td className="py-1.5 pr-4 font-mono text-xs text-yellow-300 align-top whitespace-nowrap">{c.signature}</td>
                            <td className="py-1.5 text-xs text-gray-400 align-top">{c.description}</td>
                        </tr>
                    ))}
            </tbody>
        </table>
    </div>
)}
```

**3h. Add Insert/Copy button to each example code block**

Find each place where `<pre>` or `<code>` renders example code and wrap with a relative container. Add the button:

```tsx
<div className="relative group">
    <pre className="...">{exampleCode}</pre>
    <button
        onClick={() => {
            if (onInsertExample) {
                onInsertExample(exampleCode);
            } else {
                navigator.clipboard.writeText(exampleCode);
            }
        }}
        title={onInsertExample ? 'Insert into editor' : 'Copy to clipboard'}
        aria-label={onInsertExample ? 'Insert example into editor' : 'Copy example to clipboard'}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-opacity"
    >
        {onInsertExample ? 'Insert' : 'Copy'}
    </button>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd core/frontend && npx vitest run tests/plotHelpModal.test.tsx 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Wire onInsertExample in NotebookCell.tsx**

In `core/frontend/components/NotebookCell.tsx`, find the `PlotHelpModal` usage at the bottom of the component (line ~1533):

```tsx
<PlotHelpModal isOpen={isPlotHelpModalOpen} onClose={() => setIsPlotHelpModalOpen(false)} />
```

Change to:

```tsx
<PlotHelpModal
    isOpen={isPlotHelpModalOpen}
    onClose={() => setIsPlotHelpModalOpen(false)}
    onInsertExample={activePlotEditorRef.current
        ? (code) => activePlotEditorRef.current!.dispatch({
            changes: {
                from: activePlotEditorRef.current!.state.selection.main.from,
                insert: code,
            },
        })
        : undefined
    }
/>
```

You'll need to identify or create `activePlotEditorRef` — a `useRef<EditorView | null>(null)` that is set when the user opens the help modal from a specific plot cell's button. Look for `setIsPlotHelpModalOpen(true)` calls in the file; each call site can also set a ref to the corresponding plot editor:

```typescript
const activePlotEditorRef = useRef<import('@codemirror/view').EditorView | null>(null);
```

In each plot cell's help button `onClick`:

```tsx
onClick={() => {
    activePlotEditorRef.current = plotEditorRef; // the EditorView for this plot cell
    setIsPlotHelpModalOpen(true);
}}
```

Check the existing plot editor ref pattern in `NotebookCell.tsx` (search for `plotEditorRef` or `editorRef`) to find the right variable name.

- [ ] **Step 6: Run full test suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/PlotHelpModal.tsx \
        core/frontend/components/NotebookCell.tsx \
        core/frontend/tests/plotHelpModal.test.tsx
git commit -m "feat(help): add search, cheat sheet tab, and insert-example button to PlotHelpModal"
```

---

## Task 6: Onboarding cell for new notebooks

When a user opens a blank notebook for the first time, prepend a dismissable "Getting started" cell. After dismissal the cell never reappears (localStorage flag).

**Files:**
- Modify: `core/frontend/App.tsx`
- Test: `core/frontend/tests/onboarding.test.ts`

### Context

`App.tsx` manages `cells` via a state derived from `useHistoryState`. The `addCellFromTool` function (line ~769) inserts cells. For the onboarding cell we use a simpler approach: a boolean state `showOnboarding` initialized from `localStorage`. The cell renders as an overlay/banner above the notebook content rather than as a proper notebook cell — this way it doesn't pollute the notebook file.

Check: `App.tsx` already has `cells` state (line ~605). The onboarding condition: `cells.length === 0 && !localStorage.getItem('jfrq:onboarding-dismissed')`.

The onboarding UI renders as a dismissable info banner at the top of the notebook column, above the `cells.map(...)` render. It is not a `NotebookCellData` — it's a React-only element in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/onboarding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldShowOnboarding } from '../../App';

// jsdom sets up localStorage
describe('shouldShowOnboarding', () => {
    beforeEach(() => localStorage.clear());

    it('returns true when there are no cells and no dismiss flag', () => {
        expect(shouldShowOnboarding(0)).toBe(true);
    });

    it('returns false when cells exist', () => {
        expect(shouldShowOnboarding(1)).toBe(false);
    });

    it('returns false after dismissal', () => {
        localStorage.setItem('jfrq:onboarding-dismissed', '1');
        expect(shouldShowOnboarding(0)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core/frontend && npx vitest run tests/onboarding.test.ts 2>&1 | tail -10
```

Expected: FAIL — `shouldShowOnboarding` not exported from `App`.

- [ ] **Step 3: Implement onboarding in App.tsx**

In `core/frontend/App.tsx`, add after the existing imports:

```typescript
export function shouldShowOnboarding(cellCount: number): boolean {
    return cellCount === 0 && !localStorage.getItem('jfrq:onboarding-dismissed');
}
```

Inside the `App` component, add state:

```typescript
const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => !!localStorage.getItem('jfrq:onboarding-dismissed')
);
const showOnboarding = !onboardingDismissed && cells.length === 0;
```

Add a dismiss handler:

```typescript
const dismissOnboarding = useCallback(() => {
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
    setOnboardingDismissed(true);
}, []);
```

In the JSX, find where the cells are rendered (the `cells.map(...)` call) and prepend:

```tsx
{showOnboarding && (
    <div className="mx-4 mt-4 mb-2 rounded-lg border border-cyan-700/50 bg-cyan-900/10 p-4 text-sm text-gray-300 relative">
        <button
            onClick={dismissOnboarding}
            aria-label="Dismiss getting started guide"
            className="absolute top-2 right-2 p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
        >
            ✕
        </button>
        <h3 className="font-semibold text-cyan-300 mb-2">Getting started</h3>
        <ol className="space-y-1 list-decimal list-inside text-gray-400">
            <li>Load a JFR file — drag &amp; drop onto the page or use <kbd className="text-xs bg-gray-700 px-1 rounded">File → Open</kbd></li>
            <li>Write a SQL query in a cell — e.g. <code className="text-xs bg-gray-800 px-1 rounded font-mono">SELECT * FROM jfr LIMIT 100</code></li>
            <li>Add a Plot cell below the query to visualise the results</li>
        </ol>
        <p className="mt-2 text-xs text-gray-500">
            Press <kbd className="bg-gray-700 px-1 rounded">Ctrl+Shift+P</kbd> (or <kbd className="bg-gray-700 px-1 rounded">Cmd+Shift+P</kbd>) to open the command palette. Type <kbd className="bg-gray-700 px-1 rounded">?</kbd> for help.
        </p>
    </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd core/frontend && npx vitest run tests/onboarding.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add core/frontend/App.tsx core/frontend/tests/onboarding.test.ts
git commit -m "feat(ux): add dismissable onboarding banner for new empty notebooks"
```

---

## Self-review notes

- **Stream 1 (hover + lint):** Already fully implemented — `editor/hover.ts` covers shape and tail-clause hover; `lint.ts` already has "did you mean" for unknown shapes and tail keywords. No tasks needed.
- **Stream 3 ("Fix with AI"):** Already implemented — `AiErrorFixer` in `PlotRenderer.tsx` auto-triggers on plot errors with a suggestion + Apply Fix button. No tasks needed.
- **Stream 2 (test connection):** Already implemented in `SettingsModal.tsx` (`handleTestKey`). Only the mode cards are new (Task 1).
- **Column validation (Task 2):** Extracts quoted strings from suggestions and checks against schema. Passes through when schema is null or empty to avoid false rejections.
- **`suggestPlot` (Task 4):** Runs a `LIMIT 0` query to cheaply fetch schema — handles failure gracefully.
- **PlotHelpModal (Task 5):** `matchesFilter` is exported for unit testing without needing to mount the full modal.
- **Onboarding (Task 6):** `shouldShowOnboarding` is exported for unit testing without mounting App.
