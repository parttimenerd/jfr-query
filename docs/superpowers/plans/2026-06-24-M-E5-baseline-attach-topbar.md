# M-E5 Baseline Attach in Topbar — Recording Compare goes live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the already-built recording-compare feature to users by adding a baseline-attach control to the Topbar, and fix the underlying baseline loader so the candidate's tables in the main schema are not clobbered by the baseline import. After this milestone, a user can open a candidate `.jfr.db`, click **Attach baseline**, pick a second `.jfr.db`, and any cell with `compare: true` in its frontmatter renders the side-by-side `CompareView` with the baseline rendered against `baseline_*` tables — without the candidate's data being overwritten.

**Architecture:**

- The existing `BaselineControls` (`frontend-v2/src/components/compare/BaselineControls.tsx`) and `useBaseline` hook (`frontend-v2/src/hooks/useBaseline.ts`) are fully built but never rendered. Step 1 wires `BaselineControls` into `Topbar` (between **Open** and **Export**).
- The existing baseline loading path in `useBaseline.ts` materialises the baseline file's tables into the **main** schema via `JfrLoader.load(...)`, then wraps them in `baseline_X` views. This collides with the candidate's tables (`CREATE TABLE IF NOT EXISTS` becomes a no-op when the candidate already loaded the same table names, so `baseline_X` ends up reading candidate data). Step 2 replaces the materialization-then-view path with a direct **ATTACH-and-view** approach: the baseline file is `ATTACH`ed read-only as a separate DuckDB database named `baseline_src`, and each `baseline_X` view selects from `baseline_src.main."X"`. No row is copied; the candidate's main-schema tables are not touched.
- A new `baselineJfrLoader.ts` encapsulates the attach-and-view flow. `useBaseline` is updated to call it instead of constructing a `JfrLoader`.
- Wiring touches `Topbar.tsx` only — the rest of the compare stack (`CompareView`, `baselineState`, `crossRecordingCoupling`, `registerDiffMacro`, and the `compare: true` frontmatter handling in `CellView`) is unchanged.

**Tech Stack:** TypeScript 5.x, React 19.2, Vitest 4.1.9 (`pool: 'forks'`), @testing-library/react 16.3.0, DuckDB-WASM (via `DuckDBClientLike`).

---

## Critical Rules

- `import type { JSX } from 'react'` in every component file.
- `pool: 'forks'` in `vitest.config.ts` — NEVER change.
- All colors via CSS token vars only — never hardcode hex.
- No `text-sm` — use `text-[13px]`, `text-[12px]`, `text-[11px]`.
- No `any` — use `unknown` with narrowing.
- All test files live under `frontend-v2/src/__tests__/` to match the existing `vitest.config.ts` include glob.
- Identifier quoting: when a JFR table name contains `"` characters, double them per SQL identifier rules (use the `quoteIdent` helper).

---

### Task 1: Add an isolated `baselineJfrLoader` that ATTACHes the file as a separate database

**Files:**

- Create: `frontend-v2/src/services/jfr/baselineJfrLoader.ts`
- Create: `frontend-v2/src/__tests__/jfr/baselineJfrLoader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/jfr/baselineJfrLoader.test.ts`:

```ts
// frontend-v2/src/__tests__/jfr/baselineJfrLoader.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadBaselineJfr } from '../../services/jfr/baselineJfrLoader';
import type { DuckDBClientLike } from '../../services/jfr/jfrTypes';

// Build a small ArrayBuffer with the DuckDB magic bytes at offset 8 so the
// loader's format check passes without us needing a real .db file.
function makeFakeDuckDbBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const view = new Uint8Array(buf);
  view[8] = 0x44; // 'D'
  view[9] = 0x55; // 'U'
  view[10] = 0x43; // 'C'
  view[11] = 0x4b; // 'K'
  return buf;
}

interface QueryLog {
  sql: string;
}

function makeClient(tables: string[]): {
  client: DuckDBClientLike;
  log: QueryLog[];
} {
  const log: QueryLog[] = [];
  const client: DuckDBClientLike = {
    registerFile: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(async (sql: string) => {
      log.push({ sql });
      if (/duckdb_tables\(\)/.test(sql)) {
        return tables.map((t) => ({ table_name: t }));
      }
      return [];
    }),
  };
  return { client, log };
}

describe('loadBaselineJfr', () => {
  it('rejects an empty file', async () => {
    const { client } = makeClient([]);
    const empty = new File([], 'baseline.jfr.db');
    await expect(loadBaselineJfr(client, empty)).rejects.toMatchObject({
      kind: 'empty-file',
    });
  });

  it('rejects a non-DuckDB buffer with friendly error', async () => {
    const { client } = makeClient([]);
    const garbage = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])], 'baseline.jfr.db');
    await expect(loadBaselineJfr(client, garbage)).rejects.toMatchObject({
      kind: 'unsupported-format',
    });
  });

  it('ATTACHes the buffer as baseline_src and creates baseline_<T> views without copying rows', async () => {
    const { client, log } = makeClient(['jfr_cpu_load', 'jfr_gc_pause']);
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');

    const result = await loadBaselineJfr(client, file);

    // No CREATE TABLE — only ATTACH and CREATE VIEW
    expect(log.some((l) => /CREATE TABLE/i.test(l.sql))).toBe(false);
    expect(log.some((l) => /ATTACH .* AS baseline_src/i.test(l.sql))).toBe(true);
    expect(log.some((l) => /CREATE OR REPLACE VIEW "baseline_jfr_cpu_load"/.test(l.sql))).toBe(true);
    expect(log.some((l) => /CREATE OR REPLACE VIEW "baseline_jfr_gc_pause"/.test(l.sql))).toBe(true);

    // View body reads from the attached baseline_src database (verifying isolation)
    const viewSql = log.find((l) => /CREATE OR REPLACE VIEW "baseline_jfr_cpu_load"/.test(l.sql))!.sql;
    expect(viewSql).toMatch(/FROM baseline_src\.main\."jfr_cpu_load"/);

    expect(result).toEqual(['baseline_jfr_cpu_load', 'baseline_jfr_gc_pause']);
  });

  it('detaches the previous baseline_src before attaching a fresh one (idempotent reattach)', async () => {
    const { client, log } = makeClient(['jfr_cpu_load']);
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');
    await loadBaselineJfr(client, file);
    log.length = 0;
    await loadBaselineJfr(client, file);

    // Detach must come before the new ATTACH.
    const detachIdx = log.findIndex((l) => /DETACH .*baseline_src/i.test(l.sql));
    const attachIdx = log.findIndex((l) => /ATTACH .* AS baseline_src/i.test(l.sql));
    expect(detachIdx).toBeGreaterThanOrEqual(0);
    expect(attachIdx).toBeGreaterThan(detachIdx);
  });

  it('quotes identifiers with embedded quotes safely', async () => {
    const { client, log } = makeClient(['jfr_weird"name']);
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');
    await loadBaselineJfr(client, file);
    const viewSql = log.find((l) => /CREATE OR REPLACE VIEW/.test(l.sql))!.sql;
    expect(viewSql).toMatch(/"baseline_jfr_weird""name"/);
    expect(viewSql).toMatch(/baseline_src\.main\."jfr_weird""name"/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run jfr/baselineJfrLoader`

Expected: FAIL — `loadBaselineJfr` does not exist (module not found).

- [ ] **Step 3: Implement**

Create `frontend-v2/src/services/jfr/baselineJfrLoader.ts`:

```ts
// frontend-v2/src/services/jfr/baselineJfrLoader.ts
import type { DuckDBClientLike, JfrError } from './jfrTypes';

const DUCK_MAGIC: readonly number[] = [0x44, 0x55, 0x43, 0x4b]; // 'DUCK'
const DUCK_MAGIC_OFFSET = 8;

function isDuckDbBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < DUCK_MAGIC_OFFSET + DUCK_MAGIC.length) return false;
  const view = new Uint8Array(buf, DUCK_MAGIC_OFFSET, DUCK_MAGIC.length);
  for (let i = 0; i < DUCK_MAGIC.length; i++) {
    if (view[i] !== DUCK_MAGIC[i]) return false;
  }
  return true;
}

function quoteIdent(name: string): string {
  return name.replace(/"/g, '""');
}

async function toArrayBuffer(input: File | ArrayBuffer): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  return input.arrayBuffer();
}

/** Sanitize the file stem for use as the registered virtual file name. */
function fileStem(fileName: string): string {
  let base = fileName;
  if (base.endsWith('.jfr.db')) base = base.slice(0, -'.jfr.db'.length);
  else if (base.endsWith('.db')) base = base.slice(0, -'.db'.length);
  const sanitized = base.replace(/[^A-Za-z0-9_]/g, '_');
  return sanitized.length === 0 ? '_baseline' : sanitized;
}

/**
 * Attach a baseline .jfr.db file to DuckDB as a separate read-only database
 * named `baseline_src`, then expose each table as a `baseline_<T>` view.
 *
 * The candidate's tables in the main schema are never touched: no rows are
 * copied, only views are created.
 *
 * Returns the list of newly-created `baseline_<T>` view names.
 *
 * Idempotent: calling twice replaces the prior baseline cleanly.
 */
export async function loadBaselineJfr(
  client: DuckDBClientLike,
  input: File | ArrayBuffer,
): Promise<string[]> {
  const fileName = input instanceof File ? input.name : 'baseline.jfr.db';
  const buffer = await toArrayBuffer(input);

  if (buffer.byteLength === 0) {
    const err: JfrError = {
      kind: 'empty-file',
      message: `'${fileName}' is empty (0 bytes)`,
    };
    throw err;
  }

  if (!isDuckDbBuffer(buffer)) {
    const err: JfrError = {
      kind: 'unsupported-format',
      message:
        `'${fileName}' is not a DuckDB-formatted JFR file. ` +
        `Raw .jfr binaries are not supported in v2 browser mode; ` +
        `convert the recording with the jfr-query CLI first.`,
    };
    throw err;
  }

  const stem = fileStem(fileName);
  const registeredName = `${stem}.baseline.jfr.db`;

  try {
    await client.registerFile(registeredName, buffer);
  } catch (cause) {
    const err: JfrError = {
      kind: 'register-failed',
      message:
        cause instanceof Error ? cause.message : `registerFile failed for '${registeredName}'`,
      cause,
    };
    throw err;
  }

  // Detach any prior baseline to make reattach idempotent. Wrap in try/catch
  // because DETACH on a name that's not currently attached raises an error.
  try {
    await client.query(`DETACH baseline_src`);
  } catch {
    // not attached — fine.
  }

  try {
    await client.query(`ATTACH '${registeredName}' AS baseline_src (READ_ONLY)`);
  } catch (cause) {
    const err: JfrError = {
      kind: 'query-failed',
      message:
        cause instanceof Error
          ? cause.message
          : `ATTACH failed for baseline '${registeredName}'`,
      cause,
    };
    throw err;
  }

  let tables: string[] = [];
  try {
    const rows = await client.query(
      `SELECT table_name FROM duckdb_tables() WHERE database_name='baseline_src' AND schema_name='main'`,
    );
    tables = rows.map((r) => String(r['table_name']));
  } catch (cause) {
    const err: JfrError = {
      kind: 'query-failed',
      message:
        cause instanceof Error ? cause.message : 'Failed to enumerate baseline tables',
      cause,
    };
    throw err;
  }

  const baselineNames: string[] = [];
  for (const t of tables) {
    const q = quoteIdent(t);
    const baseline = `baseline_${t}`;
    const bq = quoteIdent(baseline);
    await client.query(
      `CREATE OR REPLACE VIEW "${bq}" AS SELECT * FROM baseline_src.main."${q}"`,
    );
    baselineNames.push(baseline);
  }

  return baselineNames;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run jfr/baselineJfrLoader`

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/services/jfr/baselineJfrLoader.ts frontend-v2/src/__tests__/jfr/baselineJfrLoader.test.ts
git commit -m "$(cat <<'EOF'
feat(compare): isolated baseline JFR loader

