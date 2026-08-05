# Heavy-File Rigorous Testing — Bug Report

**Date:** 2026-07-07
**Tester:** Playwright MCP (interactive browser)
**Test files used:**
- `.playwright-mcp/container.jfr` — 67 MB (tier: medium)
- `.playwright-mcp/medium.jfr` — 90 MB (tier: medium)
- `.playwright-mcp/large.jfr` — 250 MB (tier: large, ZGC recording)

**Import times (Skip stack frames mode):**
- container.jfr (67 MB): **~46 s** (fixed — was crashing)
- medium.jfr (90 MB): **~30 s**
- large.jfr (250 MB): **~91 s**

## Severity legend
- 🔴 broken / data loss / crash
- 🟠 surprising behavior / silently wrong
- 🟡 mild UX friction
- 🔵 nice-to-have

---

## File Loading & Import

### ✅ [H-001] container.jfr (67 MB) crashes the browser tab with any stack-depth setting

**Where:** File import pipeline (WASM worker)
**Repro:** Navigate to `http://localhost:5180/`, drop `.playwright-mcp/container.jfr` via the file input. Select any stack-depth option (50, 10, 5, or Skip) and click Import.
**Observed:** The browser tab crashes to `about:blank` immediately after Import. No JS error appears in the console before the crash — the process is killed by the browser (OOM or memory limit). Happens consistently with all four stack-depth modes including Skip (no call stack — fastest).
**Expected:** Either a progress indicator leading to a loaded notebook, or a graceful error message ("File too large to import").
**Notes:** medium.jfr at 90 MB imports successfully. The 67 MB container.jfr crashes, suggesting the crash threshold is between 67–90 MB or is specific to this recording's structure/event density.
**Fix:** Removed next-batch worker pre-creation pipelining and reduced default `maxWorkers` from 2 to 1. Workers are now created strictly sequentially: create → parse → drain → merge → terminate, before the next batch starts. This ensures at most 1 GraalVM WASM instance (~300–600 MB) is alive at any time. Users can override with `?maxWorkers=N` in the URL. Verified: container.jfr (67 MB, 6 chunks) now imports successfully without crash.

---

### ✅ [H-002] Dropping a second file while a notebook is loaded does nothing — silent ignore

**Where:** Drop zone / file input handler
**Repro:** Load a file (e.g., demo or medium.jfr). Once notebook is shown, drop `default.db` (or any other file) onto the page's file input. Wait 5+ seconds.
**Observed:** Nothing happens. The schema sidebar still shows the old file's tables. The header badges (WASM, JFR) are unchanged. No dialog, no toast, no loading indicator. The file drop is silently discarded.
**Expected:** Either (a) a confirmation dialog "Replace current notebook with new file?" or (b) the new file loads and replaces the schema.
**Notes:** This means there is no way to switch files without a full page reload. Combined with the `beforeunload` prompt (H-003), users are stuck.

---

### ✅ [H-003] Navigating away from a loaded notebook triggers `beforeunload` even with no user changes

**Where:** App-level `beforeunload` handler
**Repro:** Load any file. Then navigate to another URL or reload.
**Observed:** Browser shows native "Leave site? Changes you made may not be saved." confirmation dialog, even when the user made no changes to the notebook.
**Expected:** `beforeunload` should only fire if there are genuinely unsaved changes (cells edited since last save/export). A freshly loaded notebook with no edits should not block navigation.
**Notes:** Causes friction in the test workflow and will annoy users who accidentally click a link.

---

### ✅ [H-004] Loading medium.jfr a second time (without page reload) crashes the browser

**Where:** File import pipeline / DuckDB-WASM instance
**Repro:** Load medium.jfr successfully. Wait for notebook. Drop medium.jfr again via file input.
**Observed:** Browser tab crashed immediately on the second load attempt.
**Root cause:** `resetWasmDatabase` dropped tables/views but kept ~600 MB of WASM linear memory allocated. A second large JFR file on top exceeded the browser's memory limit.
**Fix:** On re-import, the old DuckDB connection and instance are fully terminated (`db.terminate()`) before creating a fresh WASM instance. This frees the entire WASM heap prior to the new import. Applied to both `loadFile` and `loadDemo` paths in `DuckDBContext.tsx`.

---

## Error Resilience

### ✅ [H-005] Dropping a non-JFR / non-DB file shows no error feedback

