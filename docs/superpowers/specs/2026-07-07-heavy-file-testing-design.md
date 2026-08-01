# Heavy-File Rigorous Testing — Design Spec

**Date:** 2026-07-07  
**Status:** Approved  
**Output:** `core/frontend/BUGS2.md`

---

## Goal

Exercise all major app areas against large JFR files using Playwright, document every bug and UX friction in `BUGS2.md` matching the severity taxonomy in `BUGS.md`.

---

## Test Files

| Tier    | File                            | Size  |
|---------|---------------------------------|-------|
| medium  | `.playwright-mcp/container.jfr` | 67 MB |
| medium  | `.playwright-mcp/medium.jfr`    | 90 MB |
| large   | `.playwright-mcp/large.jfr`     | 250 MB |

---

## Test Areas

### 1. File Loading & Import

- Load each file via `setInputFiles` on the hidden `input[type=file]`
- Assert progress indicator / loading state appears
- Assert notebook becomes ready (heading visible, SQL editor visible, schema sidebar populated)
- Measure and log wall-clock import time per file
- Test: switch to a second heavy file without reload — assert old schema clears and new schema loads

### 2. Schema Explorer

- Assert sidebar shows tables after each file load
- Expand a table node, assert column names visible
- Search/filter tables by name
- Check for overflow, truncation, or render errors

### 3. SQL Query Execution

- Run `SELECT * FROM <large_table> LIMIT 100`
- Run an aggregation query
- Run a query returning 0 rows
- Assert DataTable renders, row count shown, pagination works
- Assert cell error state on intentionally bad SQL (syntax error, nonexistent table)

### 4. Plot Rendering

- Add a plot cell on a large dataset query result
- Assert SVG chart appears within timeout
- Test brushing / zoom interaction
- Test plot with a column not suitable for the selected type (expect graceful error or fallback)

### 5. Variable Substitution

- Set `$session_start` / `$session_end` toolbar values
- Re-run a cell using those variables
- Assert query uses substituted values in DataTable output
- Test `$var` cell-local and `$$var` global scopes

### 6. Save / Load Round-Trip

- Execute a notebook with multiple cells (SQL + plot)
- Export notebook as Markdown
- Reload the page, drop the same JFR file, import the saved Markdown
- Assert cells restore and are runnable

### 7. Multi-Chunk JFR Specifics

- Verify tables from different chunks are merged (no `chunk0_*` tables visible in schema)
- Verify struct tables (Method, Class) are deduped (no duplicate rows on a `SELECT COUNT(*)`)
- Run a query joining merged tables

### 8. Error Resilience

- Drop an invalid file (e.g., a .txt renamed to .jfr) after a valid one is loaded
- Assert error toast / message appears
- Assert prior notebook state survives (cells still present, previous results intact)
- Drop a valid JFR after an error state — assert recovery works

### 9. Performance Stress

- Cancel a long-running query mid-execution (assert cancel button works, UI recovers)
- Open settings modal while import is in progress
- Collapse all cells with a large number of cells loaded

---

## Output Format

After all tests run, write `core/frontend/BUGS2.md` with:

- Header: date, test files used, import times measured
- One entry per bug/suggestion, using the severity taxonomy from BUGS.md:
  - 🔴 broken / data loss / crash
  - 🟠 surprising behavior / silently wrong
  - 🟡 mild UX friction
  - 🔵 nice-to-have

---

## Implementation File

`core/frontend/e2e/heavy-files.spec.ts`

Tests use `test.describe.serial` per file-tier group. File loading helpers are shared. Timeouts are extended for large files (120s import timeout).