ATTACH the baseline file as a separate read-only database (baseline_src)
and expose each table as a baseline_<T> view. The candidate's main-schema
tables are never touched, fixing the data-collision bug in the prior
materialize-then-view path.

Idempotent: a second call detaches the previous baseline cleanly before
re-attaching.
EOF
)"
```

---

### Task 2: Switch `useBaseline` over to the isolated loader

**Files:**

- Modify: `frontend-v2/src/hooks/useBaseline.ts`
- Create: `frontend-v2/src/__tests__/hooks/useBaseline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/hooks/useBaseline.test.tsx`:

```tsx
// frontend-v2/src/__tests__/hooks/useBaseline.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useBaseline } from '../../hooks/useBaseline';
import { baselineState } from '../../services/compare/baselineState';

// Mock the underlying loader and DIFF macro registration so the hook can be
// tested without a real DuckDB instance.
const loadBaselineJfrMock = vi.fn();
vi.mock('../../services/jfr/baselineJfrLoader', () => ({
  loadBaselineJfr: (...args: unknown[]) => loadBaselineJfrMock(...args),
}));

const registerDiffMacroMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/compare/registerDiffMacro', () => ({
  registerDiffMacro: (...args: unknown[]) => registerDiffMacroMock(...args),
}));

const fakeClient = { registerFile: vi.fn(), query: vi.fn() };
vi.mock('../../hooks/useDB', () => ({
  useDB: () => fakeClient,
}));

function makeFakeDuckDbBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const view = new Uint8Array(buf);
  view[8] = 0x44;
  view[9] = 0x55;
  view[10] = 0x43;
  view[11] = 0x4b;
  return buf;
}

beforeEach(() => {
  baselineState.detach();
  loadBaselineJfrMock.mockReset();
  registerDiffMacroMock.mockClear();
});

const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

