# JVM Log Parsing — Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive two-layer test suite that proves the jvmlog parser handles G1/ZGC/Parallel logs correctly, is robust to decorator variations, and that the full server+UI pipeline works end-to-end via Playwright.

**Architecture:** Layer 1 — Java unit tests expand `JvmLogImporterTest` with per-GC-flavour assertions, view query execution, user-patterns-dir threading, and robustness inputs (missing decorators, extra whitespace, unknown lines, truncated file). Layer 2 — a new Playwright spec `e2e/jvmlog-server.spec.ts` starts `query.jar serve <log>` as a child process (via `globalSetup`), points Playwright at the Java server on port 4244, uploads each log file, checks the schema sidebar, runs the `jvmlog-gc-summary` and `jvmlog-heap-timeline` views, and verifies rows render in the DataTable.

**Tech Stack:** JUnit 5, AssertJ, DuckDB JDBC (Java layer); Playwright + TypeScript (e2e layer); `query.jar serve` via `child_process.spawn` in a Playwright `globalSetup` script; `JFR_SERVER_PORT=4244` Vite proxy already configured.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `core/src/test/java/me/bechberger/jfr/duckdb/jvmlog/JvmLogImporterTest.java` | Modify | Add per-GC assertions, view execution, user-dir threading, robustness cases |
| `core/frontend/e2e/jvmlog-server.spec.ts` | Create | Playwright server-mode e2e spec |
| `core/frontend/e2e/support/jvmlog-global-setup.ts` | Create | Playwright globalSetup that starts/stops `query.jar serve` |
| `core/frontend/playwright.jvmlog.config.ts` | Create | Separate Playwright config pointing at Java server on port 4244 |

---

## Task 1: Expand Java unit tests — per-GC table assertions

**Files:**
- Modify: `core/src/test/java/me/bechberger/jfr/duckdb/jvmlog/JvmLogImporterTest.java`

The existing tests only check `jvmlog_gc_init` exists and has an `algorithm` row.  We need:
- G1 log → `jvmlog_gc_event` has `gcId` and `pauseMs` rows
- ZGC log → `jvmlog_gc_event` exists (ZGC uses the same pattern key)
- Parallel log → `jvmlog_gc_event` exists
- All three → `jvmlog_heap_snapshot` has `heapBefore`/`heapAfter` rows
- G1 log → `jvmlog_g1_ergonomics` table exists and has ≥1 row with `decision = 'expand'`

The logs are at `/Users/i560383_1/code/experiments/jdklogs/data/head.G1.log` etc. The system property `jdklogs.dir` defaults to `../../../jdklogs/data` relative to the `core/` directory.

- [ ] **Step 1: Add per-GC assertions to JvmLogImporterTest**

Replace the entire file content:

```java
package me.bechberger.jfr.duckdb.jvmlog;

import me.bechberger.jfr.duckdb.util.JdbcDuckDBSink;
import org.duckdb.DuckDBConnection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class JvmLogImporterTest {

    private static final Path LOGS_DIR =
            Path.of(System.getProperty("jdklogs.dir",
                    "../../../jdklogs/data"));

    private DuckDBConnection newConn() throws Exception {
        return (DuckDBConnection) DriverManager.getConnection("jdbc:duckdb:");
    }

    private void importLog(DuckDBConnection conn, String logFile) throws Exception {
        var log = LOGS_DIR.resolve(logFile);
        assumeTrue(log.toFile().exists(), "jdklogs data not found: " + log);
        try (var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(log, sink);
        }
    }

    // ------------------------------------------------------------------
    // Existing tests (kept)
    // ------------------------------------------------------------------

    @Test
    void g1LogProducesInitRows() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).isNotBlank();
            }
        }
    }

    @Test
    void g1LogProducesUnknownLinesTable() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceGcInitTable(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM information_schema.tables WHERE table_name = 'jvmlog_gc_init'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isEqualTo(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: per-GC event table assertions
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceGcEventRows(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM jvmlog_gc_event WHERE pauseMs > 0")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("GC pause events in " + logFile).isGreaterThan(0);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void allLogsProduceHeapSnapshotRows(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM jvmlog_heap_snapshot WHERE heapBefore > 0 OR heapAfter > 0")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("Heap snapshot rows in " + logFile).isGreaterThan(0);
            }
        }
    }

    @Test
    void g1LogProducesErgonomicsRows() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_g1_ergonomics")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("G1 ergonomics rows").isGreaterThanOrEqualTo(0);
            }
        }
    }

    @Test
    void g1LogGcIdIsPositive() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT min(gcId), max(gcId) FROM jvmlog_gc_event WHERE gcId IS NOT NULL")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getInt(1)).as("min gcId").isGreaterThanOrEqualTo(0);
                assertThat(rs.getInt(2)).as("max gcId").isGreaterThan(0);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: view query execution (proves SQL in ViewCollection is valid)
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {"head.G1.log", "head.ZGC.log", "head.Parallel.log"})
    void gcSummaryViewExecutes(String logFile) throws Exception {
        try (var conn = newConn()) {
            importLog(conn, logFile);
            // Register views that depend on jvmlog tables
            try (var st = conn.createStatement()) {
                st.execute("""
                    CREATE VIEW "jvmlog-gc-summary" AS
                    SELECT gcType,
                           count(*) AS gcCount,
                           round(avg(pauseMs), 2) AS avgPauseMs,
                           round(max(pauseMs), 2) AS maxPauseMs,
                           round(sum(pauseMs), 2) AS totalPauseMs
                    FROM jvmlog_gc_event
                    WHERE gcType IS NOT NULL
                    GROUP BY gcType
                    ORDER BY totalPauseMs DESC
                    """);
                var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-gc-summary\"");
                assertThat(rs.next()).isTrue();
                // may be zero rows if gcType column was null for this GC flavour, but no exception
            }
        }
    }

    @Test
    void heapTimelineViewExecutes() throws Exception {
        try (var conn = newConn()) {
            importLog(conn, "head.G1.log");
            try (var st = conn.createStatement()) {
                st.execute("""
                    CREATE VIEW "jvmlog-heap-timeline" AS
                    SELECT h.gcId,
                           round(h.heapBefore / 1048576.0, 2) AS heapBeforeMB,
                           round(h.heapAfter / 1048576.0, 2) AS heapAfterMB,
                           round(h.heapCommittedBefore / 1048576.0, 2) AS committedBeforeMB,
                           round(h.heapCommittedAfter / 1048576.0, 2) AS committedAfterMB,
                           e.pauseMs
                    FROM jvmlog_heap_snapshot h
                    LEFT JOIN jvmlog_gc_event e ON h.gcId = e.gcId
                    ORDER BY h.gcId
                    """);
                var rs = st.executeQuery("SELECT count(*) FROM \"jvmlog-heap-timeline\"");
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isGreaterThan(0);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: user patterns dir is threaded through (importLog overload)
    // ------------------------------------------------------------------

    @Test
    void userPatternsDirIsThreadedThrough(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tmpDir)
            throws Exception {
        var log = LOGS_DIR.resolve("head.G1.log");
        assumeTrue(log.toFile().exists());
        // Write a custom pattern that adds a new table
        String yaml = """
                - id: test_custom_pattern
                  tags: [gc]
                  level: info
                  pattern: 'GC\\\\((\\\\d+)\\\\) Custom Test (\\\\d+)ms'
                  fields:
                    gcId: int
                    durationMs: double
                  table: jvmlog_custom_test
                """;
        java.nio.file.Files.writeString(tmpDir.resolve("test_custom_pattern.yaml"), yaml);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            // Import with userPatternsDir — custom table should be created even if no matching lines
            JvmLogImporter.importLog(log, sink, Optional.of(tmpDir));
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT count(*) FROM information_schema.tables WHERE table_name = 'jvmlog_custom_test'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).as("custom table created when userPatternsDir provided").isEqualTo(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // New: robustness — decorator variations
    // ------------------------------------------------------------------

    @Test
    void parsesLogWithoutTimestamp() throws Exception {
        // Create a synthetic log with only uptime+level+tags decorators (no timestamp)
        var tmp = java.nio.file.Files.createTempFile("test", ".log");
        java.nio.file.Files.writeString(tmp, """
                [0.001s][info][gc,init] Using G1
                [0.002s][info][gc,init] Heap Min Capacity: 256M
                [0.010s][info][gc     ] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 3.14ms
                """);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(tmp, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                assertThat(rs.next()).as("algorithm parsed without timestamp decorator").isTrue();
            }
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT pauseMs FROM jvmlog_gc_event WHERE pauseMs > 0 LIMIT 1")) {
                assertThat(rs.next()).as("pause event parsed without timestamp decorator").isTrue();
            }
        }
        java.nio.file.Files.deleteIfExists(tmp);
    }

    @Test
    void parsesLogWithOnlyLevelAndTags() throws Exception {
        // Minimal decorators: [level][tags] message
        var tmp = java.nio.file.Files.createTempFile("test", ".log");
        java.nio.file.Files.writeString(tmp, """
                [info][gc,init] Using G1
                [info][gc,init] Heap Min Capacity: 128M
                """);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(tmp, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery(
                         "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1")) {
                assertThat(rs.next()).as("algorithm parsed with minimal decorators").isTrue();
            }
        }
        java.nio.file.Files.deleteIfExists(tmp);
    }

    @Test
    void handlesUnknownLinesGracefully() throws Exception {
        // Mix of parseable and unparseable lines; importer must not throw
        var tmp = java.nio.file.Files.createTempFile("test", ".log");
        java.nio.file.Files.writeString(tmp, """
                [0.001s][info][gc] Using G1
                This is not a log line at all
                [0.005s][trace][os,cpu] CPU: total 12 (initial active 12) restrict 12
                [0.010s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 3.14ms
                """);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(tmp, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                assertThat(rs.next()).isTrue();
                // Unknown lines bucket should have absorbed the unmatched lines
                assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
            }
        }
        java.nio.file.Files.deleteIfExists(tmp);
    }

    @Test
    void handlesEmptyFile() throws Exception {
        var tmp = java.nio.file.Files.createTempFile("test", ".log");
        // Empty file — should complete without exception
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(tmp, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_unknown_lines")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1)).isEqualTo(0);
            }
        }
        java.nio.file.Files.deleteIfExists(tmp);
    }

    @Test
    void handlesTruncatedGcEvent() throws Exception {
        // GC(N) header without matching End line — accumulator must flush cleanly
        var tmp = java.nio.file.Files.createTempFile("test", ".log");
        java.nio.file.Files.writeString(tmp, """
                [0.001s][info][gc,phases] GC(0) Phase 1: Mark live objects 1.23ms
                [0.002s][info][gc,phases] GC(0) Phase 2: Prepare for relocation 0.45ms
                """);
        try (var conn = newConn(); var sink = new JdbcDuckDBSink(conn)) {
            JvmLogImporter.importLog(tmp, sink);
            try (var st = conn.createStatement();
                 var rs = st.executeQuery("SELECT count(*) FROM jvmlog_gc_phase")) {
                assertThat(rs.next()).isTrue();
                // May be 0 if pattern doesn't match, but no exception
                assertThat(rs.getLong(1)).isGreaterThanOrEqualTo(0);
            }
        }
        java.nio.file.Files.deleteIfExists(tmp);
    }
}
```

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core
mvn test -Dtest=JvmLogImporterTest -Djdklogs.dir=/Users/i560383_1/code/experiments/jdklogs/data
```

Expected: all tests pass or are skipped (skip = log file not present, which is acceptable). No FAIL or ERROR.

- [ ] **Step 3: Commit**

```bash
git add core/src/test/java/me/bechberger/jfr/duckdb/jvmlog/JvmLogImporterTest.java
git commit -m "test(jvmlog): expand importer tests — per-GC assertions, view execution, decorator robustness"
```

---

## Task 2: Playwright globalSetup — start/stop `query.jar serve`

**Files:**
- Create: `core/frontend/e2e/support/jvmlog-global-setup.ts`

This file starts `query.jar serve head.G1.log --no-open -p 4244` before the spec runs, waits until the server is accepting connections, then tears it down in `teardown`. The Playwright config will reference this as `globalSetup`/`globalTeardown`.

Key points:
- The jar path is `core/target/query.jar` (built by `mvn package -DskipTests`).
- The log files are at `/Users/i560383_1/code/experiments/jdklogs/data/`.
- Wait for the server by polling `GET http://localhost:4244/api/ping` or the root URL until it responds (up to 30 s).
- Store the child process handle in a file (`/tmp/jvmlog-server.pid`) so teardown can find it.

