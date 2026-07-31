# Chat Good Pal — Phase 2: AI-Initiated Queries + Permission System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI the ability to run its own DuckDB queries and mutate the notebook. Permissions are gated once per session (not per call) — after first approval the AI iterates autonomously. Every tool call is recorded in a collapsible trace view. Every mutation is undoable.

**Architecture:** A new `query_data` tool is registered in the tool runtime. `AiService.streamChatWithTools` already handles multi-round tool loops (capped at 10 rounds). Session-level permission state lives in `ChatPanel` — once the user clicks "Allow for this session" on the first `query_data` call, all subsequent calls in that session run silently. `ChatPermissionCard` appears only for the first call of each permission type. `TraceStep[]` is appended to `ChatMessage.meta.trace` on every tool completion — a collapsed "Thinking…" block in the message bubble shows the trace. Settings gains four `aiPerm*` fields for global defaults.

**Tech Stack:** React, Tailwind, existing `AiService`/tool runtime, `DataContext.query()`, Vitest.

**Prerequisite:** Phase 1 complete.

---

## File Map

| File | Change |
|------|--------|
| `services/ai/tools/queryData.ts` | **Create** — `query_data` tool definition + handler |
| `services/ai/tools/index.ts` | **Modify** — register `query_data` in tools array |
| `components/chat/ChatPermissionCard.tsx` | **Create** — first-call approval card; hidden on all subsequent calls once session permission is granted |
| `components/chat/ChatTraceView.tsx` | **Create** — collapsible "Thinking…" trace block rendered inside each AI message bubble |
| `context/SettingsContext.tsx` | **Modify** — add `aiPermQueryData`, `aiPermAddCell`, `aiPermUpdateCell`, `aiPermDeleteCell` |
| `components/SettingsModal.tsx` | **Modify** — add AI Permissions section |
| `components/ChatPanel.tsx` | **Modify** — session permission state, trace capture, visibility toggle, revert button |
| `tests/chat/queryData.test.ts` | **Create** — tool definition + handler unit tests |
| `tests/chat/chatPermissionCard.test.ts` | **Create** — permission card unit tests |
| `tests/chat/chatTraceView.test.ts` | **Create** — trace view unit tests |

---

### Task 1: `query_data` tool definition and handler

**Files:**
- Create: `core/frontend/services/ai/tools/queryData.ts`
- Create: `core/frontend/tests/chat/queryData.test.ts`

**Context:** The tool runtime lives in `services/ai/tools/`. A `Tool` has shape `{ name, description, kind: 'read'|'mutate', inputSchema }`. The handler receives `(args, deps)` and returns a string result. Read `services/ai/tools/index.ts` (first 60 lines) to find the exact `ToolDeps` type and how the DuckDB query method is named (likely `duckdbQuery` or `runQuery`).

- [ ] **Step 1: Read tool runtime to find `ToolDeps`**

```bash
head -60 core/frontend/services/ai/tools/index.ts
```

Note the exact method name on `ToolDeps` for running a SQL query.

- [ ] **Step 2: Write failing tests**

Create `core/frontend/tests/chat/queryData.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { QUERY_DATA_TOOL, handleQueryData } from '../../services/ai/tools/queryData';

describe('QUERY_DATA_TOOL definition', () => {
    it('has kind read', () => {
        expect(QUERY_DATA_TOOL.kind).toBe('read');
    });

    it('has required sql, reason, tables parameters', () => {
        const { properties, required } = QUERY_DATA_TOOL.inputSchema;
        expect(properties).toHaveProperty('sql');
        expect(properties).toHaveProperty('reason');
        expect(properties).toHaveProperty('tables');
        expect(required).toContain('sql');
        expect(required).toContain('reason');
        expect(required).toContain('tables');
    });

    it('tables parameter is an array of strings', () => {
        const tables = QUERY_DATA_TOOL.inputSchema.properties!.tables;
        expect(tables.type).toBe('array');
        expect((tables as any).items?.type).toBe('string');
    });
});

describe('handleQueryData', () => {
    it('runs the sql via deps and returns JSON result', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockResolvedValue({ columns: ['n'], rows: [[42]] }),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT 42 AS n', reason: 'test', tables: ['t'] },
            mockDeps,
        );
        expect(mockDeps.duckdbQuery).toHaveBeenCalledWith('SELECT 42 AS n');
        const parsed = JSON.parse(result);
        expect(parsed.columns).toEqual(['n']);
        expect(parsed.rows[0]).toEqual([42]);
    });

    it('returns error JSON on failure', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockRejectedValue(new Error('Table not found')),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT * FROM bad', reason: 'test', tables: ['bad'] },
            mockDeps,
        );
        const parsed = JSON.parse(result);
        expect(parsed.error).toContain('Table not found');
    });

    it('caps rows at 100 in the returned result', async () => {
        const rows = Array.from({ length: 200 }, (_, i) => [i]);
        const mockDeps = {
            duckdbQuery: vi.fn().mockResolvedValue({ columns: ['i'], rows }),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT i FROM t', reason: 'test', tables: ['t'] },
            mockDeps,
        );
        const parsed = JSON.parse(result);
        expect(parsed.rows.length).toBe(100);
        expect(parsed.totalRows).toBe(200);
    });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/queryData.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `queryData.ts`**

Create `core/frontend/services/ai/tools/queryData.ts` (replace `duckdbQuery` with the field name found in Step 1 if different):

```typescript
import type { Tool } from './index';
import type { ToolDeps } from './index';

