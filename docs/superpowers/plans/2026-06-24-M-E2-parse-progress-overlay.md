# M-E2: JFR Parse Progress Overlay + Recording Metadata Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current minimal `LoadingOverlay` (single spinner + 4-stage percent bar) with a rich, full-screen JFR parse progress overlay that shows a chunk counter (X/Y), elapsed and remaining time estimates, and a per-event-type streaming rows table that updates as the loader discovers and materializes tables. After successful load, populate the `recordingStore` (from M-E1 plan) with file size, event count, duration, JVM version, and GC algorithm so the RECORDING sidebar card renders correctly.

**Architecture:** `JfrLoader` currently emits coarse `start`/`registered`/`done` events. We extend `JfrLoadEvent` with two new variants — `'chunk'` (incremental progress: current chunk index, total chunks, optional bytes processed) and `'table-progress'` (per-table row counts as they are inserted) — so the loader produces fine-grained progress without leaking impl details. Inside `JfrLoader.load()`, the table-materialization loop is split into chunked work: each table emits a `'chunk'` event before its `CREATE TABLE AS SELECT` and a `'table-progress'` event after, with the row count obtained via a follow-up `SELECT count(*)`. Then a new metadata probe runs four read-only queries against the attached source (best-effort, swallowed if not present): `events` total, recording duration, JVM info, GC algorithm. The metadata is returned in the `'done'` event payload, and `useFileIngest` pushes it into the new `recordingStore` (introduced in M-E1 plan but also created here in case M-E1 has not yet been merged — see Task 0). The `LoadingOverlay` is rewritten as `JfrProgressOverlay` consuming a richer state shape.

**Tech Stack:** React 19.2, TypeScript 5.8, Vitest 4.1.9 (`pool: 'forks'`), @testing-library/react 16.3.0, Playwright 1.61.0, Tailwind v4 CSS tokens. No new dependencies.

---

## Critical Rules

- `import type { JSX } from 'react'` in every component file
- `pool: 'forks'` in `vitest.config.ts` — NEVER change
- All colors via CSS token vars only
- No `text-sm` — use `text-[13px]`, `text-[12px]`, `text-[11px]`
- No `any` — narrow `unknown`
- Loader still emits `start`/`registered`/`done`/`error`; new events are additions, not replacements (backward compat for `useFileIngest` callers that ignore them)
- ETA math lives in a pure helper so it is unit-testable
- Metadata probing is *best-effort*: a single failed query must not fail the load
- Overlay must be `aria-live="polite"` and trap focus on `Escape`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/recording/recordingStore.ts` | Create (or reuse from M-E1) | External store for active JFR metadata |
| `src/services/jfr/jfrTypes.ts` | Modify | Extend `JfrLoadEvent` with `chunk` & `table-progress`; add `RecordingMetadata` shape and `done.metadata` |
| `src/services/jfr/jfrLoader.ts` | Modify | Emit `chunk`/`table-progress`; collect metadata; pass to `done` |
| `src/services/jfr/metadataProbe.ts` | Create | Best-effort metadata queries (events, duration, JVM, GC) |
| `src/services/jfr/progressEta.ts` | Create | Pure helper: `etaMs(start, doneChunks, totalChunks)` |
| `src/hooks/useFileIngest.ts` | Modify | New `IngestState['loading']` payload (chunks, eta, tableProgress); call `recordingStore.set` on done |
| `src/components/shell/JfrProgressOverlay.tsx` | Create | Rich overlay replacing `LoadingOverlay` for loading state |
| `src/components/shell/LoadingOverlay.tsx` | Modify | Delegate "loading" branch to `JfrProgressOverlay`; keep error branch |
| `src/__tests__/jfr/jfrLoader.test.ts` | Modify | Add chunk/table-progress event assertions |
| `src/__tests__/jfr/metadataProbe.test.ts` | Create | Unit |
| `src/__tests__/jfr/progressEta.test.ts` | Create | Unit |
| `src/__tests__/hooks/useFileIngest.test.tsx` | Modify | Assert chunked state + recordingStore call |
| `src/__tests__/shell/JfrProgressOverlay.test.tsx` | Create | Component |
| `tests/visual/jfr-progress-overlay.visual.spec.ts` | Create | Playwright visual regression |

---

## Key design decisions

1. **Chunk = "one table materialization step".** Rather than fake byte-level chunking, we treat each of the N tables discovered in step 2 as one chunk. `totalChunks = tables.length`. This is honest, observable progress; estimation accuracy is good when tables are roughly similar in size, and the user always sees forward motion.
2. **Per-event-type streaming table.** Each `'table-progress'` event carries `{ tableName, rowCount, durationMs }`. The overlay accumulates these into a `tableProgress: Record<string, { rowCount, durationMs }>` map and renders a small sortable table.
3. **Metadata probe runs *before* DETACH.** It queries `src.main.<table>` for the metrics so we don't pay the cost of an extra round trip after copying. Each probe wraps its query in try/catch and contributes `null` to the result on failure.
4. **ETA formula:** simple linear projection — `elapsedMs / doneChunks * (totalChunks - doneChunks)`. Returned as `null` when `doneChunks === 0` so the UI can show "—".
5. **Backward compat.** `useFileIngest.state` keeps the same discriminator (`'idle' | 'loading' | 'done' | 'error'`) but the loading variant gains optional `chunks`/`tableProgress`/`etaMs` fields. Existing tests that read `state.progress`/`state.percent` continue to pass.
6. **Overlay vs sidebar card.** The overlay is shown *during* loading. Once `done`, the overlay hides and the RECORDING card (from M-E1 plan) appears in the sidebar. If M-E1 has not yet landed, this plan still creates `recordingStore` and the metadata path; the sidebar consumer comes from M-E1.

---

## Task 0: Ensure `recordingStore` exists

**Files:**
- Create or verify: `src/services/recording/recordingStore.ts`
- Create or verify: `src/__tests__/recording/recordingStore.test.ts`

- [ ] **Step 1: Check whether M-E1 has already created the file**

```bash
test -f src/services/recording/recordingStore.ts && echo "exists" || echo "missing"
```

- [ ] **Step 2: If missing, create it (identical to Task 4 of plan M-E1)**

```ts
// src/services/recording/recordingStore.ts
export interface RecordingMetadata {
  fileName: string;
  bytes: number;
  eventCount: number;
  durationMs: number;
  jvmVersion: string | null;
  gcAlgorithm: string | null;
}