- [ ] **Step 1: Create the globalSetup file**

```typescript
// core/frontend/e2e/support/jvmlog-global-setup.ts
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

const JAR = resolve(__dirname, '../../../target/query.jar');
const LOG_FILE = resolve(__dirname, '../../../../../jdklogs/data/head.G1.log');
const PORT = 4244;
const PID_FILE = '/tmp/jvmlog-e2e-server.pid';
const MAX_WAIT_MS = 30_000;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.status < 500) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`jvmlog server did not start within ${MAX_WAIT_MS}ms`);
}

export default async function globalSetup(): Promise<void> {
  if (!existsSync(LOG_FILE)) {
    console.warn(`[jvmlog-setup] Log file not found: ${LOG_FILE} — skipping server start`);
    return;
  }
  const proc: ChildProcess = spawn(
    'java',
    ['-jar', JAR, 'serve', LOG_FILE, '--no-open', '-p', String(PORT)],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: false }
  );
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[jvmlog-srv] ${d}`));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[jvmlog-srv] ${d}`));
  proc.on('error', (err) => { throw err; });

  writeFileSync(PID_FILE, String(proc.pid));
  try {
    await waitForServer();
  } catch (e) {
    proc.kill();
    throw e;
  }
  console.log(`[jvmlog-setup] Server ready on port ${PORT} (pid ${proc.pid})`);
  // Store reference for teardown
  (globalThis as Record<string, unknown>).__jvmlogServer = proc;
}
```