**Where:** File input validation
**Repro:** Load demo or any valid file. Drop a `.md` file (or any invalid file) via the file input.
**Observed:** The file is silently rejected. No toast, no error banner, no console error visible to the user. The existing notebook state is preserved (correct), but the user receives zero feedback explaining why nothing happened.
**Expected:** A brief toast or inline message: "Unsupported file type. Drop a .jfr or .db file."

---

## SQL Query Execution

### ✅ [H-006] React "Maximum update depth exceeded" — setState loop in SQL editor

**Where:** `core/frontend/components/NotebookCell.tsx:292` → `SQLEditor.tsx:203` → `Editor.tsx:115`
**Repro:** Load medium.jfr. Open the GC Analysis Notebook template. Cells auto-run. Scroll through results.
**Observed:** Console shows repeated: `Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect ... at NotebookCell.tsx:292`.
**Expected:** No infinite setState loop. The component tree should stabilize after the initial render.
**Notes:** The loop appears triggered by programmatic SQL content updates. May cause performance degradation in notebooks with many cells. Likely a missing dependency/guard in an effect that calls `onChange` or similar.

---

### ✅ [H-007] `SCATTER_CHART` is silently accepted but renders as an error

**Where:** Plot DSL parser / plot renderer
**Repro:** In a plot cell, type `SCATTER_CHART(x: col1, y: col2)`. Run the cell.
**Observed:** The plot DSL accepts `SCATTER_CHART` but produces no chart — the result area shows an error or empty state. The correct keyword is `SCATTER_PLOT`.
**Expected:** Either (a) an autocomplete/lint error highlighting `SCATTER_CHART` as unknown, or (b) accept it as an alias. There is no warning that the keyword is wrong.
**Notes:** Easily confused by users familiar with `BAR_CHART` / `LINE_CHART` naming pattern. The `_CHART` suffix works for BAR, LINE, PIE, AREA — but not SCATTER.

---

### ✅ [H-008] Column chips show `"error — click to copy"` when SQL cell has an error

**Where:** SQL result / column chip area
**Repro:** Run a SQL cell that produces an error (e.g., syntax error or bad table name).
**Observed:** The column chip area (below the editor) shows a chip labeled `"error — click to copy"` instead of being empty or hidden.
**Expected:** Column chips should only appear when a query successfully returns a result. On error, this area should be empty or hidden.

---

## Variable Substitution

### ✅ [H-009] "Add variable" button creates a blank `$newVar = ` entry with empty name and value

**Where:** Variable panel / cell toolbar
**Repro:** Click "Add variable" on any SQL cell.
**Observed:** A new variable row appears pre-filled with `$newVar = ` (literal name "newVar", empty value). This gets saved verbatim into the notebook Markdown on next save, producing a `$newVar = ` line in the variables frontmatter.
**Expected:** Either (a) open an inline editor immediately so the user can name the variable before it exists, or (b) use a unique placeholder name like `$var1` / `$var2` that at least doesn't collide.
**Notes:** The saved notebook contained `$newVar = ` with an empty value, which is serialized into the notebook file.

---

### ✅ [H-010] `$session_start` and `$session_end` toolbar chips always show `—` (not auto-populated)

**Where:** Toolbar / `$session_start` / `$session_end` chips
**Repro:** Load medium.jfr or large.jfr (both have `RecordingInfo` table with start/end times).
**Observed:** Both chips show `—` (not set). The recording start/end is not automatically populated from `RecordingInfo` or `recording_start()` / `recording_end()` macros.
**Expected:** After loading a JFR file, `$session_start` and `$session_end` should be auto-populated from the recording metadata, so time-range queries work without manual input.

---

## Schema Explorer

### ✅ [H-011] Sidebar table buttons merge name and row count without separator

**Where:** `Sidebar.tsx` — table/view list items
**Repro:** Load any JFR. Look at sidebar entries.
**Observed:** Each button renders the table name and row count badge concatenated without spacing: e.g., `ActiveRecording8`, `CPULoad1,791`. The count badge is directly appended to the name with no visual separation.
**Expected:** A space, separator, or distinct visual style between name and count: `ActiveRecording (8)` or `ActiveRecording · 8`.
**Notes:** Makes it hard to read long table names at a glance.

---

### ✅ [H-012] Sidebar preview pane truncates long file path strings