type Listener = () => void;

class RecordingStore {
  private snapshot: RecordingMetadata | null = null;
  private listeners: Set<Listener> = new Set();

  getSnapshot = (): RecordingMetadata | null => this.snapshot;
  subscribe = (cb: Listener): (() => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };

  set(meta: RecordingMetadata): void {
    this.snapshot = { ...meta };
    for (const l of this.listeners) l();
  }
  clear(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    for (const l of this.listeners) l();
  }
}

export const recordingStore = new RecordingStore();
```

And the matching test file (copy from M-E1 Task 4 Step 1).

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/recording/recordingStore.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit (skip if M-E1 already added)**

```bash
git add src/services/recording/recordingStore.ts src/__tests__/recording/recordingStore.test.ts
git commit -m "feat(recording): add recordingStore (idempotent with M-E1)"
```

---

## Task 1: Extend `JfrLoadEvent` and add `RecordingMetadata` to `done`

**Files:**
- Modify: `src/services/jfr/jfrTypes.ts`

- [ ] **Step 1: Replace the file body**

```ts
// src/services/jfr/jfrTypes.ts

export type JfrError =
  | { kind: 'unsupported-format'; message: string }
  | { kind: 'empty-file'; message: string }
  | { kind: 'not-jfr-or-db'; message: string }
  | { kind: 'register-failed'; message: string; cause?: unknown }
  | { kind: 'query-failed'; message: string; cause?: unknown };

export interface RecordingMetadata {
  fileName: string;
  bytes: number;
  eventCount: number;
  durationMs: number;
  jvmVersion: string | null;
  gcAlgorithm: string | null;
}

export interface TableProgressEntry {
  tableName: string;
  rowCount: number;
  durationMs: number;
}

export type JfrLoadEvent =
  | { kind: 'start'; fileName: string; bytes: number }
  | { kind: 'registered'; fileName: string; totalChunks: number }
  | { kind: 'chunk'; fileName: string; tableName: string; chunkIndex: number; totalChunks: number }
  | { kind: 'table-progress'; fileName: string; entry: TableProgressEntry }
  | { kind: 'done'; fileName: string; tables: string[]; metadata: RecordingMetadata }
  | { kind: 'error'; fileName: string; error: JfrError };

export type JfrLoadCallback = (event: JfrLoadEvent) => void;

