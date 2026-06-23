# Code Review — 6b697ce docs(v2): add style guide + visual fidelity checkpoints

## Lint & Format
**ESLint:** ❌ 1 error — `react-hooks/exhaustive-deps` rule referenced in `DepGraphSource.tsx` ESLint-disable comment but plugin not installed. Fixed in `454beb1`.
**Prettier:** ❌ 4 files (DepGraphOverlay.test.tsx, DepGraphSource.tsx, graphElements.ts, main.tsx). Fixed in `454beb1`.
**TypeScript:** ✅ clean

## Issues Found

### 🔴 Critical
- None.

### 🟡 Warning
- `src/components/depGraph/DepGraphSource.tsx:18` — `// eslint-disable-next-line react-hooks/exhaustive-deps` comment references an ESLint plugin not in the config. This produces an ESLint error "Definition for rule was not found." Fixed by replacing with a prose comment. The underlying behavior (intentionally omitting `effectiveRuntime` from deps) is correct since it's an inline-constructed object that would cause infinite re-renders if included.
- `src/components/depGraph/graphElements.ts` — previously had 5 phantom `type _Foo = Foo` aliases to suppress TS "unused import" warnings. These were removed when prettier removed the no-longer-needed imports. The final file correctly imports only `DepGraph`, `GraphEdge`, `GraphNode`. The unused-import suppression pattern was fragile — a better approach is to use the types directly in function signatures where possible.
- `src/components/depGraph/CytoscapeAdapter.tsx:68` — `as unknown as cytoscape.LayoutOptions` cast needed because cytoscape-dagre's layout options extend the base type. The custom type declaration at `src/types/cytoscape-dagre.d.ts` addresses the module typing gap. Acceptable workaround.
- `src/components/depGraph/DepGraphOverlay.tsx:44` — The Cmd+G keydown handler closes over `open` and `setOpen`. Since `open` is in the dep array, this correctly handles both open/close. However, `setOpen` is defined via `useCallback` with `[openProp, onOpenChange]` deps — the open/close toggle `setOpen(!open)` inside the effect uses the stale `open` value from the closure. When `openProp` is controlled, toggling rapidly could skip states. Recommend using `setOpen((prev) => !prev)` pattern, but only if `setOpen` supports functional updates.

### 🔵 Note
- `docs/STYLE_GUIDE.md` — excellent reference document with visual fidelity checkpoints. No code issues.
- `src/components/depGraph/EdgeKeyboardList.tsx` — `role="listbox"` with `aria-activedescendant` and `role="option"` items is correct ARIA pattern for keyboard navigation in a graph. The visually hidden (`sr-only`) list with screen-reader-only text is a good accessibility pattern.
- `src/components/depGraph/DepGraphOverlay.tsx` — uses `createPortal(overlay, document.body)` to render in a modal pattern. `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + `aria-describedby` is correct. `useFocusTrap` prevents focus escape. Good implementation.
- `src/components/depGraph/DepGraphOverlay.tsx:113-120` — `role="status" aria-live="polite"` announcement region for edge activation. Correct pattern per checklist.
- `src/main.tsx` — new `?fixture=depGraphCanonical` query param path for Playwright overlay tests. Dynamic import keeps it out of the main bundle. Good testing seam.
- `src/components/cell/CellView.tsx` — now integrates `DepGraphSource`. The `notebook` prop is threaded through `AppShell` → `App` correctly.

## Verdict
PASS WITH NOTES

The M-B4 dep graph overlay is well-structured with excellent accessibility (focus trap, ARIA dialog, keyboard edge navigation, live announcement region). The ESLint disable comment for the uninstalled `react-hooks` plugin was the only lint error, fixed in `454beb1`.