**Where:** Sidebar preview panel
**Repro:** Load medium.jfr or large.jfr. Open the sidebar preview. Click a table that has a filename/path column.
**Observed:** Path strings like `/Users/I560383/code/experiments/condensed-data/benchmark/...` are truncated without a tooltip showing the full path.
**Expected:** Either a `title` tooltip on hover, or a monospace expandable display.

---

## Plot Rendering

### ✅ [H-013] Recharts `width(-1) height(-1)` warnings on every chart render

**Where:** Chart rendering pipeline (Recharts)
**Repro:** Render any chart in a notebook cell. Check console.
**Observed:** Console shows `Warning: [Recharts] width(-1) and height(-1) are both fixed numbers, maybe you need to set width and height manually to ResponsiveContainer` on every chart render (4+ per session).
**Expected:** No warnings. Either pass explicit dimensions or ensure ResponsiveContainer gets its container dimensions before rendering.

---

## Save / Load Round-Trip

### ✅ [H-014] Saved notebook markdown contains `$newVar = ` with empty value in frontmatter

**Where:** `notebookParser.ts` — serialization
**Repro:** Click "Add variable" on a cell without filling in name or value. Save the notebook.
**Observed:** The saved `.md` file contains:
```yaml
variables:
  $newVar: ''
```
(or equivalent) in the YAML frontmatter. On reload this creates a `$newVar` variable with an empty string value, which silently affects any query using `$newVar`.
**Expected:** Variables with empty names or empty values should not be serialized to the file.

---

## Multi-Chunk JFR Specifics

### ✅ [H-015] Multi-chunk merging works correctly — no chunk staging tables visible

**Where:** WASM import pipeline / schema reflection
**Repro:** Load large.jfr (250 MB, 17 recording chunks per `ActiveRecording` row count).
**Observed:** Schema sidebar shows 153 items. Zero tables with `chunk0_`, `chunk1_`, or similar staging prefixes. `SELECT COUNT(*) AS total_classes FROM "Class"` returns 5,756, matching the sidebar badge exactly.
**Expected:** Tables merged, no phantoms. ✓ Confirmed working.

### ✅ [H-016] Struct dedup (Class, Method) produces correct row counts

**Where:** WASM import — struct table deduplication
**Observed:** `Class` = 5,756 rows (matches sidebar). `Method` sidebar badge = 7,820. Counts are consistent with a single-pass deduplicated table across 17 chunks.
**Expected:** No duplicate rows from repeated chunk headers. ✓ Confirmed working.

---

## Template / Notebook Workflow

### ✅ [H-017] "GC Analysis Notebook" template fails on non-GC or ZGC recordings — 3 Catalog Errors

**Where:** GC Analysis Notebook template (`New GC Analysis Notebook` button)
**Repro:** Load large.jfr (a ZGC benchmark recording). Click "New GC Analysis Notebook". Click "Run All".
**Observed:** Three cells produce `Catalog Error`:
- `heap-committed-vs-used` does not exist (suggestion: `heap-summary-over-time`)
- `allocation-rate` does not exist (suggestion: `thread-allocation`)
- `ObjectAllocationSample` does not exist (suggestion: `ZAllocationStatisticsSample`)
**Expected:** The template should either (a) check which views/tables exist and skip/adapt cells, or (b) show a banner "This template is optimized for G1GC/CMS recordings — some cells may not apply to your file."
**Notes:** ZGC uses different event types (`ZAllocationStatisticsSample` instead of `ObjectAllocationSample`, `heap-summary-over-time` instead of `heap-committed-vs-used`).

---

## Performance

### ✅ [H-018] ONNX Runtime EP assignment warnings on every page load

**Where:** ONNX Runtime initialization (local ML model)
**Repro:** Load any file. Check console immediately after page load.
**Observed:** Console shows ONNX Runtime warnings about EP (execution provider) assignment on every load. These appear before any user action.
**Expected:** ONNX Runtime should be initialized silently in the background without polluting the console.

### ✅ [H-019] `/api/query` HTTP 500 errors on every page load in WASM mode

**Where:** App initialization
**Repro:** Load any page. Check Network tab or console.
**Observed:** Two `POST /api/query` requests return HTTP 500 immediately on load. In WASM mode there is no backend, so these requests always fail. They appear to be capability-detection probes that are expected to fail, but the errors clutter the console.
**Expected:** Either suppress the 500 from the console (expected failure), or don't make the requests if WASM mode is detected.

