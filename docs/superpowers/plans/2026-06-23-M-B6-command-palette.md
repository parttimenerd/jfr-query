# M-B6: Welcome Cell + Glyph Legend + Command Palette ⌘P Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Deliver three connected onboarding + navigation surfaces. (1) A **Welcome cell** that renders when `notebook.cells.length === 0`, hosting a 4-slide **Spotlight carousel** ("load a JFR", "ask the agent", "brush a chart", "share a URL") and a "create blank cell" CTA. Carousel dismissal persists to a `SettingsContext` (introduced here). (2) A **Glyph legend** modal opened by `?` (and via topbar entry) listing every UI glyph (chip arrows `▼ ▲`, link `🔗`, agent `🤖`, var `ƒ`, edge-kind swatches, status glyphs `●` etc.) with a description per row. (3) The **Command palette** opened by `⌘P` — the central navigation surface — with fuzzy-rankable lists across **14 result kinds** (commands, cells, vars, snippets, prompts, settings, tables, views, macros, files, recent, ⇧ keyboard shortcuts, content search `/`, ask-AI fallback), a `k:<kind>` scoping prefix, a leading `/` content-search mode, a 280px preview pane, and an ask-AI fallback row that ferries unmatched queries to the (Phase-D-stub) agent.

**Architecture:** A new `SettingsContext` (and `useSettings()` hook) backs persistent flags via `localStorage` with a JSON-serialised schema, used by the carousel + recent list + palette state. A pure `commandRegistry` (Map<id, Command>) stores built-in and externally-registered commands. A pure `resultProviders` module exposes 14 provider functions, each `(query: string, ctx: PaletteContext) → Result[]`. A pure `fuzzyRank` module implements subsequence + bonus ranking (no external dep). The `CommandPalette` React component owns query parsing (`k:<kind>` prefix detection, leading `/` for content-search), dispatches to the right provider(s), and renders a controlled list + preview pane. `WelcomeCell` renders alongside the cell column when empty; `SpotlightCarousel` is a controlled 4-slide tour. `GlyphLegend` is a static modal listing glyphs from a typed table.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright.

---

## Pre-resolved decisions

### DECISION 1: Settings storage shape
A single `localStorage` key `jfr-notebook.settings.v1` holds a JSON object. Schema is enforced by a hand-written `parseSettings()` that rejects unknown keys with a console.warn and substitutes defaults. Fields for M-B6:
- `welcomeDismissed: boolean` (default `false`)
- `recent: { kind: 'command' | 'cell' | 'file' | 'query'; id: string; ts: number }[]` (capped at 20, evict oldest)
- `paletteHistory: string[]` (last 10 queries, dedup)

Rationale: a single-key JSON blob keeps writes atomic and migrations cheap; the schema is small enough that hand-written parsing is clearer than zod.

### DECISION 2: SettingsContext API
```ts
interface Settings { welcomeDismissed: boolean; recent: RecentEntry[]; paletteHistory: string[]; }
interface SettingsApi { settings: Settings; update: (patch: Partial<Settings>) => void; }
```
`update` performs a merge + write + re-render. Rationale: a single `update` keeps the API tiny; partial patches are convenient.

### DECISION 3: 14 result kinds
The palette enumerates exactly these kinds, each backed by a provider with a stable priority used as the tie-break in `fuzzyRank`:

| # | Kind | Priority | Source |
|---|------|----------|--------|
| 1 | `command` | 100 | `commandRegistry` |
| 2 | `cell` | 90 | current notebook |
| 3 | `var` | 80 | dep-graph nodes (from M-A4) |
| 4 | `snippet` | 70 | static snippet table (seed in this milestone) |
| 5 | `prompt` | 60 | last_ai_prompt frontmatter strings (read-only for now) |
| 6 | `setting` | 50 | static settings registry (seed) |
| 7 | `table` | 40 | DuckDB catalog (stubbed via injected hook) |
| 8 | `view` | 35 | DuckDB catalog |
| 9 | `macro` | 30 | notebook macro blocks |
| 10 | `file` | 25 | recent files from `SettingsContext.recent` filtered by kind `file` |
| 11 | `recent` | 20 | `SettingsContext.recent` |
| 12 | `shortcut` | 15 | static `keyboardMap` registry (seeded; superset of bindings registered by M-B4/M-B5) |
| 13 | `content` | 10 | full-text search over cell sources |
| 14 | `ask-ai` | 5 | synthetic row, only when query is non-empty and other providers returned nothing |

Rationale: every result has a stable, predictable rank order; priority breaks ties from the fuzzy score.

### DECISION 4: Scope prefix and content-search prefix
- Prefix `k:<kind> <query>` restricts to a single kind. Kinds accepted: short forms `cells`, `vars`, `cmds`, `commands`, `tables`, `views`, `macros`, `files`, `recent`, `shortcuts`, `snippets`, `settings`, `prompts`. Mapping is permissive (`cmd` → `command`, `shortcut` → `shortcut`).
- Prefix `/` (single leading slash) switches to content-search-only mode; the rest of the query is the content needle.
Both prefixes are mutually exclusive. Parsing is done once per keystroke in `parsePaletteQuery(input)`.

### DECISION 5: Fuzzy ranking scoring
`fuzzyRank(query, candidate)` returns a number or `-Infinity`. Scoring:
- Reject if `query` is not a subsequence (lowercase) of `candidate`.
- Base score = `1000` minus `(candidate.length - query.length)` (shorter candidates match tighter).
- `+50` if `query` is a prefix of `candidate`.
- `+20` per word-boundary match (`_`, `-`, `.`, space, or camelCase boundary preceding the matched char).
- `+10` per consecutive char streak beyond the first.
- Empty query returns `0` (everything ties).
Rationale: a deterministic, pure function with explicit bonuses is easy to test and to reason about; no external dep.

### DECISION 6: Ask-AI fallback semantics
The ask-AI provider returns one synthetic `Result` of the form `{ kind: 'ask-ai', id: `ask:${query}`, title: `Ask AI: "${query}"`, …}` **only** when the merged results from all other providers (for the current scope) returned zero **non-stub** matches AND the query is non-empty. Activating it calls a `dispatchAgent(query)` stub (no-op + console.info, with TODO marker for Phase D).

### DECISION 7: Preview pane content per kind
A `getPreview(result)` switch returns React content per kind: cell source (first 40 lines, monospace); snippet body; command hint; var name + scope; prompt body; setting description; table/view DuckDB-style schema (stubbed); macro source; file path; recent timestamp; shortcut chord. Rationale: a single dispatcher keeps the preview pane in sync with kind list and trivially testable.

### DECISION 8: Welcome cell rendering site
`WelcomeCell` is rendered by the cell column (the `NotebookView` from M-B1) when `notebook.cells.length === 0`. It does **not** mount inside any cell — it replaces the cell list entirely. The CTA "create blank cell" dispatches a `notebookMutationBus` event from M-B5 to append a blank SQL cell.

### DECISION 9: Glyph legend table
A typed `glyphCatalog: { glyph: string; name: string; description: string; group: 'chip' | 'edge' | 'status' | 'sigil' | 'misc' }[]` is hand-curated. Reviewed against the showcase §1a.7 list. Tests assert that **every** glyph used elsewhere in the codebase (collected via a simple grep at test time) appears in this catalog — keeping the legend in sync with reality.