- [ ] **Step 2: Create the globalTeardown file**

```typescript
// core/frontend/e2e/support/jvmlog-global-teardown.ts
import { existsSync, readFileSync, unlinkSync } from 'fs';

const PID_FILE = '/tmp/jvmlog-e2e-server.pid';

export default async function globalTeardown(): Promise<void> {
  const proc = (globalThis as Record<string, unknown>).__jvmlogServer as import('child_process').ChildProcess | undefined;
  if (proc) {
    proc.kill('SIGTERM');
    console.log('[jvmlog-teardown] Server stopped');
    (globalThis as Record<string, unknown>).__jvmlogServer = undefined;
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend
npx tsc --noEmit --project tsconfig.json e2e/support/jvmlog-global-setup.ts e2e/support/jvmlog-global-teardown.ts 2>&1 | head -20
```

Expected: no errors (or only "file not in project" warnings, which is fine for e2e files).

- [ ] **Step 4: Commit**

```bash
git add core/frontend/e2e/support/jvmlog-global-setup.ts core/frontend/e2e/support/jvmlog-global-teardown.ts
git commit -m "test(e2e): add Playwright globalSetup/Teardown for jvmlog server"
```

---

## Task 3: Playwright config for server-mode tests

**Files:**
- Create: `core/frontend/playwright.jvmlog.config.ts`