### ✅ [H-020] 189 KaTeX warnings for `Unrecognized Unicode character "?" (65533)` from query results

**Where:** Markdown/KaTeX rendering pipeline
**Repro:** Load medium.jfr. Run any query that returns binary data or path strings (e.g., `SELECT * FROM "ActiveRecording"`).
**Observed:** 189 console warnings: `LaTeX-incompatible input and strict mode is set to 'warn': Unrecognized Unicode character "?" (65533)` from `rehype-katex.js`.
**Expected:** Query result cell values that aren't LaTeX should not be processed through the KaTeX pipeline. Binary/null bytes in string columns should be sanitized before rendering.

---

## Performance Benchmarks

| Operation | File | Time |
|-----------|------|------|
| Import (Skip frames) | medium.jfr 90 MB | ~30 s |
| Import (Skip frames) | large.jfr 250 MB | ~91 s |
| Import (any depth) | container.jfr 67 MB | **crash** |
| Collapse All (21 cells) | large.jfr | ~1.1 s |
| Run All Queries (21 cells) | large.jfr | ~2.1 s |
| Settings modal open | large.jfr loaded | ~0.5 s |

---

## Additional Findings (Deep Pass)

### ✅ [H-021] Undo history spans across file loads — undoing far enough reverts to a previous session's notebook content

**Where:** Undo/redo state (`useHistoryState` or equivalent)
**Repro:** Load large.jfr, click "New GC Analysis Notebook". Click Undo 6+ times.
**Observed:** Undo sequence goes: 21 cells → 20 cells → 20 cells → 0 cells (empty) → 6 cells with the *previous session's* medium.jfr notebook content (`SELECT * FROM "CPULoad" LIMIT $lim`). Then continues undoing further to the app's welcome page template.
**Expected:** Loading a new file or creating a new notebook should clear the undo history. Undo should only apply to changes *within* the current notebook session.
**Notes:** This can cause data confusion — a user clicking undo thinking they're reverting a cell edit could end up with an entirely different notebook from a different file load.

---

### ✅ [H-022] Ctrl+A in a CodeMirror SQL cell selects across all cells, not just the current one

**Where:** CodeMirror 6 key binding / notebook-level Ctrl+A handler
**Repro:** Click into any SQL cell editor. Press Ctrl+A. Start typing.
**Observed:** Ctrl+A selects all content across all editors simultaneously. Typing then inserts/prepends into the focused cell without replacing its content, producing garbled SQL like `SELECTSELECT COUNT(*) AS total_classes FROM "Class"  recording_start() AS "Start"...`
**Expected:** Ctrl+A inside a CodeMirror editor should select all text *within that editor only*. The notebook should not intercept Ctrl+A when the cursor is inside an editor.
**Notes:** This makes it impossible to reliably replace cell contents via keyboard. The standard editor UX expectation (Ctrl+A = select all in current field) is broken.

---

### ✅ [H-023] DataTable shows maximum 20 rows with no pagination — no way to access the rest

**Where:** DataTable component (result rendering)
**Repro:** Run `SELECT * FROM "CPULoad"` (which has 620 rows). Observe the result table.
**Observed:** Only 20 rows are shown. The label says "20 rows" with no indication that the table has 620 total rows. There are no pagination controls (Next/Prev page, page number, rows-per-page selector). The "CSV ↓" export also downloads only the 20 visible rows, not the full 620.
**Expected:** Either (a) show the total row count ("20 of 620 rows") with pagination, or (b) export the full result set to CSV even if only 20 rows are displayed.
**Notes:** Users with large datasets have no way to access rows 21+. The CSV export silently truncates without warning. This is particularly bad for debugging or data analysis workflows.

---

### ✅ [H-024] CSV export filename is always `data.csv` regardless of query or table name

**Where:** DataTable CSV export
**Repro:** Run any query and click "CSV ↓".
**Observed:** Downloaded file is always named `data.csv`.
**Expected:** Filename should reflect the query context, e.g. `CPULoad.csv` (from `FROM "CPULoad"`) or `query-2026-07-07.csv`, to avoid all exports overwriting the same filename.

---

### ✅ [H-025] `$session_start` / `$session_end` datetime input cannot be committed via programmatic fill or keyboard Enter