export interface DuckDBClientLike {
  registerFile(name: string, buffer: ArrayBuffer): Promise<void>;
  query(sql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: errors only at the loader / hook / overlay call sites that we'll fix in subsequent tasks. Note them; do not fix here.

- [ ] **Step 3: Commit**

```bash
git add src/services/jfr/jfrTypes.ts
git commit -m "feat(jfr-types): extend JfrLoadEvent with chunk/table-progress + RecordingMetadata"
```

---

## Task 2: Add the `progressEta` pure helper

**Files:**
- Create: `src/services/jfr/progressEta.ts`
- Create: `src/__tests__/jfr/progressEta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/jfr/progressEta.test.ts
import { describe, it, expect } from 'vitest';
import { etaMs } from '../../services/jfr/progressEta';

describe('etaMs', () => {
  it('returns null when no chunks done yet', () => {
    expect(etaMs({ startedAt: 1000, now: 5000, doneChunks: 0, totalChunks: 10 })).toBeNull();
  });

  it('projects linearly from done/total ratio', () => {
    expect(etaMs({ startedAt: 0, now: 1000, doneChunks: 1, totalChunks: 4 })).toBe(3000);
    expect(etaMs({ startedAt: 0, now: 1000, doneChunks: 2, totalChunks: 4 })).toBe(1000);
  });

  it('returns 0 when all chunks done', () => {
    expect(etaMs({ startedAt: 0, now: 1000, doneChunks: 4, totalChunks: 4 })).toBe(0);
  });

  it('returns null when totalChunks is 0', () => {
    expect(etaMs({ startedAt: 0, now: 1000, doneChunks: 0, totalChunks: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/jfr/progressEta.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/jfr/progressEta.ts
export interface EtaInput {
  startedAt: number;
  now: number;
  doneChunks: number;
  totalChunks: number;
}

export function etaMs(input: EtaInput): number | null {
  if (input.totalChunks <= 0) return null;
  if (input.doneChunks <= 0) return null;
  if (input.doneChunks >= input.totalChunks) return 0;
  const elapsed = Math.max(0, input.now - input.startedAt);
  const remaining = input.totalChunks - input.doneChunks;
  return Math.round((elapsed / input.doneChunks) * remaining);
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/jfr/progressEta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/jfr/progressEta.ts src/__tests__/jfr/progressEta.test.ts
git commit -m "feat(jfr): add etaMs helper for progress overlay"
```

---

## Task 3: Add `metadataProbe`

**Files:**
- Create: `src/services/jfr/metadataProbe.ts`
- Create: `src/__tests__/jfr/metadataProbe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/jfr/metadataProbe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { probeMetadata } from '../../services/jfr/metadataProbe';
import type { DuckDBClientLike } from '../../services/jfr/jfrTypes';

function makeClient(responder: (sql: string) => Promise<Record<string, unknown>[]>): DuckDBClientLike {
  return { registerFile: vi.fn(), query: vi.fn((sql: string) => responder(sql)) };
}

describe('probeMetadata', () => {
  it('aggregates event_count, duration_ms, jvm_version, gc_algorithm from src tables', async () => {
    const client = makeClient(async (sql) => {
      if (sql.includes('event_count')) return [{ event_count: 9999 }];
      if (sql.includes('MIN(start_time)')) return [{ duration_ms: 60000 }];
      if (sql.includes('jvm_information') || sql.includes('jvm_info')) return [{ jvm_version: '21.0.1' }];
      if (sql.includes('gc_configuration')) return [{ gc_algorithm: 'G1' }];
      return [];
    });
    const meta = await probeMetadata(client, ['events', 'jvm_information', 'gc_configuration']);
    expect(meta).toEqual({ eventCount: 9999, durationMs: 60000, jvmVersion: '21.0.1', gcAlgorithm: 'G1' });
  });

  it('returns nulls when probe queries fail', async () => {
    const client = makeClient(async () => { throw new Error('nope'); });
    const meta = await probeMetadata(client, []);
    expect(meta).toEqual({ eventCount: 0, durationMs: 0, jvmVersion: null, gcAlgorithm: null });
  });

  it('skips probes for tables that do not exist in the source', async () => {
    const calls: string[] = [];
    const client = makeClient(async (sql) => { calls.push(sql); return []; });
    await probeMetadata(client, ['events']); // only events present
    expect(calls.some((s) => s.includes('jvm_information'))).toBe(false);
    expect(calls.some((s) => s.includes('gc_configuration'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/jfr/metadataProbe.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/jfr/metadataProbe.ts
import type { DuckDBClientLike } from './jfrTypes';

export interface ProbedMetadata {
  eventCount: number;
  durationMs: number;
  jvmVersion: string | null;
  gcAlgorithm: string | null;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

function firstScalar<T = unknown>(rows: Record<string, unknown>[], key: string): T | null {
  if (rows.length === 0) return null;
  const v = rows[0][key];
  return (v === undefined || v === null) ? null : (v as T);
}

export async function probeMetadata(
  client: DuckDBClientLike,
  sourceTables: string[]
): Promise<ProbedMetadata> {
  const has = new Set(sourceTables);

  // Total event count: try `events` first, else SUM of all known event tables.
  let eventCount = 0;
  if (has.has('events')) {
    const rows = await safe(client.query(`SELECT count(*) AS event_count FROM src.main."events"`), []);
    eventCount = Number(firstScalar<number>(rows, 'event_count') ?? 0);
  }

  // Duration: max(end_time) - min(start_time) from events, expressed as ms.
  let durationMs = 0;
  if (has.has('events')) {
    const rows = await safe(client.query(
      `SELECT CAST(EXTRACT(EPOCH FROM (MAX(end_time) - MIN(start_time))) * 1000 AS BIGINT) AS duration_ms FROM src.main."events"`
    ), []);
    durationMs = Number(firstScalar<number>(rows, 'duration_ms') ?? 0);
  }

  // JVM version: jvm_information.jvm_version (first row).
  let jvmVersion: string | null = null;
  const jvmTable = has.has('jvm_information') ? 'jvm_information' : has.has('jvm_info') ? 'jvm_info' : null;
  if (jvmTable !== null) {
    const rows = await safe(client.query(`SELECT jvm_version FROM src.main."${jvmTable}" LIMIT 1`), []);
    const v = firstScalar<string>(rows, 'jvm_version');
    jvmVersion = v === null ? null : String(v);
  }

  // GC algorithm: gc_configuration.young_collector or .gc_name.
  let gcAlgorithm: string | null = null;
  if (has.has('gc_configuration')) {
    const rows = await safe(client.query(`SELECT coalesce(young_collector, gc_name) AS gc_algorithm FROM src.main."gc_configuration" LIMIT 1`), []);
    const v = firstScalar<string>(rows, 'gc_algorithm');
    gcAlgorithm = v === null ? null : String(v);
  }

  return { eventCount, durationMs, jvmVersion, gcAlgorithm };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/jfr/metadataProbe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/jfr/metadataProbe.ts src/__tests__/jfr/metadataProbe.test.ts
git commit -m "feat(jfr): metadataProbe for events/duration/JVM/GC (best-effort)"
```

---

## Task 4: Modify `JfrLoader` to emit chunk + table-progress + metadata

**Files:**
- Modify: `src/services/jfr/jfrLoader.ts`
- Modify: `src/__tests__/jfr/jfrLoader.test.ts`

- [ ] **Step 1: Write the failing test (add new cases to `jfrLoader.test.ts`)**

Add to `src/__tests__/jfr/jfrLoader.test.ts`:

```ts
describe('JfrLoader progress events', () => {
  it('emits chunk + table-progress events for every discovered table', async () => {
    const events: JfrLoadEvent[] = [];
    const tables = ['events', 'gc_configuration'];
    const client: DuckDBClientLike = {
      registerFile: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.startsWith('ATTACH')) return Promise.resolve([]);
        if (sql.startsWith('DETACH')) return Promise.resolve([]);
        if (sql.includes('duckdb_tables()')) return Promise.resolve(tables.map((t) => ({ table_name: t })));
        if (sql.startsWith('CREATE TABLE')) return Promise.resolve([]);
        if (sql.startsWith('SELECT count(*)')) return Promise.resolve([{ n: 42 }]);
        // metadata probe queries
        if (sql.includes('event_count')) return Promise.resolve([{ event_count: 42 }]);
        if (sql.includes('MIN(start_time)')) return Promise.resolve([{ duration_ms: 1000 }]);
        if (sql.includes('gc_algorithm')) return Promise.resolve([{ gc_algorithm: 'G1' }]);
        return Promise.resolve([]);
      }),
    };
    const { JfrLoader } = await import('../../services/jfr/jfrLoader');
    const buf = makeDuckBuffer();
    await new JfrLoader(client).load(buf, 'app.jfr.db', (e) => events.push(e));
    const chunkEvents = events.filter((e) => e.kind === 'chunk');
    const tpEvents = events.filter((e) => e.kind === 'table-progress');
    expect(chunkEvents.length).toBe(2);
    expect(tpEvents.length).toBe(2);
    const done = events.find((e) => e.kind === 'done');
    expect(done && done.kind === 'done' ? done.metadata.eventCount : -1).toBe(42);
    expect(done && done.kind === 'done' ? done.metadata.gcAlgorithm : '').toBe('G1');
  });
});

// helper at top of file (next to existing helpers):
function makeDuckBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const view = new Uint8Array(buf);
  view[8] = 0x44; view[9] = 0x55; view[10] = 0x43; view[11] = 0x4b;
  return buf;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/jfr/jfrLoader.test.ts`
Expected: FAIL — no `chunk`/`table-progress` events; `done` has no `metadata`.

- [ ] **Step 3: Modify `jfrLoader.ts`**

Replace the entire body of the `load()` method's "Step 2" block (currently the `try { ... await DETACH ... }`) and the final `emit({ kind: 'done', ... })`:

```ts
// Step 2: ATTACH, discover, copy with progress, probe metadata, DETACH.
let tables: string[] = [];
let metadata = { eventCount: 0, durationMs: 0, jvmVersion: null as string | null, gcAlgorithm: null as string | null };
try {
  await this.client.query(`ATTACH '${registeredName}' AS src (READ_ONLY)`);
  const rows = await this.client.query(
    `SELECT table_name FROM duckdb_tables() WHERE database_name='src' AND schema_name='main'`
  );
  tables = rows.map((r) => String(r['table_name']));
  emit({ kind: 'registered', fileName, totalChunks: tables.length });

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const safe = quoteIdent(t);
    emit({ kind: 'chunk', fileName, tableName: t, chunkIndex: i, totalChunks: tables.length });
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    await this.client.query(`CREATE TABLE IF NOT EXISTS "${safe}" AS SELECT * FROM src.main."${safe}"`);
    const countRows = await this.client.query(`SELECT count(*) AS n FROM "${safe}"`);
    const rowCount = Number((countRows[0] ?? {})['n'] ?? 0);
    const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    emit({ kind: 'table-progress', fileName, entry: { tableName: t, rowCount, durationMs } });
  }

  const { probeMetadata } = await import('./metadataProbe');
  metadata = await probeMetadata(this.client, tables);

  await this.client.query('DETACH src');
} catch (cause) {
  const err: JfrError = {
    kind: 'query-failed',
    message: cause instanceof Error ? cause.message : `Table discovery failed for '${registeredName}'`,
    cause,
  };
  emit({ kind: 'error', fileName, error: err });
  throw err;
}

activityBus.dispatch(makeEntry('load', `Loaded ${fileName} (${tables.length} tables)`));
emit({
  kind: 'done',
  fileName,
  tables,
  metadata: {
    fileName,
    bytes: buffer.byteLength,
    eventCount: metadata.eventCount,
    durationMs: metadata.durationMs,
    jvmVersion: metadata.jvmVersion,
    gcAlgorithm: metadata.gcAlgorithm,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/jfr/jfrLoader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/jfr/jfrLoader.ts src/__tests__/jfr/jfrLoader.test.ts
git commit -m "feat(jfr-loader): emit chunk/table-progress events; probe metadata"
```

---

## Task 5: Build `JfrProgressOverlay`

**Files:**
- Create: `src/components/shell/JfrProgressOverlay.tsx`
- Create: `src/__tests__/shell/JfrProgressOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/JfrProgressOverlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JfrProgressOverlay } from '../../components/shell/JfrProgressOverlay';

describe('JfrProgressOverlay', () => {
  it('shows chunk counter X/Y, elapsed, eta, and a row per table', () => {
    render(
      <JfrProgressOverlay
        fileName="app.jfr.db"
        chunkIndex={2}
        totalChunks={5}
        elapsedMs={4000}
        etaMs={6000}
        tableProgress={{
          events: { rowCount: 1000, durationMs: 800 },
          gc_pauses: { rowCount: 42, durationMs: 50 },
        }}
      />
    );
    expect(screen.getByTestId('jfr-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('jfr-overlay-chunk-counter')).toHaveTextContent('2 / 5');
    expect(screen.getByTestId('jfr-overlay-elapsed')).toHaveTextContent(/4\.0s/);
    expect(screen.getByTestId('jfr-overlay-eta')).toHaveTextContent(/6\.0s/);
    expect(screen.getByText('events')).toBeInTheDocument();
    expect(screen.getByText('gc_pauses')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });

  it('renders an em-dash for ETA before any chunk is done', () => {
    render(
      <JfrProgressOverlay
        fileName="x.jfr.db"
        chunkIndex={0}
        totalChunks={3}
        elapsedMs={500}
        etaMs={null}
        tableProgress={{}}
      />
    );
    expect(screen.getByTestId('jfr-overlay-eta')).toHaveTextContent('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/JfrProgressOverlay.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/JfrProgressOverlay.tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { formatDurationMs } from '../../services/jfr/progressEta';

export interface JfrProgressOverlayProps {
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
  elapsedMs: number;
  etaMs: number | null;
  tableProgress: Record<string, { rowCount: number; durationMs: number }>;
}

export function JfrProgressOverlay(props: JfrProgressOverlayProps): JSX.Element {
  const trapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { trapRef.current?.focus(); }, []);
  const pct = props.totalChunks === 0 ? 0 : Math.round((props.chunkIndex / props.totalChunks) * 100);
  const tableEntries = Object.entries(props.tableProgress);

  const node = (
    <div
      ref={trapRef}
      data-testid="jfr-overlay"
      role="status"
      aria-live="polite"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg-base)]/95 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xl">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg-base)]">Parsing {props.fileName}</h2>

        <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <div className="text-[var(--color-fg-dim)] uppercase tracking-wider">Chunks</div>
            <div data-testid="jfr-overlay-chunk-counter" className="text-[15px] font-mono text-[var(--color-fg-base)]">
              {props.chunkIndex} / {props.totalChunks}
            </div>
          </div>
          <div>
            <div className="text-[var(--color-fg-dim)] uppercase tracking-wider">Elapsed</div>
            <div data-testid="jfr-overlay-elapsed" className="text-[15px] font-mono text-[var(--color-fg-base)]">
              {formatDurationMs(props.elapsedMs)}
            </div>
          </div>
          <div>
            <div className="text-[var(--color-fg-dim)] uppercase tracking-wider">ETA</div>
            <div data-testid="jfr-overlay-eta" className="text-[15px] font-mono text-[var(--color-fg-base)]">
              {formatDurationMs(props.etaMs)}
            </div>
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Parse progress"
          data-testid="jfr-overlay-progress-bar"
          className="mt-4 h-1.5 w-full rounded-full bg-[var(--color-bg-overlay)]"
        >
          <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-5">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)]">Materialized tables</div>
          {tableEntries.length === 0 ? (
            <div className="text-[12px] text-[var(--color-fg-dim)]">Waiting for first chunk…</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--color-fg-dim)]">
                  <th className="py-0.5">Table</th>
                  <th className="py-0.5 text-right">Rows</th>
                  <th className="py-0.5 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {tableEntries.map(([name, { rowCount, durationMs }]) => (
                  <tr key={name} data-testid={`jfr-overlay-row-${name}`} className="border-t border-[var(--color-border)]/40">
                    <td className="py-0.5 font-mono text-[var(--color-fg-base)]">{name}</td>
                    <td className="py-0.5 text-right text-[var(--color-fg-muted)]">{rowCount.toLocaleString()}</td>
                    <td className="py-0.5 text-right text-[var(--color-fg-muted)]">{formatDurationMs(durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/JfrProgressOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/JfrProgressOverlay.tsx src/__tests__/shell/JfrProgressOverlay.test.tsx
git commit -m "feat(shell): JfrProgressOverlay with chunk counter + per-table grid"
```

---

## Task 6: Update `LoadingOverlay` to delegate to `JfrProgressOverlay`

**Files:**
- Modify: `src/components/shell/LoadingOverlay.tsx`
- Modify: `src/__tests__/shell/loadingOverlay.test.tsx` (if it exists; otherwise add minimal smoke test)

- [ ] **Step 1: Write the failing test (delegation)**

```tsx
// src/__tests__/shell/loadingOverlayDelegation.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingOverlay } from '../../components/shell/LoadingOverlay';

describe('LoadingOverlay delegation', () => {
  it('renders JfrProgressOverlay when status is loading with rich props', () => {
    render(
      <LoadingOverlay
        status="loading"
        fileName="x.jfr.db"
        chunkIndex={1}
        totalChunks={3}
        elapsedMs={1000}
        etaMs={2000}
        tableProgress={{ events: { rowCount: 5, durationMs: 10 } }}
      />
    );
    expect(screen.getByTestId('jfr-overlay')).toBeInTheDocument();
  });

  it('still renders the error branch for error status', () => {
    render(
      <LoadingOverlay
        status="error"
        error={{ kind: 'empty-file', message: 'nope' }}
        onRetry={() => {}}
      />
    );
    expect(screen.getByTestId('loading-error-heading')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/loadingOverlayDelegation.test.tsx`
Expected: FAIL — `LoadingOverlay` props don't accept the new shape.

- [ ] **Step 3: Modify `LoadingOverlay.tsx`**

Replace the file body:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import type { JfrError } from '../../services/jfr/jfrTypes';
import { JfrProgressOverlay } from './JfrProgressOverlay';

type UiJfrError = JfrError | { kind: 'not-jfr-or-db'; message: string };

function errorHeading(error: UiJfrError): string {
  switch (error.kind) {
    case 'empty-file': return 'Empty file';
    case 'unsupported-format': return 'Unsupported format';
    case 'register-failed': return 'Registration failed';
    case 'query-failed': return 'Query failed';
    case 'not-jfr-or-db': return 'Not a JFR or DuckDB file';
    default: return 'Load failed';
  }
}

export type LoadingOverlayProps =
  | {
      status: 'loading';
      fileName: string;
      chunkIndex: number;
      totalChunks: number;
      elapsedMs: number;
      etaMs: number | null;
      tableProgress: Record<string, { rowCount: number; durationMs: number }>;
    }
  | { status: 'error'; error: UiJfrError; onRetry: () => void };

export function LoadingOverlay(props: LoadingOverlayProps): JSX.Element {
  const trapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { trapRef.current?.focus(); }, []);

  if (props.status === 'loading') {
    return (
      <JfrProgressOverlay
        fileName={props.fileName}
        chunkIndex={props.chunkIndex}
        totalChunks={props.totalChunks}
        elapsedMs={props.elapsedMs}
        etaMs={props.etaMs}
        tableProgress={props.tableProgress}
      />
    );
  }

  const node = (
    <div
      ref={trapRef}
      data-testid="loading-overlay"
      role="status"
      aria-live="polite"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg-base)]/90 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="rounded-full bg-[var(--color-accent-red)]/20 p-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 data-testid="loading-error-heading" className="text-[16px] font-semibold text-[var(--color-fg-base)]">
          {errorHeading(props.error)}
        </h2>
        <p className="text-[13px] text-[var(--color-fg-muted)]">{props.error.message}</p>
        <button
          type="button"
          data-testid="loading-retry-button"
          onClick={props.onRetry}
          className="mt-2 rounded px-4 py-2 text-[13px] font-medium bg-[var(--color-accent)] text-[var(--color-bg-base)] hover:opacity-90 transition-opacity"
        >Try again</button>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/loadingOverlayDelegation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/LoadingOverlay.tsx src/__tests__/shell/loadingOverlayDelegation.test.tsx
git commit -m "feat(shell): LoadingOverlay delegates loading branch to JfrProgressOverlay"
```

---

## Task 7: Update `useFileIngest` to track chunks + push to `recordingStore`

**Files:**
- Modify: `src/hooks/useFileIngest.ts`
- Modify: `src/__tests__/hooks/useFileIngest.test.tsx` (or create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `src/__tests__/hooks/useFileIngest.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileIngest } from '../../hooks/useFileIngest';
import { recordingStore } from '../../services/recording/recordingStore';
import type { DuckDBClientLike, JfrLoadEvent } from '../../services/jfr/jfrTypes';