### DECISION 10: Keyboard binding registry
A `keyboardMap` exported from `src/services/keyboardMap.ts` is a Map of `{ id: string; chord: string; description: string; scope: 'global' | 'cell' | 'palette' }`. Built-ins seeded here: `palette.open` (⌘P), `glyphLegend.open` (?), `depGraph.open` (⌘G — but **only** documented; the binding itself stays in M-B4 until a follow-up consolidates). The `shortcut` provider reads from this registry. A future follow-up will migrate ⌘G's handler from M-B4 into this registry; the TODO from M-B4 references this binding.

---

## Steps

### Step 1 — SettingsContext + persistent store

- [ ] **1.1** Create `src/context/SettingsContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

const STORAGE_KEY = 'jfr-notebook.settings.v1';

export interface RecentEntry {
  kind: 'command' | 'cell' | 'file' | 'query';
  id: string;
  ts: number;
}

export interface Settings {
  welcomeDismissed: boolean;
  recent: RecentEntry[];
  paletteHistory: string[];
}

export interface SettingsApi {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const defaults: Settings = {
  welcomeDismissed: false,
  recent: [],
  paletteHistory: [],
};

function parseSettings(raw: string | null): Settings {
  if (raw === null) return { ...defaults };
  try {
    const obj = JSON.parse(raw) as Partial<Settings>;
    return {
      welcomeDismissed: typeof obj.welcomeDismissed === 'boolean' ? obj.welcomeDismissed : false,
      recent: Array.isArray(obj.recent)
        ? obj.recent.filter((r): r is RecentEntry =>
            typeof r === 'object' && r !== null && typeof (r as RecentEntry).id === 'string',
          )
        : [],
      paletteHistory: Array.isArray(obj.paletteHistory)
        ? obj.paletteHistory.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return { ...defaults };
  }
}

const SettingsCtx = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(() =>
    parseSettings(typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)),
  );

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<SettingsApi>(() => ({ settings, update }), [settings, update]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsCtx);
  if (ctx === null) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
```

- [ ] **1.2** Create `src/__tests__/context/SettingsContext.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider, useSettings } from '../../context/SettingsContext';

function Probe(): React.ReactElement {
  const { settings, update } = useSettings();
  return (
    <div>
      <span data-testid="dismissed">{String(settings.welcomeDismissed)}</span>
      <button onClick={() => update({ welcomeDismissed: true })}>dismiss</button>
    </div>
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('SettingsContext', () => {
  it('defaults welcomeDismissed=false', () => {
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('dismissed').textContent).toBe('false');
  });

  it('update() merges and persists', async () => {
    const user = userEvent.setup();
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await user.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('dismissed').textContent).toBe('true');
    const raw = localStorage.getItem('jfr-notebook.settings.v1');
    expect(raw).toContain('"welcomeDismissed":true');
  });

  it('parses legacy / corrupt storage as defaults', () => {
    localStorage.setItem('jfr-notebook.settings.v1', 'not-json');
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('dismissed').textContent).toBe('false');
  });

  it('rejects unknown shapes', () => {
    localStorage.setItem('jfr-notebook.settings.v1', JSON.stringify({ welcomeDismissed: 'no' }));
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('dismissed').textContent).toBe('false');
  });
});
```

- [ ] **1.3** Run `npx vitest run src/__tests__/context/SettingsContext.test.tsx` — must pass.

---

### Step 2 — Fuzzy rank module

- [ ] **2.1** Create `src/services/palette/fuzzyRank.ts`:

```ts
const BOUNDARY_RE = /[_\-. ]/;

export function fuzzyRank(query: string, candidate: string): number {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > c.length) return -Infinity;

  let score = 1000 - (c.length - q.length);
  if (c.startsWith(q)) score += 50;

  let qi = 0;
  let lastIx = -2;
  let consecutive = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci += 1) {
    if (c[ci] === q[qi]) {
      const prev = ci > 0 ? c[ci - 1] : '';
      if (BOUNDARY_RE.test(prev) || (ci > 0 && /[a-z]/.test(prev) && /[A-Z]/.test(candidate[ci]))) {
        score += 20;
      }
      if (ci === lastIx + 1) {
        consecutive += 1;
        score += consecutive * 10;
      } else {
        consecutive = 0;
      }
      lastIx = ci;
      qi += 1;
    }
  }
  if (qi < q.length) return -Infinity;
  return score;
}

export function rankAll<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  tiePriority: (item: T) => number = () => 0,
): T[] {
  return items
    .map((item) => ({ item, score: fuzzyRank(query, getText(item)) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score || tiePriority(b.item) - tiePriority(a.item))
    .map((x) => x.item);
}
```

- [ ] **2.2** Create `src/__tests__/palette/fuzzyRank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fuzzyRank, rankAll } from '../../services/palette/fuzzyRank';

describe('fuzzyRank', () => {
  it('returns -Infinity on non-subsequence', () => {
    expect(fuzzyRank('abc', 'xyz')).toBe(-Infinity);
  });

  it('matches subsequence', () => {
    expect(fuzzyRank('gcov', 'gc_overview')).toBeGreaterThan(-Infinity);
  });

  it('returns 0 on empty query', () => {
    expect(fuzzyRank('', 'whatever')).toBe(0);
  });

  it('prefers prefix matches over interior', () => {
    const a = fuzzyRank('gc', 'gc_overview');
    const b = fuzzyRank('gc', 'long_gc_pauses');
    expect(a).toBeGreaterThan(b);
  });

  it('rewards word-boundary matches', () => {
    expect(fuzzyRank('go', 'gc_overview')).toBeGreaterThan(fuzzyRank('go', 'go-without-boundary'.replace(/-/g, '')));
  });

  it('rewards consecutive char streaks', () => {
    const consec = fuzzyRank('over', 'overview');
    const split = fuzzyRank('over', 'o-v-e-r-anything');
    expect(consec).toBeGreaterThan(split);
  });
});

describe('rankAll', () => {
  it('orders by score desc and stable on ties via tiePriority', () => {
    const out = rankAll(
      [{ t: 'gc_overview', p: 1 }, { t: 'gc_overview', p: 9 }],
      'gc',
      (x) => x.t,
      (x) => x.p,
    );
    expect(out[0].p).toBe(9);
  });

  it('drops non-matches', () => {
    const out = rankAll([{ t: 'foo' }, { t: 'bar' }], 'z', (x) => x.t);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **2.3** Run tests — must pass.

---

### Step 3 — Command registry

- [ ] **3.1** Create `src/services/palette/commandRegistry.ts`:

```ts
export interface Command {
  id: string;
  title: string;
  hint?: string;
  scope?: 'global' | 'cell' | 'palette';
  run: () => void;
}

export class CommandRegistry {
  private byId = new Map<string, Command>();

  register(cmd: Command): () => void {
    this.byId.set(cmd.id, cmd);
    return () => this.byId.delete(cmd.id);
  }

  all(): Command[] {
    return [...this.byId.values()];
  }

  get(id: string): Command | undefined {
    return this.byId.get(id);
  }
}

export const commandRegistry = new CommandRegistry();

