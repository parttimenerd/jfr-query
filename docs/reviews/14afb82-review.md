# Code Review — 14afb82 fix(v2): use pool=forks in vitest to prevent worker isolation race conditions

## Lint & Format
**ESLint:** ✅ clean (0 errors, 63 warnings — all pre-existing `no-explicit-any` in test/util files)
**Prettier:** ✅ clean
**TypeScript:** ✅ clean

## Issues Found

### 🔴 Critical
- None.

### 🟡 Warning
- `src/services/executor/cellExecutor.ts:40` — `compareValues` in ResultsTable (separate file) casts `unknown` to `number` via `Number(a as number)`. The `as number` cast is redundant (`Number()` accepts `unknown`) and slightly misleading. Low risk but should be removed.
- `src/context/DuckDBContext.tsx` — `DuckDBProvider` creates the `DuckDBClient` on first render via an `if (ref.current === null)` guard, using a `useRef`. This is idiomatic for React 19 concurrent-mode-safe lazy init. However, the real `DuckDBClient` constructor calls `new Worker(url)` inside it — if `DuckDBProvider` is rendered in tests without passing a `client` prop and without a Worker mock, the test will throw. The test correctly passes a `mockClient` prop in all test cases, so this is safe. Worth documenting in the component's JSDoc.
- `src/__tests__/executor/cellExecutor.test.ts` — test file mocks `DuckDBClient` with `vi.mock` but the mock shape (`query`, `registerFile`, `dropFile`, `describe`) doesn't include `abort()` method. If `executeCell` later gains abort-propagation, mock will need updating. Non-blocking for now.

### 🔵 Note
- `vitest.config.ts` — `pool: 'forks'` is the correct fix for DuckDB-WASM worker isolation in jsdom. Worker threads cannot share SharedArrayBuffer cross-thread in jsdom's simulated environment; forked processes get separate V8 contexts. Good diagnosis and fix.
- `src/context/index.ts` + `src/hooks/useDB.ts` — two-level re-export (`context/index.ts` re-exports `DuckDBContext`, `hooks/useDB.ts` re-exports `context/DuckDBContext` directly). Slight redundancy: `useDB` is reachable via both `@/hooks/useDB` and `@/context`. One path should be canonical. The `@/hooks/useDB` alias is the ergonomic consumer path; the `@/context` path is for providers. This is fine as-is.
- `src/__tests__/results/ResultsTable.test.tsx` — tests cover empty state, truncation at 200 rows, sorting asc/desc/neutral, BigInt formatting, Date formatting, null values, and WCAG aria-sort. Thorough.
- `src/components/results/ResultsTable.tsx:40-43` — BigInt comparison casts both sides to `Number`. Precision loss for bigint > `Number.MAX_SAFE_INTEGER`. Acceptable for JFR durations which won't exceed 2^53.

## Verdict
PASS WITH NOTES

The M-B3 executor + context + results foundation is clean and well-tested. The `pool: 'forks'` fix correctly addresses DuckDB-WASM worker isolation in Vitest/jsdom. All checks pass after auto-fixes in `1108c62`.
