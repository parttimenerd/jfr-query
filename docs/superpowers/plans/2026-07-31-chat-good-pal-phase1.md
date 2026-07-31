# Chat Good Pal — Phase 1: Visual Refresh + Embedded Cells

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat panel visually and add support for AI responses that embed live, interactive cells (charts, tables, flame graphs) inline within message bubbles, with an "Add to notebook" button on each.

**Architecture:** `ChatMarkdownView` gains a `:::cell` fence parser that replaces fences with a new `ChatEmbeddedCell` component. `ChatEmbeddedCell` executes the embedded SQL via `DataContext`, renders via existing `PlotRenderer`/`DataTable`/`FlameGraphPlot`, and exposes an "Add to notebook" callback. `ChatPanel` gets a visual overhaul (darker bg, avatar dots, asymmetric bubbles, model badge, unified input). Variables are already in scope via `variablesSystemPromptLine()` — no changes needed there.

**Tech Stack:** React, Tailwind CSS, react-markdown (already in use), existing `DataContext.query()`, `PlotRenderer`, `DataTable`, `FlameGraphPlot`, Vitest.

---

## File Map

| File | Change |
|------|--------|
| `components/chat/ChatEmbeddedCell.tsx` | **Create** — renders a live cell inside a chat bubble |
| `components/chat/ChatMarkdownView.tsx` | **Modify** — detect + parse `:::cell` fences, render `ChatEmbeddedCell` |
| `components/ChatPanel.tsx` | **Modify** — visual refresh: bg, bubbles, avatar, input, model badge |
| `tests/chat/chatEmbeddedCell.test.ts` | **Create** — unit tests for fence parser and ChatEmbeddedCell |

---

### Task 1: `:::cell` fence parser utility

**Files:**
- Create: `core/frontend/components/chat/ChatEmbeddedCell.tsx` (just the parser first)
- Create: `core/frontend/tests/chat/chatEmbeddedCell.test.ts`

The fence format is:
```
:::cell type=chart
sql: SELECT bucket, avg(pause_ms) AS avg_pause FROM gc_events GROUP BY bucket ORDER BY bucket
plot: LINE_CHART(x: "bucket", y: ["avg_pause"])
:::
```
Fields: `type` (required, first line), `sql:` (required), `plot:` (optional, only for `type=chart`).

- [ ] **Step 1: Write the failing tests**

Create `core/frontend/tests/chat/chatEmbeddedCell.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCellFence, splitCellFences } from '../../components/chat/ChatEmbeddedCell';

describe('parseCellFence', () => {
    it('parses a chart fence', () => {
        const fence = `type=chart
sql: SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket
plot: LINE_CHART(x: "bucket", y: ["p"])`;
        const result = parseCellFence(fence);
        expect(result).toEqual({
            type: 'chart',
            sql: 'SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket',
            plotConfig: 'LINE_CHART(x: "bucket", y: ["p"])',
        });
    });

    it('parses a table fence (no plot)', () => {
        const fence = `type=table\nsql: SELECT * FROM gc_events LIMIT 10`;
        const result = parseCellFence(fence);
        expect(result).toEqual({ type: 'table', sql: 'SELECT * FROM gc_events LIMIT 10', plotConfig: undefined });
    });

    it('parses a flamegraph fence', () => {
        const fence = `type=flamegraph\nsql: SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 500`;
        const result = parseCellFence(fence);
        expect(result?.type).toBe('flamegraph');
        expect(result?.sql).toContain('ExecutionSample');
    });

    it('returns null for malformed fence (no sql)', () => {
        const fence = `type=chart\nplot: LINE_CHART(x: "x", y: ["y"])`;
        expect(parseCellFence(fence)).toBeNull();
    });
});

describe('splitCellFences', () => {
    it('splits text with one fence into text + cell parts', () => {
        const text = `Here is the chart:\n:::cell type=chart\nsql: SELECT 1\n:::\nDone.`;
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(3);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Here is the chart:\n' });
        expect(parts[1]).toEqual({ kind: 'cell', content: 'type=chart\nsql: SELECT 1' });
        expect(parts[2]).toEqual({ kind: 'text', content: '\nDone.' });
    });

    it('handles multiple fences', () => {
        const text = `A\n:::cell type=table\nsql: SELECT 1\n:::\nB\n:::cell type=chart\nsql: SELECT 2\nplot: BAR_CHART(x: "x", y: "y")\n:::\nC`;
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(2);
        expect(parts.filter(p => p.kind === 'text')).toHaveLength(3);
    });

    it('returns single text part when no fences', () => {
        const text = 'Just plain text.';
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Just plain text.' });
    });

    it('handles fence at start of text', () => {
        const text = `:::cell type=table\nsql: SELECT 1\n:::\nAfter`;
        const parts = splitCellFences(text);
        expect(parts[0].kind).toBe('cell');
        expect(parts[1]).toEqual({ kind: 'text', content: '\nAfter' });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd core/frontend && npx vitest run tests/chat/chatEmbeddedCell.test.ts
```
Expected: FAIL — `Cannot find module '../../components/chat/ChatEmbeddedCell'`

