# M-E3 Command Palette Scoping Prefixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-character scope prefix keys to the command palette so users can type `t:`, `v:`, `m:`, `@`, `c:`, `/` (content), or `k:` to instantly narrow to one category, with a context-aware placeholder and an always-last "✨ Ask AI" sentinel in unscoped mode.

**Architecture:** The existing `parsePaletteQuery` function already handles the `k:<scope> <needle>` long-form and the `/` content-mode prefix. This plan extends it to recognise seven short single-character/two-character prefixes, maps each to an existing `ResultKind`, and updates the placeholder text in the input. The `providersByKind` dispatch table and `ResultRow` components are unchanged. The "ask-ai" sentinel is demoted from "only appears when no results" to "always last in unscoped all-mode when needle is non-empty", which requires a small sort-order tweak in `CommandPalette.tsx`. The `PaletteContext` interface gains a `schemaExplorer` field so live DuckDB table names flow in from `AppShell`.

**Tech Stack:** TypeScript, React 19, Vitest, @testing-library/react, @testing-library/user-event.

---

## File Structure

**Modify:**
- `src/services/palette/parsePaletteQuery.ts` — extend the parser to recognise the new short-prefix syntax; returns a new `placeholder` string in `ParsedQuery`.
- `src/services/palette/types.ts` — add `placeholder` to `ParsedQuery`; add `schemaExplorer?: { tables: string[] }` to `PaletteContext`.
- `src/services/palette/resultProviders.ts` — update `tablesProvider` to also use `ctx.schemaExplorer.tables`; keep `ctx.catalog.tables` as fallback.
- `src/components/palette/CommandPalette.tsx` — read `parsedQuery.placeholder` and pass it to the `<input>`; fix the "ask-ai always-last" sorting invariant.
- `src/components/shell/AppShell.tsx` — pass live `schemaExplorer` tables into `paletteCtx`.

**Create:**
- `src/__tests__/palette/parsePaletteQuery.test.ts` — comprehensive unit tests for the extended parser.
- `src/__tests__/palette/paletteScoping.test.tsx` — integration tests verifying scoping behaviour in the full rendered palette.

---

### Task 1: Extend `ParsedQuery` type and parser

**Files:**
- Modify: `src/services/palette/types.ts`
- Modify: `src/services/palette/parsePaletteQuery.ts`
- Create: `src/__tests__/palette/parsePaletteQuery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/palette/parsePaletteQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePaletteQuery } from '../../services/palette/parsePaletteQuery';

describe('parsePaletteQuery — short-prefix scoping', () => {
  it('empty query returns all-mode with default placeholder', () => {
    const r = parsePaletteQuery('');
    expect(r.mode).toBe('all');
    expect(r.needle).toBe('');
    expect(r.placeholder).toBe('Type a command, query, or table… (t: v: m: @ c: k:)');
  });

  it('t: with no needle scopes to table, empty needle', () => {
    const r = parsePaletteQuery('t:');
    expect(r.mode).toBe('scoped');
    expect(r.scope).toBe('table');
    expect(r.needle).toBe('');
    expect(r.placeholder).toBe('Search tables…');
  });

  it('t:gc scopes to table with needle "gc"', () => {
    const r = parsePaletteQuery('t:gc');
    expect(r.mode).toBe('scoped');
    expect(r.scope).toBe('table');
    expect(r.needle).toBe('gc');
  });

  it('v: scopes to view', () => {
    expect(parsePaletteQuery('v:foo').scope).toBe('view');
    expect(parsePaletteQuery('v:').placeholder).toBe('Search views…');
  });

  it('m: scopes to macro', () => {
    expect(parsePaletteQuery('m:').scope).toBe('macro');
    expect(parsePaletteQuery('m:').placeholder).toBe('Search macros…');
  });

  it('@ scopes to cell (aliases)', () => {
    const r = parsePaletteQuery('@gc_overview');
    expect(r.mode).toBe('scoped');
    expect(r.scope).toBe('cell');
    expect(r.needle).toBe('gc_overview');
    expect(r.placeholder).toBe('Jump to cell…');
  });

  it('@ alone returns scoped cell mode with empty needle', () => {
    const r = parsePaletteQuery('@');
    expect(r.scope).toBe('cell');
    expect(r.needle).toBe('');
  });

  it('c: scopes to command', () => {
    const r = parsePaletteQuery('c:run');
    expect(r.scope).toBe('command');
    expect(r.needle).toBe('run');
    expect(r.placeholder).toBe('Search commands…');
  });

  it('k: with shortcut word scopes to shortcut (existing long-form)', () => {
    const r = parsePaletteQuery('k:shortcuts gc');
    expect(r.scope).toBe('shortcut');
    expect(r.needle).toBe('gc');
  });

  it('/ still enters content mode', () => {
    const r = parsePaletteQuery('/SELECT');
    expect(r.mode).toBe('content');
    expect(r.needle).toBe('SELECT');
    expect(r.placeholder).toBe('Search cell content…');
  });

  it('plain text returns all-mode', () => {
    const r = parsePaletteQuery('gc');
    expect(r.mode).toBe('all');
    expect(r.needle).toBe('gc');
  });

  it('t: prefix is parsed greedily — t:gc table is not a "t" scope + "gc table"', () => {
    const r = parsePaletteQuery('t:gc table');
    expect(r.scope).toBe('table');
    expect(r.needle).toBe('gc table');
  });
});

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run parsePaletteQuery`
Expected: FAIL — `placeholder` field does not exist on `ParsedQuery`; `t:`, `v:`, `m:`, `@`, `c:` are not recognised scopes.