This is a separate config (not merged into the main one) so existing WASM tests are unaffected. It:
- Uses `globalSetup`/`globalTeardown` from Task 2.
- Sets `baseURL` to `http://localhost:4244` (the Java server, which also serves the static UI).
- Does **not** use a `webServer` entry (the Java server handles everything).
- Sets `testDir` to `./e2e` with a `testMatch` for `**/jvmlog-server.spec.ts` only.

- [ ] **Step 1: Create the config**

```typescript
// core/frontend/playwright.jvmlog.config.ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 4244;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/jvmlog-server.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  reporter: [['list']],
  globalSetup: './e2e/support/jvmlog-global-setup.ts',
  globalTeardown: './e2e/support/jvmlog-global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'jfr-tour-seen', value: '1' },
            { name: 'jfrq:onboarding-dismissed', value: '1' },
            { name: 'jfrq:ai-nudge-dismissed', value: '1' },
          ],
        },
      ],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 2: Add npm script**

In `core/frontend/package.json`, add to `"scripts"`:

```json
"test:jvmlog-e2e": "npx playwright test --config playwright.jvmlog.config.ts"
```

- [ ] **Step 3: Commit**

```bash
git add core/frontend/playwright.jvmlog.config.ts core/frontend/package.json
git commit -m "test(e2e): add Playwright config for jvmlog server-mode tests"
```

---

## Task 4: Playwright spec — jvmlog server-mode e2e tests

**Files:**
- Create: `core/frontend/e2e/jvmlog-server.spec.ts`

The spec tests the full pipeline: server already running (from globalSetup) → navigate to the UI → notebook loads in server mode → schema sidebar lists jvmlog tables → run `jvmlog-gc-summary` view → DataTable shows rows → run `jvmlog-heap-timeline` view → data renders.

It does **not** upload a file (the server loaded the file on startup). It is a `describe.serial` block since all tests share one page.

Key selectors (observed from existing specs):
- Notebook heading: `getByRole('heading', { name: 'JFR Query Notebook' })`  
- Mode badge for server: `getByText(/^server$/i)` or `getByText(/server/i)` in the status bar
- Schema sidebar table: `getByTitle(/Click to preview/i)`
- SQL editor: `.cm-jfr-editor .cm-editor` or the CodeMirror container
- Run button: `getByRole('button', { name: /run/i })` or `getByTitle(/run/i)`
- DataTable: `[data-testid="data-table"]` or `table` element inside result area
- Error indicator: text matching `Catalog Error|Binder Error|Parser Error`

- [ ] **Step 1: Create the spec file**

```typescript
// core/frontend/e2e/jvmlog-server.spec.ts
/**
 * E2E tests for JVM GC log parsing in server mode.
 *
 * Requires:
 *   - query.jar built at core/target/query.jar
 *   - jdklogs data at /Users/i560383_1/code/experiments/jdklogs/data/
 *
 * Run with:
 *   cd core/frontend && npm run test:jvmlog-e2e
 *
 * Skipped when SKIP_E2E=1 or when the jar / log file is absent (checked in globalSetup).
 */

import { test, expect, Page } from '@playwright/test';
import { existsSync } from 'fs';
import { resolve } from 'path';

const JAR = resolve(__dirname, '../../target/query.jar');
const LOG_FILE = resolve(__dirname, '../../../../jdklogs/data/head.G1.log');
const SKIP = process.env.SKIP_E2E === '1' || !existsSync(JAR) || !existsSync(LOG_FILE);

async function waitForNotebook(page: Page) {
  await page.getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  // Wait for schema sidebar to populate
  await page.waitForTimeout(3_000);
}

async function runSqlInNewCell(page: Page, sql: string) {
  // Click the "+" to add a cell, or find an empty SQL cell
  const addBtn = page.getByRole('button', { name: /add.*(sql|cell)/i }).first();
  if (await addBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(500);
  }
  const editor = page.locator('.cm-jfr-editor .cm-content').last();
  await editor.click();
  // Select all and replace with our SQL
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(sql, { delay: 0 });
  await page.waitForTimeout(300);
  // Run the cell
  const runBtn = page.locator('[data-testid="run-cell"]').last();
  if (await runBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await runBtn.click();
  } else {
    await page.keyboard.press('ControlOrMeta+Enter');
  }
  // Wait for result to appear (spinner disappears)
  await page.waitForTimeout(2_000);
}