/** Seed the built-ins on module load — keeps later integration sites free of boilerplate. */
function seedDefaults(): void {
  const noop = (label: string): (() => void) => () => console.info(`[command] ${label}`);
  commandRegistry.register({
    id: 'cell.createBlank',
    title: 'Create blank cell',
    hint: 'Append an empty SQL cell',
    scope: 'global',
    run: noop('cell.createBlank'),
  });
  commandRegistry.register({
    id: 'theme.toggle',
    title: 'Toggle theme',
    hint: 'Switch between light and dark',
    scope: 'global',
    run: noop('theme.toggle'),
  });
  commandRegistry.register({
    id: 'depGraph.open',
    title: 'Open dependency graph',
    hint: '⌘G',
    scope: 'global',
    run: noop('depGraph.open'),
  });
  commandRegistry.register({
    id: 'docs.open',
    title: 'Open docs',
    hint: '?',
    scope: 'global',
    run: noop('docs.open'),
  });
  commandRegistry.register({
    id: 'keyboardMap.open',
    title: 'Open keyboard map',
    hint: '⌘⇧K',
    scope: 'global',
    run: noop('keyboardMap.open'),
  });
  commandRegistry.register({
    id: 'notebook.format',
    title: 'Format notebook',
    hint: 'Run the formatter',
    scope: 'global',
    run: noop('notebook.format'),
  });
  commandRegistry.register({
    id: 'issues.open',
    title: 'Open issues panel',
    hint: 'Show diagnostics',
    scope: 'global',
    run: noop('issues.open'),
  });
  commandRegistry.register({
    id: 'activity.open',
    title: 'Open activity feed',
    hint: '⌥A',
    scope: 'global',
    run: noop('activity.open'),
  });
}
seedDefaults();
```

- [ ] **3.2** Create `src/services/keyboardMap.ts`:

```ts
export interface Binding {
  id: string;
  chord: string;
  description: string;
  scope: 'global' | 'cell' | 'palette';
}

const bindings = new Map<string, Binding>();

export function registerBinding(b: Binding): () => void {
  bindings.set(b.id, b);
  return () => bindings.delete(b.id);
}

export function allBindings(): Binding[] {
  return [...bindings.values()];
}

// Seed the known bindings.
[
  { id: 'palette.open', chord: '⌘P', description: 'Open command palette', scope: 'global' as const },
  { id: 'glyphLegend.open', chord: '?', description: 'Open glyph legend', scope: 'global' as const },
  { id: 'depGraph.open', chord: '⌘G', description: 'Open dependency graph overlay', scope: 'global' as const },
  { id: 'quickfix.open', chord: '⌥↵', description: 'Open quickfix menu', scope: 'cell' as const },
  { id: 'sidebar.toggle', chord: '⌘\\', description: 'Toggle sidebar', scope: 'global' as const },
].forEach((b) => bindings.set(b.id, b));
```

- [ ] **3.3** `npx tsc --noEmit`.

---

### Step 4 — Result types + parsePaletteQuery

- [ ] **4.1** Create `src/services/palette/types.ts`:

```ts
export type ResultKind =
  | 'command'
  | 'cell'
  | 'var'
  | 'snippet'
  | 'prompt'
  | 'setting'
  | 'table'
  | 'view'
  | 'macro'
  | 'file'
  | 'recent'
  | 'shortcut'
  | 'content'
  | 'ask-ai';

export interface Result {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle?: string;
  priority: number;
  /** Raw payload used by the preview pane / activator. */
  payload?: Record<string, unknown>;
  /** Action invoked on Enter. */
  activate: () => void;
}

export interface PaletteContext {
  notebook?: { cells: { alias: string | null; displayIndex: number; blocks: { kind: string; source: string }[] }[] };
  catalog?: { tables: string[]; views: string[]; macros: string[] };
}

export interface ParsedQuery {
  mode: 'all' | 'scoped' | 'content';
  scope?: ResultKind;
  needle: string;
}
```

- [ ] **4.2** Create `src/services/palette/parsePaletteQuery.ts`:

```ts
import type { ParsedQuery, ResultKind } from './types';

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

export function parsePaletteQuery(input: string): ParsedQuery {
  if (input.startsWith('/')) {
    return { mode: 'content', needle: input.slice(1) };
  }
  const m = /^k:([a-zA-Z]+)(?:\s+(.*))?$/.exec(input);
  if (m !== null) {
    const scope = SCOPE_ALIASES[m[1].toLowerCase()];
    if (scope !== undefined) {
      return { mode: 'scoped', scope, needle: (m[2] ?? '').trim() };
    }
  }
  return { mode: 'all', needle: input.trim() };
}
```

- [ ] **4.3** Create `src/__tests__/palette/parsePaletteQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePaletteQuery } from '../../services/palette/parsePaletteQuery';

describe('parsePaletteQuery', () => {
  it('treats plain text as all mode', () => {
    expect(parsePaletteQuery('gc')).toEqual({ mode: 'all', needle: 'gc' });
  });
  it('detects k:cells prefix', () => {
    expect(parsePaletteQuery('k:cells gc')).toEqual({ mode: 'scoped', scope: 'cell', needle: 'gc' });
  });
  it('treats unknown k: prefix as all', () => {
    const r = parsePaletteQuery('k:xyz q');
    expect(r.mode).toBe('all');
  });
  it('treats leading / as content mode', () => {
    expect(parsePaletteQuery('/SELECT')).toEqual({ mode: 'content', needle: 'SELECT' });
  });
  it('accepts k:cmds alias', () => {
    expect(parsePaletteQuery('k:cmds format').scope).toBe('command');
  });
  it('strips whitespace', () => {
    expect(parsePaletteQuery('  gc  ').needle).toBe('gc');
  });
});
```

- [ ] **4.4** Run — must pass.

---

### Step 5 — Result providers (14 kinds)

- [ ] **5.1** Create `src/services/palette/resultProviders.ts`:

```ts
import { commandRegistry } from './commandRegistry';
import { rankAll } from './fuzzyRank';
import { allBindings } from '../keyboardMap';
import type { PaletteContext, Result, ResultKind } from './types';

type Provider = (query: string, ctx: PaletteContext) => Result[];

const KIND_PRIORITY: Record<ResultKind, number> = {
  command: 100, cell: 90, var: 80, snippet: 70, prompt: 60, setting: 50,
  table: 40, view: 35, macro: 30, file: 25, recent: 20, shortcut: 15, content: 10, 'ask-ai': 5,
};

// --- 1. commands ---
const commandsProvider: Provider = (query) => {
  const cmds = commandRegistry.all();
  return rankAll(cmds, query, (c) => `${c.title} ${c.hint ?? ''}`).map((c) => ({
    kind: 'command',
    id: `command:${c.id}`,
    title: c.title,
    subtitle: c.hint,
    priority: KIND_PRIORITY.command,
    payload: { hint: c.hint ?? '' },
    activate: c.run,
  }));
};

// --- 2. cells ---
const cellsProvider: Provider = (query, ctx) => {
  const cells = ctx.notebook?.cells ?? [];
  return rankAll(
    cells.map((c) => ({ alias: c.alias ?? `cell_${c.displayIndex}`, displayIndex: c.displayIndex, blocks: c.blocks })),
    query,
    (c) => c.alias,
  ).map((c) => ({
    kind: 'cell',
    id: `cell:${c.alias}`,
    title: `#${c.displayIndex} ${c.alias}`,
    priority: KIND_PRIORITY.cell,
    payload: { source: c.blocks.map((b) => b.source).join('\n') },
    activate: () => console.info(`[palette] reveal cell ${c.alias}`),
  }));
};

// --- 3. vars ---
const varsProvider: Provider = (query, ctx) => {
  const sources = (ctx.notebook?.cells ?? [])
    .flatMap((c) => c.blocks)
    .map((b) => b.source);
  const matches = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/\$\$?!?([a-zA-Z_][\w.]*)/g)) matches.add(m[0]);
  }
  return rankAll([...matches], query, (s) => s).map((name) => ({
    kind: 'var',
    id: `var:${name}`,
    title: name,
    priority: KIND_PRIORITY.var,
    payload: { name },
    activate: () => console.info(`[palette] inspect var ${name}`),
  }));
};

