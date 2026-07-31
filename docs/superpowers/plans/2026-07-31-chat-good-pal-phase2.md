# Chat Good Pal — Phase 2: AI-Initiated Queries + Permission System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI the ability to run its own DuckDB queries and mutate the notebook, gated by an inline permission card that shows which tables are accessed. Users can allow per-action or grant session-wide/global permissions. Every mutation is undoable.

**Architecture:** A new `query_data` tool is added to the tool registry. `AiService.streamChatWithTools` already handles tool calls — the tool handler executes the query and returns results. A new `ChatPermissionCard` component intercepts gated tool calls before execution (plugging into the existing `chooseProposalKind` / `applyApprovalAction` pattern). Settings gains four `aiPerm*` fields. A per-session visibility override toggle is added to the chat header. `onBeforeMutate` / `onUndoLastAction` are already wired — we add a "Revert last AI action" button to the header.

**Tech Stack:** React, Tailwind, existing `AiService`/tool runtime, `DataContext.query()`, existing `ChatProposalCard` pattern, Vitest.

**Prerequisite:** Phase 1 complete.

---

## File Map

| File | Change |
|------|--------|
| `services/ai/tools/queryData.ts` | **Create** — `query_data` tool definition + handler |
| `services/ai/tools/index.ts` | **Modify** — register `query_data` in `TOOLS` array |
| `components/chat/ChatPermissionCard.tsx` | **Create** — inline approval card for `query_data` + mutation tools |
| `context/SettingsContext.tsx` | **Modify** — add `aiPermQueryData`, `aiPermAddCell`, `aiPermUpdateCell`, `aiPermDeleteCell` fields |
| `components/SettingsModal.tsx` | **Modify** — add AI Permissions section |
| `components/ChatPanel.tsx` | **Modify** — visibility toggle, revert button, session permission state |
| `tests/chat/queryData.test.ts` | **Create** — tool definition + handler unit tests |
| `tests/chat/chatPermissionCard.test.ts` | **Create** — permission card unit tests |

---

### Task 1: `query_data` tool definition and handler

**Files:**
- Create: `core/frontend/services/ai/tools/queryData.ts`
- Create: `core/frontend/tests/chat/queryData.test.ts`

**Context:** A `Tool` has shape `{ name: string, description: string, kind: 'read'|'mutate', inputSchema: JsonSchema }`. The tool handler receives `(args: any, deps: ToolDeps)` and returns a string result. `ToolDeps` is defined in `services/ai/tools/runtime.ts` — read the first 40 lines to get its exact shape, then use `deps.duckdbQuery(sql)` (or the equivalent field) to run the query.

- [ ] **Step 1: Read `runtime.ts` to find `ToolDeps`**

```bash
head -60 core/frontend/services/ai/tools/runtime.ts
```

Note the exact field name for running a DuckDB query in `ToolDeps`. It is likely `duckdbQuery` or `runQuery`.

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
        expect(tables.items?.type).toBe('string');
    });
});

describe('handleQueryData', () => {
    it('runs the sql via deps and returns stringified result', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockResolvedValue({ columns: ['n'], rows: [[42]] }),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT 42 AS n', reason: 'test', tables: ['t'] },
            mockDeps,
        );
        expect(mockDeps.duckdbQuery).toHaveBeenCalledWith('SELECT 42 AS n');
        expect(result).toContain('42');
    });

    it('returns error string on failure', async () => {
        const mockDeps = {
            duckdbQuery: vi.fn().mockRejectedValue(new Error('Table not found')),
        } as any;
        const result = await handleQueryData(
            { sql: 'SELECT * FROM bad', reason: 'test', tables: ['bad'] },
            mockDeps,
        );
        expect(result).toContain('error');
        expect(result).toContain('Table not found');
    });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd core/frontend && npx vitest run tests/chat/queryData.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `queryData.ts`**

Create `core/frontend/services/ai/tools/queryData.ts`:

```typescript
import type { Tool } from './index';
import type { ToolDeps } from './runtime';

export const QUERY_DATA_TOOL: Tool = {
    name: 'query_data',
    kind: 'read',
    description: 'Run a read-only SQL query against the loaded JFR session data. Always include the reason and the table names you will access — these are shown to the user for approval.',
    inputSchema: {
        type: 'object',
        properties: {
            sql: {
                type: 'string',
                description: 'A read-only SQL SELECT query.',
            },
            reason: {
                type: 'string',
                description: 'One sentence explaining why this query answers the user\'s question.',
            },
            tables: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of table names this query accesses. Used to inform the user before running.',
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
        // Use the correct field from ToolDeps — adjust if the field name differs
        const result = await (deps as any).duckdbQuery(args.sql);
        const { columns, rows } = result as { columns: string[]; rows: any[][] };
        const preview = rows.slice(0, 100);
        return JSON.stringify({ columns, rows: preview, totalRows: rows.length });
    } catch (err: any) {
        return JSON.stringify({ error: String(err?.message ?? err) });
    }
}
```

> **Note:** Replace `deps.duckdbQuery` with the actual field name found in Step 1.

- [ ] **Step 5: Run tests**

```bash
cd core/frontend && npx vitest run tests/chat/queryData.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 6: Register the tool in `index.ts`**

In `core/frontend/services/ai/tools/index.ts`, find the `TOOLS` array (or equivalent export). Add:

```typescript
import { QUERY_DATA_TOOL, handleQueryData } from './queryData';

// In TOOLS array:
QUERY_DATA_TOOL,

// In the tool handler dispatch (wherever tool calls are executed by name):
case 'query_data':
    return handleQueryData(args, deps);
```

> **Note:** Read `index.ts` lines 1–50 to find the exact pattern for registering and dispatching tools.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/services/ai/tools/queryData.ts core/frontend/services/ai/tools/index.ts core/frontend/tests/chat/queryData.test.ts
git commit -m "feat(chat): add query_data tool with permission-aware handler"
```

---

### Task 2: `ChatPermissionCard` component

**Files:**
- Create: `core/frontend/components/chat/ChatPermissionCard.tsx`
- Create: `core/frontend/tests/chat/chatPermissionCard.test.ts`

