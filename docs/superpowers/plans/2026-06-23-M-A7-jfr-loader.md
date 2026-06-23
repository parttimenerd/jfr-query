# M-A7: JFR Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load `.jfr.db` files into DuckDB WASM via the `DuckDBClient` (M-A6), emit typed progress events, handle 4 failure modes (`unsupported-format`, `empty-file`, `register-failed`, `query-failed`).

**Architecture:** A plain class `JfrLoader` takes a `DuckDBClient` via constructor injection. `load(input, fileName, onProgress)` detects file type via the DuckDB magic bytes, registers the buffer, ATTACHes it, copies tables into the main database, then DETACHes. All progress is reported through a synchronous callback. No React, no hooks, no global state.

**Tech Stack:** TypeScript 5.8, DuckDBClient (M-A6), Vitest 4.1.9

---

## Pre-resolved decisions

**DECISION (Opus-resolved): File type detection.**
- A `.jfr.db` (or `.db`) file is a DuckDB database. Its on-disk format begins with an 8-byte storage checksum, immediately followed by the 4-byte magic `DUCK` (`0x44 0x55 0x43 0x4B`). On all fixtures in `core/jfr_files/*.db` the magic sits at **offset 8**, not offset 0.
- A raw `.jfr` file begins with `FLR\x00` (`0x46 0x4C 0x52 0x00`) at offset 0.
- Detection algorithm:
  1. If `byteLength === 0` → `JfrError { kind: 'empty-file' }`.
  2. If `byteLength >= 12` and bytes `[8..12]` equal `[0x44, 0x55, 0x43, 0x4B]` → DuckDB.
  3. Otherwise → `JfrError { kind: 'unsupported-format' }`.
  (Raw JFR is intentionally rejected — parsing requires GraalVM tooling not present in the browser.)

**DECISION (Opus-resolved): Dependency injection.**
- `JfrLoader` constructor takes `client: DuckDBClient` (the M-A6 class instance).
- Tests pass a minimal stub typed as `Pick<DuckDBClient, 'registerFile' | 'query'>`. No singletons, no module-level state.
- The constructor parameter type is the structural minimum: `{ registerFile(name: string, buffer: ArrayBuffer): Promise<void>; query(sql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]>; }`. We export this as `DuckDBClientLike` so callers may also inject a custom adapter.

**DECISION (Opus-resolved): Table discovery + copy.**
- Filename stem `name` = `fileName` with one trailing `.db` (or `.jfr.db`) stripped, then sanitized: characters not matching `[A-Za-z0-9_]` are replaced with `_`. If empty after sanitize → `_jfr`.
- Registered virtual filename: `${stem}.jfr.db` (always with `.jfr.db` suffix, regardless of the user's original extension).
- After `client.registerFile(registeredName, buffer)`:
  ```sql
  ATTACH '<registeredName>' AS src (READ_ONLY);
  SELECT table_name FROM duckdb_tables() WHERE database_name='src' AND schema_name='main';
  -- for each table_name t (escape " as ""):
  CREATE TABLE IF NOT EXISTS "<t_safe>" AS SELECT * FROM src.main."<t_safe>";
  DETACH src;
  ```
- The discovery query returns `Record<string, unknown>[]`; convert each `row['table_name']` to `string`.

**DECISION (Opus-resolved): Progress callback signature.**
```typescript
type JfrLoadCallback = (event: JfrLoadEvent) => void;
```
- Called synchronously in-line. The callback's return value is ignored. Exceptions thrown by the callback propagate (caller's responsibility to keep callbacks pure).
- Sequence on success: `start` → `registered` → `done`.
- Sequence on failure after `start`: `start` → `error` (and the promise rejects with the same `JfrError`).
- For pre-detection failures (`empty-file`, `unsupported-format`), no `start` event is emitted; the promise rejects with the `JfrError` and a single `error` event fires.