export const QUERY_DATA_TOOL: Tool = {
    name: 'query_data',
    kind: 'read',
    description:
        'Run a read-only SQL query against the loaded JFR session data. ' +
        'Always include the reason and the table names you will access — these are shown to the user.',
    inputSchema: {
        type: 'object',
        properties: {
            sql: {
                type: 'string',
                description: 'A read-only SQL SELECT query.',
            },
            reason: {
                type: 'string',
                description: 'One sentence explaining why this query answers the question.',
            },
            tables: {
                type: 'array',
                items: { type: 'string' },
                description: 'Table names this query accesses — shown to the user before running.',
            },
        },
        required: ['sql', 'reason', 'tables'],
    },
};

export async function handleQueryData(
    args: { sql: string; reason: string; tables: string[] },
    deps: ToolDeps,
): Promise<string> {
    try {
        const result = await (deps as any).duckdbQuery(args.sql);
        const { columns, rows } = result as { columns: string[]; rows: unknown[][] };
        return JSON.stringify({ columns, rows: rows.slice(0, 100), totalRows: rows.length });
    } catch (err: unknown) {
        return JSON.stringify({ error: String((err as Error)?.message ?? err) });
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd core/frontend && npx vitest run tests/chat/queryData.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 6: Register the tool**

Read `core/frontend/services/ai/tools/index.ts` lines 1–80 to find:
1. Where tools are listed in a `TOOLS` array or equivalent export
2. Where tool calls are dispatched by name (switch/if-else)

Add:

```typescript
import { QUERY_DATA_TOOL, handleQueryData } from './queryData';

// In TOOLS array:
QUERY_DATA_TOOL,

// In tool dispatch:
case 'query_data':
    return handleQueryData(args, deps);
```

- [ ] **Step 7: Commit**

```bash
git add core/frontend/services/ai/tools/queryData.ts core/frontend/services/ai/tools/index.ts core/frontend/tests/chat/queryData.test.ts
git commit -m "feat(chat): add query_data tool with row-capped handler"
```

---

### Task 2: `ChatPermissionCard` — first-call session gate

**Files:**
- Create: `core/frontend/components/chat/ChatPermissionCard.tsx`
- Create: `core/frontend/tests/chat/chatPermissionCard.test.ts`

**Context:** This card appears exactly **once per session per permission type** — on the first `query_data` call and on the first mutation call. After the user clicks "Allow for this session", the card never shows again in that session (session permission state is held in `ChatPanel`). Three buttons: "Allow for this session" / "Always allow" / "Deny". The card shows: the reason text, the table names accessed, and the first 200 chars of the SQL (for queries).

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/chat/chatPermissionCard.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPermissionCard } from '../../components/chat/ChatPermissionCard';

const queryArgs = {
    sql: 'SELECT class_name, sum(alloc_size) AS total FROM ObjectAllocationInNewTLAB GROUP BY class_name ORDER BY total DESC LIMIT 20',
    reason: 'Find top allocating classes',
    tables: ['ObjectAllocationInNewTLAB'],
};

describe('ChatPermissionCard — query_data', () => {
    it('shows the reason text', () => {
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/Find top allocating classes/)).toBeInTheDocument();
    });

    it('shows table names', () => {
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/ObjectAllocationInNewTLAB/)).toBeInTheDocument();
    });

    it('shows truncated SQL', () => {
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/SELECT class_name/)).toBeInTheDocument();
    });

    it('calls onAllowSession when "Allow for this session" clicked', async () => {
        const onAllowSession = vi.fn();
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={onAllowSession}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Allow for this session/ }));
        expect(onAllowSession).toHaveBeenCalledOnce();
    });

    it('calls onAllowAlways when "Always allow" clicked', async () => {
        const onAllowAlways = vi.fn();
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={vi.fn()}
                onAllowAlways={onAllowAlways}
                onDeny={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Always allow/ }));
        expect(onAllowAlways).toHaveBeenCalledOnce();
    });

    it('calls onDeny when Deny clicked', async () => {
        const onDeny = vi.fn();
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={onDeny}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Deny/ }));
        expect(onDeny).toHaveBeenCalledOnce();
    });
});

