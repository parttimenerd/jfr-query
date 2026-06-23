# Code Review — a0c2729 fix(v2): Bug 6 — guard DepGraphSource useMemo when notebook is undefined

## Lint & Format
**ESLint:** ✅ clean
**Prettier:** ✅ clean
**TypeScript:** ✅ clean

## Issues Found

### 🔴 Critical
- None.

### 🟡 Warning
- None.

### 🔵 Note
- `src/components/depGraph/DepGraphSource.tsx` — replaces `notebook!` non-null assertion with a conditional `notebook ? computeDepGraph(...) : null`. Falls back to `{ nodes: [], edges: [] }` empty graph when neither `notebook` nor `graphProp` is provided. This is a safe null-coalescing change. The fix correctly handles the Playwright fixture seam where `graph` is injected directly and `notebook` is `undefined`.
- The `computedGraph: DepGraph | null` type change is propagated cleanly — the fallback `?? { nodes: [], edges: [] }` keeps the `graph` type as `DepGraph` (non-nullable) for the downstream `DepGraphOverlay`.

## Verdict
PASS