- [ ] **Step 3: Implement the parser**

Create `core/frontend/components/chat/ChatEmbeddedCell.tsx`:

```typescript
import React, { useEffect, useState, useContext } from 'react';
import { DataContext } from '../../context/DuckDBContext';

export type CellFenceType = 'chart' | 'table' | 'flamegraph' | 'sql';

export interface ParsedCellFence {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
}

export type FencePart =
    | { kind: 'text'; content: string }
    | { kind: 'cell'; content: string };

/** Parse the inner content of a :::cell fence (everything between ::: markers). */
export function parseCellFence(inner: string): ParsedCellFence | null {
    const lines = inner.split('\n');
    let type: CellFenceType | null = null;
    let sql: string | null = null;
    let plotConfig: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('type=')) {
            type = trimmed.slice('type='.length).trim() as CellFenceType;
        } else if (trimmed.startsWith('sql:')) {
            sql = trimmed.slice('sql:'.length).trim();
        } else if (trimmed.startsWith('plot:')) {
            plotConfig = trimmed.slice('plot:'.length).trim();
        }
    }

    if (!type || !sql) return null;
    return { type, sql, plotConfig };
}

/** Split a markdown string into alternating text and cell-fence parts. */
export function splitCellFences(text: string): FencePart[] {
    const FENCE_RE = /:::cell[ \t]+([\s\S]*?):::/g;
    const parts: FencePart[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FENCE_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: 'text', content: text.slice(lastIndex, match.index) });
        }
        parts.push({ kind: 'cell', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push({ kind: 'text', content: text.slice(lastIndex) });
    }

    return parts;
}

// ChatEmbeddedCell component — added in Task 2
export {};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core/frontend && npx vitest run tests/chat/chatEmbeddedCell.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatEmbeddedCell.tsx core/frontend/tests/chat/chatEmbeddedCell.test.ts
git commit -m "feat(chat): add :::cell fence parser with split utility"
```

---

### Task 2: `ChatEmbeddedCell` component

**Files:**
- Modify: `core/frontend/components/chat/ChatEmbeddedCell.tsx`
- Modify: `core/frontend/tests/chat/chatEmbeddedCell.test.ts`

**Context:** `DataContext` in `context/DuckDBContext.tsx` exposes `query(sql: string): Promise<QueryResult>` where `QueryResult` has `{ columns: string[], rows: any[][] }`. `PlotRenderer` at `components/PlotRenderer.tsx` takes `{ config: string, result: QueryResult }`. `DataTable` at `components/DataTable.tsx` takes `{ result: QueryResult }`. `FlameGraphPlot` at `components/plots/FlameGraphPlot.tsx` takes `{ data: QueryResult }`.

- [ ] **Step 1: Write failing component tests**

Add to `core/frontend/tests/chat/chatEmbeddedCell.test.ts`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatEmbeddedCell } from '../../components/chat/ChatEmbeddedCell';
import { DataContext } from '../../context/DuckDBContext';

const mockQuery = vi.fn();
const mockDataContext = { query: mockQuery } as any;

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataContext.Provider value={mockDataContext}>{children}</DataContext.Provider>
);