- [ ] **Step 3: Add `placeholder` to `ParsedQuery` in `src/services/palette/types.ts`**

Current `ParsedQuery` interface ends at line 44. Add the `placeholder` field:

```ts
export interface ParsedQuery {
  mode: 'all' | 'scoped' | 'content';
  scope?: ResultKind;
  needle: string;
  /** Placeholder text to show in the palette input for this parse state. */
  placeholder: string;
}
```

- [ ] **Step 4: Extend `parsePaletteQuery` to recognise short prefixes**

Replace the entire body of `src/services/palette/parsePaletteQuery.ts` with:

```ts
import type { ParsedQuery, ResultKind } from './types';

// Long-form scope aliases (k:<word>) — unchanged from before.
const SCOPE_ALIASES: Record<string, ResultKind> = {
  cells: 'cell', cell: 'cell',
  vars: 'var', var: 'var',
  cmds: 'command', cmd: 'command', commands: 'command', command: 'command',
  tables: 'table', table: 'table',
  views: 'view', view: 'view',
  macros: 'macro', macro: 'macro',
  files: 'file', file: 'file',
  recent: 'recent',
  shortcuts: 'shortcut', shortcut: 'shortcut',
  snippets: 'snippet', snippet: 'snippet',
  settings: 'setting', setting: 'setting',
  prompts: 'prompt', prompt: 'prompt',
};

// Short single/two-character prefixes introduced in M-E3.
const SHORT_PREFIXES: Array<{ prefix: string; scope: ResultKind; placeholder: string }> = [
  { prefix: 't:', scope: 'table',   placeholder: 'Search tables…'    },
  { prefix: 'v:', scope: 'view',    placeholder: 'Search views…'     },
  { prefix: 'm:', scope: 'macro',   placeholder: 'Search macros…'    },
  { prefix: 'c:', scope: 'command', placeholder: 'Search commands…'  },
];

const DEFAULT_PLACEHOLDER = 'Type a command, query, or table… (t: v: m: @ c: k:)';

export function parsePaletteQuery(input: string): ParsedQuery {
  // Content search: /needle
  if (input.startsWith('/')) {
    return {
      mode: 'content',
      needle: input.slice(1),
      placeholder: 'Search cell content…',
    };
  }

  // Cell-alias jump: @needle
  if (input.startsWith('@')) {
    return {
      mode: 'scoped',
      scope: 'cell',
      needle: input.slice(1),
      placeholder: 'Jump to cell…',
    };
  }

  // Short prefix: t: v: m: c:
  for (const entry of SHORT_PREFIXES) {
    if (input.startsWith(entry.prefix)) {
      return {
        mode: 'scoped',
        scope: entry.scope,
        needle: input.slice(entry.prefix.length),
        placeholder: entry.placeholder,
      };
    }
  }

  // Long-form: k:<word> [needle]
  const m = /^k:([a-zA-Z]+)(?:\s+(.*))?$/.exec(input);
  if (m !== null) {
    const scope = SCOPE_ALIASES[m[1].toLowerCase()];
    if (scope !== undefined) {
      const placeholder = `Search ${m[1].toLowerCase()}…`;
      return { mode: 'scoped', scope, needle: (m[2] ?? '').trim(), placeholder };
    }
  }

  return { mode: 'all', needle: input.trim(), placeholder: DEFAULT_PLACEHOLDER };
}
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run parsePaletteQuery`
Expected: PASS — all 12 cases.