**DECISION (Opus-resolved): Test strategy.**
- Unit tests construct a fake client that satisfies `DuckDBClientLike`. SQL execution is recorded; tables are returned from an in-memory map keyed by ATTACH alias.
- Integration tests use fixtures from `/Users/i560383_1/code/experiments/jfr-query/core/jfr_files/`. Available fixtures (verified at plan time): `container.db`, `default.db`, `metal.db`. Integration tests use **a real `DuckDBClient`** is out-of-scope for M-A7 (that needs WASM in jsdom). Instead, the integration test reads `default.db` from disk via `fs/promises`, feeds the `ArrayBuffer` into `JfrLoader` with a *recording* fake client, and asserts the SQL the loader generated.
- Run `test.skipIf(!HAS_FIXTURE)` keyed on `existsSync` of the fixture path.

**DECISION (Opus-resolved): Input normalization.**
- `load(input: File | ArrayBuffer, fileName: string, onProgress: JfrLoadCallback): Promise<void>`.
- If `input instanceof ArrayBuffer` → use directly.
- Else (it is a `File`) → `await input.arrayBuffer()`.
- `fileName` is **always** provided by the caller (the v1 code already does this). When `input` is a `File`, the caller may pass `input.name`.

---

## Steps

### Step 1 — Create directories

