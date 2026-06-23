# Code Review — 0aaf745 fix(v2): M-B5 refinements — QuickfixMenu doc keydown, WelcomeCell h1→h2

## Lint & Format
**ESLint:** ✅ clean (0 errors)
**Prettier:** ❌ 3 files (SettingsContext.tsx, SettingsContext.test.tsx, duckdb/client.ts — new working-tree files). Fixed in `81994c9`.
**TypeScript:** ❌ 1 error — `src/context/DuckDBContext.tsx:8` cannot find `'../services/duckdb/worker.ts?worker'` (Vite `?worker` import requires `"types": ["vite/client"]` in tsconfig). Fixed in `81994c9`.

## Issues Found

### 🔴 Critical
- None.

### 🟡 Warning
- `src/context/DuckDBContext.tsx:8` — `import DuckDBWorker from '../services/duckdb/worker.ts?worker'` uses a Vite-specific import syntax that TypeScript doesn't understand without `vite/client` type declarations. The `tsconfig.app.json` was missing `"types": ["vite/client"]`. Fixed by adding it in `81994c9`.
- `src/components/issues/QuickfixMenu.tsx` — The `activeIndexRef` is updated both inside `setActiveIndex` updater function and directly (`activeIndexRef.current = next`). This is needed because the `setActiveIndex` updater's result doesn't immediately propagate to the ref. The pattern is correct but unusual — a comment explaining the stale closure issue would help future maintainers.

### 🔵 Note
- `src/components/issues/QuickfixMenu.tsx` — Document-level keyboard handler pattern is correct for menus that may not have DOM focus. The `fixesRef`, `onApplyRef`, `onCloseRef` stable-reference pattern avoids stale closures without including callbacks in effect deps. Good React practice.
- `src/components/shell/WelcomeCell.tsx` — h1 → h2 demotion is correct WCAG fix (single `<h1>` per page in Topbar). The emoji icons in feature cards (`📊`, `🔍`, `⚡`, `💾`) will need `aria-hidden="true"` if they're decorative or explicit `aria-label` for the surrounding div. Currently they have no label — low risk since the descriptive text is adjacent.
- `tests/e2e/99-edge-cases.spec.ts` — `test.fixme` reformatting is cosmetic (collapsing multi-arg form to inline). No behavioral change.

## Verdict
PASS WITH NOTES

The QuickfixMenu keyboard refactor correctly addresses the focus issue. The TypeScript `?worker` import type error has been fixed. All checks pass after `81994c9`.