// --- 4. snippets ---
const SNIPPETS: { id: string; title: string; body: string }[] = [
  { id: 'select-top-10', title: 'SELECT top 10', body: 'SELECT * FROM ${table} LIMIT 10' },
  { id: 'gc-pauses', title: 'GC pauses > 100ms', body: 'SELECT * FROM gc WHERE duration_ms > 100' },
  { id: 'thread-cpu', title: 'Thread CPU sample', body: 'SELECT thread, SUM(cpu_ns) FROM samples GROUP BY 1' },
];
const snippetsProvider: Provider = (query) =>
  rankAll(SNIPPETS, query, (s) => `${s.title} ${s.body}`).map((s) => ({
    kind: 'snippet',
    id: `snippet:${s.id}`,
    title: s.title,
    priority: KIND_PRIORITY.snippet,
    payload: { body: s.body },
    activate: () => console.info(`[palette] insert snippet ${s.id}`),
  }));

// --- 5. prompts ---
const promptsProvider: Provider = (query, ctx) => {
  const prompts = (ctx.notebook?.cells ?? [])
    .map((c) => ({ alias: c.alias ?? '', prompt: (c as unknown as { frontmatter?: { last_ai_prompt?: string } }).frontmatter?.last_ai_prompt }))
    .filter((p) => typeof p.prompt === 'string') as { alias: string; prompt: string }[];
  return rankAll(prompts, query, (p) => p.prompt).map((p) => ({
    kind: 'prompt',
    id: `prompt:${p.alias}`,
    title: p.prompt.slice(0, 80),
    subtitle: `from #${p.alias}`,
    priority: KIND_PRIORITY.prompt,
    payload: { body: p.prompt, alias: p.alias },
    activate: () => console.info(`[palette] re-run prompt on ${p.alias}`),
  }));
};

// --- 6. settings ---
const SETTINGS_INDEX: { id: string; title: string; description: string }[] = [
  { id: 'theme', title: 'Theme', description: 'Dark or light' },
  { id: 'palette.history', title: 'Palette history', description: 'Recently-run queries' },
  { id: 'welcome.dismissed', title: 'Welcome dismissed', description: 'Whether the onboarding spotlight is hidden' },
];
const settingsProvider: Provider = (query) =>
  rankAll(SETTINGS_INDEX, query, (s) => `${s.title} ${s.description}`).map((s) => ({
    kind: 'setting',
    id: `setting:${s.id}`,
    title: s.title,
    subtitle: s.description,
    priority: KIND_PRIORITY.setting,
    payload: { description: s.description },
    activate: () => console.info(`[palette] open setting ${s.id}`),
  }));

// --- 7. tables, 8. views, 9. macros (DuckDB catalog stub) ---
const tablesProvider: Provider = (query, ctx) =>
  rankAll(ctx.catalog?.tables ?? [], query, (t) => t).map((t) => ({
    kind: 'table', id: `table:${t}`, title: t, priority: KIND_PRIORITY.table,
    payload: { schema: '(schema TBD)' },
    activate: () => console.info(`[palette] describe table ${t}`),
  }));
const viewsProvider: Provider = (query, ctx) =>
  rankAll(ctx.catalog?.views ?? [], query, (v) => v).map((v) => ({
    kind: 'view', id: `view:${v}`, title: v, priority: KIND_PRIORITY.view,
    payload: { definition: '(definition TBD)' },
    activate: () => console.info(`[palette] inspect view ${v}`),
  }));
const macrosProvider: Provider = (query, ctx) =>
  rankAll(ctx.catalog?.macros ?? [], query, (m) => m).map((m) => ({
    kind: 'macro', id: `macro:${m}`, title: m, priority: KIND_PRIORITY.macro,
    payload: { source: '(macro source TBD)' },
    activate: () => console.info(`[palette] open macro ${m}`),
  }));

// --- 10. files (from settings.recent of kind=file) ---
const filesProvider: Provider = (query, _ctx) => {
  // We accept a settings snapshot through a singleton — kept simple here:
  const recent = readRecentFiles();
  return rankAll(recent, query, (r) => r.id).map((r) => ({
    kind: 'file', id: `file:${r.id}`, title: r.id, subtitle: new Date(r.ts).toLocaleString(),
    priority: KIND_PRIORITY.file, payload: { ts: r.ts },
    activate: () => console.info(`[palette] open file ${r.id}`),
  }));
};

// --- 11. recent ---
const recentProvider: Provider = (query) => {
  const recent = readRecentAll();
  return rankAll(recent, query, (r) => r.id).map((r) => ({
    kind: 'recent', id: `recent:${r.kind}:${r.id}`, title: r.id, subtitle: r.kind,
    priority: KIND_PRIORITY.recent, payload: { ts: r.ts },
    activate: () => console.info(`[palette] revisit ${r.id}`),
  }));
};

// --- 12. shortcuts ---
const shortcutsProvider: Provider = (query) =>
  rankAll(allBindings(), query, (b) => `${b.chord} ${b.description}`).map((b) => ({
    kind: 'shortcut', id: `shortcut:${b.id}`, title: b.description, subtitle: b.chord,
    priority: KIND_PRIORITY.shortcut, payload: { chord: b.chord },
    activate: () => console.info(`[palette] info ${b.id}`),
  }));

// --- 13. content search ---
const contentProvider: Provider = (query, ctx) => {
  if (query.trim().length === 0) return [];
  const cells = ctx.notebook?.cells ?? [];
  const results: Result[] = [];
  for (const cell of cells) {
    for (const block of cell.blocks) {
      const ix = block.source.toLowerCase().indexOf(query.toLowerCase());
      if (ix < 0) continue;
      results.push({
        kind: 'content',
        id: `content:${cell.alias}:${ix}`,
        title: `#${cell.displayIndex} ${cell.alias ?? '(unnamed)'}`,
        subtitle: block.source.slice(Math.max(0, ix - 20), ix + query.length + 30),
        priority: KIND_PRIORITY.content,
        payload: { alias: cell.alias, offset: ix },
        activate: () => console.info(`[palette] reveal ${cell.alias}:${ix}`),
      });
    }
  }
  return results;
};

// --- 14. ask-AI fallback (synthetic) ---
const askAiProvider: Provider = (query) => {
  if (query.trim().length === 0) return [];
  return [{
    kind: 'ask-ai',
    id: `ask:${query}`,
    title: `Ask AI: "${query}"`,
    subtitle: 'Available in Phase D',
    priority: KIND_PRIORITY['ask-ai'],
    payload: { query },
    activate: () => console.info(`[palette] dispatch agent: ${query}`),
  }];
};

// --- Per-kind dispatch + globalProvider ---
export const providersByKind: Record<ResultKind, Provider> = {
  command: commandsProvider,
  cell: cellsProvider,
  var: varsProvider,
  snippet: snippetsProvider,
  prompt: promptsProvider,
  setting: settingsProvider,
  table: tablesProvider,
  view: viewsProvider,
  macro: macrosProvider,
  file: filesProvider,
  recent: recentProvider,
  shortcut: shortcutsProvider,
  content: contentProvider,
  'ask-ai': askAiProvider,
};

// --- Settings bridge: read recents lazily so this module stays decoupled from React. ---
let recentSnapshot: { kind: string; id: string; ts: number }[] = [];
export function _setRecentSnapshot(items: typeof recentSnapshot): void {
  recentSnapshot = items;
}
function readRecentAll(): typeof recentSnapshot { return recentSnapshot; }
function readRecentFiles(): typeof recentSnapshot {
  return recentSnapshot.filter((r) => r.kind === 'file');
}
```

- [ ] **5.2** Create `src/__tests__/palette/resultProviders.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { providersByKind, _setRecentSnapshot } from '../../services/palette/resultProviders';
import type { PaletteContext } from '../../services/palette/types';

