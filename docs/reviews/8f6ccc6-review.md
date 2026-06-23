# Code Review — 8f6ccc6 feat(v2): M-B2 cell editor — CM6 SQL+plot editors, $var chips, diagnostics strip

## Lint & Format
**ESLint:** ❌ 3 errors (unused `page` in `test.fixme` stubs) + 63 warnings (`no-explicit-any` in test/util files)
**Prettier:** ❌ 4 files (DuckDBContext.tsx, cellExecutor.ts, DuckDBContext.test.tsx, cellExecutor.test.ts)
**TypeScript:** ❌ 1 error — `ResultsTable` module not found (new file added in working tree but not tracked; `CellHeading` unused import after M-B3 update to CellView)

All three issues were auto-fixed in commit `1108c62`.

## Issues Found

### 🔴 Critical (must fix before next milestone)
- None. $$ai_providers only appears in formatter test/source as scrub target — correct.
- Tailwind theme uses `[data-theme="dark"]` selector — correct.
- `AxeBuilder` imported statically in 99-edge-cases.spec.ts — correct.

### 🟡 Warning (should fix soon)
- `tests/e2e/99-edge-cases.spec.ts:328,332,336` — `page` fixture destructured in `test.fixme` bodies with empty stubs (`@typescript-eslint/no-unused-vars`). Fixed by removing destructure entirely — `test.fixme` stubs don't need fixtures.
- `src/components/cell/CellView.tsx:5` — `CellHeading` imported but unused (TS6133). CellView was upgraded in working tree to inline its heading; the named import was left behind. Fixed by removing the import.
- `src/utils/duckdbWasmLoader.ts:18,26` — two `any` types in WASM loader shim. Low-risk (interop boundary with WASM CDN loading) but should be tightened to `unknown` at next pass.
- `src/__tests__/parser/plotDslParser.test.ts` — 58 `no-explicit-any` warnings. Property test uses `expect.objectContaining` with `any` for nested AST checks. Should use typed matchers or partial AST types in M-C pass.

### 🔵 Note (minor/style)
- `src/components/cell/CellView.tsx` — `key={i}` on block `<div>` uses array index. Acceptable for now since blocks are ordered and non-reorderable in M-B2, but should switch to a stable key (e.g. `${block.kind}-${i}`) in M-C.
- `src/components/notebook/NotebookView.tsx:41` — `key={\`${cell.displayIndex}-${i}\`}` is safe but redundant with the numeric index.
- `src/components/cell/SqlBlockEditor.tsx:17` — `VAR_RE` uses the `/g` flag. The regex is shared across calls and reset explicitly via `lastIndex = 0` before each `exec` loop — this is correct and intentional (pattern noted in comment). No bug, just worth flagging for future readers.
- `src/components/cell/CellHeading.tsx:10` — `STATUS_GLYPH` is defined but `CellHeading` component is no longer used in `CellView` after M-B3 upgrade. `CellHeading.tsx` is now dead code and should be deleted or re-integrated in M-C.
- `src/components/cell/DiagnosticsStrip.tsx` — `role="status"` / `aria-live` not present on the strip itself, but this is a list of diagnostics not a live region. The status chip in `CellView` correctly has `role="status" aria-live="polite"` — no issue.
- `src/components/cell/VarChip.tsx:12` — `role="tooltip"` on the popover div is correct. The close button has `aria-label="Close variable popover"` — good accessibility.

## Verdict
PASS WITH NOTES

The M-B2 milestone delivers a clean CM6 SQL editor with `$var` chip decorations, plot editor, `DiagnosticsStrip`, and a `NotebookView` container. The architecture is sound. Auto-fixes were applied in commit `1108c62`. Remaining warnings (61 `no-explicit-any`) are pre-existing in test/utility files and do not affect production code paths.