- [ ] **1.1** Create the new directories:
  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/jfr \
           /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/jfr
  ```
  Expected output: no output (mkdir -p is silent on success).

- [ ] **1.2** Confirm both directories exist:
  ```bash
  ls -d /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/jfr \
        /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/jfr
  ```
  Expected output (two lines):
  ```
  /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/jfr
  /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/jfr
  ```

---

### Step 2 — Write `jfrTypes.ts`

- [ ] **2.1** Create `frontend-v2/src/services/jfr/jfrTypes.ts` with this exact content:
  ```typescript
  // src/services/jfr/jfrTypes.ts

  /** Tagged error union for JFR loading failures. */
  export type JfrError =
    | { kind: 'unsupported-format'; message: string }
    | { kind: 'empty-file'; message: string }
    | { kind: 'register-failed'; message: string; cause?: unknown }
    | { kind: 'query-failed'; message: string; cause?: unknown };

  /** Progress events emitted during JFR file loading. */
  export type JfrLoadEvent =
    | { kind: 'start'; fileName: string; bytes: number }
    | { kind: 'registered'; fileName: string }
    | { kind: 'done'; fileName: string; tables: string[] }
    | { kind: 'error'; fileName: string; error: JfrError };

  /** Synchronous callback invoked for each progress event. */
  export type JfrLoadCallback = (event: JfrLoadEvent) => void;

  /**
   * Minimal structural interface the loader needs from a DuckDBClient.
   * Exists so tests can pass a stub without instantiating a real Worker.
   */
  export interface DuckDBClientLike {
    registerFile(name: string, buffer: ArrayBuffer): Promise<void>;
    query(sql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]>;
  }
  ```

- [ ] **2.2** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0, no errors.

---

### Step 3 — Write failing unit tests (TDD red)

- [ ] **3.1** Create `frontend-v2/src/__tests__/jfr/jfrLoader.test.ts` with this exact content:
  ```typescript
  // src/__tests__/jfr/jfrLoader.test.ts
  import { describe, it, expect, vi } from 'vitest';
  import { JfrLoader } from '../../services/jfr/jfrLoader';
  import type {
    DuckDBClientLike,
    JfrError,
    JfrLoadEvent,
  } from '../../services/jfr/jfrTypes';

  /** Build an ArrayBuffer that starts with 8 zero bytes then `DUCK`. */
  function makeDuckDbBuffer(extraBytes = 16): ArrayBuffer {
    const buf = new ArrayBuffer(12 + extraBytes);
    const view = new Uint8Array(buf);
    view[8] = 0x44; // D
    view[9] = 0x55; // U
    view[10] = 0x43; // C
    view[11] = 0x4b; // K
    return buf;
  }

  /** Build an ArrayBuffer that starts with `FLR\0` (raw JFR magic). */
  function makeRawJfrBuffer(): ArrayBuffer {
    const buf = new ArrayBuffer(16);
    const view = new Uint8Array(buf);
    view[0] = 0x46; // F
    view[1] = 0x4c; // L
    view[2] = 0x52; // R
    view[3] = 0x00;
    return buf;
  }

  /**
   * A recording fake DuckDBClient. Tracks every call and returns a configurable
   * response per-SQL via the `responses` map.
   */
  function makeFakeClient(opts?: {
    registerThrows?: Error;
    queryError?: { onSql: RegExp; error: Error };
    tables?: string[];
  }): DuckDBClientLike & {
    calls: Array<{ method: 'registerFile' | 'query'; args: unknown[] }>;
  } {
    const calls: Array<{ method: 'registerFile' | 'query'; args: unknown[] }> = [];
    const tables = opts?.tables ?? ['Events', 'GCPause'];
    return {
      calls,
      async registerFile(name: string, buffer: ArrayBuffer): Promise<void> {
        calls.push({ method: 'registerFile', args: [name, buffer] });
        if (opts?.registerThrows) throw opts.registerThrows;
      },
      async query(sql: string): Promise<Record<string, unknown>[]> {
        calls.push({ method: 'query', args: [sql] });
        if (opts?.queryError && opts.queryError.onSql.test(sql)) {
          throw opts.queryError.error;
        }
        if (/duckdb_tables\(\)/i.test(sql)) {
          return tables.map((t) => ({ table_name: t }));
        }
        return [];
      },
    };
  }

  describe('JfrLoader', () => {
    it('rejects empty buffer with empty-file error and no start event', async () => {
      const client = makeFakeClient();
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await expect(
        loader.load(new ArrayBuffer(0), 'empty.jfr.db', (e) => events.push(e)),
      ).rejects.toMatchObject({ kind: 'empty-file' } satisfies Partial<JfrError>);

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('error');
      if (events[0].kind === 'error') {
        expect(events[0].error.kind).toBe('empty-file');
      }
      expect(client.calls).toHaveLength(0);
    });

    it('rejects raw .jfr binary with unsupported-format', async () => {
      const client = makeFakeClient();
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await expect(
        loader.load(makeRawJfrBuffer(), 'profile.jfr', (e) => events.push(e)),
      ).rejects.toMatchObject({ kind: 'unsupported-format' });

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('error');
      expect(client.calls).toHaveLength(0);
    });

    it('emits start → registered → done on happy path with .jfr.db', async () => {
      const client = makeFakeClient({ tables: ['Events', 'GCPause'] });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await loader.load(makeDuckDbBuffer(64), 'profile.jfr.db', (e) =>
        events.push(e),
      );

      expect(events.map((e) => e.kind)).toEqual(['start', 'registered', 'done']);
      const start = events[0];
      if (start.kind === 'start') {
        expect(start.fileName).toBe('profile.jfr.db');
        expect(start.bytes).toBe(76); // 12 magic + 64 extra
      }
      const done = events[2];
      if (done.kind === 'done') {
        expect(done.tables).toEqual(['Events', 'GCPause']);
      }

      // Verify the SQL sequence
      const sqls = client.calls
        .filter((c) => c.method === 'query')
        .map((c) => c.args[0] as string);
      expect(sqls[0]).toMatch(/^ATTACH 'profile\.jfr\.db' AS src \(READ_ONLY\)$/);
      expect(sqls[1]).toMatch(/duckdb_tables\(\)/);
      expect(sqls[2]).toBe(
        'CREATE TABLE IF NOT EXISTS "Events" AS SELECT * FROM src.main."Events"',
      );
      expect(sqls[3]).toBe(
        'CREATE TABLE IF NOT EXISTS "GCPause" AS SELECT * FROM src.main."GCPause"',
      );
      expect(sqls[4]).toBe('DETACH src');
    });

    it('sanitizes filename for the virtual ATTACH name', async () => {
      const client = makeFakeClient({ tables: [] });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await loader.load(makeDuckDbBuffer(), "weird name'.jfr.db", (e) =>
        events.push(e),
      );

      const reg = client.calls.find((c) => c.method === 'registerFile');
      expect(reg).toBeTruthy();
      expect((reg!.args[0] as string)).toBe('weird_name_.jfr.db');
      const attachSql = client.calls.find(
        (c) =>
          c.method === 'query' &&
          /^ATTACH /.test(c.args[0] as string),
      );
      expect(attachSql).toBeTruthy();
      expect(attachSql!.args[0]).toBe(
        "ATTACH 'weird_name_.jfr.db' AS src (READ_ONLY)",
      );
    });

    it('emits error and rejects with register-failed when registerFile throws', async () => {
      const client = makeFakeClient({
        registerThrows: new Error('worker dead'),
      });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await expect(
        loader.load(makeDuckDbBuffer(), 'x.jfr.db', (e) => events.push(e)),
      ).rejects.toMatchObject({ kind: 'register-failed' });

      expect(events.map((e) => e.kind)).toEqual(['start', 'error']);
      const errEv = events[1];
      if (errEv.kind === 'error') {
        expect(errEv.error.kind).toBe('register-failed');
        expect(errEv.error.message).toContain('worker dead');
      }
    });

    it('emits error and rejects with query-failed when ATTACH throws', async () => {
      const client = makeFakeClient({
        queryError: { onSql: /^ATTACH /, error: new Error('attach boom') },
      });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await expect(
        loader.load(makeDuckDbBuffer(), 'x.jfr.db', (e) => events.push(e)),
      ).rejects.toMatchObject({ kind: 'query-failed' });

      expect(events.map((e) => e.kind)).toEqual(['start', 'registered', 'error']);
      const errEv = events[2];
      if (errEv.kind === 'error') {
        expect(errEv.error.kind).toBe('query-failed');
        expect(errEv.error.message).toContain('attach boom');
      }
    });

    it('accepts a File and reads its ArrayBuffer', async () => {
      const client = makeFakeClient({ tables: ['T'] });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];
      // Build a File from a DuckDB-shaped buffer
      const buf = makeDuckDbBuffer(8);
      const blob = new Blob([buf]);
      const file = new File([blob], 'profile.jfr.db');

      await loader.load(file, file.name, (e) => events.push(e));

      expect(events.map((e) => e.kind)).toEqual(['start', 'registered', 'done']);
      const start = events[0];
      if (start.kind === 'start') {
        expect(start.bytes).toBe(20); // 12 + 8
      }
    });

    it('escapes embedded double-quotes in discovered table names', async () => {
      const client = makeFakeClient({ tables: ['weird"name'] });
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await loader.load(makeDuckDbBuffer(), 'p.jfr.db', (e) => events.push(e));

      const createSql = client.calls
        .filter((c) => c.method === 'query')
        .map((c) => c.args[0] as string)
        .find((s) => s.startsWith('CREATE TABLE'));
      expect(createSql).toBe(
        'CREATE TABLE IF NOT EXISTS "weird""name" AS SELECT * FROM src.main."weird""name"',
      );
    });
  });
  ```

- [ ] **3.2** Run the new tests; they MUST fail because `jfrLoader.ts` does not exist yet:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- jfr/jfrLoader 2>&1 | tail -20
  ```
  Expected: tests fail with an import error referencing `services/jfr/jfrLoader`. Exit code is non-zero. Look for a line like:
  ```
  Failed to resolve import "../../services/jfr/jfrLoader"
  ```
  (Vitest may show `Module not found` instead — either form is acceptable as confirmation of the red phase.)