**Where:** Toolbar datetime-local input for `$session_start` / `$session_end`
**Repro:** Click the `$session_start` chip. The native `datetime-local` input appears. Fill a value (e.g. `2024-05-24T21:49`). Press Enter or click away.
**Observed:** The value is discarded. Clicking away closes the input without committing. Pressing Enter closes the input without committing. The chip still shows `—` (not set).
**Expected:** Pressing Enter, Tab, or clicking away should commit the entered value to `$session_start`. The only working path appears to be interacting directly with the native date/time picker spinners (browser-native UI), which is unintuitive.
**Notes:** This makes `$session_start` / `$session_end` practically unusable unless the user knows to interact with the native spinner UI specifically.

---

### ✅ [H-026] DataTable row label shows total visible rows as total — no indication of truncation

**Where:** DataTable component
**Repro:** Run any query returning more than 20 rows (e.g. `SELECT * FROM "CPULoad"` with 620 rows).
**Observed:** The label reads "20 rows" with no qualification. A user has no way to know that 600 rows are hidden.
**Expected:** Label should read "20 of 620 rows" or similar, making truncation explicit.

---

### ✅ [H-027] CSV button label is "CSV ↓" but tooltip/title is absent — purpose unclear at a glance

**Where:** DataTable result toolbar
**Repro:** Look at the "CSV ↓" button in any result cell.
**Observed:** The button has no `title` attribute and no tooltip. The "↓" arrow implies download but isn't labelled "Export" or "Download CSV".
**Expected:** Add `title="Download as CSV"` for keyboard/accessibility users.

---

### ✅ [H-028] Delete Cell uses native `window.confirm()` dialog instead of an in-app modal

**Where:** Cell toolbar → Delete Cell button
**Repro:** Click "Delete Cell" on any cell.
**Observed:** A native browser `confirm()` dialog appears: "Delete this cell?" with OK/Cancel. It blocks the JS thread and cannot be styled or keyboard-navigated with app shortcuts.
**Expected:** Use an in-app confirmation modal or a brief "Undo" toast (delete immediately, allow undo for 5s). Native `confirm()` dialogs are visually inconsistent with the app design and behave differently across browsers.

---

### ✅ [H-029] Presenter mode keeps the full sidebar visible, wasting ~25% of screen width

**Where:** Presenter Mode
**Repro:** Click "Presenter Mode (hide editors)".
**Observed:** All SQL/plot editors are hidden (correct). But the full sidebar (schema explorer with tables/views/macros) remains visible at full width, taking ~25% of the screen with information irrelevant to a presentation.
**Expected:** Presenter mode should hide or collapse the sidebar automatically, giving the result tables and charts the full width.

---

### ✅ [H-030] Edit Raw Markdown is a split-view (raw left, rendered right) — not documented in any tooltip or button label

**Where:** "Edit Raw Markdown" button → split view
**Repro:** Click "Edit Raw Markdown".
**Observed:** A split-view appears with the raw markdown on the left and the rendered notebook on the right. The button to return is labelled "Switch to Notebook View". This is actually a useful feature, but completely undiscoverable — no tooltip on the button explains what the view looks like.
**Expected:** Tooltip: "Edit notebook as raw Markdown (split preview)" or similar.

---

### ✅ [H-031] Auto-Run toggle has no visual active state indicator beyond tooltip text

**Where:** "Disable Auto-Run" / "Enable Auto-Run" toggle button
**Repro:** Click the Auto-Run button to disable, then look at its visual state.
**Observed:** The button changes its `title` attribute (from "Disable Auto-Run" to "Enable Auto-Run") but has no visual difference in appearance (color, icon, active state) between enabled and disabled states. You can only tell the state by hovering to see the tooltip.
**Expected:** Add a visual indicator (e.g., different icon color, "active" CSS class, or a small status indicator) so the current state is visible without hovering.

---

### ✅ [H-032] Sidebar table name includes row count appended directly — row count is not separately accessible

**Where:** Sidebar table button text content
**Observed:** Sidebar buttons render `"ActiveRecording17"` — the row count `17` is part of the button's text content. There is no `data-row-count` attribute or separate DOM node, making it impossible to programmatically extract just the table name without string parsing.
**Expected:** Use a separate `<span>` for the row count badge so screen readers and test code can distinguish name from count.