- [ ] **Step 6: Commit**

```bash
git add src/services/palette/types.ts src/services/palette/parsePaletteQuery.ts \
        src/__tests__/palette/parsePaletteQuery.test.ts
git commit -m "feat(palette): M-E3 short-prefix scoping parser with placeholder text"
```

---

### Task 2: Wire `placeholder` into `CommandPalette` and fix "ask-ai always-last"

**Files:**
- Modify: `src/components/palette/CommandPalette.tsx`

Currently the palette renders a static placeholder string on line 159 and the ask-ai fallback only appears when `nonStubMatches.length === 0`. M-E3 requires:
1. The placeholder changes to match the active scope.
2. In all-mode with a non-empty needle, the ask-ai item is always last (after all ranked real results), not gated on "no results".

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/palette/CommandPalette.test.tsx` (inside the existing `describe('CommandPalette', ...)`):

```tsx
it('t: prefix shows "Search tables…" placeholder', async () => {
  const user = userEvent.setup();
  render(harness(true));
  await user.type(screen.getByTestId('palette-input'), 't:');
  const input = screen.getByTestId('palette-input');
  expect(input).toHaveAttribute('placeholder', 'Search tables…');
});

it('@ prefix shows "Jump to cell…" placeholder', async () => {
  const user = userEvent.setup();
  render(harness(true));
  await user.type(screen.getByTestId('palette-input'), '@');
  const input = screen.getByTestId('palette-input');
  expect(input).toHaveAttribute('placeholder', 'Jump to cell…');
});

it('ask-ai is always the last item in all-mode when needle is non-empty', async () => {
  const user = userEvent.setup();
  render(harness(true));
  await user.type(screen.getByTestId('palette-input'), 'gc');
  const rows = await screen.findAllByTestId('palette-result');
  // At least one non-ai result should precede the ai one.
  const lastKind = rows[rows.length - 1]?.getAttribute('data-kind');
  expect(lastKind).toBe('ask-ai');
  expect(rows.length).toBeGreaterThan(1);
});

it('t: scoping hides all non-table results', async () => {
  const user = userEvent.setup();
  render(harness(true));
  await user.type(screen.getByTestId('palette-input'), 't:');
  const rows = await screen.findAllByTestId('palette-result');
  for (const r of rows) {
    expect(r.getAttribute('data-kind')).toBe('table');
  }
});

