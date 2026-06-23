# Code Review: cff689e

**Commit:** cff689e  
**Date:** 2026-06-23  
**Author:** Johannes Bechberger  
**Message:** feat(v2): M-B7 three-grain undo + activity feed

## Result: PASS

## Summary

Introduces the three-grain undo system and activity feed:
- `useUndoHistory` — coarse (cell-level) + structural (notebook-level) undo/redo via ref+state
  separation so push/pop avoid superfluous re-renders
- `useUndoHotkeys` — `⌘Z` / `⌘⇧Z` router that delegates to CM6 only when an editor has focus
- `activityBus` — thin `EventTarget` event bus dispatching `ActivityEntry` custom events
- `activityStore` — 200-entry LRU ring buffer backed by `useSyncExternalStore`-compatible subscribe
- `ActivityFeed` / `ActivityFeedPanel` — ARIA live region feed with kind badges
- Integration into `cellExecutor`, `jfrLoader`, `diagnosticRegistry` (error-only)
- 6 unit/bench test files + 3 Playwright e2e specs

22 files added / 2 files modified (1 012 lines net).

## Lint Errors

None. `npx eslint src/ tests/ --max-warnings 0` (scoped to commit files) exits 0.

## Type Errors

None. `npx tsc --noEmit` exits 0.

## Formatting Issues

None. All matched files use Prettier code style.

## Auto-fixes Applied

None required.

## Notes

- `activityStore._reset()` is a test-only escape hatch; consider gating behind
  `import.meta.env.DEV || import.meta.env.TEST` to prevent accidental prod usage.
- `useUndoHistory` holds four parallel ref+state pairs; a single `useReducer` with an `immer`-style
  reducer would halve the boilerplate and be more testable, but the current approach is correct.
- `useUndoHotkeys` re-registers the `keydown` listener on every render because the `callback` dep
  changes on each call. Stable `useCallback` wrappers in the caller prevent this in practice, but
  the hook itself doesn't enforce stability — worth a comment.
- Redo stack is cleared on `pushCoarse` / `pushStructural` (correct); not cleared on `undoCoarse`
  redo path (also correct — expected behaviour matches standard undo semantics).
- Activity feed renders as `<ol>` with `aria-live="polite" aria-relevant="additions"` — correct;
  each row uses `aria-label` combining kind + message, which is accessible.
- `makeId()` uses `Math.random().toString(36).slice(2, 10)` — fine for UI identifiers; not
  cryptographically unique but sufficient for 200-entry ring buffer keys.