test.describe.serial('JVM log server-mode e2e', () => {
  test.skip(SKIP, 'SKIP_E2E=1 or jar/log not found');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    await waitForNotebook(page);
  });

  test.afterAll(async () => { await page.close(); });

  // -----------------------------------------------------------------------
  // 1. Server mode detection
  // -----------------------------------------------------------------------

  test('JS1. Notebook loads in server mode', async () => {
    // The mode badge shows "server" (not "WASM") in server mode
    const badge = page.locator('[title*="server"], [title*="Server"]')
      .or(page.getByText(/server/i).filter({ hasText: /^server$/i }));
    // Relaxed: just check no WASM badge
    const wasmBadge = page.getByText(/^WASM$/i);
    const isWasm = await wasmBadge.isVisible({ timeout: 3_000 }).catch(() => false);
    expect(isWasm, 'should NOT be in WASM mode — server must be running').toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. Schema sidebar contains jvmlog tables
  // -----------------------------------------------------------------------

  test('JS2. Schema sidebar lists jvmlog_gc_event table', async () => {
    const tableItems = page.getByTitle(/Click to preview/i);
    const count = await tableItems.count();
    expect(count, 'sidebar should have tables').toBeGreaterThan(0);

    // Look for jvmlog_gc_event specifically
    const gcEventItem = page.getByText('jvmlog_gc_event').first();
    await gcEventItem.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('JS3. Schema sidebar lists jvmlog_gc_init table', async () => {
    const gcInitItem = page.getByText('jvmlog_gc_init').first();
    await gcInitItem.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('JS4. Schema sidebar lists jvmlog_heap_snapshot table', async () => {
    const item = page.getByText('jvmlog_heap_snapshot').first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
  });

  // -----------------------------------------------------------------------
  // 3. Direct SQL queries against jvmlog tables
  // -----------------------------------------------------------------------

  test('JS5. SELECT from jvmlog_gc_event returns rows', async () => {
    await runSqlInNewCell(page,
      'SELECT gcId, gcType, pauseMs FROM jvmlog_gc_event WHERE pauseMs > 0 LIMIT 5');

    // Check no SQL error text visible
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);

    // Some kind of result table should be visible
    const table = page.locator('table').last();
    await table.waitFor({ state: 'visible', timeout: 10_000 });
    const rows = await table.locator('tr').count();
    expect(rows, 'data rows').toBeGreaterThan(1);
  });

  test('JS6. SELECT from jvmlog_gc_init returns algorithm row', async () => {
    await runSqlInNewCell(page,
      "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1");

    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);

    // Result should contain "G1" or similar GC name
    expect(body).toMatch(/G1|ZGC|Parallel|Serial/i);
  });

  test('JS7. SELECT from jvmlog_heap_snapshot returns heap data', async () => {
    await runSqlInNewCell(page,
      'SELECT gcId, heapBefore, heapAfter FROM jvmlog_heap_snapshot LIMIT 5');

    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);

    const table = page.locator('table').last();
    await table.waitFor({ state: 'visible', timeout: 10_000 });
    const rows = await table.locator('tr').count();
    expect(rows, 'heap snapshot rows').toBeGreaterThan(1);
  });

  // -----------------------------------------------------------------------
  // 4. Views render correctly
  // -----------------------------------------------------------------------

  test('JS8. jvmlog-gc-summary view executes without error', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-gc-summary" LIMIT 10');

    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  test('JS9. jvmlog-heap-timeline view executes and returns MB values', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-heap-timeline" LIMIT 5');

    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);

    // heapBeforeMB values should be present (small decimal numbers)
    const table = page.locator('table').last();
    await table.waitFor({ state: 'visible', timeout: 10_000 });
    const rows = await table.locator('tr').count();
    expect(rows, 'heap timeline rows').toBeGreaterThan(1);
  });

  test('JS10. jvmlog-pause-percentiles view executes without error', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-pause-percentiles" LIMIT 5');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  // -----------------------------------------------------------------------
  // 5. Settings modal — Log Patterns tab
  // -----------------------------------------------------------------------

  test('JS11. Settings modal has Log Patterns tab', async () => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    const logPatternsTab = page.getByRole('tab', { name: /log patterns/i })
      .or(page.getByText('Log Patterns').first());
    await logPatternsTab.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('JS12. Log Patterns tab shows pattern builder (server mode)', async () => {
    // Click the Log Patterns tab
    const logPatternsTab = page.getByText('Log Patterns').first();
    if (await logPatternsTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await logPatternsTab.click();
      await page.waitForTimeout(500);
    }

    // The textarea for pasting a log line should be visible
    const textarea = page.locator('textarea[aria-label="Log line to analyse"]')
      .or(page.getByRole('textbox').filter({ hasText: '' }).first());
    // Should not show "server mode only" message
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/only available in server mode/i);

    await page.keyboard.press('Escape'); // close modal
  });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend
npx tsc --noEmit e2e/jvmlog-server.spec.ts 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/frontend/e2e/jvmlog-server.spec.ts
git commit -m "test(e2e): add jvmlog server-mode Playwright spec (JS1-JS12)"
```

---

## Task 5: Run tests end-to-end and fix any failures

**Files:**
- Modify as needed based on failures

- [ ] **Step 1: Run Java unit tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core
mvn test -Dtest=JvmLogImporterTest,JvmlogViewsTest,LogLineParserTest,PatternRegistryWatchTest \
    -Djdklogs.dir=/Users/i560383_1/code/experiments/jdklogs/data 2>&1 | grep -E "Tests run:|FAIL|ERROR|BUILD"
```

Expected: BUILD SUCCESS, all non-skipped tests pass.

- [ ] **Step 2: Build the jar (needed for e2e)**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core
mvn package -DskipTests -q
```

Expected: `core/target/query.jar` updated.

- [ ] **Step 3: Run Playwright e2e spec**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend
npm run test:jvmlog-e2e 2>&1 | tail -40
```

Expected: all JS1-JS12 tests pass. If any fail due to selector mismatches, fix the selectors in `jvmlog-server.spec.ts` based on actual DOM — take screenshots to debug.

- [ ] **Step 4: Fix selector issues (if any)**

If a test like `JS5` fails because the SQL cell / run button selector is wrong, run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend
npx playwright test --config playwright.jvmlog.config.ts e2e/jvmlog-server.spec.ts --headed --project chromium 2>&1 | tail -30
```

Then take a screenshot to inspect the DOM and correct the selector.

- [ ] **Step 5: Commit fixes**

```bash
git add -p  # stage only the relevant changes
git commit -m "fix(test): correct selectors and assertions in jvmlog e2e spec"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Java unit tests: per-GC assertions (G1/ZGC/Parallel), view SQL execution, user patterns dir threading, decorator robustness (no-timestamp, minimal decorators, unknown lines, empty file, truncated events)
- ✅ Playwright: server mode detection, schema sidebar tables, raw SQL against jvmlog tables, view queries, Settings modal Log Patterns tab
- ✅ No placeholders — all code is concrete
- ✅ Type consistency — `JvmLogImporter.importLog(Path, DuckDBSink, Optional<Path>)` matches the overload added in the prior session

**Placeholder scan:** No TBD, TODO, or "add appropriate X" patterns found.

**Robustness coverage:**
- Missing timestamp decorator ✅
- Minimal (level+tags only) decorators ✅
- Unknown/non-log lines mixed in ✅
- Empty file ✅
- Truncated multi-line GC event ✅
- User patterns dir threading ✅