it('c: scoping shows only command results', async () => {
  const user = userEvent.setup();
  render(harness(true));
  await user.type(screen.getByTestId('palette-input'), 'c:');
  const rows = await screen.findAllByTestId('palette-result');
  for (const r of rows) {
    expect(r.getAttribute('data-kind')).toBe('command');
  }
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run CommandPalette`
Expected: FAIL — placeholder does not update; ask-ai may not be last when real results exist.

- [ ] **Step 3: Update `CommandPalette.tsx`**

In `src/components/palette/CommandPalette.tsx`, make the following changes:

a. The `placeholder` for the input currently is static (line 159). Replace it with the parsed value:

```tsx
// In the results useMemo (already at line 66), destructure placeholder:
const { results, placeholder } = useMemo(() => {
  if (!open) return { results: [], placeholder: 'Type a command, query, or table… (t: v: m: @ c: k:)' };
  const parsed = parsePaletteQuery(query);
  if (parsed.mode === 'content') {
    return {
      results: providersByKind.content(parsed.needle, context),
      placeholder: parsed.placeholder,
    };
  }
  if (parsed.mode === 'scoped' && parsed.scope !== undefined) {
    return {
      results: providersByKind[parsed.scope](parsed.needle, context),
      placeholder: parsed.placeholder,
    };
  }
  // All-mode: gather every kind, sort by priority, append ask-ai always-last.
  const all: Result[] = [];
  for (const kind of ORDERED_KINDS) {
    all.push(...providersByKind[kind](parsed.needle, context));
  }
  const nonAi = all.filter((r) => r.kind !== 'ask-ai').sort((a, b) => b.priority - a.priority);
  const askAi = parsed.needle.length > 0 ? providersByKind['ask-ai'](parsed.needle, context) : [];
  return {
    results: [...nonAi, ...askAi],
    placeholder: parsed.placeholder,
  };
}, [open, query, context]);
```

b. Update the `<input>` element's `placeholder` prop (line ~159):

```tsx
placeholder={placeholder}
```

c. Remove the old standalone `results` state derivation (lines 66–84) and the old `results` reference — the destructured value above replaces it.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run CommandPalette`
Expected: PASS — all pre-existing tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/components/palette/CommandPalette.tsx \
        src/__tests__/palette/CommandPalette.test.tsx
git commit -m "feat(palette): M-E3 dynamic placeholder + ask-ai always-last in all-mode"
```

---

### Task 3: Feed live DuckDB table names into `PaletteContext`

`t:` scoping is only useful if the context actually contains the live DuckDB tables. Currently `paletteCtx.catalog.tables` is built from a static list. The live `useSchemaExplorer` hook exists in the `TablesPanel` but its results are not wired into `PaletteContext`. This task adds a `schemaExplorer` field to `PaletteContext` and populates it in `AppShell`.

**Files:**
- Modify: `src/services/palette/types.ts`
- Modify: `src/services/palette/resultProviders.ts`
- Modify: `src/components/shell/AppShell.tsx`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/palette/parsePaletteQuery.test.ts`, add a provider-level test. Create a new file `src/__tests__/palette/resultProviders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { providersByKind } from '../../services/palette/resultProviders';
import type { PaletteContext } from '../../services/palette/types';

describe('tablesProvider — schemaExplorer integration', () => {
  it('uses schemaExplorer.tables when catalog.tables is absent', () => {
    const ctx: PaletteContext = {
      schemaExplorer: { tables: ['live_table_a', 'live_table_b'] },
    };
    const results = providersByKind.table('', ctx);
    const titles = results.map((r) => r.title);
    expect(titles).toContain('live_table_a');
    expect(titles).toContain('live_table_b');
  });

  it('merges schemaExplorer and catalog.tables deduplicating', () => {
    const ctx: PaletteContext = {
      schemaExplorer: { tables: ['shared', 'live_only'] },
      catalog: { tables: ['shared', 'catalog_only'], views: [], macros: [] },
    };
    const results = providersByKind.table('', ctx);
    const titles = results.map((r) => r.title);
    expect(titles.filter((t) => t === 'shared')).toHaveLength(1);
    expect(titles).toContain('live_only');
    expect(titles).toContain('catalog_only');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run resultProviders`
Expected: FAIL — `schemaExplorer` does not exist on `PaletteContext`.

- [ ] **Step 3: Add `schemaExplorer` to `PaletteContext`**

In `src/services/palette/types.ts`, add the optional field to `PaletteContext`:

```ts
export interface PaletteContext {
  notebook?: {
    cells: {
      alias: string | null;
      displayIndex: number;
      blocks: { kind: string; source: string }[];
    }[];
  };
  catalog?: { tables: string[]; views: string[]; macros: string[] };
  /** Live DuckDB table list from useSchemaExplorer — merged with catalog.tables. */
  schemaExplorer?: { tables: string[] };
}
```

- [ ] **Step 4: Update `tablesProvider` in `resultProviders.ts` to merge sources**

Replace lines 139–147 in `src/services/palette/resultProviders.ts`:

```ts
const tablesProvider: Provider = (query, ctx) => {
  const catalogTables = ctx.catalog?.tables ?? [];
  const schemaTables = ctx.schemaExplorer?.tables ?? [];
  // Deduplicate: schemaExplorer is authoritative (live), catalog fills gaps.
  const seen = new Set<string>(schemaTables);
  const merged = [...schemaTables, ...catalogTables.filter((t) => !seen.has(t))];
  return rankAll(merged, query, (t) => t).map((t) => ({
    kind: 'table',
    id: `table:${t}`,
    title: t,
    priority: KIND_PRIORITY.table,
    payload: { schema: '(schema TBD)' },
    activate: () => console.info(`[palette] describe table ${t}`),
  }));
};
```

- [ ] **Step 5: Populate `schemaExplorer` in `AppShell`**

`AppShell` does not currently have a DuckDB client or schema state. The client lives in `NotebookView` / the DuckDB context. The cleanest approach that requires no new context is to read from `liveSchemaStore` which is a separate singleton populated by the schema refresh flow.

Check whether `liveSchemaStore` exposes tables:

```bash
grep -n "export\|tables\|getSnapshot" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/schema/liveSchemaStore.ts
```

If `liveSchemaStore.getSnapshot()` returns `{ tables: string[] }`, use it directly. Otherwise use an optional `schemaExplorer` prop threaded down from the parent.

For maximum compatibility: Add an optional `schemaExplorer?: { tables: string[] }` prop to `AppShellProps` and thread it from the root render site. If the schema is unavailable (welcome screen), the prop is `undefined`, which is safe.

In `src/components/shell/AppShell.tsx`:

```ts
// Add to AppShellProps:
interface AppShellProps {
  children: ReactNode;
  notebook?: Notebook;
  schemaExplorer?: { tables: string[] };
}

// In AppShellInner, update paletteCtx:
const paletteCtx: PaletteContext = {
  notebook: notebook ? { cells: notebook.cells.map(/* existing mapping */) } : undefined,
  schemaExplorer: props.schemaExplorer,
};
```

(The exact mapping for notebook cells is already at AppShell.tsx:92–98 — leave it unchanged.)

- [ ] **Step 6: Run the resultProviders tests**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run resultProviders`
Expected: PASS — 2 new cases.

- [ ] **Step 7: Run the full palette suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run palette`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/services/palette/types.ts src/services/palette/resultProviders.ts \
        src/components/shell/AppShell.tsx \
        src/__tests__/palette/resultProviders.test.ts
git commit -m "feat(palette): M-E3 live table names via schemaExplorer in PaletteContext"
```

---

### Task 4: Integration test — full scoping prefix matrix

**Files:**
- Create: `src/__tests__/palette/paletteScoping.test.tsx`

This task adds a focused end-to-end render test for each prefix. It exercises the full `CommandPalette` component (not just the parser) to confirm that the correct result kinds appear and wrong ones are hidden.

- [ ] **Step 1: Write the test**

Create `src/__tests__/palette/paletteScoping.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPalette } from '../../components/palette/CommandPalette';
import { SettingsProvider } from '../../context/SettingsContext';
import type { PaletteContext } from '../../services/palette/types';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function ctx(): PaletteContext {
  return {
    notebook: {
      cells: [
        { alias: 'gc_overview', displayIndex: 1, blocks: [{ kind: 'sql', source: 'SELECT 1' }] },
      ],
    },
    catalog: { tables: ['gc_events'], views: ['gc_view'], macros: ['gc_macro'] },
    schemaExplorer: { tables: ['live_gc_table'] },
  };
}

function harness(): ReactElement {
  return (
    <SettingsProvider>
      <CommandPalette open onOpenChange={() => {}} context={ctx()} />
    </SettingsProvider>
  );
}

async function typePrefix(user: ReturnType<typeof userEvent.setup>, prefix: string): Promise<void> {
  await user.type(screen.getByTestId('palette-input'), prefix);
}

describe('M-E3 palette scoping — prefix matrix', () => {
  it('t: shows only table results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 't:');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('table');
  });

  it('t: includes live schemaExplorer tables', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 't:');
    const rows = await screen.findAllByTestId('palette-result');
    const titles = rows.map((r) => r.textContent);
    expect(titles.some((t) => t?.includes('live_gc_table'))).toBe(true);
  });

  it('v: shows only view results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 'v:');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('view');
  });

  it('m: shows only macro results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 'm:');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('macro');
  });

  it('@ shows only cell results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, '@');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('cell');
  });

  it('c: shows only command results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 'c:');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('command');
  });

  it('no prefix shows mixed results', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 'gc');
    const rows = await screen.findAllByTestId('palette-result');
    const kinds = new Set(rows.map((r) => r.getAttribute('data-kind')));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('ask-ai is the very last row in all-mode when needle is non-empty', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 'gc');
    const rows = await screen.findAllByTestId('palette-result');
    const lastKind = rows[rows.length - 1]?.getAttribute('data-kind');
    expect(lastKind).toBe('ask-ai');
  });

  it('ask-ai does NOT appear in scoped mode', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 't:');
    const rows = screen.queryAllByTestId('palette-result');
    const hasAi = rows.some((r) => r.getAttribute('data-kind') === 'ask-ai');
    expect(hasAi).toBe(false);
  });

  it('scoped needle — t:gc narrows tables matching "gc"', async () => {
    const user = userEvent.setup();
    render(harness());
    await typePrefix(user, 't:gc');
    const rows = await screen.findAllByTestId('palette-result');
    // All results must be table kind
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('table');
    // The gc_events table must appear
    expect(rows.some((r) => r.textContent?.includes('gc_events'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run paletteScoping`
Expected: FAIL — `t:` prefix not yet recognised by the palette component (Tasks 1–3 not yet landed in this run order, or pending).

- [ ] **Step 3: Confirm pass after Tasks 1–3 are complete**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run paletteScoping`
Expected: PASS — all 10 cases.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/palette/paletteScoping.test.tsx
git commit -m "test(palette): M-E3 integration matrix for all scoping prefixes"
```

---

### Task 5: Build check + full suite

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test`
Expected: all tests pass. Baseline is ~2028; this plan adds ~30 new tests.

- [ ] **Step 2: TypeScript build**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run build`
Expected: no type errors.

- [ ] **Step 3: Smoke test in browser**

`npm run dev` — open the notebook, press ⌘K.
1. Type `t:` — placeholder says "Search tables…", only table rows appear.
2. Type `v:` — only view rows appear.
3. Type `m:` — only macro rows.
4. Type `@gc` — only cells matching "gc" appear.
5. Type `c:run` — only commands matching "run".
6. Type `gc` (no prefix) — mixed rows, "✨ Ask AI" is the last row.
7. Type `/SELECT` — content search rows only, all from cell bodies containing "SELECT".

- [ ] **Step 4: Commit smoke fixes if needed**

```bash
git add -p
git commit -m "chore: smoke fixes for M-E3 palette scoping"
```

---

## Self-Review

**Spec coverage:**
- `t:` → Task 1 parser + Task 3 live tables + Task 4 integration ✓
- `v:` → Task 1 parser + Task 4 integration ✓
- `m:` → Task 1 parser + Task 4 integration ✓
- `@` cell aliases → Task 1 parser + Task 4 integration ✓
- `c:` commands → Task 1 parser + Task 4 integration ✓
- `/` slash content search → preserved in Task 1 (existing mode, now adds placeholder) ✓
- `k:` keyboard shortcuts → preserved long-form in Task 1 ✓
- Placeholder text changes on scope → Task 2 ✓
- Items from other categories hidden (not de-ranked) → Task 2 (scoped mode uses single provider) ✓
- "✨ Ask AI" always-last in all-mode → Task 2 ✓
- "✨ Ask AI" never first result → ensured by positioning after `nonAi` sort ✓
- Live table names for `t:` → Task 3 ✓

**Placeholder scan:** No TBD or "similar to Task N" patterns.

**Type consistency:**
- `ParsedQuery.placeholder: string` is set in every branch of `parsePaletteQuery` (non-nullable).
- `PaletteContext.schemaExplorer` is `| undefined` — the `tablesProvider` handles the absent case with `?? []`.
- `providersByKind` dispatch table is unchanged; adding `schemaExplorer` to context is purely additive.
```

---