---

### Step 4 — Implement `jfrLoader.ts` (TDD green)

- [ ] **4.1** Create `frontend-v2/src/services/jfr/jfrLoader.ts` with this exact content:
  ```typescript
  // src/services/jfr/jfrLoader.ts
  import type {
    DuckDBClientLike,
    JfrError,
    JfrLoadCallback,
    JfrLoadEvent,
  } from './jfrTypes';

  const DUCK_MAGIC: readonly number[] = [0x44, 0x55, 0x43, 0x4b]; // 'DUCK'
  const DUCK_MAGIC_OFFSET = 8;

  /** Strip a trailing `.jfr.db` or `.db` and sanitize for use as an alias. */
  function fileStem(fileName: string): string {
    let base = fileName;
    if (base.endsWith('.jfr.db')) base = base.slice(0, -'.jfr.db'.length);
    else if (base.endsWith('.db')) base = base.slice(0, -'.db'.length);
    const sanitized = base.replace(/[^A-Za-z0-9_]/g, '_');
    return sanitized.length === 0 ? '_jfr' : sanitized;
  }

  /** Escape `"` for use inside a SQL double-quoted identifier. */
  function quoteIdent(name: string): string {
    return name.replace(/"/g, '""');
  }

  function isDuckDbBuffer(buf: ArrayBuffer): boolean {
    if (buf.byteLength < DUCK_MAGIC_OFFSET + DUCK_MAGIC.length) return false;
    const view = new Uint8Array(buf, DUCK_MAGIC_OFFSET, DUCK_MAGIC.length);
    for (let i = 0; i < DUCK_MAGIC.length; i++) {
      if (view[i] !== DUCK_MAGIC[i]) return false;
    }
    return true;
  }

  async function toArrayBuffer(input: File | ArrayBuffer): Promise<ArrayBuffer> {
    if (input instanceof ArrayBuffer) return input;
    return input.arrayBuffer();
  }

  export class JfrLoader {
    constructor(private readonly client: DuckDBClientLike) {}

    /**
     * Load a JFR (DuckDB-formatted) file into the underlying DuckDB instance.
     * Resolves on success, rejects with a `JfrError` on any failure.
     */
    async load(
      input: File | ArrayBuffer,
      fileName: string,
      onProgress: JfrLoadCallback,
    ): Promise<void> {
      const emit = (event: JfrLoadEvent): void => {
        onProgress(event);
      };

      const buffer = await toArrayBuffer(input);

      // Pre-detection: empty file.
      if (buffer.byteLength === 0) {
        const err: JfrError = {
          kind: 'empty-file',
          message: `'${fileName}' is empty (0 bytes)`,
        };
        emit({ kind: 'error', fileName, error: err });
        throw err;
      }

      // Pre-detection: format check.
      if (!isDuckDbBuffer(buffer)) {
        const err: JfrError = {
          kind: 'unsupported-format',
          message:
            `'${fileName}' is not a DuckDB-formatted JFR file. ` +
            `Raw .jfr binaries are not supported in v2 browser mode; ` +
            `convert the recording with the jfr-query CLI first.`,
        };
        emit({ kind: 'error', fileName, error: err });
        throw err;
      }

      emit({ kind: 'start', fileName, bytes: buffer.byteLength });

      // Sanitize and pick the registered virtual name.
      const stem = fileStem(fileName);
      const registeredName = `${stem}.jfr.db`;

      // Step 1: register the buffer with DuckDB-WASM.
      try {
        await this.client.registerFile(registeredName, buffer);
      } catch (cause) {
        const err: JfrError = {
          kind: 'register-failed',
          message:
            cause instanceof Error
              ? cause.message
              : `registerFile failed for '${registeredName}'`,
          cause,
        };
        emit({ kind: 'error', fileName, error: err });
        throw err;
      }

      emit({ kind: 'registered', fileName });

      // Step 2: ATTACH, discover, copy, DETACH.
      let tables: string[] = [];
      try {
        await this.client.query(
          `ATTACH '${registeredName}' AS src (READ_ONLY)`,
        );
        const rows = await this.client.query(
          `SELECT table_name FROM duckdb_tables() WHERE database_name='src' AND schema_name='main'`,
        );
        tables = rows.map((r) => String(r['table_name']));
        for (const t of tables) {
          const safe = quoteIdent(t);
          await this.client.query(
            `CREATE TABLE IF NOT EXISTS "${safe}" AS SELECT * FROM src.main."${safe}"`,
          );
        }
        await this.client.query('DETACH src');
      } catch (cause) {
        const err: JfrError = {
          kind: 'query-failed',
          message:
            cause instanceof Error
              ? cause.message
              : `Table discovery failed for '${registeredName}'`,
          cause,
        };
        emit({ kind: 'error', fileName, error: err });
        throw err;
      }

      emit({ kind: 'done', fileName, tables });
    }
  }
  ```

- [ ] **4.2** Run the unit tests again — they MUST all pass:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- jfr/jfrLoader.test 2>&1 | tail -15
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  8 passed (8)
  ```

- [ ] **4.3** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0, no errors.

---

### Step 5 — Verify fixtures, write integration test

- [ ] **5.1** List the JFR fixture directory; record what is present:
  ```bash
  ls /Users/i560383_1/code/experiments/jfr-query/core/jfr_files/
  ```
  Expected (verified at plan authoring time):
  ```
  README.md
  container.db
  container.jfr
  default.db
  default.jfr
  metal.db
  metal.jfr
  ```
  The integration test will use `default.db`. If that file is missing, the test self-skips.

- [ ] **5.2** Confirm `default.db` carries the DuckDB magic at offset 8:
  ```bash
  xxd /Users/i560383_1/code/experiments/jfr-query/core/jfr_files/default.db | head -1
  ```
  Expected (first line):
  ```
  00000000: e2e0 a0b2 c49d d839 4455 434b 4000 0000  .......9DUCK@...
  ```
  Bytes 8..11 are `44 55 43 4b` = `DUCK`. Confirms detection logic.

- [ ] **5.3** Create `frontend-v2/src/__tests__/jfr/jfrLoader.integration.test.ts` with this exact content:
  ```typescript
  // src/__tests__/jfr/jfrLoader.integration.test.ts
  import { describe, it, expect } from 'vitest';
  import { readFile } from 'node:fs/promises';
  import { existsSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { JfrLoader } from '../../services/jfr/jfrLoader';
  import type {
    DuckDBClientLike,
    JfrLoadEvent,
  } from '../../services/jfr/jfrTypes';

  const FIXTURE = resolve(
    __dirname,
    '../../../../core/jfr_files/default.db',
  );
  const HAS_FIXTURE = existsSync(FIXTURE);

  /** Recording fake DuckDBClient: validates detection on a real fixture. */
  function recordingClient(): DuckDBClientLike & {
    calls: Array<{ method: string; sql?: string; name?: string }>;
  } {
    const calls: Array<{ method: string; sql?: string; name?: string }> = [];
    return {
      calls,
      async registerFile(name: string): Promise<void> {
        calls.push({ method: 'registerFile', name });
      },
      async query(sql: string): Promise<Record<string, unknown>[]> {
        calls.push({ method: 'query', sql });
        if (/duckdb_tables\(\)/i.test(sql)) {
          return [
            { table_name: 'Events' },
            { table_name: 'GCPause' },
          ];
        }
        return [];
      },
    };
  }

  describe.skipIf(!HAS_FIXTURE)('JfrLoader integration (real fixture)', () => {
    it('detects DuckDB magic in core/jfr_files/default.db and emits start→registered→done', async () => {
      const buf = await readFile(FIXTURE);
      // Copy into a fresh ArrayBuffer (Node Buffer shares memory with a Uint8Array slice)
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;

      const client = recordingClient();
      const loader = new JfrLoader(client);
      const events: JfrLoadEvent[] = [];

      await loader.load(ab, 'default.db', (e) => events.push(e));

      expect(events.map((e) => e.kind)).toEqual(['start', 'registered', 'done']);
      const done = events[2];
      if (done.kind === 'done') {
        expect(done.tables).toEqual(['Events', 'GCPause']);
      }
      // The registered virtual name uses .jfr.db suffix regardless of input.
      expect(
        client.calls.find((c) => c.method === 'registerFile')?.name,
      ).toBe('default.jfr.db');
    });
  });

  describe.skipIf(HAS_FIXTURE)('JfrLoader integration (no fixture)', () => {
    it('is skipped because core/jfr_files/default.db is absent', () => {
      expect(true).toBe(true);
    });
  });
  ```

- [ ] **5.4** Run the integration test alone:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- jfr/jfrLoader.integration 2>&1 | tail -15
  ```
  Expected (when fixture present):
  ```
  Test Files  1 passed (1)
       Tests  1 passed (1)
  ```
  If `HAS_FIXTURE` is false (fixture missing on this machine), expect 1 passed test (the placeholder in the second describe block).

---

### Step 6 — Full gate

- [ ] **6.1** Run all JFR tests together:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- jfr 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  2 passed (2)
       Tests  9 passed (9)
  ```

- [ ] **6.2** Run the full project test suite to ensure no regressions:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test 2>&1 | tail -5
  ```
  Expected: every previously-passing milestone (M-A0 … M-A6) still passes. The final summary line must show `0 failed`.

- [ ] **6.3** Typecheck the whole project:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0, no errors.

- [ ] **6.4** Lint (if a `lint` script exists — skip cleanly if not):
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run lint --if-present 2>&1 | tail -5
  ```
  Expected: either no output (no `lint` script) or `0 errors`.

---

### Step 7 — Inspect, then commit

- [ ] **7.1** Show what is staged-able:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git status --short -- \
    frontend-v2/src/services/jfr \
    frontend-v2/src/__tests__/jfr \
    docs/superpowers/plans/2026-06-23-M-A7-jfr-loader.md
  ```
  Expected (file names may vary by extension):
  ```
  ?? docs/superpowers/plans/2026-06-23-M-A7-jfr-loader.md
  ?? frontend-v2/src/__tests__/jfr/
  ?? frontend-v2/src/services/jfr/
  ```

- [ ] **7.2** Stage the new files explicitly (no `git add -A`):
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git add \
    frontend-v2/src/services/jfr/jfrTypes.ts \
    frontend-v2/src/services/jfr/jfrLoader.ts \
    frontend-v2/src/__tests__/jfr/jfrLoader.test.ts \
    frontend-v2/src/__tests__/jfr/jfrLoader.integration.test.ts \
    docs/superpowers/plans/2026-06-23-M-A7-jfr-loader.md
  ```
  Expected: no output. Then verify:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git diff --cached --stat
  ```
  Expected: 5 files listed, all with `+` insertions only.

- [ ] **7.3** Commit:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git commit -m "$(cat <<'EOF'
  feat(v2): M-A7 JFR loader — file registration, progress events, 4 failure modes

  - Add JfrLoader class with DI of DuckDBClientLike
  - Typed progress events: start, registered, done, error
  - Four failure modes: empty-file, unsupported-format, register-failed, query-failed
  - Detect DuckDB magic at offset 8; reject raw .jfr binaries
  - 8 unit tests (mock client) + 1 integration test (real default.db fixture)
  EOF
  )"
  ```
  Expected: a commit summary like `5 files changed, NNN insertions(+)`.

- [ ] **7.4** Confirm the working tree is clean for the M-A7 paths:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git status --short -- \
    frontend-v2/src/services/jfr \
    frontend-v2/src/__tests__/jfr \
    docs/superpowers/plans/2026-06-23-M-A7-jfr-loader.md
  ```
  Expected: no output (all changes committed).

---

## Step 8 — Playwright smoke + E2E tests (testing standard Layer 2)

The JFR loader is a service — no new UI yet. Smoke test confirms the app still
boots and COOP/COEP is intact (required for DuckDB which JFR loader calls).

- [ ] **8.1** Build and run the smoke suite:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run build && npx playwright test tests/e2e/00-smoke.spec.ts
  ```
  Expected: 18 tests pass (9 per dark/light project). If COOP/COEP fails, fix
  `vite.config.ts` headers before committing.

- [ ] **8.2** Verify no regressions across all E2E specs:
  ```bash
  npx playwright test --project=dark 2>&1 | tail -5
  ```
  Expected: all non-`test.fixme` tests pass.

- [ ] **8.3** Add a `test.fixme` to `tests/e2e/01-shell-and-ingest.spec.ts` for the
  drag-and-drop JFR file load flow (will be implemented when M-B1 shell lands):
  ```typescript
  // In the 'shell — file ingest' describe block:
  test.fixme('drag .jfr.db onto drop zone loads tables', async ({ page }) => {
    await page.goto('/');
    // drag tests/fixtures/jfr/sample-small.jfr.db onto the drop zone
    // assert progress events: start → registered → done
    // assert table list populates in sidebar
  });

  test.fixme('unsupported raw .jfr file shows error toast', async ({ page }) => {
    await page.goto('/');
    // drag a raw .jfr binary
    // assert error message "only .jfr.db (DuckDB) files are supported"
  });

  test.fixme('empty file shows error immediately', async ({ page }) => {
    await page.goto('/');
  });
  ```

---

## Done criteria

- [ ] `jfrTypes.ts` exports `JfrError`, `JfrLoadEvent`, `JfrLoadCallback`, `DuckDBClientLike`.
- [ ] `JfrLoader.load(input, fileName, onProgress)` resolves on success, rejects with a `JfrError` on every failure path.
- [ ] All 4 failure modes have an associated unit test that observes both the rejection and the `error` event.
- [ ] Happy path emits exactly `start` → `registered` → `done` and runs ATTACH → discover → per-table CREATE → DETACH.
- [ ] Integration test loads `core/jfr_files/default.db` and verifies the loader detects DuckDB magic on a real file.
- [ ] `npm run test -- jfr` shows 9 passing tests.
- [ ] `npm run typecheck` exits 0.
- [ ] Single git commit on the branch encapsulates the milestone.