describe('ChatPermissionCard — notebook mutation', () => {
    it('shows mutation title for add_cell', () => {
        render(
            <ChatPermissionCard
                toolName="add_cell"
                args={{ type: 'sql', content: 'SELECT 1', afterCellId: 'cell-1' }}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/Allow AI to modify your notebook/i)).toBeInTheDocument();
    });

    it('shows action description for add_cell', () => {
        render(
            <ChatPermissionCard
                toolName="add_cell"
                args={{ type: 'sql', content: 'SELECT 1', afterCellId: 'cell-1' }}
                onAllowSession={vi.fn()}
                onAllowAlways={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/Add sql cell/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/chatPermissionCard.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ChatPermissionCard`**

Create `core/frontend/components/chat/ChatPermissionCard.tsx`:

```typescript
import React from 'react';

const MUTATION_TOOLS = new Set(['add_cell', 'editCell', 'deleteCell', 'applyPlot', 'moveCell']);

interface ChatPermissionCardProps {
    toolName: string;
    args: Record<string, unknown>;
    onAllowSession: () => void;
    onAllowAlways: () => void;
    onDeny: () => void;
}

export function ChatPermissionCard({ toolName, args, onAllowSession, onAllowAlways, onDeny }: ChatPermissionCardProps) {
    const isQuery = toolName === 'query_data';

    return (
        <div className="bg-[#0d1420] border border-[#1e2d3d] rounded-lg p-3 my-2 text-sm">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{isQuery ? '🔍' : '✏️'}</span>
                <span className="font-semibold text-slate-200">
                    {isQuery ? 'Allow AI to query your data?' : 'Allow AI to modify your notebook?'}
                </span>
            </div>

            {isQuery && (
                <>
                    <div className="text-xs text-slate-400 mb-1">
                        <span className="text-slate-500">Reason: </span>
                        {String(args.reason)}
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                        <span className="text-slate-500">Tables: </span>
                        {(args.tables as string[]).join(', ')}
                    </div>
                    <pre className="text-[10px] text-cyan-300/70 bg-gray-950 rounded p-2 overflow-x-auto mb-3 whitespace-pre-wrap font-mono leading-relaxed">
                        {String(args.sql).slice(0, 200)}{String(args.sql).length > 200 ? '…' : ''}
                    </pre>
                </>
            )}

            {MUTATION_TOOLS.has(toolName) && (
                <div className="text-xs text-slate-400 mb-3">
                    <span className="text-slate-500">Action: </span>
                    {toolName === 'add_cell' && `Add ${String(args.type)} cell`}
                    {toolName === 'editCell' && `Edit cell`}
                    {toolName === 'deleteCell' && `Delete cell`}
                    {toolName === 'applyPlot' && `Apply plot config`}
                    {toolName === 'moveCell' && `Move cell`}
                </div>
            )}

            <div className="flex gap-2 flex-wrap">
                <button
                    onClick={onAllowSession}
                    className="px-3 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded cursor-pointer"
                >
                    Allow for this session
                </button>
                <button
                    onClick={onAllowAlways}
                    className="px-3 py-1 text-xs bg-[#1e2d3d] hover:bg-[#263548] text-slate-300 rounded border border-[#2d3f52] cursor-pointer"
                >
                    Always allow
                </button>
                <button
                    onClick={onDeny}
                    className="px-3 py-1 text-xs bg-[#1e2d3d] hover:bg-red-900/30 text-slate-400 hover:text-red-400 rounded border border-[#2d3f52] cursor-pointer"
                >
                    Deny
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run tests**

```bash
cd core/frontend && npx vitest run tests/chat/chatPermissionCard.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatPermissionCard.tsx core/frontend/tests/chat/chatPermissionCard.test.ts
git commit -m "feat(chat): add ChatPermissionCard with session/always/deny buttons"
```

---

### Task 3: Permission settings fields

**Files:**
- Modify: `core/frontend/context/SettingsContext.tsx`
- Modify: `core/frontend/components/SettingsModal.tsx`

- [ ] **Step 1: Read the Settings type definition**

```bash
grep -n "interface Settings\|type Settings\|aiDefaultVisibility\|localBaseUrl" core/frontend/context/SettingsContext.tsx | head -30
```

Note where the `Settings` interface is defined and where `defaultSettings` is.

- [ ] **Step 2: Add permission fields to `Settings` interface**

In `core/frontend/context/SettingsContext.tsx`, in the `Settings` interface, add after the existing AI fields:

```typescript
aiPermQueryData: 'never' | 'ask' | 'always';
aiPermAddCell: 'never' | 'ask' | 'always';
aiPermUpdateCell: 'never' | 'ask' | 'always';
aiPermDeleteCell: 'never' | 'ask' | 'always';
```

In `defaultSettings`, add:

```typescript
aiPermQueryData: 'ask',
aiPermAddCell: 'ask',
aiPermUpdateCell: 'ask',
aiPermDeleteCell: 'ask',
```

- [ ] **Step 3: Run tests to verify no regressions**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Read the SettingsModal local state pattern**

```bash
grep -n "localSettings\|setLocalSettings\|useState\|localSet" core/frontend/components/SettingsModal.tsx | head -20
```

Note the local state variable name (it is likely `localSettings` or `draft`).

- [ ] **Step 5: Add AI Permissions section to `SettingsModal`**

In `core/frontend/components/SettingsModal.tsx`, find a section heading (e.g. the AI section or the last section before the close button). Add after it:

```tsx
{/* AI Permissions */}
<div className="mt-6">
    <h3 className="text-sm font-semibold text-slate-300 mb-3">AI Permissions</h3>
    <div className="space-y-3">
        {(
            [
                { key: 'aiPermQueryData' as const, label: 'Run queries' },
                { key: 'aiPermAddCell' as const, label: 'Create cells' },
                { key: 'aiPermUpdateCell' as const, label: 'Edit cells' },
                { key: 'aiPermDeleteCell' as const, label: 'Delete cells' },
            ]
        ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{label}</span>
                <select
                    value={localSettings[key]}
                    onChange={e =>
                        setLocalSettings(s => ({ ...s, [key]: e.target.value as 'never' | 'ask' | 'always' }))
                    }
                    className="bg-gray-800 border border-gray-700 text-slate-300 text-xs rounded px-2 py-1"
                >
                    <option value="ask">Ask every time</option>
                    <option value="always">Always allow</option>
                    <option value="never">Never allow</option>
                </select>
            </div>
        ))}
    </div>
</div>
```

> **Note:** Replace `localSettings` / `setLocalSettings` with the actual local state variable names found in Step 4.

- [ ] **Step 6: Run tests + visual check**

```bash
cd core/frontend && npx vitest run
```

Open Settings in the dev server. Verify the AI Permissions section appears with four dropdowns, each defaulting to "Ask every time".

- [ ] **Step 7: Commit**

```bash
git add core/frontend/context/SettingsContext.tsx core/frontend/components/SettingsModal.tsx
git commit -m "feat(chat): add aiPerm* settings fields and AI Permissions section"
```

---

### Task 4: `ChatTraceView` — collapsible tool trace in message bubbles

**Files:**
- Create: `core/frontend/components/chat/ChatTraceView.tsx`
- Create: `core/frontend/tests/chat/chatTraceView.test.ts`

**Context:** Each AI message that involved tool calls shows a collapsible "Thinking…" block above the final text. The block is collapsed by default. When expanded it shows each step: icon, tool name, short description (reason for query_data; action for mutations), row count (for query_data), and duration. A "Show full SQL" toggle per step reveals the full SQL.

The `TraceStep` type is:
```typescript
interface TraceStep {
    tool: string;           // 'query_data' | 'add_cell' | etc.
    args: Record<string, unknown>;
    result: string;         // JSON string (parse to get rowCount)
    durationMs: number;
    rowCount?: number;      // pre-parsed convenience field
}
```

`ChatTraceView` receives `steps: TraceStep[]` and renders the collapsed block.

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/chat/chatTraceView.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatTraceView } from '../../components/chat/ChatTraceView';
import type { TraceStep } from '../../components/chat/ChatTraceView';

const steps: TraceStep[] = [
    {
        tool: 'query_data',
        args: { sql: 'SELECT count(*) FROM GarbageCollection', reason: 'Count GC events', tables: ['GarbageCollection'] },
        result: JSON.stringify({ columns: ['count'], rows: [[14]], totalRows: 14 }),
        durationMs: 32,
        rowCount: 14,
    },
    {
        tool: 'query_data',
        args: { sql: 'SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 20', reason: 'Top CPU methods', tables: ['ExecutionSample'] },
        result: JSON.stringify({ columns: ['stackTrace', 'n'], rows: [], totalRows: 20 }),
        durationMs: 118,
        rowCount: 20,
    },
];

describe('ChatTraceView', () => {
    it('renders collapsed by default with step count', () => {
        render(<ChatTraceView steps={steps} />);
        expect(screen.getByText(/Thinking/i)).toBeInTheDocument();
        expect(screen.getByText(/2 queries/i)).toBeInTheDocument();
    });

    it('does not show step details when collapsed', () => {
        render(<ChatTraceView steps={steps} />);
        expect(screen.queryByText(/Count GC events/i)).not.toBeInTheDocument();
    });

    it('shows step details after clicking the header', async () => {
        render(<ChatTraceView steps={steps} />);
        await userEvent.click(screen.getByText(/Thinking/i));
        expect(screen.getByText(/Count GC events/i)).toBeInTheDocument();
        expect(screen.getByText(/Top CPU methods/i)).toBeInTheDocument();
    });

    it('shows row count for query_data steps', async () => {
        render(<ChatTraceView steps={steps} />);
        await userEvent.click(screen.getByText(/Thinking/i));
        expect(screen.getByText(/14 rows/i)).toBeInTheDocument();
        expect(screen.getByText(/20 rows/i)).toBeInTheDocument();
    });

    it('shows total duration in the header', () => {
        render(<ChatTraceView steps={steps} />);
        // total = 32 + 118 = 150ms
        expect(screen.getByText(/150ms/i)).toBeInTheDocument();
    });

    it('reveals full SQL when "Show SQL" is toggled', async () => {
        render(<ChatTraceView steps={steps} />);
        await userEvent.click(screen.getByText(/Thinking/i));
        const showSqlButtons = screen.getAllByRole('button', { name: /show sql/i });
        await userEvent.click(showSqlButtons[0]);
        expect(screen.getByText(/SELECT count\(\*\) FROM GarbageCollection/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/chatTraceView.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ChatTraceView`**

Create `core/frontend/components/chat/ChatTraceView.tsx`:

```typescript
import React, { useState } from 'react';

export interface TraceStep {
    tool: string;
    args: Record<string, unknown>;
    result: string;
    durationMs: number;
    rowCount?: number;
}

interface ChatTraceViewProps {
    steps: TraceStep[];
}

export function ChatTraceView({ steps }: ChatTraceViewProps) {
    const [expanded, setExpanded] = useState(false);
    const [expandedSql, setExpandedSql] = useState<Set<number>>(new Set());

    const totalMs = steps.reduce((s, t) => s + t.durationMs, 0);
    const queryCount = steps.filter(s => s.tool === 'query_data').length;
    const label = queryCount > 0 ? `${queryCount} quer${queryCount === 1 ? 'y' : 'ies'}` : `${steps.length} steps`;

    return (
        <div className="mb-2 text-xs">
            <button
                onClick={() => setExpanded(e => !e)}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-400 cursor-pointer select-none"
            >
                <span>{expanded ? '▼' : '▶'}</span>
                <span className="font-medium">Thinking</span>
                <span className="text-slate-600">({label} · {totalMs}ms)</span>
            </button>

            {expanded && (
                <div className="mt-1 ml-4 border-l border-gray-800 pl-3 space-y-2">
                    {steps.map((step, i) => (
                        <div key={i} className="text-slate-500">
                            <div className="flex items-baseline gap-1.5">
                                <span>{step.tool === 'query_data' ? '🔍' : '✏️'}</span>
                                <span className="text-slate-400">
                                    {step.tool === 'query_data'
                                        ? String(step.args.reason ?? step.tool)
                                        : step.tool}
                                </span>
                                {step.rowCount !== undefined && (
                                    <span className="text-slate-600">{step.rowCount} rows</span>
                                )}
                                <span className="text-slate-700">{step.durationMs}ms</span>
                                {step.tool === 'query_data' && step.args.sql && (
                                    <button
                                        onClick={() =>
                                            setExpandedSql(prev => {
                                                const next = new Set(prev);
                                                next.has(i) ? next.delete(i) : next.add(i);
                                                return next;
                                            })
                                        }
                                        className="text-[10px] text-slate-600 hover:text-slate-400 cursor-pointer ml-1"
                                    >
                                        {expandedSql.has(i) ? 'hide sql' : 'show sql'}
                                    </button>
                                )}
                            </div>
                            {expandedSql.has(i) && step.args.sql && (
                                <pre className="mt-1 text-[10px] text-cyan-300/60 bg-gray-950 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                                    {String(step.args.sql)}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run tests**

```bash
cd core/frontend && npx vitest run tests/chat/chatTraceView.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatTraceView.tsx core/frontend/tests/chat/chatTraceView.test.ts
git commit -m "feat(chat): add ChatTraceView collapsible trace block with per-step SQL toggle"
```

---

### Task 5: Wire permission system and trace capture into `ChatPanel`

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** `ChatPanel` needs to:
1. Hold session permission state: `sessionQueryPerm: 'ask'|'granted'|'denied'` and `sessionMutatePerm: 'ask'|'granted'|'denied'`
2. Before each `query_data` tool call, check global setting + session state; show `ChatPermissionCard` on first call only
3. Capture `TraceStep` for every tool call completion and store in `ChatMessage.meta.trace`
4. Pass `TraceStep[]` from `message.meta?.trace` to `ChatTraceView` in the message render

Read `ChatPanel.tsx` fully before writing any code to understand:
- How tool calls are processed (the existing `ApprovalRecord` / `chooseProposalKind` / `applyApprovalAction` pattern)
- Where tool results are received and stored
- How `ChatMessage` is typed (`meta` field if it exists, or where to add it)

- [ ] **Step 1: Read ChatPanel to understand tool call flow**

```bash
wc -l core/frontend/components/ChatPanel.tsx
grep -n "ApprovalRecord\|chooseProposal\|applyApproval\|toolResult\|ToolResult\|tool_call\|streamChatWithTools\|meta\b" core/frontend/components/ChatPanel.tsx | head -40
```

Note which function processes completed tool calls and where results are appended to messages.

- [ ] **Step 2: Read ChatMessage type**

```bash
grep -rn "interface ChatMessage\|type ChatMessage\|ChatMessage\s*=" core/frontend/services/ai/ core/frontend/components/ | head -20
```

Note whether `meta` already exists on the type. If not, we need to add `meta?: { trace?: TraceStep[] }`.

- [ ] **Step 3: Add `meta.trace` to ChatMessage type**

If `ChatMessage` doesn't already have a `meta` field, add it:

```typescript
interface ChatMessage {
    // ... existing fields
    meta?: {
        trace?: import('./chat/ChatTraceView').TraceStep[];
    };
}
```

If `ChatMessage` is in a shared types file, add it there.

- [ ] **Step 4: Add session permission state**

In `ChatPanel.tsx`, near other `useState` calls:

```typescript
const [sessionQueryPerm, setSessionQueryPerm] = useState<'ask' | 'granted' | 'denied'>('ask');
const [sessionMutatePerm, setSessionMutatePerm] = useState<'ask' | 'granted' | 'denied'>('ask');
const [pendingPermission, setPendingPermission] = useState<{
    tool: string;
    args: Record<string, unknown>;
    resolve: (granted: boolean) => void;
} | null>(null);
```

- [ ] **Step 5: Add trace accumulator ref**

```typescript
const traceRef = useRef<import('./chat/ChatTraceView').TraceStep[]>([]);
```

This ref is reset at the start of each new message exchange and appended to as each tool call completes.

- [ ] **Step 6: Add permission gate before tool execution**

Find where the tool call handler runs a tool (the function that calls `handleQueryData` or dispatches tool calls). Wrap `query_data` calls with permission logic:

```typescript
async function runToolWithPermission(toolName: string, args: Record<string, unknown>, deps: ToolDeps): Promise<string> {
    const globalPerm = settings[toolName === 'query_data' ? 'aiPermQueryData' : 'aiPermAddCell'] as 'never' | 'ask' | 'always';
    const sessionPerm = toolName === 'query_data' ? sessionQueryPerm : sessionMutatePerm;

    if (globalPerm === 'never' || sessionPerm === 'denied') {
        return JSON.stringify({ error: 'Permission denied by user.' });
    }

    if (globalPerm === 'always' || sessionPerm === 'granted') {
        return runTool(toolName, args, deps); // existing dispatch
    }

    // First call of this type — show permission card and wait
    const granted = await new Promise<boolean>(resolve => {
        setPendingPermission({ tool: toolName, args, resolve });
    });

    if (!granted) {
        if (toolName === 'query_data') setSessionQueryPerm('denied');
        else setSessionMutatePerm('denied');
        return JSON.stringify({ error: 'Permission denied by user.' });
    }
    return runTool(toolName, args, deps);
}
```

> **Note:** `runTool` is a placeholder for the existing dispatch. Adapt to the actual pattern in `ChatPanel.tsx`. The key point is that `query_data` and mutation tools go through permission checks; other tools (like `set_variable`) do not.

- [ ] **Step 7: Render `ChatPermissionCard` for pending permission**

In the JSX of `ChatPanel`, below the message list, add:

```tsx
import { ChatPermissionCard } from './chat/ChatPermissionCard';

{pendingPermission && (
    <ChatPermissionCard
        toolName={pendingPermission.tool}
        args={pendingPermission.args}
        onAllowSession={() => {
            if (pendingPermission.tool === 'query_data') setSessionQueryPerm('granted');
            else setSessionMutatePerm('granted');
            pendingPermission.resolve(true);
            setPendingPermission(null);
        }}
        onAllowAlways={() => {
            const key = pendingPermission.tool === 'query_data' ? 'aiPermQueryData' : 'aiPermAddCell';
            updateSettings({ [key]: 'always' });
            if (pendingPermission.tool === 'query_data') setSessionQueryPerm('granted');
            else setSessionMutatePerm('granted');
            pendingPermission.resolve(true);
            setPendingPermission(null);
        }}
        onDeny={() => {
            if (pendingPermission.tool === 'query_data') setSessionQueryPerm('denied');
            else setSessionMutatePerm('denied');
            pendingPermission.resolve(false);
            setPendingPermission(null);
        }}
    />
)}
```

> **Note:** `updateSettings` is a placeholder for the settings update function from `SettingsContext`. Find the actual function name in `ChatPanel.tsx` (it is likely `setSettings` or `updateSettings` from the context).

- [ ] **Step 8: Capture trace steps on tool completion**

Find where tool results are processed (the callback or handler that receives the result after a tool runs). Add trace capture:

```typescript
const startTime = Date.now();
const result = await runToolWithPermission(toolName, args, deps);
const durationMs = Date.now() - startTime;

let rowCount: number | undefined;
try {
    const parsed = JSON.parse(result);
    if (typeof parsed.totalRows === 'number') rowCount = parsed.totalRows;
} catch { /* not JSON */ }

traceRef.current.push({ tool: toolName, args, result, durationMs, rowCount });
```

When the AI's final text message is appended to `messages`, attach the trace:

```typescript
const newMessage: ChatMessage = {
    role: 'assistant',
    content: finalText,
    meta: traceRef.current.length > 0 ? { trace: [...traceRef.current] } : undefined,
};
traceRef.current = []; // reset for next turn
```

- [ ] **Step 9: Render `ChatTraceView` in message bubbles**

In the message render loop, where AI messages are displayed, add above the markdown text:

```tsx
import { ChatTraceView } from './chat/ChatTraceView';

{msg.meta?.trace && msg.meta.trace.length > 0 && (
    <ChatTraceView steps={msg.meta.trace} />
)}
```

- [ ] **Step 10: Manual test the full autonomous loop**

In the dev server with a cloud provider configured:
1. Ask "what are the top allocating classes?" — verify the permission card appears once with reason + tables + SQL
2. Click "Allow for this session" — verify the query runs, AI iterates, and produces an answer with a trace block
3. Ask another question — verify no permission card appears (session granted)
4. Expand the trace block — verify each step shows reason, row count, duration
5. Click "Show SQL" on a step — verify full SQL appears
6. Open Settings → set "Run queries" to Always → reload → ask again — verify no card at all

- [ ] **Step 11: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): wire upfront permission gate and trace capture into ChatPanel"
```

---

### Task 6: Visibility toggle, revert button, and error retry loop

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`
- Modify: `core/frontend/components/chat/ChatEmbeddedCell.tsx`
- Modify: `core/frontend/components/chat/ChatMarkdownView.tsx`

**Context:** Three remaining Phase 2 features: (1) per-session visibility override in the chat header, (2) revert button when AI has mutated the notebook, (3) automatic error feedback loop — when an embedded cell fails, the error is fed back to the AI as a follow-up message and the AI retries up to 2 times.

- [ ] **Step 1: Add session visibility state and toggle**

In `ChatPanel.tsx`, add:

```typescript
const [sessionVisibility, setSessionVisibility] = useState<'no-data' | 'sanitized' | 'full' | null>(null);
const effectiveVisibility = sessionVisibility ?? settings.aiDefaultVisibility;
```

Find every reference to `settings.aiDefaultVisibility` in `ChatPanel.tsx`:

```bash
grep -n "aiDefaultVisibility" core/frontend/components/ChatPanel.tsx
```

Replace each with `effectiveVisibility`.

In the chat header (near the model badge from Phase 1), add the visibility toggle:

```tsx
<div className="flex items-center gap-1">
    {(['no-data', 'sanitized', 'full'] as const).map(v => (
        <button
            key={v}
            onClick={() => setSessionVisibility(v === effectiveVisibility && sessionVisibility !== null ? null : v)}
            className={`px-1.5 py-0.5 text-[10px] rounded border cursor-pointer transition-colors ${
                effectiveVisibility === v
                    ? 'bg-cyan-700/30 border-cyan-600/40 text-cyan-400'
                    : 'bg-transparent border-gray-700/50 text-gray-600 hover:text-gray-400'
            }`}
            title={`Data visibility: ${v}`}
        >
            {v === 'no-data' ? '🔒' : v === 'sanitized' ? '~' : '👁'}{' '}{v.replace('-', ' ')}
        </button>
    ))}
</div>
```

- [ ] **Step 2: Add revert button**

In `ChatPanel.tsx`, add:

```typescript
const [aiHasMutated, setAiHasMutated] = useState(false);
```

In the tool completion handler (same place where trace steps are captured), when a mutation tool completes successfully, set:

```typescript
if (['add_cell', 'editCell', 'deleteCell', 'applyPlot', 'moveCell'].includes(toolName)) {
    setAiHasMutated(true);
}
```

In the chat header, add:

```tsx
{aiHasMutated && onUndoLastAction && (
    <button
        onClick={() => {
            onUndoLastAction();
            setAiHasMutated(false);
        }}
        className="text-[10px] text-amber-500 hover:text-amber-300 cursor-pointer px-1.5 py-0.5 rounded border border-amber-700/30"
        title="Undo the last AI notebook change"
    >
        ↩ Revert
    </button>
)}
```

- [ ] **Step 3: Add `onError` to `ChatEmbeddedCell`**

In `core/frontend/components/chat/ChatEmbeddedCell.tsx`, update the props:

```typescript
interface ChatEmbeddedCellProps {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
    onAddToNotebook: () => void;
    onError?: (error: string, sql: string, type: CellFenceType, plotConfig?: string) => void;
    retryCount?: number;
}
```

In the query `useEffect` catch block, after setting error state:

```typescript
.catch(err => {
    const message = String((err as Error)?.message ?? err);
    setState({ status: 'error', message });
    onError?.(message, sql, type, plotConfig);
});
```

In the error render, add an "Ask AI to fix" button when retries are exhausted:

```tsx
{state.status === 'error' && (
    <div className="px-2 py-1">
        <div className="text-xs text-red-400 font-mono">{state.message}</div>
        {(retryCount ?? 0) >= 2 && (
            <button
                onClick={() => onError?.(state.message, sql, type, plotConfig)}
                className="text-[10px] text-cyan-500 hover:text-cyan-300 cursor-pointer mt-1"
            >
                Ask AI to fix →
            </button>
        )}
    </div>
)}
```

- [ ] **Step 4: Wire error retry in `ChatPanel`**

In `ChatPanel.tsx`, add:

```typescript
const cellRetryCount = useRef<Map<string, number>>(new Map());

const handleCellError = useCallback(
    (error: string, sql: string, type: string, plotConfig?: string) => {
        const count = (cellRetryCount.current.get(sql) ?? 0) + 1;
        cellRetryCount.current.set(sql, count);
        if (count > 2) return;

        // Build the feedback message and re-stream
        // Use the same mechanism as the send button — append to history and call streamChatWithTools
        const feedback = `The ${type} cell failed with error: "${error}". The SQL was:\n\`\`\`sql\n${sql}\n\`\`\`\nPlease fix the SQL and try again.`;
        // find the existing sendMessage/appendAndStream function in ChatPanel and call it here
        sendMessage(feedback, { role: 'system' });
    },
    [],
);
```

> **Note:** Replace `sendMessage` with the actual function found by reading the send button handler in `ChatPanel.tsx`. The key pattern is: append a message to the conversation history and re-invoke `aiService.streamChatWithTools`. Read the existing `handleSend` or equivalent function and replicate the logic.

- [ ] **Step 5: Update `ChatMarkdownView` to accept and pass `onCellError`**

In `ChatMarkdownView.tsx`, add to props interface:

```typescript
onCellError?: (error: string, sql: string, type: CellFenceType, plotConfig?: string) => void;
```

Pass it to each `ChatEmbeddedCell`:

```tsx
<ChatEmbeddedCell
    // ... existing props
    onError={props.onCellError}
    retryCount={/* track per sql key via a useRef Map in ChatMarkdownView, or pass from ChatPanel */}
/>
```

Update `ChatPanel.tsx` to pass `onCellError={handleCellError}` to every `<ChatMarkdownView>`.

- [ ] **Step 6: Run full test suite**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Manual test**

1. Verify visibility toggle changes which data is sent to the AI
2. Let AI add a cell — verify Revert button appears; click it — verify cell reverts and button disappears
3. Send a message that produces a `:::cell` with a misspelled table name — verify:
   - Error shows inline in red
   - AI is automatically re-prompted
   - On 3rd failure, "Ask AI to fix →" button appears

- [ ] **Step 8: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx core/frontend/components/chat/ChatEmbeddedCell.tsx core/frontend/components/chat/ChatMarkdownView.tsx
git commit -m "feat(chat): add visibility toggle, revert button, and automatic cell error retry"
```