**Context:** The existing `ChatProposalCard` uses pure helper functions (`chooseProposalKind`, `applyApprovalAction`) and renders an inline card with Approve/Reject buttons. `ChatPermissionCard` follows the same pattern but is specific to `query_data` and notebook mutations. It is rendered in `ChatPanel` when a pending approval record has `name === 'query_data'` or a mutate tool.

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
    it('shows the reason', () => {
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllow={vi.fn()}
                onAllowAll={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/Find top allocating classes/)).toBeInTheDocument();
    });

    it('shows each accessed table name', () => {
        render(
            <ChatPermissionCard
                toolName="query_data"
                args={queryArgs}
                onAllow={vi.fn()}
                onAllowAll={vi.fn()}
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
                onAllow={vi.fn()}
                onAllowAll={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/SELECT class_name/)).toBeInTheDocument();
    });

    it('calls onAllow when Allow clicked', async () => {
        const onAllow = vi.fn();
        render(
            <ChatPermissionCard toolName="query_data" args={queryArgs} onAllow={onAllow} onAllowAll={vi.fn()} onDeny={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Allow$/ }));
        expect(onAllow).toHaveBeenCalledOnce();
    });

    it('calls onAllowAll when "Allow all queries" clicked', async () => {
        const onAllowAll = vi.fn();
        render(
            <ChatPermissionCard toolName="query_data" args={queryArgs} onAllow={vi.fn()} onAllowAll={onAllowAll} onDeny={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Allow all queries/ }));
        expect(onAllowAll).toHaveBeenCalledOnce();
    });

    it('calls onDeny when Deny clicked', async () => {
        const onDeny = vi.fn();
        render(
            <ChatPermissionCard toolName="query_data" args={queryArgs} onAllow={vi.fn()} onAllowAll={vi.fn()} onDeny={onDeny} />,
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
                onAllow={vi.fn()}
                onAllowAll={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByText(/Modify notebook/i)).toBeInTheDocument();
    });

    it('shows "Allow all edits" for mutations', () => {
        render(
            <ChatPermissionCard
                toolName="editCell"
                args={{ cellId: 'cell-1', content: 'SELECT 2' }}
                onAllow={vi.fn()}
                onAllowAll={vi.fn()}
                onDeny={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /Allow all edits/ })).toBeInTheDocument();
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
    args: any;
    onAllow: () => void;
    onAllowAll: () => void;
    onDeny: () => void;
}

export function ChatPermissionCard({ toolName, args, onAllow, onAllowAll, onDeny }: ChatPermissionCardProps) {
    const isQuery = toolName === 'query_data';
    const isMutation = MUTATION_TOOLS.has(toolName);

    return (
        <div className="bg-[#0d1420] border border-[#1e2d3d] rounded-lg p-3 my-2 text-sm">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{isQuery ? '🔍' : '✏️'}</span>
                <span className="font-semibold text-slate-200">
                    {isQuery ? 'Run query?' : 'Modify notebook?'}
                </span>
            </div>

            {isQuery && (
                <>
                    <div className="text-xs text-slate-400 mb-1">
                        <span className="text-slate-500">Reason: </span>{args.reason}
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                        <span className="text-slate-500">Tables accessed: </span>
                        {(args.tables as string[]).join(', ')}
                    </div>
                    <pre className="text-[10px] text-slate-400 bg-gray-950 rounded p-2 overflow-x-auto mb-3 whitespace-pre-wrap font-mono">
                        {args.sql}
                    </pre>
                </>
            )}

            {isMutation && (
                <div className="text-xs text-slate-400 mb-3">
                    <span className="text-slate-500">Action: </span>
                    {toolName === 'add_cell' && `Add ${args.type} cell`}
                    {toolName === 'editCell' && `Edit cell ${args.cellId}`}
                    {toolName === 'deleteCell' && `Delete cell ${args.cellId}`}
                    {toolName === 'applyPlot' && `Apply plot config to cell ${args.cellId}`}
                    {toolName === 'moveCell' && `Move cell ${args.cellId}`}
                    {args.content && (
                        <pre className="text-[10px] text-slate-400 bg-gray-950 rounded p-2 overflow-x-auto mt-1 whitespace-pre-wrap font-mono">
                            {String(args.content).slice(0, 200)}{String(args.content).length > 200 ? '…' : ''}
                        </pre>
                    )}
                </div>
            )}

            <div className="flex gap-2">
                <button
                    onClick={onAllow}
                    className="px-3 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded cursor-pointer"
                >
                    Allow
                </button>
                <button
                    onClick={onAllowAll}
                    className="px-3 py-1 text-xs bg-[#1e2d3d] hover:bg-[#263548] text-slate-300 rounded border border-[#2d3f52] cursor-pointer"
                >
                    {isQuery ? 'Allow all queries' : 'Allow all edits'}
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
git commit -m "feat(chat): add ChatPermissionCard for query_data and notebook mutation approval"
```

---

### Task 3: Permission settings fields

**Files:**
- Modify: `core/frontend/context/SettingsContext.tsx`
- Modify: `core/frontend/components/SettingsModal.tsx`

- [ ] **Step 1: Add permission fields to `Settings` type**

In `core/frontend/context/SettingsContext.tsx`, add to the `Settings` interface:

```typescript
// AI Permissions
aiPermQueryData: 'never' | 'ask' | 'always';
aiPermAddCell: 'never' | 'ask' | 'always';
aiPermUpdateCell: 'never' | 'ask' | 'always';
aiPermDeleteCell: 'never' | 'ask' | 'always';
```

In the `defaultSettings` object, add:

```typescript
aiPermQueryData: 'ask',
aiPermAddCell: 'ask',
aiPermUpdateCell: 'ask',
aiPermDeleteCell: 'ask',
```

- [ ] **Step 2: Run tests to verify no regressions**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass (new fields have defaults, existing consumers unaffected).

- [ ] **Step 3: Add AI Permissions section to `SettingsModal`**

In `core/frontend/components/SettingsModal.tsx`, find the end of the modal content (before the closing tag). Add a new section:

```tsx
{/* AI Permissions */}
<div className="mt-6">
    <h3 className="text-sm font-semibold text-slate-300 mb-3">AI Permissions</h3>
    <div className="space-y-3">
        {(
            [
                { key: 'aiPermQueryData', label: 'Run queries' },
                { key: 'aiPermAddCell', label: 'Create cells' },
                { key: 'aiPermUpdateCell', label: 'Edit cells' },
                { key: 'aiPermDeleteCell', label: 'Delete cells' },
            ] as const
        ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{label}</span>
                <select
                    value={localSettings[key]}
                    onChange={e => setLocalSettings(s => ({ ...s, [key]: e.target.value as any }))}
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

> **Note:** Read the top of `SettingsModal.tsx` to confirm the local state variable name (`localSettings` or similar). Adjust the `onChange` accordingly.

- [ ] **Step 4: Run tests + manual check**

```bash
cd core/frontend && npx vitest run
```

Open Settings in the dev server. Verify the AI Permissions section appears with four dropdowns.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/context/SettingsContext.tsx core/frontend/components/SettingsModal.tsx
git commit -m "feat(chat): add aiPerm* settings fields and AI Permissions section in Settings"
```

---

### Task 4: Wire permission system into `ChatPanel`

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** `ChatPanel` already handles tool approvals via `ApprovalRecord[]` state and the `chooseProposalKind` / `applyApprovalAction` helpers from `ChatProposalCard`. The `query_data` tool is `kind: 'read'` but must always prompt (it's not a normal auto-read). We need to:
1. Add session-level permission state (`sessionAllowQueries`, `sessionAllowMutations`)
2. Check global settings + session state before showing the permission card
3. Render `ChatPermissionCard` for pending `query_data` approvals (alongside existing `ChatProposalCard` for other tools)
4. Add "Allow all" handlers that set session state

- [ ] **Step 1: Add session permission state**

In `ChatPanel.tsx`, add near other `useState` calls:

```typescript
const [sessionAllowQueries, setSessionAllowQueries] = useState(false);
const [sessionAllowMutations, setSessionAllowMutations] = useState(false);
```

- [ ] **Step 2: Override `chooseProposalKind` for `query_data`**

Find where `chooseProposalKind` is called in `ChatPanel.tsx`. Add a special case before it:

```typescript
// query_data is kind='read' but always needs a permission check
// unless the user has granted session or global permission
if (tool.name === 'query_data') {
    const globalPerm = settings.aiPermQueryData;
    if (globalPerm === 'never') {
        // Return a 'rejected' record immediately — no card shown
        return { kind: 'prompt-read' }; // will be shown but auto-denied below
    }
    if (globalPerm === 'always' || sessionAllowQueries) {
        return { kind: 'auto-read' }; // skip the card
    }
    return { kind: 'prompt-read' }; // show the permission card
}
```

> **Note:** Read the surrounding code to understand exactly where `chooseProposalKind` is called and how tool execution is gated. The pattern may differ — adjust to match.

- [ ] **Step 3: Render `ChatPermissionCard` for `query_data` pending approvals**

Find where `ChatProposalCard` is rendered for pending approvals. Add a parallel render for `query_data`:

```tsx
import { ChatPermissionCard } from './chat/ChatPermissionCard';

// In the message render loop, near where ChatProposalCard renders:
{approvals
    .filter(a => a.name === 'query_data' && a.status === 'pending')
    .map(approval => (
        <ChatPermissionCard
            key={approval.id}
            toolName="query_data"
            args={approval.args}
            onAllow={() => {
                // mark approved — existing applyApprovalAction pattern
                setApprovals(prev => applyApprovalAction(prev, { type: 'approve', id: approval.id }));
            }}
            onAllowAll={() => {
                setSessionAllowQueries(true);
                setApprovals(prev => applyApprovalAction(prev, { type: 'approve', id: approval.id }));
            }}
            onDeny={() => {
                setApprovals(prev => applyApprovalAction(prev, { type: 'reject', id: approval.id }));
            }}
        />
    ))
}
```

- [ ] **Step 4: Handle `never` permission — auto-deny**

When `settings.aiPermQueryData === 'never'` and a `query_data` tool call arrives, auto-reject it before showing a card. In the same area where you check `chooseProposalKind`, if the result is `prompt-read` AND `aiPermQueryData === 'never'`, immediately set status to `'rejected'` and return a denial result to the AI.

- [ ] **Step 5: Manual test the permission flow**

In the dev server, with a provider configured:
- Send "what are the top allocating classes?" — verify the permission card appears with the SQL, reason, and table names
- Click Allow — verify the query runs and result appears in the AI response
- Click Allow all queries — verify subsequent queries skip the card
- Open Settings → set "Run queries" to Always → reload — verify no card appears

- [ ] **Step 6: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): wire ChatPermissionCard into ChatPanel with session + global permission state"
```

---

### Task 5: Visibility toggle and Revert button in chat header

**Files:**
- Modify: `core/frontend/components/ChatPanel.tsx`

- [ ] **Step 1: Add session visibility state**

In `ChatPanel.tsx`, add:

```typescript
const [sessionVisibility, setSessionVisibility] = useState<'no-data' | 'sanitized' | 'full' | null>(null);
// null = use global setting
const effectiveVisibility = sessionVisibility ?? settings.aiDefaultVisibility;
```

- [ ] **Step 2: Replace all references to `settings.aiDefaultVisibility` with `effectiveVisibility`**

```bash
grep -n "aiDefaultVisibility" core/frontend/components/ChatPanel.tsx
```

For each hit, replace `settings.aiDefaultVisibility` with `effectiveVisibility`.

- [ ] **Step 3: Add visibility toggle to chat header**

In the header area of ChatPanel (near the model badge added in Phase 1 Task 5), add:

```tsx
<div className="flex items-center gap-1 text-[10px]">
    {(['no-data', 'sanitized', 'full'] as const).map(v => (
        <button
            key={v}
            onClick={() => setSessionVisibility(v === effectiveVisibility && sessionVisibility !== null ? null : v)}
            className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                effectiveVisibility === v
                    ? 'bg-cyan-700/30 border-cyan-600/40 text-cyan-400'
                    : 'bg-transparent border-gray-700 text-gray-600 hover:text-gray-400'
            }`}
        >
            {v === 'no-data' ? '🔒' : v === 'sanitized' ? '~' : '👁'} {v}
        </button>
    ))}
</div>
```

- [ ] **Step 4: Add "Revert last AI action" button**

Add state to track whether AI has mutated anything this session:

```typescript
const [aiHasMutated, setAiHasMutated] = useState(false);
```

Whenever an AI mutation tool call completes successfully, set `setAiHasMutated(true)`. Find where tool results are processed (near `applyApprovalAction` with `type: 'complete'`) and add this flag there.

Then in the header, conditionally render:

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

- [ ] **Step 5: Manual test**

In the dev server:
- Verify the three visibility buttons appear in the header
- Click `👁 full` — verify it overrides global setting for this session
- Let the AI mutate a cell — verify the Revert button appears
- Click Revert — verify the cell reverts and the button disappears

- [ ] **Step 6: Commit**

```bash
git add core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): add session visibility toggle and AI revert button to chat header"
```

---

### Task 6: Error feedback loop (automatic retry)

**Files:**
- Modify: `core/frontend/components/chat/ChatEmbeddedCell.tsx`
- Modify: `core/frontend/components/ChatPanel.tsx`

**Context:** When `ChatEmbeddedCell` gets a SQL error, it shows the error inline. We need to also feed that error back to the AI automatically (up to 2 retries). `ChatEmbeddedCell` needs an `onError` callback. `ChatPanel` intercepts this and appends a system message then re-invokes the AI.

- [ ] **Step 1: Add `onError` callback to `ChatEmbeddedCell`**

In `core/frontend/components/chat/ChatEmbeddedCell.tsx`, update the props interface:

```typescript
interface ChatEmbeddedCellProps {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
    onAddToNotebook: () => void;
    onError?: (error: string, sql: string, type: CellFenceType, plotConfig?: string) => void;
    retryCount?: number;  // shown in header if > 0
}
```

In the `useEffect` catch block, after setting state:

```typescript
.catch(err => {
    const message = String(err?.message ?? err);
    setState({ status: 'error', message });
    onError?.(message, sql, type, plotConfig);
});
```

In the error render, show retry count if > 0 and add the "Ask AI to fix" button after 2 retries:

```tsx
{state.status === 'error' && (
    <div>
        <div className="text-xs text-red-400 py-2 px-1 font-mono">{state.message}</div>
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

- [ ] **Step 2: Add retry logic in `ChatPanel`**

In `ChatPanel.tsx`, add retry state:

```typescript
const cellRetryCount = useRef<Map<string, number>>(new Map());
```

Add a `handleCellError` callback:

```typescript
const handleCellError = useCallback((error: string, sql: string, type: string, plotConfig?: string) => {
    const key = sql;
    const count = (cellRetryCount.current.get(key) ?? 0) + 1;
    cellRetryCount.current.set(key, count);

    if (count > 2) return; // stop after 2 retries

    // Append a system feedback message and re-invoke the AI
    const feedbackMsg: ToolChatMessage = {
        role: 'user',
        content: `The ${type} cell failed to render with this error: "${error}". The SQL was: \`${sql}\`. Please fix the SQL and try again.`,
    };
    // Use the existing sendMessage mechanism — append to tool history and re-stream
    // Find the existing function in ChatPanel that appends to toolHistory and calls streamChatWithTools
    appendAndStream(feedbackMsg);
}, [/* existing deps */]);
```

> **Note:** `appendAndStream` is a placeholder name. Read `ChatPanel.tsx` around the send button handler to find the actual function that appends a message to `toolHistory` and calls `aiService.streamChatWithTools`. Use that pattern directly.

Pass `onError={handleCellError}` to every `ChatEmbeddedCell` rendered via `ChatMarkdownView`:

```tsx
<ChatMarkdownView
    text={msg.text}
    onNavigateRef={onNavigateRef}
    onAddToNotebook={handleAddCellFromFence}
    onCellError={handleCellError}
/>
```

Update `ChatMarkdownView` props to accept and pass through `onCellError`:

```typescript
interface ChatMarkdownViewProps {
    // ... existing
    onCellError?: (error: string, sql: string, type: CellFenceType, plotConfig?: string) => void;
}
```

Pass it to each `ChatEmbeddedCell`:

```tsx
<ChatEmbeddedCell
    // ... existing props
    onError={onCellError}
    retryCount={/* track per sql key, or omit for simplicity */}
/>
```

- [ ] **Step 3: Run tests**

```bash
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Manual test error retry**

Send a message that produces a `:::cell` with bad SQL (e.g. misspelled table name). Verify:
- Error appears inline in red
- AI is automatically re-prompted
- AI produces a corrected query
- After 2 failures, "Ask AI to fix →" button appears

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/chat/ChatEmbeddedCell.tsx core/frontend/components/chat/ChatMarkdownView.tsx core/frontend/components/ChatPanel.tsx
git commit -m "feat(chat): add automatic error feedback loop - AI retries failed cells up to 2 times"
```