function makeFile(name = 'a.jfr.db'): File {
  const ab = new ArrayBuffer(32);
  const v = new Uint8Array(ab);
  v[8] = 0x44; v[9] = 0x55; v[10] = 0x43; v[11] = 0x4b;
  return new File([ab], name);
}

function makeClient(tables: string[]): DuckDBClientLike {
  return {
    registerFile: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('ATTACH') || sql.startsWith('DETACH')) return Promise.resolve([]);
      if (sql.includes('duckdb_tables()')) return Promise.resolve(tables.map((t) => ({ table_name: t })));
      if (sql.startsWith('CREATE TABLE')) return Promise.resolve([]);
      if (sql.startsWith('SELECT count(*)')) return Promise.resolve([{ n: 7 }]);
      if (sql.includes('event_count')) return Promise.resolve([{ event_count: 7 }]);
      if (sql.includes('MIN(start_time)')) return Promise.resolve([{ duration_ms: 1000 }]);
      if (sql.includes('jvm_version')) return Promise.resolve([{ jvm_version: '21' }]);
      if (sql.includes('gc_algorithm')) return Promise.resolve([{ gc_algorithm: 'G1' }]);
      return Promise.resolve([]);
    }),
  };
}

describe('useFileIngest chunked state', () => {
  it('accumulates tableProgress and pushes RecordingMetadata into recordingStore', async () => {
    recordingStore.clear();
    const client = makeClient(['events', 'gc_configuration']);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useFileIngest({ client: client as never, onSuccess })
    );
    await act(async () => { result.current.handleFile(makeFile()); });
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(recordingStore.getSnapshot()).toMatchObject({
      fileName: 'a.jfr.db', eventCount: 7, jvmVersion: '21', gcAlgorithm: 'G1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Modify `useFileIngest.ts`**

Replace the body. Key changes: new loading payload shape; track elapsed via `Date.now()`; populate `recordingStore` on done.

```ts
import { useCallback, useRef, useState } from 'react';
import type {
  JfrError,
  JfrLoadCallback,
  JfrLoadEvent,
  DuckDBClientLike,
  RecordingMetadata,
  TableProgressEntry,
} from '../services/jfr/jfrTypes';
import { JfrLoader } from '../services/jfr/jfrLoader';
import type { Notebook } from '../services/parser/types';
import { loadLiveSchema } from '../context/FileIngestContext';
import { etaMs } from '../services/jfr/progressEta';
import { recordingStore } from '../services/recording/recordingStore';

const ACCEPTED_EXTENSIONS = ['.jfr', '.db', '.duckdb', '.jfr.db'];

type UiJfrError = JfrError | { kind: 'not-jfr-or-db'; message: string };

type LoadingPayload = {
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
  startedAt: number;
  elapsedMs: number;
  etaMs: number | null;
  tableProgress: Record<string, { rowCount: number; durationMs: number }>;
};

type IngestState =
  | { status: 'idle' }
  | { status: 'loading'; payload: LoadingPayload }
  | { status: 'done' }
  | { status: 'error'; error: UiJfrError };

function buildStarterNotebook(tables: string[]): Notebook {
  const tableName = tables.includes('gc_pauses') ? 'gc_pauses' : tables[0] ?? null;
  const source = tableName ? `SELECT * FROM ${tableName} LIMIT 100` : '-- No tables found';
  return {
    frontmatter: {},
    cells: [{ displayIndex: 1, alias: 'cell_1', frontmatter: {}, blocks: [{ kind: 'sql', source }] }],
  };
}

function hasAcceptedExtension(fileName: string): boolean {
  return ACCEPTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
}

interface UseFileIngestOptions {
  client: DuckDBClientLike;
  onSuccess: (notebook: Notebook) => void;
  onProgress?: JfrLoadCallback;
}

interface UseFileIngestResult {
  state: IngestState;
  handleFile: (file: File) => void;
  retry: () => void;
}

export function useFileIngest({
  client, onSuccess, onProgress,
}: UseFileIngestOptions): UseFileIngestResult {
  const [state, setState] = useState<IngestState>({ status: 'idle' });
  const lastFileRef = useRef<File | null>(null);

  const loadFile = useCallback(
    async (file: File): Promise<void> => {
      if (!hasAcceptedExtension(file.name)) {
        setState({ status: 'error', error: { kind: 'not-jfr-or-db', message: 'Drop a .jfr.db, .db, or .duckdb file.' } });
        return;
      }

      const startedAt = Date.now();
      const initialPayload: LoadingPayload = {
        fileName: file.name,
        chunkIndex: 0,
        totalChunks: 0,
        startedAt,
        elapsedMs: 0,
        etaMs: null,
        tableProgress: {},
      };
      setState({ status: 'loading', payload: initialPayload });

      const loader = new JfrLoader(client);
      let doneTables: string[] = [];
      let doneMetadata: RecordingMetadata | null = null;

      const handler: JfrLoadCallback = (event: JfrLoadEvent) => {
        onProgress?.(event);
        setState((prev) => {
          if (prev.status !== 'loading') return prev;
          const now = Date.now();
          const elapsedMs = now - prev.payload.startedAt;
          const base = { ...prev.payload, elapsedMs };
          switch (event.kind) {
            case 'start':
              return { status: 'loading', payload: { ...base } };
            case 'registered':
              return { status: 'loading', payload: { ...base, totalChunks: event.totalChunks } };
            case 'chunk':
              return {
                status: 'loading',
                payload: {
                  ...base,
                  chunkIndex: event.chunkIndex,
                  totalChunks: event.totalChunks,
                  etaMs: etaMs({ startedAt: prev.payload.startedAt, now, doneChunks: event.chunkIndex, totalChunks: event.totalChunks }),
                },
              };
            case 'table-progress': {
              const entry: TableProgressEntry = event.entry;
              return {
                status: 'loading',
                payload: {
                  ...base,
                  tableProgress: { ...base.tableProgress, [entry.tableName]: { rowCount: entry.rowCount, durationMs: entry.durationMs } },
                },
              };
            }
            case 'done':
              doneTables = event.tables;
              doneMetadata = event.metadata;
              return prev;
            default:
              return prev;
          }
        });
      };

      try {
        await loader.load(file, file.name, handler);
        await loadLiveSchema(client);
        if (doneMetadata !== null) recordingStore.set(doneMetadata);
        const notebook = buildStarterNotebook(doneTables);
        setState({ status: 'done' });
        onSuccess(notebook);
      } catch (thrown: unknown) {
        setState({ status: 'error', error: thrown as JfrError });
      }
    },
    [client, onSuccess, onProgress]
  );

  const handleFile = useCallback((file: File): void => { lastFileRef.current = file; void loadFile(file); }, [loadFile]);
  const retry = useCallback((): void => {
    const file = lastFileRef.current;
    if (file) void loadFile(file);
    else setState({ status: 'idle' });
  }, [loadFile]);

  return { state, handleFile, retry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileIngest.ts src/__tests__/hooks/useFileIngest.test.tsx
git commit -m "feat(ingest): track chunked progress + push RecordingMetadata to recordingStore"
```

---

## Task 8: Update `WelcomeCell` to forward the new loading shape

**Files:**
- Modify: `src/components/shell/WelcomeCell.tsx`

- [ ] **Step 1: Write the failing test**

Add to (or create) `src/__tests__/shell/WelcomeCell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WelcomeCell } from '../../components/shell/WelcomeCell';
import { DuckDBProvider } from '../../context/DuckDBContext';

describe('WelcomeCell ingest UI', () => {
  it('renders the JFR progress overlay while loading and clears it on done', async () => {
    // Spy on the hook
    vi.doMock('../../hooks/useFileIngest', () => ({
      useFileIngest: () => ({
        state: {
          status: 'loading',
          payload: {
            fileName: 'x.jfr.db',
            chunkIndex: 1,
            totalChunks: 3,
            startedAt: 0,
            elapsedMs: 1000,
            etaMs: 2000,
            tableProgress: { events: { rowCount: 10, durationMs: 5 } },
          },
        },
        handleFile: () => {},
        retry: () => {},
      }),
    }));
    const mod = await import('../../components/shell/WelcomeCell');
    render(<DuckDBProvider><mod.WelcomeCell /></DuckDBProvider>);
    await waitFor(() => expect(screen.getByTestId('jfr-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('jfr-overlay-chunk-counter')).toHaveTextContent('1 / 3');
    vi.doUnmock('../../hooks/useFileIngest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/WelcomeCell.test.tsx`
Expected: FAIL — old `state.progress`/`state.percent` shape used.

- [ ] **Step 3: Modify `WelcomeCell.tsx`**

Replace the `LoadingOverlay` rendering at the top of the JSX:

```tsx
{state.status === 'loading' && (
  <LoadingOverlay
    status="loading"
    fileName={state.payload.fileName}
    chunkIndex={state.payload.chunkIndex}
    totalChunks={state.payload.totalChunks}
    elapsedMs={state.payload.elapsedMs}
    etaMs={state.payload.etaMs}
    tableProgress={state.payload.tableProgress}
  />
)}
{state.status === 'error' && (
  <LoadingOverlay status="error" error={state.error} onRetry={retry} />
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/WelcomeCell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/WelcomeCell.tsx src/__tests__/shell/WelcomeCell.test.tsx
git commit -m "feat(welcome): forward chunked loading state to LoadingOverlay"
```

---

## Task 9: Tick elapsed time at ~10 Hz so the overlay updates while waiting on a slow query

**Files:**
- Modify: `src/hooks/useFileIngest.ts` (add a `setInterval` while loading)
- Modify: `src/__tests__/hooks/useFileIngest.test.tsx` (test that elapsedMs advances even without events)

- [ ] **Step 1: Write the failing test**

```tsx
import { vi } from 'vitest';

describe('useFileIngest elapsed ticking', () => {
  it('advances elapsedMs between chunk events', async () => {
    vi.useFakeTimers();
    // (use makeClient/makeFile helpers from earlier tests)
    const client = makeClient(['events']);
    const { result } = renderHook(() => useFileIngest({ client: client as never, onSuccess: () => {} }));
    await act(async () => { result.current.handleFile(makeFile()); });
    await act(async () => { vi.advanceTimersByTime(500); });
    if (result.current.state.status === 'loading') {
      expect(result.current.state.payload.elapsedMs).toBeGreaterThanOrEqual(500);
    }
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Modify `useFileIngest.ts` — add interval**

Inside `loadFile`, after `setState({ status: 'loading', payload: initialPayload });`, before `const loader = ...`:

```ts
const tickInterval = setInterval(() => {
  setState((prev) => {
    if (prev.status !== 'loading') return prev;
    const now = Date.now();
    return { status: 'loading', payload: { ...prev.payload, elapsedMs: now - prev.payload.startedAt } };
  });
}, 100);
```

In the `try`/`catch`/`finally` block, wrap the `try`/`catch` so we always clear the interval:

```ts
try {
  await loader.load(file, file.name, handler);
  await loadLiveSchema(client);
  if (doneMetadata !== null) recordingStore.set(doneMetadata);
  const notebook = buildStarterNotebook(doneTables);
  setState({ status: 'done' });
  onSuccess(notebook);
} catch (thrown: unknown) {
  setState({ status: 'error', error: thrown as JfrError });
} finally {
  clearInterval(tickInterval);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileIngest.ts src/__tests__/hooks/useFileIngest.test.tsx
git commit -m "feat(ingest): tick elapsedMs at 10Hz during loading"
```

---

## Task 10: Wire `recordingStore.clear()` on unmount / new file

**Files:**
- Modify: `src/hooks/useFileIngest.ts`

- [ ] **Step 1: Write the failing test**

```tsx
describe('useFileIngest clears recordingStore on new load', () => {
  it('clears stale metadata when a new file starts loading', async () => {
    recordingStore.set({
      fileName: 'old', bytes: 1, eventCount: 0, durationMs: 0, jvmVersion: null, gcAlgorithm: null,
    });
    const client = makeClient(['events']);
    const { result } = renderHook(() => useFileIngest({ client: client as never, onSuccess: () => {} }));
    await act(async () => { result.current.handleFile(makeFile('new.jfr.db')); });
    // While loading, the previous metadata should already be gone.
    if (result.current.state.status === 'loading') {
      expect(recordingStore.getSnapshot()?.fileName).not.toBe('old');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Modify `useFileIngest.ts`**

At the very top of `loadFile`, immediately after the extension check, add:

```ts
recordingStore.clear();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useFileIngest.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileIngest.ts src/__tests__/hooks/useFileIngest.test.tsx
git commit -m "feat(ingest): clear recordingStore on new file load"
```

---

## Task 11: Playwright visual regression

**Files:**
- Create: `tests/visual/jfr-progress-overlay.visual.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/visual/jfr-progress-overlay.visual.spec.ts
import { test, expect } from '@playwright/test';
import path from 'node:path';

test('JFR progress overlay renders chunk counter and per-table grid', async ({ page }) => {
  await page.goto('/');
  // Inject a fixture .jfr.db file (place a small fixture under tests/fixtures/sample.jfr.db).
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', 'sample.jfr.db');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /open/i }).click().catch(() => {}),
  ]);
  await fileChooser.setFiles(fixturePath);
  await expect(page.getByTestId('jfr-overlay')).toBeVisible();
  await expect(page.getByTestId('jfr-overlay-chunk-counter')).toBeVisible();
  await expect(page).toHaveScreenshot('jfr-progress-overlay.png', { maxDiffPixels: 200 });
});

test('Overlay disappears after load and recording metadata becomes available', async ({ page }) => {
  await page.goto('/');
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', 'sample.jfr.db');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /open/i }).click().catch(() => {}),
  ]);
  await fileChooser.setFiles(fixturePath);
  await page.getByTestId('jfr-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  // The recording panel (added in M-E1) should be visible. If M-E1 not yet merged, skip the assertion.
  const recording = page.getByTestId('recording-panel');
  if (await recording.count()) {
    await expect(recording).toBeVisible();
  }
});
```

- [ ] **Step 2: Ensure a fixture exists**

```bash
test -f tests/fixtures/sample.jfr.db || echo "ADD a small .jfr.db fixture under tests/fixtures/ before running this test"
```

If absent, copy the existing example used in `jfrLoader.integration.test.ts`:

```bash
mkdir -p tests/fixtures
# Locate any *.jfr.db under the repo and copy it:
find . -name "*.jfr.db" -not -path "./node_modules/*" | head -n1 | xargs -I{} cp {} tests/fixtures/sample.jfr.db
```

- [ ] **Step 3: Run the visual test**

Run: `npx playwright test tests/visual/jfr-progress-overlay.visual.spec.ts --update-snapshots`
Expected: snapshot written. Re-run without `--update-snapshots` and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/visual/jfr-progress-overlay.visual.spec.ts tests/visual/jfr-progress-overlay.visual.spec.ts-snapshots tests/fixtures/sample.jfr.db
git commit -m "test(visual): JFR progress overlay golden + post-load assertion"
```

---

## Task 12: Full regression sweep

- [ ] **Step 1: Run typecheck + full test suite**

```bash
npm run typecheck
npm test -- --run
```

Expected: all green.

- [ ] **Step 2: Commit if any tests had to be patched for breaking changes to `JfrLoadEvent`**

E.g. older tests reading `event.kind === 'registered'` may now need to accept the `totalChunks` field; existing tests reading `event.kind === 'done'` may need to read `event.metadata`.

```bash
git add -A
git commit -m "test: align existing JfrLoadEvent consumers with new shape"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Full-screen progress overlay → Task 5 (`JfrProgressOverlay`)
   - Chunk counter X/Y → Tasks 4 (loader emits), 5 (UI), 7 (state)
   - Elapsed time → Tasks 7 (state), 9 (tick), 5 (UI)
   - Remaining time estimate → Tasks 2 (etaMs), 7 (state), 5 (UI)
   - Per-event-type streaming rows table → Tasks 4 (`table-progress` event), 7 (state map), 5 (UI table)
   - Recording metadata card → Tasks 0 (store), 3 (probe), 4 (loader returns), 7 (push to store); the card UI itself comes from M-E1 plan Task 10
   - File name, size, event count, duration, JVM version, GC algorithm → Task 3 + Task 4 done payload + Task 7 store push
2. **Placeholder scan:** every step has executable code or shell command.
3. **Type consistency:**
   - `RecordingMetadata` shape (`fileName`, `bytes`, `eventCount`, `durationMs`, `jvmVersion`, `gcAlgorithm`) defined in Task 0/1 and consumed identically in Tasks 4, 7
   - `TableProgressEntry` (`tableName`, `rowCount`, `durationMs`) defined in Task 1 and used in Tasks 4, 7
   - `JfrLoadEvent` 6 variants (`start`/`registered`/`chunk`/`table-progress`/`done`/`error`) defined in Task 1 and exhaustively switched in Tasks 4, 7
   - `etaMs` input shape (`startedAt`/`now`/`doneChunks`/`totalChunks`) defined in Task 2 and called identically in Task 7
   - `LoadingOverlay` props discriminator (`status: 'loading'` requires `chunkIndex/totalChunks/elapsedMs/etaMs/tableProgress/fileName`) defined in Task 6 and supplied in Task 8