describe('ChatEmbeddedCell', () => {
    beforeEach(() => {
        mockQuery.mockResolvedValue({ columns: ['bucket', 'avg_pause'], rows: [['2024-01-01', 12]] });
    });

    it('executes sql on mount', async () => {
        render(
            <ChatEmbeddedCell type="table" sql="SELECT 1" onAddToNotebook={vi.fn()} />,
            { wrapper },
        );
        await waitFor(() => expect(mockQuery).toHaveBeenCalledWith('SELECT 1'));
    });

    it('shows type badge', async () => {
        render(<ChatEmbeddedCell type="table" sql="SELECT 1" onAddToNotebook={vi.fn()} />, { wrapper });
        expect(screen.getByText('TABLE')).toBeInTheDocument();
    });

    it('shows truncated sql label', async () => {
        render(<ChatEmbeddedCell type="table" sql="SELECT bucket FROM gc_events LIMIT 10" onAddToNotebook={vi.fn()} />, { wrapper });
        expect(screen.getByText(/SELECT bucket FROM gc_events/)).toBeInTheDocument();
    });

    it('calls onAddToNotebook when button clicked', async () => {
        const onAdd = vi.fn();
        render(<ChatEmbeddedCell type="table" sql="SELECT 1" onAddToNotebook={onAdd} />, { wrapper });
        await userEvent.click(screen.getByText(/Add to notebook/));
        expect(onAdd).toHaveBeenCalledOnce();
    });

    it('shows error when query fails', async () => {
        mockQuery.mockRejectedValue(new Error('Table not found'));
        render(<ChatEmbeddedCell type="table" sql="SELECT 1" onAddToNotebook={vi.fn()} />, { wrapper });
        await waitFor(() => expect(screen.getByText(/Table not found/)).toBeInTheDocument());
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/chatEmbeddedCell.test.ts
```
Expected: FAIL — `ChatEmbeddedCell is not a function` (not yet exported as component).

- [ ] **Step 3: Implement `ChatEmbeddedCell`**

Replace the `export {};` at the bottom of `core/frontend/components/chat/ChatEmbeddedCell.tsx` with:

```typescript
interface ChatEmbeddedCellProps {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
    onAddToNotebook: () => void;
}

type CellState =
    | { status: 'loading' }
    | { status: 'done'; result: any }
    | { status: 'error'; message: string };

const TYPE_LABELS: Record<CellFenceType, string> = {
    chart: 'CHART',
    table: 'TABLE',
    flamegraph: 'FLAME GRAPH',
    sql: 'SQL',
};

export function ChatEmbeddedCell({ type, sql, plotConfig, onAddToNotebook }: ChatEmbeddedCellProps) {
    const { query } = useContext(DataContext);
    const [state, setState] = useState<CellState>({ status: 'loading' });

    useEffect(() => {
        setState({ status: 'loading' });
        query(sql)
            .then(result => setState({ status: 'done', result }))
            .catch(err => setState({ status: 'error', message: String(err.message ?? err) }));
    }, [sql]);

    const truncatedSql = sql.length > 60 ? sql.slice(0, 60) + '…' : sql;

    return (
        <div className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden my-2">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold tracking-widest text-gray-500 shrink-0">
                        {TYPE_LABELS[type]}
                    </span>
                    <span className="text-gray-600 text-xs">·</span>
                    <span className="text-[10px] text-gray-600 font-mono truncate">{truncatedSql}</span>
                </div>
                <button
                    onClick={onAddToNotebook}
                    className="text-[10px] text-cyan-500 hover:text-cyan-300 shrink-0 ml-2 cursor-pointer"
                >
                    ↗ Add to notebook
                </button>
            </div>

            {/* Body */}
            <div className="p-2">
                {state.status === 'loading' && (
                    <div className="text-xs text-gray-600 py-2 px-1">Running query…</div>
                )}
                {state.status === 'error' && (
                    <div className="text-xs text-red-400 py-2 px-1 font-mono">{state.message}</div>
                )}
                {state.status === 'done' && type === 'table' && (
                    <div className="max-h-[200px] overflow-y-auto">
                        <DataTableEmbed result={state.result} />
                    </div>
                )}
                {state.status === 'done' && type === 'sql' && (
                    <div className="max-h-[200px] overflow-y-auto">
                        <DataTableEmbed result={state.result} />
                    </div>
                )}
                {state.status === 'done' && type === 'chart' && plotConfig && (
                    <PlotEmbed result={state.result} plotConfig={plotConfig} />
                )}
                {state.status === 'done' && type === 'flamegraph' && (
                    <FlameEmbed result={state.result} />
                )}
            </div>
        </div>
    );
}

// Lazy wrapper components — imported dynamically to avoid circular deps
function DataTableEmbed({ result }: { result: any }) {
    const DataTable = React.lazy(() => import('../DataTable'));
    return (
        <React.Suspense fallback={<span className="text-xs text-gray-600">Loading…</span>}>
            <DataTable result={result} />
        </React.Suspense>
    );
}

function PlotEmbed({ result, plotConfig }: { result: any; plotConfig: string }) {
    const PlotRenderer = React.lazy(() => import('../PlotRenderer'));
    return (
        <React.Suspense fallback={<span className="text-xs text-gray-600">Loading…</span>}>
            <PlotRenderer config={plotConfig} result={result} />
        </React.Suspense>
    );
}

function FlameEmbed({ result }: { result: any }) {
    const FlameGraphPlot = React.lazy(() => import('../plots/FlameGraphPlot'));
    return (
        <React.Suspense fallback={<span className="text-xs text-gray-600">Loading…</span>}>
            <FlameGraphPlot data={result} />
        </React.Suspense>
    );
}
```

> **Note:** Check the actual prop names of `DataTable`, `PlotRenderer`, and `FlameGraphPlot` before running. Read `components/DataTable.tsx` line 1–20, `components/PlotRenderer.tsx` line 1–20, and `components/plots/FlameGraphPlot.tsx` line 1–20 to confirm prop interface. Adjust the wrapper components above to match.

- [ ] **Step 4: Run tests**

```bash
cd core/frontend && npx vitest run tests/chat/chatEmbeddedCell.test.ts
```
Expected: all component tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatEmbeddedCell.tsx core/frontend/tests/chat/chatEmbeddedCell.test.ts
git commit -m "feat(chat): add ChatEmbeddedCell component with query execution and add-to-notebook"
```

---

### Task 3: Wire `:::cell` fences into `ChatMarkdownView`

**Files:**
- Modify: `core/frontend/components/chat/ChatMarkdownView.tsx`
- Modify: `core/frontend/tests/chat/chatEmbeddedCell.test.ts`

**Context:** `ChatMarkdownView` currently exports `renderMarkdown(text, onRef?)` which returns JSX. The component signature is `React.FC<{ text: string; onNavigateRef?: (ref: string) => void; className?: string }>`. We need to add an `onAddToNotebook?: (sql: string, type: CellFenceType, plotConfig?: string) => void` prop and process cell fences before passing to react-markdown.

- [ ] **Step 1: Write failing tests for fence rendering**

Add to `core/frontend/tests/chat/chatEmbeddedCell.test.ts`:

```typescript
import { ChatMarkdownView } from '../../components/chat/ChatMarkdownView';

describe('ChatMarkdownView with cell fences', () => {
    it('renders plain text without cell fences unchanged', () => {
        const { container } = render(
            <ChatMarkdownView text="Hello world" />,
        );
        expect(container.textContent).toContain('Hello world');
    });

    it('renders a :::cell fence as ChatEmbeddedCell (shows TABLE badge)', async () => {
        const text = 'Here:\n:::cell type=table\nsql: SELECT 1\n:::\nDone.';
        render(
            <ChatMarkdownView text={text} />,
            { wrapper },
        );
        await waitFor(() => expect(screen.getByText('TABLE')).toBeInTheDocument());
        expect(screen.getByText(/Add to notebook/)).toBeInTheDocument();
    });

    it('calls onAddToNotebook with correct args when button clicked', async () => {
        const onAdd = vi.fn();
        const text = ':::cell type=table\nsql: SELECT 42\n:::';
        render(<ChatMarkdownView text={text} onAddToNotebook={onAdd} />, { wrapper });
        await userEvent.click(await screen.findByText(/Add to notebook/));
        expect(onAdd).toHaveBeenCalledWith('SELECT 42', 'table', undefined);
    });

    it('renders text before and after a fence', async () => {
        const text = 'Before\n:::cell type=table\nsql: SELECT 1\n:::\nAfter';
        render(<ChatMarkdownView text={text} />, { wrapper });
        expect(screen.getByText(/Before/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('TABLE')).toBeInTheDocument());
        expect(screen.getByText(/After/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/chatEmbeddedCell.test.ts
```
Expected: FAIL — `ChatMarkdownView` doesn't accept `onAddToNotebook` prop and doesn't render cell fences.

- [ ] **Step 3: Update `ChatMarkdownView`**

In `core/frontend/components/chat/ChatMarkdownView.tsx`, update the props interface and the component body:

```typescript
// Add to imports at top:
import { splitCellFences, parseCellFence, ChatEmbeddedCell, type CellFenceType } from './ChatEmbeddedCell';

// Update the props interface:
interface ChatMarkdownViewProps {
    text: string;
    onNavigateRef?: (ref: string) => void;
    onAddToNotebook?: (sql: string, type: CellFenceType, plotConfig?: string) => void;
    className?: string;
}
```

Then in the component body, replace the current single `renderMarkdown(text, onNavigateRef)` call with:

```typescript
export const ChatMarkdownView: React.FC<ChatMarkdownViewProps> = ({ text, onNavigateRef, onAddToNotebook, className }) => {
    const parts = splitCellFences(text);

    return (
        <div className={className}>
            {parts.map((part, i) => {
                if (part.kind === 'text') {
                    return (
                        <React.Fragment key={i}>
                            {renderMarkdown(part.content, onNavigateRef)}
                        </React.Fragment>
                    );
                }
                const parsed = parseCellFence(part.content);
                if (!parsed) return null;
                return (
                    <ChatEmbeddedCell
                        key={i}
                        type={parsed.type}
                        sql={parsed.sql}
                        plotConfig={parsed.plotConfig}
                        onAddToNotebook={() => onAddToNotebook?.(parsed.sql, parsed.type, parsed.plotConfig)}
                    />
                );
            })}
        </div>
    );
};
```

> **Note:** Verify that `renderMarkdown` currently returns a ReactNode (not a string). If it wraps in a div already, the `React.Fragment` wrapper here may be redundant — adjust accordingly.

- [ ] **Step 4: Run all chat tests**

```bash
cd core/frontend && npx vitest run tests/chat/
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatMarkdownView.tsx core/frontend/tests/chat/chatEmbeddedCell.test.ts
git commit -m "feat(chat): render :::cell fences as live ChatEmbeddedCell in ChatMarkdownView"
```

---

### Task 4: Wire `onAddToNotebook` through `ChatPanel`

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** `ChatPanel` renders `ChatMarkdownView` for AI messages. It already has `onAddCellFromAI(query, plotConfig, title, markdownText)` as a prop. We need to pass `onAddToNotebook` to every `ChatMarkdownView` call in the panel, converting the fence data into an `onAddCellFromAI` call.

- [ ] **Step 1: Find all `ChatMarkdownView` usages in `ChatPanel.tsx`**

```bash
grep -n "ChatMarkdownView" core/frontend/components/ChatPanel.tsx
```

Note every line number where it's rendered. There will be at least one for AI message bubbles and possibly one for streaming text.

- [ ] **Step 2: Add `onAddToNotebook` handler**

In `ChatPanel.tsx`, add this handler function near the other handlers (search for `const handle` to find the right place):

```typescript
const handleAddCellFromFence = useCallback((sql: string, type: CellFenceType, plotConfig?: string) => {
    const title = type === 'flamegraph' ? 'Flame Graph' : type === 'chart' ? 'Chart' : 'Query Result';
    onAddCellFromAI?.(sql, plotConfig ?? '', title, '');
}, [onAddCellFromAI]);
```

Also add the import at the top of `ChatPanel.tsx`:

```typescript
import type { CellFenceType } from './chat/ChatEmbeddedCell';
```

- [ ] **Step 3: Pass `onAddToNotebook` to every `ChatMarkdownView`**

For each `<ChatMarkdownView` usage found in step 1, add the prop:

```tsx
<ChatMarkdownView
    text={msg.text}
    onNavigateRef={onNavigateRef}
    onAddToNotebook={handleAddCellFromFence}  // ADD THIS
    // ... other existing props
/>
```

- [ ] **Step 4: Run the full test suite to check no regressions**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): wire onAddToNotebook from ChatEmbeddedCell through ChatPanel to onAddCellFromAI"
```

---

### Task 5: Visual refresh — message bubbles and layout

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** Current AI bubble: `max-w-[85%] rounded-lg p-3 bg-gray-700 text-gray-200`. Current user bubble: `max-w-[85%] rounded-lg p-3 bg-cyan-600 text-white`. We're replacing the whole message rendering section. The messages are rendered in a loop — search for `MessageSender.AI` to find the conditional.

- [ ] **Step 1: Update the panel background**

Find the outermost container div of ChatPanel (search for `flex flex-col h-full` or similar root div). Change its background class from `bg-gray-900` (or equivalent) to `bg-[#0f1117]`.

- [ ] **Step 2: Update AI message bubbles**

Find the AI message bubble div (near `MessageSender.AI`). Replace its className:

**Before** (approximate):
```tsx
<div className="relative group/msg max-w-[85%] rounded-lg p-3 bg-gray-700 text-gray-200">
```

**After:**
```tsx
<div className="relative group/msg max-w-[85%] rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-xl p-3 bg-[#161b27] border border-[#1e2d3d] text-slate-300">
```

Wrap it in a flex container with the AI avatar:

```tsx
<div className="flex gap-2 items-start justify-start">
    {/* Avatar */}
    <div className="w-[22px] h-[22px] rounded-full bg-gradient-to-br from-violet-600 to-cyan-400 flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white mt-0.5">
        AI
    </div>
    {/* Bubble */}
    <div className="relative group/msg max-w-[85%] rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-xl p-3 bg-[#161b27] border border-[#1e2d3d] text-slate-300">
        {/* existing bubble content unchanged */}
    </div>
</div>
```

- [ ] **Step 3: Update user message bubbles**

Find the user bubble (near `MessageSender.User` or `justify-end`). Replace className:

**Before:**
```tsx
<div className="relative group/msg max-w-[85%] rounded-lg p-3 bg-cyan-600 text-white">
```

**After:**
```tsx
<div className="relative group/msg max-w-[85%] rounded-tl-xl rounded-tr-sm rounded-br-xl rounded-bl-xl p-3 bg-[#1e3a4a] border border-cyan-700/30 text-slate-100">
```

- [ ] **Step 4: Update the input area**

Find the input container (search for `placeholder` or `Send` button). Replace the input + button area with:

```tsx
<div className="bg-[#161b27] border border-[#1e2d3d] rounded-xl px-3 py-2 flex gap-2 items-center">
    <textarea
        {/* keep all existing event handlers and refs */}
        className="flex-1 bg-transparent border-none outline-none text-slate-200 text-sm resize-none placeholder-gray-600"
        placeholder="Ask about your JFR session…"
        rows={1}
    />
    <button
        {/* keep existing onClick */}
        className="bg-gradient-to-br from-cyan-600 to-violet-600 text-white border-none rounded-md px-2.5 py-1.5 text-xs cursor-pointer shrink-0 hover:opacity-90"
    >
        ⏎
    </button>
</div>
```

> **Note:** The current input may be an `<input>` not a `<textarea>`. Check and keep the existing element type — just update the className. Preserve all existing `ref`, `value`, `onChange`, `onKeyDown` props.

- [ ] **Step 5: Add model badge to header**

Find the chat panel header (search for `Chat` text or the `XMarkIcon` close button area). Add the model badge next to the title:

```tsx
<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2433]">
    <span className="text-slate-100 font-semibold text-sm">Chat</span>
    <div className="flex items-center gap-2">
        {/* Model badge */}
        <span className="bg-[#1e2433] text-cyan-400 text-[10px] px-2 py-0.5 rounded-full border border-cyan-400/20">
            {settings.aiProvider} ✦ {settings.localBaseUrl ? 'local' : 'cloud'}
        </span>
        {/* existing header buttons (close, etc.) */}
    </div>
</div>
```

Add `const { settings } = useContext(SettingsContext);` if not already present in `ChatPanel`.

- [ ] **Step 6: Manually test the UI**

Start the dev server:
```bash
cd core/frontend && npm run dev
```

Open the app, load a JFR file, open Chat. Verify:
- Background is darker (`#0f1117`)
- AI messages have a gradient avatar dot on the left
- AI bubbles have asymmetric corners and dark border
- User bubbles are dark teal instead of bright cyan
- Input area is a unified rounded card
- Model badge appears in the header

- [ ] **Step 7: Run full test suite**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass (visual changes don't affect unit tests).

- [ ] **Step 8: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): visual refresh - darker bg, avatar dots, asymmetric bubbles, new input, model badge"
```

---

### Task 6: Inline code styling in AI messages

**Files:**
- Modify: `core/frontend/components/chat/ChatMarkdownView.tsx`

**Context:** react-markdown's `code` renderer currently uses some default styling. We want inline `<code>` (not code blocks) to render as `bg-gray-950 text-cyan-400 px-1 rounded text-[11px]` pills. Code blocks (triple backtick) should keep their existing styling.

- [ ] **Step 1: Update the `code` component override**

In `ChatMarkdownView.tsx`, find the existing `components` object passed to `ReactMarkdown` (or `renderMarkdown`). Find or add the `code` renderer:

```typescript
code({ node, inline, className, children, ...props }: any) {
    if (inline) {
        return (
            <code
                className="bg-gray-950 text-cyan-400 px-1 py-0.5 rounded text-[11px] font-mono"
                {...props}
            >
                {children}
            </code>
        );
    }
    // existing block code rendering unchanged
    return <code className={className} {...props}>{children}</code>;
},
```

> **Note:** In newer versions of react-markdown the `inline` prop may not exist — check if `node.position` or `className` indicates a code block instead. The pattern is: if `className` is undefined or doesn't start with `language-`, it's inline.

- [ ] **Step 2: Visual check**

In the dev server, send a chat message that includes backtick values like `` `48ms` `` or `` `byte[]` ``. Verify they render as small cyan pills, not plain monospace.

- [ ] **Step 3: Commit**

```bash
git add core/frontend/components/chat/ChatMarkdownView.tsx
git commit -m "feat(chat): style inline code as cyan pills in AI messages"
```

---

### Task 7: Manual end-to-end smoke test

This task verifies the whole Phase 1 works together with a real JFR file.

- [ ] **Step 1: Start dev server and load a JFR file**

```bash
cd core/frontend && npm run dev
```

Open the app, drag in any `.jfr` file (or use an existing one from the session).

- [ ] **Step 2: Test embedded chart**

In the chat, send a message. Manually construct a test by temporarily hardcoding an AI response (or use a provider if available) that contains:

```
Here is GC pause over time:
:::cell type=chart
sql: SELECT time_bucket('1s', startTime) AS t, avg(duration) AS pause_ms FROM GarbageCollection GROUP BY t ORDER BY t
plot: LINE_CHART(x: "t", y: ["pause_ms"])
:::
Pauses look healthy.
```

Verify: chart renders inside the bubble, "↗ Add to notebook" appears, clicking it adds a cell.

- [ ] **Step 3: Test embedded table**

Send a response containing:

```
:::cell type=table
sql: SELECT startTime, duration, gcId FROM GarbageCollection ORDER BY startTime LIMIT 20
:::
```

Verify: table renders with scrollbar, row count footer, "↗ Add to notebook" works.

- [ ] **Step 4: Test error handling**

Send a response with bad SQL:

```
:::cell type=table
sql: SELECT * FROM NonExistentTable LIMIT 10
:::
```

Verify: red error message appears inside the cell.

- [ ] **Step 5: Run full test suite one final time**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.