describe('useBaseline', () => {
  it('starts detached', () => {
    const { result } = renderHook(() => useBaseline(), { wrapper });
    expect(result.current.isAttached).toBe(false);
  });

  it('attach() calls loadBaselineJfr with the client and file, then registers DIFF macro', async () => {
    loadBaselineJfrMock.mockResolvedValue(['baseline_jfr_cpu_load']);
    const { result } = renderHook(() => useBaseline(), { wrapper });
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');

    await act(async () => {
      await result.current.attach(file);
    });

    expect(loadBaselineJfrMock).toHaveBeenCalledWith(fakeClient, file);
    expect(registerDiffMacroMock).toHaveBeenCalledWith(fakeClient);
  });

  it('updates baselineState.isAttached + tables after a successful attach', async () => {
    loadBaselineJfrMock.mockResolvedValue(['baseline_jfr_cpu_load', 'baseline_jfr_gc_pause']);
    const { result } = renderHook(() => useBaseline(), { wrapper });
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');

    await act(async () => {
      await result.current.attach(file);
    });

    await waitFor(() => {
      expect(result.current.isAttached).toBe(true);
    });
    expect(baselineState.getTables()).toEqual([
      'baseline_jfr_cpu_load',
      'baseline_jfr_gc_pause',
    ]);
  });

  it('detach() returns to the detached state', async () => {
    loadBaselineJfrMock.mockResolvedValue(['baseline_jfr_cpu_load']);
    const { result } = renderHook(() => useBaseline(), { wrapper });
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');

    await act(async () => {
      await result.current.attach(file);
    });
    await waitFor(() => expect(result.current.isAttached).toBe(true));

    act(() => {
      result.current.detach();
    });
    expect(result.current.isAttached).toBe(false);
  });

  it('attach() does not call JfrLoader.load (the candidate-clobbering path)', async () => {
    // This is a guardrail to lock in the architectural decision.
    loadBaselineJfrMock.mockResolvedValue([]);
    const { result } = renderHook(() => useBaseline(), { wrapper });
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');
    await act(async () => {
      await result.current.attach(file);
    });
    // No CREATE TABLE queries went through the client (loader handles its own).
    const sqls = fakeClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /CREATE TABLE/i.test(s))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run hooks/useBaseline`

Expected: FAIL — `useBaseline` still constructs `JfrLoader` and calls `loader.load(...)`, which is not the mocked path; the mocked `loadBaselineJfr` is never reached.

- [ ] **Step 3: Implement**

Replace the body of `frontend-v2/src/hooks/useBaseline.ts` with:

```ts
// frontend-v2/src/hooks/useBaseline.ts
import { useCallback, useSyncExternalStore } from 'react';
import { useDB } from './useDB';
import { baselineState } from '../services/compare/baselineState';
import { loadBaselineJfr } from '../services/jfr/baselineJfrLoader';
import { registerDiffMacro } from '../services/compare/registerDiffMacro';

export interface UseBaselineResult {
  isAttached: boolean;
  tables: string[];
  attach: (file: File) => Promise<void>;
  detach: () => void;
}

function getSnapshot(): boolean {
  return baselineState.isAttached();
}

export function useBaseline(): UseBaselineResult {
  const client = useDB();

  const isAttached = useSyncExternalStore(
    (cb) => baselineState.subscribe(cb),
    getSnapshot,
  );

  const tables = baselineState.getTables();

  const attach = useCallback(
    async (file: File): Promise<void> => {
      const baselineTables = await loadBaselineJfr(client, file);
      baselineState.attach(baselineTables);
      await registerDiffMacro(client);
    },
    [client],
  );

  const detach = useCallback((): void => {
    baselineState.detach();
  }, []);

  return { isAttached, tables, attach, detach };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run hooks/useBaseline`

Expected: PASS — all 5 tests green.

Also re-run the existing compare suite to confirm no regression:

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run compare`

Expected: PASS — all pre-existing compare tests still green. (`baselineLoader.test.ts` continues to pass because the file it tests is no longer imported by the hook but is still self-consistent.)

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/hooks/useBaseline.ts frontend-v2/src/__tests__/hooks/useBaseline.test.tsx
git commit -m "$(cat <<'EOF'
fix(compare): useBaseline routes through isolated baseline loader

Drop the JfrLoader + view-wrap path which clobbered the candidate's
main-schema tables (CREATE TABLE IF NOT EXISTS was a no-op when the
candidate had already loaded the same table names, leaving baseline_*
views reading candidate data).

useBaseline now delegates to loadBaselineJfr, which ATTACHes the
baseline as a separate read-only database and creates baseline_* views
that read directly from it. The candidate's tables are never touched.
EOF
)"
```

---

### Task 3: Render `BaselineControls` in the Topbar

**Files:**

- Modify: `frontend-v2/src/components/shell/Topbar.tsx`
- Create: `frontend-v2/src/__tests__/shell/topbarBaseline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/shell/topbarBaseline.test.tsx`:

```tsx
// frontend-v2/src/__tests__/shell/topbarBaseline.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from '../../components/shell/Topbar';
import { baselineState } from '../../services/compare/baselineState';
import { ReportModeProvider } from '../../context/ReportModeContext';
import type { Notebook } from '../../services/parser/types';

// useDB is consumed transitively by useBaseline → BaselineControls.
vi.mock('../../hooks/useDB', () => ({
  useDB: () => ({ registerFile: vi.fn(), query: vi.fn() }),
}));

beforeEach(() => {
  baselineState.detach();
});

const emptyNotebook: Notebook = {
  frontmatter: { version: '2.0' },
  cells: [],
};

function renderTopbar(notebook: Notebook | null = emptyNotebook): void {
  render(
    <ReportModeProvider>
      <Topbar hasNotebook={notebook !== null} notebook={notebook} />
    </ReportModeProvider>,
  );
}

describe('Topbar baseline control', () => {
  it('renders the attach baseline file input when a notebook is open', () => {
    renderTopbar();
    expect(screen.getByTestId('baseline-file-input')).toBeInTheDocument();
  });

  it('does not render the baseline control when no notebook is open', () => {
    renderTopbar(null);
    expect(screen.queryByTestId('baseline-file-input')).not.toBeInTheDocument();
  });

  it('switches to the detach button after baselineState.attach', () => {
    renderTopbar();
    expect(screen.getByTestId('baseline-file-input')).toBeInTheDocument();

    baselineState.attach(['baseline_jfr_cpu_load']);

    expect(screen.getByTestId('detach-baseline-button')).toBeInTheDocument();
    expect(screen.queryByTestId('baseline-file-input')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run shell/topbarBaseline`

Expected: FAIL — `BaselineControls` is not rendered by the `Topbar`, so `baseline-file-input` is not in the document.

- [ ] **Step 3: Implement**

Edit `frontend-v2/src/components/shell/Topbar.tsx`:

(a) Add the import alongside the other component imports near the top of the file (after the `CheckpointsButton` import on line 21):

```ts
import { BaselineControls } from '../compare/BaselineControls';
```

(b) In the `hasNotebook = true` render branch (the second `<header>` returned by `Topbar`), insert `<BaselineControls />` immediately before `<ExportMenu ...>`. Concretely, replace the existing block:

```tsx
          <ExportMenu
            onExportHtml={() => { void handleExportHtml(); }}
            onExportMarkdown={() => { void handleExportMarkdown(); }}
            onExportPdf={() => { void exportToPdf(); }}
          />
          <RedactionButton />
          <CheckpointsButton />
```

with:

```tsx
          <BaselineControls />
          <ExportMenu
            onExportHtml={() => { void handleExportHtml(); }}
            onExportMarkdown={() => { void handleExportMarkdown(); }}
            onExportPdf={() => { void exportToPdf(); }}
          />
          <RedactionButton />
          <CheckpointsButton />
```

Do not add `BaselineControls` to the no-notebook branch (the first `<header>` early-return at the top of the function body) — there's no candidate to compare against until a notebook is loaded, so the control would be confusing there.

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run shell/topbarBaseline`

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/components/shell/Topbar.tsx frontend-v2/src/__tests__/shell/topbarBaseline.test.tsx
git commit -m "$(cat <<'EOF'
feat(topbar): expose baseline attach/detach control

Place BaselineControls between Open and Export in the Topbar so users
can attach a baseline JFR. The control flips to a Detach button while
a baseline is attached, mirroring baselineState.

Only renders when a notebook is open — there's nothing to compare
against from the welcome screen.
EOF
)"
```

---

### Task 4: End-to-end isolation guard — candidate tables survive baseline attach

**Files:**

- Create: `frontend-v2/src/__tests__/compare/candidateIsolation.test.ts`

This task locks in the architectural invariant from Task 1 with a higher-level integration test that uses a stub `DuckDBClientLike` to play through the exact sequence: load candidate (CREATE TABLE rows), then attach baseline (ATTACH + CREATE VIEW), then query candidate and baseline tables and assert the candidate rows are unchanged while baseline_* returns the baseline's data.

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/compare/candidateIsolation.test.ts`:

```ts
// frontend-v2/src/__tests__/compare/candidateIsolation.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadBaselineJfr } from '../../services/jfr/baselineJfrLoader';
import type { DuckDBClientLike } from '../../services/jfr/jfrTypes';

function makeFakeDuckDbBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const view = new Uint8Array(buf);
  view[8] = 0x44;
  view[9] = 0x55;
  view[10] = 0x43;
  view[11] = 0x4b;
  return buf;
}

/**
 * Tiny in-memory DuckDB stand-in. Supports the three SQL shapes the loader
 * emits: ATTACH/DETACH, duckdb_tables() lookup, CREATE OR REPLACE VIEW, plus
 * the `SELECT count(*) FROM <name>` queries our assertions issue.
 */
function makeStubDb(): {
  client: DuckDBClientLike;
  /** Pretend the candidate has already loaded these tables into main with these row counts. */
  candidate: Record<string, number>;
  /** Tables the attached baseline_src will expose, with their row counts. */
  baseline: Record<string, number>;
} {
  const candidate: Record<string, number> = {
    jfr_cpu_load: 100,
    jfr_gc_pause: 42,
  };
  const baseline: Record<string, number> = {
    jfr_cpu_load: 7,
    jfr_gc_pause: 3,
  };
  const views = new Map<string, string>(); // viewName -> backing baseline table
  let attached = false;

  const client: DuckDBClientLike = {
    registerFile: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(async (sql: string) => {
      if (/^ATTACH .* AS baseline_src/i.test(sql)) {
        attached = true;
        return [];
      }
      if (/^DETACH baseline_src/i.test(sql)) {
        attached = false;
        return [];
      }
      if (/duckdb_tables\(\)/.test(sql) && /baseline_src/.test(sql)) {
        if (!attached) throw new Error('baseline_src not attached');
        return Object.keys(baseline).map((t) => ({ table_name: t }));
      }
      const viewMatch = sql.match(
        /CREATE OR REPLACE VIEW "([^"]+)" AS SELECT \* FROM baseline_src\.main\."([^"]+)"/,
      );
      if (viewMatch) {
        views.set(viewMatch[1], viewMatch[2]);
        return [];
      }
      const countMatch = sql.match(/SELECT count\(\*\) AS n FROM "([^"]+)"/);
      if (countMatch) {
        const name = countMatch[1];
        if (name in candidate) return [{ n: candidate[name] }];
        const baselineTable = views.get(name);
        if (baselineTable && baselineTable in baseline) {
          if (!attached) throw new Error(`view ${name} references detached baseline_src`);
          return [{ n: baseline[baselineTable] }];
        }
        throw new Error(`unknown name ${name}`);
      }
      return [];
    }),
  };
  return { client, candidate, baseline };
}

describe('candidate ↔ baseline schema isolation', () => {
  it('attaching a baseline does not change candidate row counts', async () => {
    const { client } = makeStubDb();

    // Sanity: candidate row counts BEFORE attach.
    const cpuBefore = await client.query(`SELECT count(*) AS n FROM "jfr_cpu_load"`);
    expect(cpuBefore[0]['n']).toBe(100);

    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');
    const names = await loadBaselineJfr(client, file);
    expect(names).toEqual(['baseline_jfr_cpu_load', 'baseline_jfr_gc_pause']);

    // Candidate row counts AFTER attach — unchanged.
    const cpuAfter = await client.query(`SELECT count(*) AS n FROM "jfr_cpu_load"`);
    expect(cpuAfter[0]['n']).toBe(100);
    const gcAfter = await client.query(`SELECT count(*) AS n FROM "jfr_gc_pause"`);
    expect(gcAfter[0]['n']).toBe(42);
  });

  it('baseline_<T> views return baseline row counts (NOT candidate)', async () => {
    const { client } = makeStubDb();
    const file = new File([makeFakeDuckDbBuffer()], 'b.jfr.db');
    await loadBaselineJfr(client, file);

    const cpu = await client.query(`SELECT count(*) AS n FROM "baseline_jfr_cpu_load"`);
    expect(cpu[0]['n']).toBe(7);
    const gc = await client.query(`SELECT count(*) AS n FROM "baseline_jfr_gc_pause"`);
    expect(gc[0]['n']).toBe(3);
  });
});
```

- [ ] **Step 2: Run to confirm failure** (or pass — depending on whether Task 1 is already in)

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run compare/candidateIsolation`

Expected: PASS — because Task 1 implements `loadBaselineJfr` correctly. The test exists primarily as a regression-prevention guardrail. If the loader is ever refactored back into the materialization path, this test will go red.

- [ ] **Step 3: Commit**

```bash
git add frontend-v2/src/__tests__/compare/candidateIsolation.test.ts
git commit -m "$(cat <<'EOF'
test(compare): guard rail — candidate tables survive baseline attach

Stubs DuckDB at the DuckDBClientLike interface and plays the full attach
sequence: candidate row counts before vs after must match exactly, and
baseline_<T> views must return baseline row counts (not candidate).

Locks in the architectural decision behind the baselineJfrLoader.
EOF
)"
```

---

### Task 5: Full suite + build check

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test`

Expected: all tests pass — including the existing `compare/baselineLoader.test.ts`, `compare/baselineState.test.ts`, `compare/crossRecordingCoupling.test.ts`, `compare/diffMacro.test.ts`, `compare/registerDiffMacro.test.ts`, and `compare/AttachBaselineButton.test.tsx`.

- [ ] **Step 2: TypeScript build**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck && npm run build`

Expected: no errors.

- [ ] **Step 3: Lint (if configured)**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run lint 2>&1 || true`

If the project has a `lint` script and it fails on any of the new files, fix those before continuing.

- [ ] **Step 4: Commit any docs/lint fixes**

Only commit if there are remaining changes:

```bash
git status
# if anything dirty:
git add -A
git commit -m "chore(compare): final lint/typecheck polish for M-E5"
```

---

## Self-Review

**Spec coverage:**

- [x] Baseline attach affordance is reachable from the Topbar when a notebook is open (Task 3).
- [x] Clicking attach loads the baseline file into DuckDB as an isolated database (Task 1 + 2).
- [x] Candidate tables in the main schema are not touched by baseline attach (Task 1 design, Task 4 guardrail).
- [x] `baseline_<T>` views serve baseline data, not candidate data (Task 1 unit test + Task 4 integration test).
- [x] `baselineState.attach(tables)` fires so existing `compare: true` cells re-render via the already-built `CompareView` path.
- [x] `registerDiffMacro` runs after attach so the `DIFF()` macro works in candidate cells (preserved from old hook).
- [x] Re-attach (selecting a different baseline) is idempotent — old baseline_src is detached first (Task 1 test).

**Placeholder scan:** No TBD patterns. Every step has complete code.

**Type consistency:**

- All new files use `import type { JSX } from 'react'` where they declare a JSX return type.
- No `any` introduced — `unknown` with narrowing or specific types throughout.
- `DuckDBClientLike` is the single interface used for the DuckDB surface; no direct dependency on `@duckdb/duckdb-wasm` types.

**Out of scope (deferred to later milestones):**

- The `name:` clause for panel addressing inside cells (M-E8).
- `filter_from` chip authoring popover in the Varbar (part of M-E7).
- A full E2E (Playwright) smoke test with a real baseline `.jfr.db` fixture — postponed until the rest of M-D2 / M-E13 fixture infrastructure lands; the integration test in Task 4 provides equivalent confidence at the DuckDB-client boundary.
- A "Detach + clear baseline_* views" cleanup pass when the user detaches — the views remain in the catalog harmlessly until the next attach replaces them; if this surfaces in user testing, add a `DROP VIEW IF EXISTS baseline_<T>` loop to `detach()` in a follow-up.
- Visual polish (icon next to the Attach baseline label, hover preview of baseline metadata).