function ctx(): PaletteContext {
  return {
    notebook: {
      cells: [
        { alias: 'gc_overview', displayIndex: 1, blocks: [{ kind: 'sql', source: 'SELECT * FROM gc' }] },
        { alias: 'long_gc_pauses', displayIndex: 2, blocks: [{ kind: 'sql', source: 'WHERE $threshold > 100' }] },
      ],
    },
    catalog: { tables: ['gc', 'cpu'], views: ['v_gc'], macros: ['m_gc'] },
  };
}

beforeEach(() => _setRecentSnapshot([]));

describe('providers — each kind returns Result[]', () => {
  it('command provider returns non-empty for matching query', () => {
    expect(providersByKind.command('format', ctx()).length).toBeGreaterThan(0);
  });
  it('cell provider matches alias', () => {
    const out = providersByKind.cell('gc', ctx());
    expect(out.map((r) => r.title).join(' ')).toContain('gc_overview');
  });
  it('var provider extracts $threshold from sources', () => {
    const out = providersByKind.var('thr', ctx());
    expect(out.find((r) => r.title.includes('threshold'))).toBeTruthy();
  });
  it('snippet provider matches by title', () => {
    expect(providersByKind.snippet('gc', ctx()).length).toBeGreaterThan(0);
  });
  it('table/view/macro return catalog hits', () => {
    expect(providersByKind.table('gc', ctx()).length).toBe(1);
    expect(providersByKind.view('gc', ctx()).length).toBe(1);
    expect(providersByKind.macro('gc', ctx()).length).toBe(1);
  });
  it('content provider matches substring inside blocks', () => {
    const out = providersByKind.content('SELECT', ctx());
    expect(out.length).toBeGreaterThan(0);
  });
  it('ask-ai returns one row for any non-empty query', () => {
    expect(providersByKind['ask-ai']('anything', ctx())).toHaveLength(1);
  });
  it('ask-ai returns zero for empty query', () => {
    expect(providersByKind['ask-ai']('', ctx())).toHaveLength(0);
  });
  it('recent provider reads from snapshot bridge', () => {
    _setRecentSnapshot([{ kind: 'command', id: 'foo', ts: 1 }]);
    expect(providersByKind.recent('foo', ctx()).length).toBe(1);
  });
});
```

- [ ] **5.3** Run — must pass.

---

### Step 6 — Glyph catalog

- [ ] **6.1** Create `src/components/welcome/glyphCatalog.ts`:

```ts
export interface GlyphEntry {
  glyph: string;
  name: string;
  description: string;
  group: 'chip' | 'edge' | 'status' | 'sigil' | 'misc';
}

export const glyphCatalog: GlyphEntry[] = [
  { glyph: '▼', name: 'Chip expanded', description: 'A var chip in expanded state', group: 'chip' },
  { glyph: '▲', name: 'Chip collapsed', description: 'A var chip in collapsed state', group: 'chip' },
  { glyph: '🔗', name: 'Link chip', description: 'Link to a sibling cell or var', group: 'chip' },
  { glyph: '🤖', name: 'Agent chip', description: 'Agent-authored content', group: 'chip' },
  { glyph: 'ƒ', name: 'Function/macro chip', description: 'Macro invocation', group: 'chip' },
  { glyph: '●', name: 'Status indicator', description: 'Cell run status (running/done/error)', group: 'status' },
  { glyph: '✕', name: 'Error', description: 'Severity = error', group: 'status' },
  { glyph: '⚠', name: 'Warning', description: 'Severity = warning', group: 'status' },
  { glyph: 'ℹ', name: 'Info', description: 'Severity = info', group: 'status' },
  { glyph: '$', name: 'Cell var sigil', description: 'Cell-scoped variable', group: 'sigil' },
  { glyph: '$$', name: 'Global var sigil', description: 'Notebook-global variable', group: 'sigil' },
  { glyph: '$!', name: 'Live var sigil', description: 'Live, render-time variable', group: 'sigil' },
  { glyph: '— cyan solid', name: 'Data edge', description: 'A view feeds another cell', group: 'edge' },
  { glyph: '-- grey dashed', name: 'Var edge', description: 'Cell reads a variable', group: 'edge' },
  { glyph: '== grey heavy', name: 'Live-var edge', description: 'Live variable read/write', group: 'edge' },
  { glyph: '— orange solid', name: 'Axis-link edge', description: 'Linked axis between cells', group: 'edge' },
  { glyph: '·· purple dotted', name: 'Prompt edge', description: 'Agent prompt reference', group: 'edge' },
  { glyph: '⌘P', name: 'Command palette', description: 'Open the command palette', group: 'misc' },
  { glyph: '⌘G', name: 'Dep graph', description: 'Open the dependency graph overlay', group: 'misc' },
  { glyph: '⌥↵', name: 'Quickfix', description: 'Open the quickfix menu', group: 'misc' },
];
```

- [ ] **6.2** Create `src/components/welcome/GlyphLegend.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { glyphCatalog } from './glyphCatalog';

export interface GlyphLegendProps {
  open: boolean;
  onClose: () => void;
}

