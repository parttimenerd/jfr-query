# Phase 1c Findings — Toolbar, Sidebar, Save/Load

**Date:** 2026-06-29  
**App:** JFR Query Notebook at http://localhost:3001  
**Method:** Live Playwright MCP exploration with the GC Analysis demo notebook  

---

## PASS / FAIL List

| # | Feature | Result | Notes |
|---|---------|--------|-------|
| T1 | Collapse All / Expand All toolbar buttons | **PASS** | All cells collapse to header-only; Expand All restores content |
| T2 | Clear All Results | **FAIL** | BUG-3: Tables and charts remain after clicking; button has no visible effect |
| T3 | Undo / Redo | **PARTIAL** | Redo works in 1 click. Undo requires 2 clicks for a single-editor replacement (BUG-8). Core functionality works. |
| T4 | Presenter Mode toggle | **PASS** | Hides toolbar/sidebar, shows cells in clean read-only view; toggle reverses |
| T5 | Auto-Run Toggle (Disable / Enable) | **PASS** | Button label flips between "Disable Auto-Run" / "Enable Auto-Run"; auto-run behaviour changes accordingly |
| T6 | CSV Export | **PASS** | Downloads `data.csv` with correct column headers and data rows |
| T7 | Edit Raw Markdown (split view) | **PASS** | Opens left-half CodeMirror with full notebook markdown; right half shows live rendered notebook |
| T8 | Column chip → paste into plot editor | **FAIL** | BUG-7: Chip copies column name to clipboard only; does not insert text into the active plot editor. Assertion "text inserted" mismatch with actual "clipboard-only" behaviour |
| T9 | Schema Explorer: Tables / Views / Macros sections | **PASS** | Tables (5), Views (5), Macros (27) all present and collapsible |
| T10 | Click table → shows schema tooltip + preview rows | **PASS** | GarbageCollection shows column list tooltip and first 5 data rows in preview panel |
| T11 | Search schema filters by column/table name | **PASS** | Typing "duration" filters results to matching items across all sections |
| T12 | Click view → shows view SQL in preview | **PASS** | gc-top-pauses view shows the defining SELECT statement in the preview panel |
| T13 | Click macro → shows macro definition in preview | **PASS** | time_bucket macro shows parameter list and body in preview tooltip |
| T14 | Show / Hide Query Editor in preview panel | **PARTIAL** | Toggle works (button title changes "Show Query Editor" ↔ "Hide Query Editor"); editor pane appears/disappears. However the editor content is a styled read-only display, not an editable CodeMirror instance — cannot edit view SQL directly from sidebar |
| T15 | Sort tables by row count | **PASS** | Tables reorder to descending row-count (150 → 40 → 40 → 25 → 20) after clicking sort-by-count button |
| T16 | Collapse / Expand sidebar | **PASS** | "Collapse sidebar" button (title attr) hides sidebar; "Expand Sidebar" button restores it |
| T17 | Save Notebook downloads .md file | **PASS** | Clicking Save Notebook triggers download of `notebook.md` with valid markdown content |
| T18 | Load Notebook round-trip (add cell → save → load → verify) | **PASS** | Loaded modified notebook; all cells (original + added) preserved correctly |
| T19 | Global variable `$rt_test = hello_world` survives round-trip | **PASS** | Variable block `$rt_test = hello_world` saved and loaded; value interpolated correctly in SQL display |
| T20 | Plot clause `BAR_CHART TITLE "RoundtripTitle"` survives round-trip | **PASS** | Plot block `BAR_CHART(x: "cause", y: ["count"]) TITLE "RoundtripTitle"` preserved verbatim in saved and re-loaded notebook |

**Summary: 15 PASS, 2 FAIL, 3 PARTIAL**

---

## BUGS

### BUG-1 — `window.scrollTo` while CodeMirror editor focused injects keystrokes
**Severity:** Medium (testing/automation concern; not a user-facing bug)  
**Repro:** Call `page.evaluate(() => window.scrollTo(0, 0))` while a `.cm-editor` has keyboard focus.  
**Effect:** Characters are injected into the editor as if typed, corrupting notebook content.  
**Workaround:** Scroll the `main` element's `scrollTop` instead, and always click a neutral element before any `evaluate` calls.

---

### BUG-2 — Delete/Backspace in schema search input causes page navigation to about:blank
**Severity:** High (data loss)  
**Repro:** Focus the schema search input, press Ctrl+A to select all, then press Delete (or Backspace) to clear.  
**Effect:** Page navigates away to `about:blank`, losing the entire notebook state. The browser's native "go back" behaviour is triggered.  
**Expected:** Delete should clear the search text.

---

### BUG-3 — Clear All Results button has no effect
**Severity:** High (feature broken)  
**Repro:** Run at least one query so a table/chart result is visible, then click the "Clear All Results" toolbar button.  
**Effect:** All result tables and charts remain visible. No change occurs.  
**Expected:** All query result panels should be hidden/cleared.

---

### BUG-4 — Multiple `beforeunload` dialogs fire on minor interactions
**Severity:** Medium (UX friction)  
**Repro:** Make any edit to a notebook cell, then navigate away (or trigger certain toolbar actions).  
**Effect:** Multiple `beforeunload` confirmation dialogs accumulate. After ~5 dialogs, the page becomes unresponsive to further interactions until dialogs are dismissed.  
**Expected:** A single "unsaved changes" warning should appear at most once.

---

### BUG-5 — Toolbar button icons missing after loading a new notebook template
**Severity:** Low (cosmetic)  
**Repro:** Click "New GC Analysis Notebook" to load a fresh template from the toolbar.  
**Effect:** Several toolbar button `<img>` elements fail to render (show as broken images). The buttons remain functional.  
**Expected:** All toolbar icons should load correctly after template switch.

---

### BUG-6 — `$session_start` / `$session_end` show "—" after using New GC Analysis Notebook
**Severity:** Medium  
**Repro:** Click "New GC Analysis Notebook" to reset the notebook.  
**Effect:** The header variable pills for `$session_start` and `$session_end` show "—" (empty/unresolved) instead of the demo recording's timestamps.  
**Expected:** The demo timestamps (e.g. "15 Mar, 11:00") should be populated from the newly-loaded notebook metadata.

---

### BUG-7 — Column chip "click to copy" only copies to clipboard; does not insert into plot editor
**Severity:** Medium (feature/UX mismatch)  
**Repro:** Open a cell with a plot editor. Above the plot editor, column chips (labeled "columns: col1 col2 — click to copy") are shown. Click a chip.  
**Effect:** The column name is copied to the clipboard. The plot editor's cursor position is not updated; no text is inserted.  
**Expected (per test spec):** Clicking a chip should insert the column name at the current cursor position in the plot editor.  
**Note:** The tooltip says "click to copy" which matches the actual behaviour. The test expectation of insertion may be a spec error, but the feature name "click to copy" vs. test assertion "inserts into editor" is a mismatch worth flagging.

---

### BUG-8 — Undo requires 2 button clicks for a single SQL edit operation
**Severity:** Low  
**Repro:** Replace the entire content of a SQL cell (e.g. select all + type new SQL). Click the Undo toolbar button once.  
**Effect:** Only part of the edit is undone on the first click. A second Undo click is needed to fully restore the original content.  
**Expected:** A single Undo click should reverse a single logical edit operation.