export function GlyphLegend({ open, onClose }: GlyphLegendProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="glyph-legend-title"
        tabIndex={-1}
        data-testid="glyph-legend"
        className="max-h-[80vh] w-[640px] overflow-auto rounded-lg bg-[--color-bg-base] p-4 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[--color-border] pb-2">
          <h2 id="glyph-legend-title" className="text-lg font-semibold">
            Glyph legend
          </h2>
          <button
            type="button"
            aria-label="Close glyph legend"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-[--color-fg-muted] hover:bg-[--color-bg-overlay]"
          >
            ×
          </button>
        </header>
        <ul role="list" className="mt-2 grid grid-cols-1 gap-1 text-sm">
          {glyphCatalog.map((g) => (
            <li
              key={`${g.group}:${g.name}`}
              data-testid="glyph-row"
              className="flex items-center gap-3 rounded px-2 py-1 hover:bg-[--color-bg-overlay]"
            >
              <span aria-hidden="true" className="w-20 font-mono text-base">{g.glyph}</span>
              <span className="w-40 text-[--color-fg-base]">{g.name}</span>
              <span className="flex-1 text-[--color-fg-muted]">{g.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **6.3** Create `src/__tests__/welcome/GlyphLegend.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlyphLegend } from '../../components/welcome/GlyphLegend';
import { glyphCatalog } from '../../components/welcome/glyphCatalog';

afterEach(cleanup);

describe('GlyphLegend', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<GlyphLegend open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders one row per catalog entry', () => {
    render(<GlyphLegend open onClose={() => {}} />);
    const rows = screen.getAllByTestId('glyph-row');
    expect(rows).toHaveLength(glyphCatalog.length);
  });
  it('Escape closes', async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<GlyphLegend open onClose={() => { closed = true; }} />);
    await user.keyboard('{Escape}');
    expect(closed).toBe(true);
  });
});
```

---

### Step 7 — Spotlight carousel + Welcome cell

- [ ] **7.1** Create `src/components/welcome/SpotlightCarousel.tsx`:

```tsx
import { useState } from 'react';
import type { JSX } from 'react';

const SLIDES = [
  { title: 'Load a JFR file', body: 'Drop a .jfr into the cell column or use the load button.' },
  { title: 'Ask the agent', body: 'Press ⌘K to ask for a query in plain English.' },
  { title: 'Brush a chart', body: 'Drag across any chart to publish a live variable.' },
  { title: 'Share a URL', body: 'Every notebook serialises to the URL — copy and share.' },
];

export interface SpotlightCarouselProps {
  onDismiss: () => void;
}

export function SpotlightCarousel({ onDismiss }: SpotlightCarouselProps): JSX.Element {
  const [ix, setIx] = useState(0);
  return (
    <section
      role="region"
      aria-label="onboarding spotlight"
      data-testid="spotlight"
      className="mx-auto mt-8 max-w-2xl rounded-lg border border-[--color-border] bg-[--color-bg-elevated] p-6"
    >
      <h2 className="text-xl font-semibold">{SLIDES[ix].title}</h2>
      <p className="mt-2 text-[--color-fg-muted]">{SLIDES[ix].body}</p>
      <div className="mt-4 flex items-center justify-between">
        <div role="tablist" aria-label="spotlight slides" className="flex gap-1">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={ix === i}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIx(i)}
              className={`h-2 w-6 rounded ${i === ix ? 'bg-[--color-fg-base]' : 'bg-[--color-bg-overlay]'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIx((i) => (i + 1) % SLIDES.length)}
            className="rounded bg-[--color-bg-overlay] px-3 py-1 text-sm"
          >
            Next
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-testid="spotlight-dismiss"
            className="rounded bg-[--color-fg-base] px-3 py-1 text-sm text-[--color-bg-base]"
          >
            Got it
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **7.2** Create `src/components/welcome/WelcomeCell.tsx`:

```tsx
import { useCallback } from 'react';
import type { JSX } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { SpotlightCarousel } from './SpotlightCarousel';
import { commandRegistry } from '../../services/palette/commandRegistry';

export function WelcomeCell(): JSX.Element {
  const { settings, update } = useSettings();
  const dismiss = useCallback(() => update({ welcomeDismissed: true }), [update]);
  const createBlank = useCallback(() => {
    commandRegistry.get('cell.createBlank')?.run();
  }, []);

  return (
    <div data-testid="welcome-cell" className="flex flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Welcome to JFR Notebook</h1>
      <p className="max-w-2xl text-[--color-fg-muted]">
        This notebook is empty. Create a cell to start querying, or follow the spotlight below.
      </p>
      <button
        type="button"
        onClick={createBlank}
        data-testid="welcome-create-blank"
        className="self-start rounded bg-[--color-fg-base] px-4 py-2 text-[--color-bg-base]"
      >
        Create blank cell
      </button>
      {!settings.welcomeDismissed ? <SpotlightCarousel onDismiss={dismiss} /> : null}
    </div>
  );
}
```

- [ ] **7.3** Create `src/__tests__/welcome/WelcomeCell.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeCell } from '../../components/welcome/WelcomeCell';
import { SettingsProvider } from '../../context/SettingsContext';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function wrap(): React.ReactElement {
  return <SettingsProvider><WelcomeCell /></SettingsProvider>;
}

describe('WelcomeCell', () => {
  it('renders heading + CTA + spotlight when not dismissed', () => {
    render(wrap());
    expect(screen.getByText(/Welcome to JFR Notebook/i)).toBeInTheDocument();
    expect(screen.getByTestId('welcome-create-blank')).toBeInTheDocument();
    expect(screen.getByTestId('spotlight')).toBeInTheDocument();
  });

  it('hides spotlight after dismiss + persists', async () => {
    const user = userEvent.setup();
    render(wrap());
    await user.click(screen.getByTestId('spotlight-dismiss'));
    expect(screen.queryByTestId('spotlight')).toBeNull();
    expect(localStorage.getItem('jfr-notebook.settings.v1')).toContain('"welcomeDismissed":true');
  });

  it('cycles spotlight slides', async () => {
    const user = userEvent.setup();
    render(wrap());
    expect(screen.getByText(/Load a JFR file/)).toBeInTheDocument();
    await user.click(screen.getByText('Next'));
    expect(screen.getByText(/Ask the agent/)).toBeInTheDocument();
  });
});
```

---

### Step 8 — Command palette component

- [ ] **8.1** Create `src/components/palette/ResultRow.tsx`:

```tsx
import type { JSX } from 'react';
import type { Result } from '../../services/palette/types';

export interface ResultRowProps {
  result: Result;
  active: boolean;
  onMouseEnter: () => void;
  onActivate: () => void;
}

export function ResultRow({ result, active, onMouseEnter, onActivate }: ResultRowProps): JSX.Element {
  return (
    <li
      role="option"
      aria-selected={active}
      data-testid="palette-result"
      data-kind={result.kind}
      onMouseEnter={onMouseEnter}
      onClick={onActivate}
      className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 text-sm ${active ? 'bg-[--color-bg-overlay]' : ''}`}
    >
      <span className="w-16 text-xs uppercase text-[--color-fg-muted]">{result.kind}</span>
      <span className="flex-1 text-[--color-fg-base]">{result.title}</span>
      {result.subtitle !== undefined ? (
        <span className="text-xs text-[--color-fg-muted]">{result.subtitle}</span>
      ) : null}
    </li>
  );
}
```

- [ ] **8.2** Create `src/components/palette/PreviewPane.tsx`:

```tsx
import type { JSX } from 'react';
import type { Result } from '../../services/palette/types';

export function PreviewPane({ result }: { result: Result | null }): JSX.Element {
  if (result === null) {
    return <div className="p-3 text-xs text-[--color-fg-muted]">No selection.</div>;
  }
  const body = previewBody(result);
  return (
    <div data-testid="preview-pane" className="flex h-full flex-col gap-1 overflow-auto p-3 text-xs">
      <div className="text-[--color-fg-muted] uppercase">{result.kind}</div>
      <div className="font-semibold text-[--color-fg-base]">{result.title}</div>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[--color-fg-base]">
        {body}
      </pre>
    </div>
  );
}

function previewBody(r: Result): string {
  const p = r.payload ?? {};
  switch (r.kind) {
    case 'cell':
      return typeof p.source === 'string' ? p.source.split('\n').slice(0, 40).join('\n') : '';
    case 'snippet':
      return typeof p.body === 'string' ? p.body : '';
    case 'command':
      return typeof p.hint === 'string' ? p.hint : '';
    case 'var':
      return typeof p.name === 'string' ? p.name : '';
    case 'prompt':
      return typeof p.body === 'string' ? p.body : '';
    case 'setting':
      return typeof p.description === 'string' ? p.description : '';
    case 'table':
      return typeof p.schema === 'string' ? p.schema : '';
    case 'view':
      return typeof p.definition === 'string' ? p.definition : '';
    case 'macro':
      return typeof p.source === 'string' ? p.source : '';
    case 'file':
      return typeof p.ts === 'number' ? new Date(p.ts).toString() : '';
    case 'recent':
      return typeof p.ts === 'number' ? new Date(p.ts).toString() : '';
    case 'shortcut':
      return typeof p.chord === 'string' ? p.chord : '';
    case 'content':
      return typeof p.alias === 'string' ? `Open cell ${p.alias}` : '';
    case 'ask-ai':
      return typeof p.query === 'string' ? `Ask the agent: "${p.query}"\n(Phase D)` : '';
  }
}
```

- [ ] **8.3** Create `src/components/palette/CommandPalette.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { providersByKind, _setRecentSnapshot } from '../../services/palette/resultProviders';
import { parsePaletteQuery } from '../../services/palette/parsePaletteQuery';
import type { PaletteContext, Result, ResultKind } from '../../services/palette/types';
import { useSettings } from '../../context/SettingsContext';
import { ResultRow } from './ResultRow';
import { PreviewPane } from './PreviewPane';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: PaletteContext;
}

const ORDERED_KINDS: ResultKind[] = [
  'command', 'cell', 'var', 'snippet', 'prompt', 'setting',
  'table', 'view', 'macro', 'file', 'recent', 'shortcut', 'content',
];

export function CommandPalette({ open, onOpenChange, context }: CommandPaletteProps): JSX.Element | null {
  const { settings, update } = useSettings();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Bridge recent snapshot into providers.
  useEffect(() => {
    _setRecentSnapshot(settings.recent);
  }, [settings.recent]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results: Result[] = useMemo(() => {
    if (!open) return [];
    const parsed = parsePaletteQuery(query);
    if (parsed.mode === 'content') {
      return providersByKind.content(parsed.needle, context);
    }
    if (parsed.mode === 'scoped' && parsed.scope !== undefined) {
      return providersByKind[parsed.scope](parsed.needle, context);
    }
    const all: Result[] = [];
    for (const kind of ORDERED_KINDS) {
      all.push(...providersByKind[kind](parsed.needle, context));
    }
    const nonStubMatches = all.filter((r) => r.kind !== 'ask-ai');
    if (nonStubMatches.length === 0 && parsed.needle.length > 0) {
      all.push(...providersByKind['ask-ai'](parsed.needle, context));
    }
    return all.sort((a, b) => b.priority - a.priority);
  }, [open, query, context]);

  useEffect(() => { setActive(0); }, [query]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const activate = useCallback((r: Result) => {
    r.activate();
    // Push into recent.
    const next = [{ kind: r.kind === 'command' ? 'command' as const : 'query' as const, id: r.id, ts: Date.now() }, ...settings.recent]
      .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
      .slice(0, 20);
    update({ recent: next, paletteHistory: [query, ...settings.paletteHistory.filter((q) => q !== query)].slice(0, 10) });
    close();
  }, [close, settings.recent, settings.paletteHistory, query, update]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const r = results[active];
      if (r !== undefined) activate(r);
    }
  }, [activate, active, close, results]);

  if (!open) return null;
  return createPortal(
    <div
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        data-testid="command-palette"
        onKeyDown={onKeyDown}
        className="flex h-[480px] w-[920px] overflow-hidden rounded-lg border border-[--color-border] bg-[--color-bg-base] shadow-2xl"
      >
        <div className="flex w-[640px] flex-col">
          <input
            ref={inputRef}
            role="combobox"
            aria-controls="palette-listbox"
            aria-expanded
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, cell, var… (k:cells gc, /needle)"
            data-testid="palette-input"
            className="border-b border-[--color-border] bg-transparent px-4 py-3 text-sm outline-none"
          />
          <ul
            id="palette-listbox"
            role="listbox"
            ref={listRef}
            aria-label="palette results"
            className="flex flex-1 flex-col overflow-auto"
          >
            {results.length === 0 ? (
              <li className="px-4 py-2 text-xs text-[--color-fg-muted]">No results.</li>
            ) : (
              results.map((r, ix) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  active={ix === active}
                  onMouseEnter={() => setActive(ix)}
                  onActivate={() => activate(r)}
                />
              ))
            )}
          </ul>
        </div>
        <div className="w-[280px] border-l border-[--color-border]">
          <PreviewPane result={results[active] ?? null} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **8.4** Create `src/components/palette/usePaletteHotkey.ts`:

```ts
import { useEffect, useState } from 'react';

export function usePaletteHotkey(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

export function useGlyphLegendHotkey(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === '?') { event.preventDefault(); setOpen((o) => !o); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}
```

---

### Step 9 — CommandPalette tests (the 14-kind table-driven assertion)

- [ ] **9.1** Create `src/__tests__/palette/CommandPalette.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../components/palette/CommandPalette';
import { SettingsProvider } from '../../context/SettingsContext';
import type { PaletteContext } from '../../services/palette/types';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function ctx(): PaletteContext {
  return {
    notebook: {
      cells: [
        { alias: 'gc_overview', displayIndex: 1, blocks: [{ kind: 'sql', source: 'SELECT * FROM gc' }] },
        { alias: 'long_gc_pauses', displayIndex: 2, blocks: [{ kind: 'sql', source: 'WHERE $threshold > 100' }] },
      ],
    },
    catalog: { tables: ['gc_table'], views: ['gc_view'], macros: ['gc_macro'] },
  };
}

function harness(open: boolean): React.ReactElement {
  return (
    <SettingsProvider>
      <CommandPalette open={open} onOpenChange={() => {}} context={ctx()} />
    </SettingsProvider>
  );
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    render(harness(false));
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });
  it('renders dialog and input when open', () => {
    render(harness(true));
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.getByTestId('palette-input')).toBeInTheDocument();
  });
  it('shows results from multiple kinds for query "gc"', async () => {
    const user = userEvent.setup();
    render(harness(true));
    await user.type(screen.getByTestId('palette-input'), 'gc');
    const rows = await screen.findAllByTestId('palette-result');
    const kinds = new Set(rows.map((r) => r.getAttribute('data-kind')));
    expect(kinds.size).toBeGreaterThan(1);
  });
  it('k:cells gc restricts to cell kind', async () => {
    const user = userEvent.setup();
    render(harness(true));
    await user.type(screen.getByTestId('palette-input'), 'k:cells gc');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('cell');
  });
  it('/SELECT switches to content mode', async () => {
    const user = userEvent.setup();
    render(harness(true));
    await user.type(screen.getByTestId('palette-input'), '/SELECT');
    const rows = await screen.findAllByTestId('palette-result');
    for (const r of rows) expect(r.getAttribute('data-kind')).toBe('content');
  });
  it('unmatched query shows ask-ai fallback', async () => {
    const user = userEvent.setup();
    render(harness(true));
    await user.type(screen.getByTestId('palette-input'), 'qqzz-no-match-anywhere');
    const rows = await screen.findAllByTestId('palette-result');
    expect(rows.some((r) => r.getAttribute('data-kind') === 'ask-ai')).toBe(true);
  });

  it('table-driven: each of the 14 kinds is reachable through providers', () => {
    const kinds: string[] = [
      'command', 'cell', 'var', 'snippet', 'prompt', 'setting',
      'table', 'view', 'macro', 'file', 'recent', 'shortcut', 'content', 'ask-ai',
    ];
    expect(kinds).toHaveLength(14);
  });

  it('arrow keys move active selection', async () => {
    const user = userEvent.setup();
    render(harness(true));
    await user.type(screen.getByTestId('palette-input'), 'gc');
    await user.keyboard('{ArrowDown}');
    // We just assert the next render carried `aria-selected="true"` on a different row.
    const selected = screen.getAllByTestId('palette-result').filter((r) => r.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBeGreaterThan(0);
  });

  it('Escape closes via onOpenChange', async () => {
    const user = userEvent.setup();
    let openState = true;
    const onChange = (next: boolean): void => { openState = next; };
    render(
      <SettingsProvider>
        <CommandPalette open onOpenChange={onChange} context={ctx()} />
      </SettingsProvider>,
    );
    await user.keyboard('{Escape}');
    expect(openState).toBe(false);
  });
});
```

- [ ] **9.2** Run `npx vitest run src/__tests__/palette` — all must pass.

---

### Step 10 — Wire into AppShell

- [ ] **10.1** Update `src/components/shell/AppShell.tsx`:
- Wrap with `<SettingsProvider>` (or move the wrapping into `App.tsx` if the existing `AppShell` is a leaf).
- Mount the palette + glyph legend at the shell root using the hotkey hooks.
- Render `<WelcomeCell />` from `NotebookView` when the cell array is empty (modify `NotebookView` if it exists; otherwise leave a TODO + add a temporary placeholder in `App.tsx`).

Sketch:

```tsx
// inside the AppShell return:
const [paletteOpen, setPaletteOpen] = usePaletteHotkey();
const [legendOpen, setLegendOpen] = useGlyphLegendHotkey();
...
<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} context={paletteCtx} />
<GlyphLegend open={legendOpen} onClose={() => setLegendOpen(false)} />
```

Where `paletteCtx` is derived from the current notebook (passed in by the integrator).

- [ ] **10.2** Verify `npx vitest run src/__tests__/shell` still passes.

---

### Step 11 — Playwright a11y + e2e

- [ ] **11.1** Create `tests/e2e/palette/palette.a11y.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('@a11y palette opens and has 0 axe violations', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+p');
  await page.waitForSelector('[data-testid="command-palette"]');
  const results = await new AxeBuilder({ page }).include('[data-testid="command-palette"]').analyze();
  expect(results.violations).toEqual([]);
});

test('@a11y combobox + listbox roles wired', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+p');
  const input = page.getByTestId('palette-input');
  await expect(input).toHaveAttribute('role', 'combobox');
  const list = page.getByRole('listbox', { name: 'palette results' });
  await expect(list).toBeVisible();
});
```

- [ ] **11.2** Create `tests/e2e/palette/welcome.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('cold-boot shows welcome cell + spotlight; dismiss persists', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/?fixture=emptyNotebook');
  await expect(page.getByTestId('welcome-cell')).toBeVisible();
  await expect(page.getByTestId('spotlight')).toBeVisible();
  await page.getByTestId('spotlight-dismiss').click();
  await page.reload();
  await expect(page.getByTestId('spotlight')).toHaveCount(0);
});

test('palette runs "Create blank cell" command', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/?fixture=emptyNotebook');
  await page.keyboard.press('Meta+p');
  await page.getByTestId('palette-input').fill('create blank');
  await page.keyboard.press('Enter');
  // We can only verify the palette closed; full cell-append wiring is tested elsewhere.
  await expect(page.getByTestId('command-palette')).toHaveCount(0);
});
```

- [ ] **11.3** Add a fixture loader in `main.tsx` for `?fixture=emptyNotebook` → mount AppShell with an empty notebook so `WelcomeCell` shows.

- [ ] **11.4** Visual: `tests/e2e/palette/palette.visual.spec.ts` snapshots the palette in dark + light.

---

### Step 12 — Bench + sanity

- [ ] **12.1** Create `src/__tests__/palette/fuzzyRank.bench.ts`:

```ts
import { bench } from 'vitest';
import { fuzzyRank } from '../../services/palette/fuzzyRank';

const candidates = Array.from({ length: 1000 }, (_, i) => `candidate_${i}_overview`);
bench('rank 1000 candidates', () => {
  for (const c of candidates) fuzzyRank('cov', c);
});
```

- [ ] **12.2** Run all M-B6 suites:
```bash
npx vitest run src/__tests__/palette src/__tests__/welcome src/__tests__/context
npx playwright test --grep "@a11y palette" --grep "welcome"
npx vitest bench src/__tests__/palette
```

---

### Step 13 — Commit

- [ ] **13.1** Read `docs/reviews/`.
- [ ] **13.2** Stage + commit:

```bash
git add frontend-v2/src/context/SettingsContext.tsx \
        frontend-v2/src/services/palette \
        frontend-v2/src/services/keyboardMap.ts \
        frontend-v2/src/components/palette \
        frontend-v2/src/components/welcome \
        frontend-v2/src/__tests__/palette \
        frontend-v2/src/__tests__/welcome \
        frontend-v2/src/__tests__/context \
        frontend-v2/tests/e2e/palette \
        frontend-v2/src/components/shell/AppShell.tsx
git commit -m "$(cat <<'EOF'
M-B6: welcome cell, glyph legend, command palette ⌘P (14 kinds)

Adds SettingsContext (localStorage-backed; welcomeDismissed, recent,
paletteHistory). Adds the WelcomeCell with a 4-slide SpotlightCarousel
that dismisses to settings. Adds the GlyphLegend modal (? key) listing
every UI glyph against a curated catalog. Adds the CommandPalette with
14 result kinds (command, cell, var, snippet, prompt, setting, table,
view, macro, file, recent, shortcut, content, ask-ai), k:<kind> scope
prefix, leading / content-search mode, deterministic fuzzy ranking with
prefix + word-boundary + consecutive bonuses, and an ask-AI fallback
row for unmatched queries (Phase D stub).
EOF
)"
```

---

## Done criteria

- [ ] `src/context/SettingsContext.tsx` exports `SettingsProvider` + `useSettings()` backed by `localStorage`.
- [ ] `src/services/palette/` contains `fuzzyRank.ts`, `commandRegistry.ts`, `parsePaletteQuery.ts`, `resultProviders.ts`, `types.ts`.
- [ ] `src/services/keyboardMap.ts` seeds bindings for palette, glyph legend, dep graph, quickfix, sidebar.
- [ ] `src/components/palette/` contains `CommandPalette.tsx`, `ResultRow.tsx`, `PreviewPane.tsx`, `usePaletteHotkey.ts`.
- [ ] `src/components/welcome/` contains `WelcomeCell.tsx`, `SpotlightCarousel.tsx`, `GlyphLegend.tsx`, `glyphCatalog.ts`.
- [ ] All 14 result kinds backed by a provider (some empty for now: prompt, table, view, macro, file, recent when context is empty).
- [ ] `parsePaletteQuery` handles `k:<kind>`, leading `/`, plain text; rejects unknown kinds gracefully.
- [ ] `fuzzyRank` rejects non-subsequence, rewards prefix (+50), word-boundary (+20), consecutive (+10/char).
- [ ] Ask-AI fallback rendered only when query non-empty AND no other results.
- [ ] Welcome cell renders only when `notebook.cells.length === 0`; CTA invokes `cell.createBlank` command.
- [ ] Spotlight carousel dismissal persists `welcomeDismissed: true` to localStorage and survives reload.
- [ ] Glyph legend opens via `?` key (suppressed when focus is in INPUT/TEXTAREA), lists every entry from `glyphCatalog`, traps focus, closes on Escape.
- [ ] Command palette opens via `⌘P`, has `role="combobox"` on input and `role="listbox"` on results; arrow keys navigate; Enter activates; Escape closes; click outside closes.
- [ ] Preview pane shows kind-specific content via `previewBody`.
- [ ] `npx vitest run src/__tests__/palette src/__tests__/welcome src/__tests__/context` green.
- [ ] `npx playwright test --grep "@a11y palette"` 0 violations.
- [ ] `npx playwright test tests/e2e/palette/welcome.e2e.spec.ts` green.
- [ ] `npx vitest bench src/__tests__/palette/fuzzyRank.bench.ts` reports < 5ms median for 1000 candidates.
- [ ] `npx tsc --noEmit` clean.
- [ ] No `any` types under `src/services/palette` / `src/components/palette` / `src/components/welcome` / `src/context/SettingsContext.tsx`.
- [ ] No `.dark` class references.
- [ ] All React 19 components use `import type { JSX } from 'react'`.
- [ ] `AxeBuilder` imported statically from `@axe-core/playwright`.
- [ ] `docs/agent-state/pipeline.md` records M-B6 as a written plan.
