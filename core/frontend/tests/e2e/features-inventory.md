# JFR Query Notebook — Features & Workflows Inventory

Complete catalogue of every feature, plot type, DSL clause, and workflow found
in the application. Each entry maps to its test coverage and lists the test
scenario that exercises it (or notes the gap).

---

## 1. App Boot & File Loading

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| WASM mode boot | Drop `.jfr` file → DuckDB-WASM loads, app renders | — | `run.mjs` step 3 |
| `.duckdb` file drop | Drop a `.duckdb` snapshot | — | `run.mjs` step 2 |
| Demo mode (no file) | "Try the demo" button loads mock data | — | `test-workflows.mjs` boot |
| GC analysis template | "Open GC analysis notebook" loads full template | — | `test-features.mjs` |
| Server mode boot | App detects backend and skips file drop | — | `run.mjs` step 1 |
| Mode badge | Header shows WASM / Server chip | — | `run.mjs` step 4 |
| `$session_start` / `$session_end` chips | Auto-populated global vars from recording metadata; click to edit | — | scenario S-SV-1 |
| Sidebar table list | Sidebar shows tables + views after load | — | `run.mjs` step 5 |

---

## 2. Cell Lifecycle

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| Add cell | "+ Add Cell" footer button inserts new cell | — | `run.mjs` step 6, all workflow tests |
| Rename cell | Click h2 → inline input → Enter | — | `run.mjs` step 7, S-RT-1 |
| Delete cell | Delete button removes cell | — | `run.mjs` step 8 |
| Drag to reorder cell | Drag handle reorders cells | — | gap |
| Duplicate cell | Duplicate button copies cell content | — | gap |
| Collapse / expand cell | Chevron button collapses cell body | — | `run.mjs` step 9 |
| Collapse All / Expand All | Toolbar buttons collapse/expand all cells | — | scenario S-CELL-1 |
| Clear All Results | Toolbar button wipes all query results | — | scenario S-CELL-2 |
| Add Conclusion block | Per-cell "Add Conclusion" footer button | — | scenario S-CELL-3 |
| Add SQL / Plot / Prose inline | "+SQL" / "+Plot" / "+Prose" between blocks | — | scenario S-CELL-4 |
| Raw Markdown / Rich View toggle | Switch cell between rendered and raw edit modes | — | S-IF-1, S-MD-1 |
| Drag to resize results panel | Drag handle between SQL and results | — | gap |
| Cell-level error display | Red inline error when SQL fails | — | S-ERR-2 |

---

## 3. SQL Editor

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| CodeMirror 6 editor renders | `.cm-editor` / `.cm-content` contenteditable | — | `run.mjs` step 10 |
| SQL autocomplete — tables | Ctrl+Space after FROM completes table names | `completions.test.ts` | `run.mjs` step 11 |
| SQL autocomplete — columns | Column names complete after table alias | `completions.test.ts` | gap |
| Format SQL | "Format SQL" button pretty-prints query | — | gap |
| Copy SQL | "Copy SQL" button copies to clipboard | — | gap |
| Run cell (button) | ▶ button executes SQL | — | `run.mjs` step 12 |
| Run cell (keyboard) | Cmd+Enter runs query | — | `run.mjs` step 12 |
| Run All Queries | Toolbar "Run All Queries" re-runs every cell | — | gap |
| Auto-Run toggle | Header button enables/disables auto-run on variable change | — | scenario S-AR-1 |
| Cancel query | Cancel button stops in-flight query | — | recent commit fix test |
| Query result table | Results render in `<table>` with sortable columns | `dataTable.test.ts` | `run.mjs` step 15 |
| BigInt values display | BIGINT columns shown without "n" suffix | `dataTable.test.ts` | — |
| Duration formatting ⏱ | Columns with nanosecond values get ⏱ badge + human units | — | gap |
| Column sort | Click header sorts table | `dataTable.test.ts` | — |
| Table search | Search box filters displayed rows | — | gap |
| CSV export | "CSV ↓" button downloads table as CSV | — | scenario S-CSV-1 |
| Download as PNG | Camera icon exports plot as PNG | — | gap |
| Undo / Redo (⌘Z / ⇧⌘Z) | History state for notebook markdown | — | scenario S-UR-1 |
| Column chips above plot editor | Click chip copies column name into plot config | — | scenario S-CHIP-1 |

---

## 4. Variable Substitution

### 4a. Cell-local variables (`$name = value`)

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| Add variable | "Add variable" footer → `$newVar` input pair appears | — | `test-workflows.mjs` S1 |
| Variables CollapsibleBlock | Block starts collapsed; expand to see inputs | — | `test-workflows.mjs` S1 |
| `$x` in SQL | `SELECT $x AS val` substitutes local value | `notebookWorkflows.test.ts` | `test-workflows.mjs` S1, S-VAR-1 |
| `$limit` caps rows | `LIMIT $limit` returns ≤ limit rows | `notebookWorkflows.test.ts` | `test-workflows.mjs` S1 |
| Delete variable | × button removes var row | — | gap |
| Change var → auto-rerun | Editing value triggers re-execution when auto-run on | `notebookWorkflows.test.ts` | scenario S-AR-1 |
| Variable chip in SQL | Hovering `$limit` in SQL shows tooltip with current value | — | gap |

### 4b. Global notebook variables (`$$name`)

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| Add global var in Notebook Settings | "Add Variable" in settings panel | — | `test-workflows.mjs` S1 |
| `$$threshold` in SQL WHERE | `WHERE n > $$threshold` filters correctly | `notebookWorkflows.test.ts` | `test-workflows.mjs` S1, S-VAR-2 |
| `$session_start` / `$session_end` | Auto-seeded from JFR recording metadata | — | scenario S-SV-1 |
| Global var survives save/reload | Value persisted in `.md` frontmatter | `notebookWorkflows.test.ts` | `test-workflows.mjs` S6, S-RT-2 |

### 4c. Cross-cell variable references (`$CellName.varName`)

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| `$CellA.x` in cell B SQL | Cell B reads cell A's local variable | `notebookWorkflows.test.ts` | scenario S-XC-1 |
| `$CellA.brush.lo/.hi` | Brush variable propagated cross-cell | `complexScenarios.test.ts` | `test-workflows.mjs` S5, S-XC-2 |
| `$CellA.linkY` (LINK-Y click) | Bar click sets variable, downstream cell reads it | — | scenario S-XC-3 |

### 4d. Transitive / complex resolution

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| `$a = $b` chain | `$a = $b`, `$b = 42` → `$a` resolves `42` | `complexScenarios.test.ts` | gap |
| Local wins over global | cell `$x` shadows `$$x` | `complexScenarios.test.ts` | gap |

---

## 5. Conditional Blocks (`{if SELECT ...}`)

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| `{if SELECT 1}` shows body | Truthy condition renders block content | `complexScenarios.test.ts` | `test-workflows.mjs` S2, S-IF-1 |
| `{if SELECT 0}` hides body | Falsy condition hides block content | `complexScenarios.test.ts` | `test-workflows.mjs` S2 |
| Variable-gated condition | `{if SELECT count(*) > $threshold}` dynamic | `complexScenarios.test.ts` | `test-workflows.mjs` S2, S-IF-2 |
| Error in condition SQL | Bad SQL shows error indicator, not silent hide | `complexScenarios.test.ts` | `test-workflows.mjs` S2 |
| Round-trip persistence | `{if}` code fence preserved in saved `.md` | `notebookWorkflows.test.ts` | `test-workflows.mjs` S6 |

---

## 6. Scalar Inline Substitution (`{{SELECT ...}}`)

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| `{{SELECT 42}}` | Renders literal number in markdown | `complexScenarios.test.ts` | `test-workflows.mjs` S7, S-SC-1 |
| `{{SELECT count(*)}}` | Renders computed row count inline | `complexScenarios.test.ts` | `test-workflows.mjs` S7 |
| `{{expr}}` with variable | `{{SELECT $$threshold + 1}}` uses global var | — | scenario S-SC-2 |

---

## 7. Markdown Features

| Feature | Description | Unit | E2E test / scenario |
|---|---|---|---|
| GFM tables | Markdown tables render in prose blocks | — | scenario S-MD-1 |
| KaTeX math (`$...$` / `$$...$$`) | Math expressions rendered | — | scenario S-MD-2 |
| Code fences | Triple-backtick blocks render with syntax highlight | — | gap |
| `{if}` blocks | Conditional content (see §5) | — | — |
| `{{expr}}` substitution | Inline scalar substitution (see §6) | — | — |
| Heading hierarchy | H1–H4 render in prose blocks | — | gap |
| Links | `[text](url)` renders as anchor | — | gap |
| Cell name directive | `<!-- @cell name="..." -->` round-trips | `notebookWorkflows.test.ts` | gap |

---

## 8. Plot Types — Complete Parameter Matrix

Every plot type listed below. For each, the "render smoke" column refers to
`plotDataShapes.test.tsx`; "e2e config" is covered by `test-workflows.mjs` S3
or the scenario references below.

### 8a. BAR_CHART

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x` (required) | column name | ✓ | S-P-BAR-1 |
| `y` (required) | column array | ✓ | S-P-BAR-1 |
| `lineY` | column array (overlay lines) | — | S-P-BAR-2 |
| `layout` | `"grouped"` (default) / `"stacked"` | — | S-P-BAR-3, S-P-BAR-4 |
| `logScale` | `true` / `false` | ✓ NaN path | S-P-BAR-5 |
| `horizontal` | `true` / `false` | — | S-P-BAR-6 |
| `color` | column (group-by color) | — | S-P-BAR-7 |
| `TITLE "..."` | outer clause | ✓ unit | `test-workflows.mjs` S3 |
| `PALETTE "..."` | outer clause | — | `test-workflows.mjs` S3 |
| `LINK-Y "$var"` | outer clause (bar click) | — | `test-workflows.mjs` S3 |
| `BRUSH "$var" MODE X/Y` | outer clause | — | `test-workflows.mjs` S3, S5 |
| Multi-query (`ON 1, 2`) | `supportsMultiQuery: true` | — | S-P-MQ-1 |

### 8b. LINE_CHART

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x` (required) | column | ✓ | S-P-LINE-1 |
| `y` (required) | column array | ✓ | S-P-LINE-1 |
| `y2` | column array (right axis) | — | S-P-LINE-2 |
| `color` | column (group-by) | — | S-P-LINE-3 |
| `yScale` | `"linear"` / `"log"` | ✓ log path | S-P-LINE-4 |
| `y2Scale` | `"linear"` / `"log"` | — | gap |
| `yDomain` | `[min, max]` | — | gap |
| `y2Domain` | `[min, max]` | — | gap |
| `yAxisLabel` | string | — | gap |
| `y2AxisLabel` | string | — | gap |
| `lineType` | `"line"` / `"dots"` | — | S-P-LINE-5 |
| `connectNulls` | boolean | ✓ null path | S-P-LINE-6 |
| `xRefLines` | `[{value, label}]` | — | gap |
| `yRefLines` | `[{value, label}]` | — | gap |
| `xDomain` | `[min, max]` | — | gap |
| `LINK_X($a, $b)` | outer clause (zoom/pan) | — | S-P-LINE-7 |
| `BRUSH "$var" MODE X` | outer clause | — | `test-workflows.mjs` S3 |
| `AXIS-Y TYPE LOG` | outer clause | — | `test-workflows.mjs` S3 |
| `AXIS-Y LABEL "..."` | outer clause | — | S-P-LINE-8 |
| `AXIS-Y DOMAIN [lo,hi]` | outer clause | — | gap |
| LTTB decimation (≥1000 pts) | auto-decimated | ✓ large-dataset | gap |
| Drag-to-pan | hold no key + drag on chart | — | S-P-LINE-7 |
| Shift+scroll to zoom | shift + wheel | — | S-P-LINE-7 |

### 8c. AREA_CHART

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x`, `y` (required) | columns | — | S-P-AREA-1 |
| `layout` | `"overlay"` / `"stacked"` | — | S-P-AREA-2 |
| `color` | column | — | gap |
| `connectNulls` | boolean | — | gap |
| `BRUSH "$var" MODE X` | outer clause | — | S-P-AREA-3 |
| LTTB decimation | auto-decimated | ✓ large-dataset | gap |

### 8d. SCATTER_PLOT

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x`, `y` (required) | columns | ✓ | S-P-SCAT-1 |
| `size` | numeric column (bubble size) | — | S-P-SCAT-2 |
| `color` | column (group-by) | — | S-P-SCAT-3 |
| `BRUSH "$var" MODE XY` | outer clause | — | S-P-SCAT-4 |

### 8e. PIE_CHART

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `category` (required) | column | ✓ | S-P-PIE-1 |
| `value` (required) | numeric column | ✓ | S-P-PIE-1 |
| `innerRadius` | `0`–`1` (0 = pie, 0.5 = donut) | — | S-P-PIE-2 |
| `sliceLabel` | `"inside"` / `"outside"` / `"none"` | — | S-P-PIE-3 |

### 8f. HISTOGRAM

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x` (required) | numeric column | ✓ | S-P-HIST-1 |
| `bins` | integer or `"auto"` | ✓ | S-P-HIST-2 |
| `logBins` | boolean | — | S-P-HIST-3 |
| Zero-variance (all same value) | — | ✓ zero-variance | gap |

### 8g. BOX_PLOT

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `value` (required) | numeric column | ✓ | S-P-BOX-1 |
| `category` / `color` | grouping column | — | S-P-BOX-2 |
| Degenerate (1 value / same value) | — | ✓ | gap |

### 8h. HEATMAP

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x`, `y` (required) | category columns | ✓ null path | S-P-HEAT-1 |
| `value` (required) | numeric column | ✓ | S-P-HEAT-1 |

### 8i. TABLE

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| (no required params) | — | ✓ | S-P-TABLE-1 |
| BigInt cells | — | ✓ BigInt | gap |
| 1k-row virtualization | — | ✓ large-dataset | gap |

### 8j. FLAMEGRAPH / FLAME_GRAPH (alias)

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `frames` (required) | semicolon-separated stack string column | — | S-P-FLAME-1 |
| `value` (required) | numeric weight column | — | S-P-FLAME-1 |
| `minFrameWidth` | number (% threshold) | — | gap |
| `search` | regex string | — | S-P-FLAME-2 |
| Click to zoom frame | interactive | — | S-P-FLAME-3 |

### 8k. GANTT

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `start`, `end` (required) | time/numeric columns | — | S-P-GANTT-1 |
| `lane` (required) | category column | — | S-P-GANTT-1 |
| `color` | column | — | S-P-GANTT-2 |

### 8l. RANGE

| Parameter | Values | Render smoke | E2E scenario |
|---|---|---|---|
| `x` (required) | column | — | S-P-RANGE-1 |
| `y`, `yLow`, `yHigh` (required) | numeric columns | — | S-P-RANGE-1 |
| `color` | CSS color string | — | gap |

---

## 9. Composite Layout DSL

| Syntax | Description | Unit | E2E scenario |
|---|---|---|---|
| `ROW(A, B)` | Horizontal flex, 2 children | `plotComposite` | `test-workflows.mjs` S4, S-COMP-1 |
| `ROW(A, B, C)` | 3 children | `plotComposite` | S-COMP-2 |
| `COL(A, B)` | Vertical flex | `plotComposite` | `test-workflows.mjs` S4, S-COMP-3 |
| `A + B` overlay | Absolute-positioned overlay | `plotComposite` | `test-workflows.mjs` S4, S-COMP-4 |
| `A + B + C` overlay | 3-child overlay | `plotComposite` | S-COMP-5 |
| `ROW(COL(A, B), C)` | 2-level nesting | `plotComposite` | `test-workflows.mjs` S4 |
| `COL(ROW(A,B), ROW(C,D))` | 2×2 grid | `plotComposite` | S-COMP-6 |
| Overlay inside ROW | `ROW(A+B, C)` | `plotComposite` | S-COMP-7 |
| 3-level nesting | `ROW(COL(A+B, C), D)` | `plotComposite` | S-COMP-8 |
| Broken child → red error box | Error isolation | `plotComposite` | `test-workflows.mjs` S8 |
| Categorical+continuous overlay | BAR + LINE overlay | `plotComposite` | S-COMP-9 |
| ROW with LINK_X sync | Overlay + zoom sync | — | S-COMP-10 |

---

## 10. Cross-Cutting Plot Clauses (all chart types)

| Clause | Syntax | Description | E2E scenario |
|---|---|---|---|
| `TITLE` | `TITLE "text"` | Chart title above plot | `test-workflows.mjs` S3 |
| `PALETTE` | `PALETTE "category10"` | d3 color scheme | `test-workflows.mjs` S3 |
| `LINK-Y` | `LINK-Y "$var"` | Bar/point click sets `$var` | `test-workflows.mjs` S3, S-XC-3 |
| `LINK_X` | `LINK_X($lo, $hi)` | Drag-to-pan + zoom, sets range vars | S-P-LINE-7 |
| `BRUSH MODE X` | `BRUSH "$var" MODE X` | X-range brush → `.brush.lo`/`.hi` | `test-workflows.mjs` S3, S5 |
| `BRUSH MODE Y` | `BRUSH "$var" MODE Y` | Y-range brush | S-P-BRUSH-Y |
| `BRUSH MODE XY` | `BRUSH "$var" MODE XY` | 2D brush | S-P-BRUSH-XY |
| `AXIS-Y TYPE LOG` | `AXIS-Y TYPE LOG` | Log Y scale | `test-workflows.mjs` S3 |
| `AXIS-Y TYPE LINEAR` | `AXIS-Y TYPE LINEAR` | Force linear override | gap |
| `AXIS-Y LABEL "..."` | `AXIS-Y LABEL "ms"` | Y-axis label | S-P-LINE-8 |
| `AXIS-Y DOMAIN [lo,hi]` | `AXIS-Y DOMAIN [0,100]` | Force Y domain | gap |
| `AXIS-X LABEL "..."` | `AXIS-X LABEL "time"` | X-axis label | gap |
| `TOOLTIP COLUMNS [a,b]` | `TOOLTIP COLUMNS ["col1","col2"]` | Custom tooltip columns | S-TOOLTIP-1 |
| `ON HOVER TOOLTIP "..."` | `ON HOVER TOOLTIP "val: {col}"` | Templated tooltip text | gap |

---

## 11. Multi-Query Plot (`ON 1, 2`)

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| `BAR_CHART(...) ON 1, 2` | Merges data from two SQL blocks | — | S-P-MQ-1 |
| `LINE_CHART(...) ON 1, 2, 3` | Three SQL sources | — | S-P-MQ-2 |
| `AREA_CHART(...) ON 1, 2` | Stacked areas from two queries | — | S-P-MQ-3 |
| `PIE_CHART(...) ON 1, 2` | Segments from multiple queries | — | gap |

---

## 12. Save / Load / Round-trip

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| Save notebook | Download `.md` with all cells | — | `run.mjs` step 23, `test-workflows.mjs` S6 |
| Load notebook | Upload `.md` restores cells | — | `run.mjs` step 24, `test-workflows.mjs` S6 |
| Global edit raw markdown | "Edit Raw Markdown" toolbar → full `.md` in one editor | — | scenario S-RT-3 |
| Cell content round-trip | Title + SQL preserved | `notebookWorkflows.test.ts` | `test-workflows.mjs` S6, S-RT-1 |
| Global var round-trip | `$$name=value` in frontmatter | `notebookWorkflows.test.ts` | `test-workflows.mjs` S6, S-RT-2 |
| Cell-local var round-trip | `$name=value` in cell | `notebookWorkflows.test.ts` | S-RT-4 |
| Frontmatter YAML block | Saved `.md` opens with `---` block | — | `test-workflows.mjs` S6 |
| `{if}` block round-trip | Conditional code fence preserved | `notebookWorkflows.test.ts` | `test-workflows.mjs` S6 |
| `{{expr}}` round-trip | Scalar substitution preserved | — | S-RT-5 |
| Cell name directive round-trip | `<!-- @cell name="..." -->` | `notebookWorkflows.test.ts` | gap |
| Plot DSL clause round-trip | `BRUSH`, `LINK_X`, `PALETTE` etc in saved `.md` | — | S-RT-6 |
| Composite layout round-trip | `ROW(...)` preserved | — | S-RT-6 |
| Undo / Redo after edit | History survives multi-step edit sequence | — | scenario S-UR-1 |

---

## 13. Sidebar & Schema Explorer

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| Tables list | Shows all JFR tables | — | `run.mjs` step 5 |
| Views list | Shows named views | — | S-SB-1 |
| Macros list (27 macros) | `after_gc`, `time_bucket`, `rolling_avg`, etc. | — | S-SB-2 |
| Search schema | Filter tables/columns by name | — | S-SB-3 |
| Click table → preview | Preview table in sidebar bottom panel | — | S-SB-4 |
| Sort by row count | Sort button in Tables header | — | gap |
| Sort alphabetically | Sort button in Tables header | — | gap |
| Show Internal Views | Toggle button in Views header | — | gap |
| Show Search in Preview | Toggle search input in preview panel | — | gap |
| Show Query Editor in Preview | Toggle editor in preview panel | — | S-SB-5 |
| Sidebar collapse | "Collapse sidebar" button hides sidebar | — | `run.mjs` step 26 |
| Resize sidebar | Drag divider to resize | — | gap |

---

## 14. Toolbar & Header Actions

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| Undo (⌘Z) | Revert last notebook edit | — | S-UR-1 |
| Redo (⇧⌘Z) | Re-apply reverted edit | — | S-UR-1 |
| Enable / Disable Auto-Run | Toggle auto-execution on variable change | — | S-AR-1 |
| Run All Queries | Re-run every SQL block | — | gap |
| Collapse All cells | — | — | S-CELL-1 |
| Expand All cells | — | — | S-CELL-1 |
| Clear All Results | Wipes all tables/charts | — | S-CELL-2 |
| Load Notebook | Upload `.md` | — | `run.mjs` step 24 |
| New from template | Opens template gallery modal | — | `test-features.mjs` |
| New GC Analysis Notebook | One-click GC template | — | `run.mjs` step 27 |
| Save Notebook | Downloads `.md` | — | `run.mjs` step 23 |
| Edit Raw Markdown | Entire notebook in one CodeMirror | — | S-RT-3 |
| Presenter Mode | Hides all editors, shows read-only | — | S-PRES-1 |
| Settings modal | AI provider, display, model config | — | `run.mjs` step 28 |

---

## 15. Settings Modal

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| AI Provider selection | Anthropic / Google Gemini / Browser (WebLLM) | — | `run.mjs` step 28 |
| API key input | Anthropic / Google credential fields | — | gap |
| AI Data Visibility | Controls how much query data AI sees | — | gap |
| Display settings | Font size, theme, etc. | — | gap |
| Model Configuration | Default model selection | — | gap |
| Per-Feature Models | Different model per feature | — | gap |
| Cancel / Save & Reload | Settings apply on save | — | gap |

---

## 16. AI / Chat Features

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| Inline chat (per-cell) | Click speech-bubble → InlineChat bar | — | `test-features.mjs` |
| Cancel InlineChat | Cancel button stops in-flight AI call | — | recent commit fix test |
| Pop InlineChat to sidebar | → opens ChatPanel with history | — | gap |
| ChatPanel (notebook AI) | Notebook-wide assistant panel | — | `test-features.mjs` |
| AI generates SQL | AI writes a SELECT and applies it | — | gap |
| AI generates plot | AI writes a plot config and applies it | — | gap |
| AI adds cell | AI creates a new cell | — | gap |
| Screenshot plot | Camera icon on plot → AI screenshot tool | — | gap |

---

## 17. Presenter Mode

| Feature | Description | Unit | E2E scenario |
|---|---|---|---|
| Hides all editors | SQL and plot editors hidden | — | S-PRES-1 |
| Shows only rendered output | Tables and charts visible | — | S-PRES-1 |
| Collapse All active | Good default for presenting | — | S-PRES-1 |
| Toggle back to edit mode | Click Presenter Mode again | — | S-PRES-1 |

---

## 18. Complex Workflow Scenarios (to be implemented as e2e tests)

These are multi-step scenarios that each exercise several features together.
They are the primary gap between the current unit tests and real-world usage.

---

### S-VAR-1: Cell-local variable drives chart filtering
1. Add cell "VarFilter". SQL: `SELECT cause, count(*) AS n FROM GarbageCollection GROUP BY cause`.
2. Add `$min_count = 3` variable.
3. Edit SQL to `… HAVING n >= $min_count`. Run.
4. Assert table shows only rows where n ≥ 3.
5. Change `$min_count` to `1`. Assert more rows appear.
6. Plot: `BAR_CHART(x: "cause", y: ["n"])`. Assert chart renders without error.

### S-VAR-2: Global `$$session_start` / `$$session_end` in time-range query
1. Note `$session_start` and `$session_end` chip values in header (e.g. "15 Mar, 11:00").
2. Add cell "TimeRange". SQL uses:
   ```sql
   SELECT startTime, duration FROM GarbageCollection
   WHERE startTime BETWEEN $$session_start AND $$session_end
   ```
3. Run. Assert results have rows with startTime in that range.
4. Chart: `LINE_CHART(x: "startTime", y: ["duration"])`. Assert chart renders.

### S-XC-1: Cross-cell variable — cell A sets `$threshold`, cell B reads `$CellA.threshold`
1. Add cell "ThresholdCell". Add variable `$threshold = 10`.
2. Add cell "FilteredCell". SQL:
   ```sql
   SELECT * FROM GarbageCollection WHERE duration * 1000 > $ThresholdCell.threshold
   ```
3. Run FilteredCell. Assert results show only rows with duration_ms > 10.
4. Change `$threshold` to `100` in ThresholdCell. Re-run FilteredCell.
5. Assert fewer rows in result.

### S-XC-2: Brush on chart A filters table in cell B
1. Add cell "BrushCell". SQL: `SELECT startTime AS t, duration*1000 AS ms FROM GarbageCollection ORDER BY t`.
2. Plot: `LINE_CHART(x: "t", y: ["ms"]) BRUSH "$rng" MODE X`.
3. Add cell "BrushFiltered". SQL:
   ```sql
   SELECT t, ms FROM (
     SELECT startTime AS t, duration*1000 AS ms FROM GarbageCollection
   ) WHERE t >= $BrushCell.rng.brush.lo OR $BrushCell.rng.brush.lo IS NULL
   ```
4. Drag brush on chart in BrushCell (left 30% → right 60%).
5. Assert BrushFiltered table has fewer rows than full result.

### S-XC-3: LINK-Y bar click drives downstream query
1. Add cell "LinkSource". SQL: `SELECT cause, count(*) AS n FROM GarbageCollection GROUP BY cause`.
2. Plot: `BAR_CHART(x: "cause", y: ["n"]) LINK-Y "$selectedCause"`.
3. Add cell "LinkDest". SQL:
   ```sql
   SELECT startTime, duration FROM GarbageCollection
   WHERE cause = $LinkSource.selectedCause OR $LinkSource.selectedCause IS NULL
   ```
4. Click one bar (e.g., "G1 Evacuation Pause").
5. Assert LinkDest re-runs and shows only rows for that cause.

### S-IF-1: Conditional block driven by query result
1. Add cell "CondCell" in Raw Markdown mode.
2. Set content:
   ```
   ```{if SELECT count(*) > 5 FROM GarbageCollection WHERE cause='G1 Concurrent GC'}
   ## Warning: more than 5 Concurrent GC events detected
   ```
   ```
3. Switch to Rich View. Assert "Warning:" heading is visible (demo data has 3 concurrent GC events — adjust threshold to match).

### S-IF-2: `{if}` block gated on cell variable
1. Add cell "IfVarCell". Add `$warn_threshold = 5`.
2. In Raw Markdown:
   ```
   ```{if SELECT count(*) >= $warn_threshold FROM GarbageCollection}
   ## Threshold exceeded
   ```
   ```
3. Set threshold to 100 → block hidden.
4. Set threshold to 1 → block visible.

### S-SC-1: Inline scalar substitution in summary prose
1. Add cell "ScalarCell" in Raw Markdown.
2. Content:
   ```
   Total GC events: **{{SELECT count(*) FROM GarbageCollection}}**
   Longest pause: **{{SELECT round(max(duration)*1000,1) FROM GarbageCollection}} ms**
   ```
3. Switch to Rich View. Assert both `{{` placeholders are replaced with numbers.

### S-SC-2: Scalar substitution with global variable
1. Set `$$cause = 'G1 Concurrent GC'` in Notebook Settings.
2. Add cell in Raw Markdown:
   ```
   Concurrent GC count: **{{SELECT count(*) FROM GarbageCollection WHERE cause='$$cause'}}**
   ```
3. Assert rendered value is numeric (3 for demo data).

### S-MD-1: Rich prose with table, code block, KaTeX
1. Add cell in Raw Markdown.
2. Content includes:
   ```markdown
   | Col A | Col B |
   |---|---|
   | foo | 42 |

   `SELECT 1` returns one row.

   Inline math: $E = mc^2$
   ```
3. Switch to Rich View. Assert table renders, `<code>` block renders, math renders.

### S-RT-1: Save → reload preserves complex cell with all features
1. Add cell named "Complex". Add `$limit = 5`. SQL uses `$limit`. Plot is `BAR_CHART` with `TITLE "My Chart" PALETTE "category10"`.
2. Save notebook.
3. Reload page, re-drop JFR file.
4. Load saved `.md`.
5. Assert: cell named "Complex" exists, SQL has `$limit`, plot editor shows `BAR_CHART`, chart renders.

### S-RT-2: Global vars survive save → reload
1. Add `$$cause_filter = 'G1 Evacuation Pause'` in Notebook Settings.
2. Add cell using `WHERE cause = $$cause_filter`. Run.
3. Save → reload → load `.md`.
4. Assert `$$cause_filter` visible in Notebook Settings with value `'G1 Evacuation Pause'`.
5. Assert cell SQL runs without error.

### S-RT-3: Edit Raw Markdown → save → reload
1. Click "Edit Raw Markdown" in toolbar.
2. Append a new cell block manually in the single editor:
   ```markdown
   ## Raw Edit Cell

   ```sql
   SELECT 'raw_edit' AS source
   ```
   ```
3. Save. Reload. Load. Assert "Raw Edit Cell" h2 appears.

### S-RT-4: Cell-local var + cross-cell ref survive round-trip
1. Cell A "SourceCell": `$x = 42`.
2. Cell B "DestCell": SQL `SELECT $SourceCell.x AS result`.
3. Save → reload → load.
4. Run DestCell. Assert result row shows `42`.

### S-RT-5: `{{scalar}}` and `{if}` blocks survive save → reload
1. Add cell with `{{SELECT 99}}` in prose and `{if SELECT 1}\nVISIBLE\n` block.
2. Save → reload → load.
3. Assert `99` rendered and "VISIBLE" text present.

### S-RT-6: Plot clauses survive round-trip
1. Add cell with `LINE_CHART(x:"t", y:["v"]) BRUSH "$b" MODE X TITLE "Round-trip" PALETTE "category10"`.
2. Save → reload → load.
3. Assert plot editor shows all four clauses intact.

### S-AR-1: Auto-run on variable change
1. Enable Auto-Run (toolbar toggle active).
2. Add cell with `SELECT $n AS result`. Add `$n = 10`. Run.
3. Change `$n` to `20` (blur input).
4. Without clicking Run, assert table updates to show `20`.

### S-CELL-1: Collapse All / Expand All
1. Open demo with ≥ 3 cells.
2. Click "Collapse All". Assert no `.cm-editor` visible in any cell body.
3. Click "Expand All". Assert editors visible again.

### S-CELL-2: Clear All Results
1. Run all cells so tables/charts are visible.
2. Click "Clear All Results".
3. Assert no `<table>` or `.recharts-wrapper` visible.

### S-CELL-3: Add Conclusion block
1. Click "Add Conclusion" on a cell.
2. Assert a new prose block (`.cm-editor` in markdown mode or rendered area) appears below the cell's SQL.

### S-CELL-4: Add SQL / Plot / Prose inline
1. In a cell with one SQL block, click "+ Plot".
2. Assert a new plot editor appears after the SQL.
3. Click "+ SQL". Assert another SQL editor appears.
4. Click "+ Prose". Assert a markdown editor appears.

### S-SB-1: Sidebar views list
1. Open sidebar. Assert "Views" section shows `heap-committed-vs-used`, `gc-top-pauses`, etc.
2. Click `gc-top-pauses`. Assert Preview panel updates to show rows.

### S-SB-2: Macros list
1. Sidebar shows 27 macros. Click `time_bucket`. Assert Preview panel shows macro SQL.

### S-SB-3: Search schema
1. Type `duration` in schema search. Assert only tables/columns containing "duration" are shown.

### S-SB-4: Click table → preview
1. Click `GarbageCollection` in sidebar. Assert Preview panel shows table rows.

### S-SB-5: Show Query Editor in preview
1. Click "Show Query Editor" button in preview panel. Assert a SQL editor appears in the preview.

### S-CSV-1: CSV export
1. Run a query that returns a table.
2. Click "CSV ↓". Assert a `.csv` file is downloaded.
3. Assert downloaded content contains the expected column headers.

### S-UR-1: Undo / Redo
1. Add cell "UndoTest". SQL: `SELECT 1`.
2. Edit SQL to `SELECT 2`. Verify change.
3. Press ⌘Z (Undo). Assert SQL reverts to `SELECT 1`.
4. Press ⇧⌘Z (Redo). Assert SQL returns to `SELECT 2`.

### S-CHIP-1: Column chip click inserts into plot editor
1. Run SQL `SELECT cause, duration FROM GarbageCollection LIMIT 1`.
2. Click "cause" chip above the plot editor.
3. Assert plot editor now contains the string `cause`.

### S-PRES-1: Presenter Mode
1. Click "Presenter Mode" in toolbar.
2. Assert no `.cm-editor` visible.
3. Assert rendered tables / charts are still visible.
4. Click "Presenter Mode" again. Assert editors reappear.

### S-SV-1: `$session_start` / `$session_end` session chips
1. After loading demo data, assert header shows two chips: `$session_start` and `$session_end`.
2. Click a chip. Assert its value changes to edit mode.
3. Edit value. Assert global variable updates.

---

## 19. Plot Combination Scenarios (composite + clauses together)

### S-COMP-1: ROW of heterogeneous plot types
```
ROW(
  BAR_CHART(x:"cause", y:["n"]) TITLE "GC Causes",
  PIE_CHART(category:"cause", value:"n") TITLE "Cause Share"
)
```
Assert: 2 flex children, both render, no errors.

### S-COMP-2: ROW with 3 children
```
ROW(
  LINE_CHART(x:"t", y:["ms"]),
  HISTOGRAM(x:"ms", bins:10),
  BOX_PLOT(value:"ms", category:"cause")
)
```
Assert: 3 charts visible, none zero-width.

### S-COMP-3: COL(table, chart)
```
COL(
  TABLE(),
  BAR_CHART(x:"cause", y:["n"])
)
```
Assert: table above chart, flex-direction:column.

### S-COMP-4: Overlay BAR + LINE (mixed series)
```
BAR_CHART(x:"cause", y:["n"]) + LINE_CHART(x:"cause", y:["avg_ms"])
```
Assert: position:relative container, both plot types render.

### S-COMP-5: 3-child overlay
```
BAR_CHART(x:"cause", y:["n"]) + LINE_CHART(x:"cause", y:["avg_ms"]) + AREA_CHART(x:"cause", y:["max_ms"])
```

### S-COMP-6: 2×2 grid
```
COL(
  ROW(BAR_CHART(x:"cause", y:["n"]), LINE_CHART(x:"t", y:["ms"])),
  ROW(HISTOGRAM(x:"ms"), BOX_PLOT(value:"ms"))
)
```
Assert: 4 charts, both flex directions present.

### S-COMP-7: Overlay inside ROW
```
ROW(
  BAR_CHART(x:"cause", y:["n"]) + LINE_CHART(x:"cause", y:["avg_ms"]),
  SCATTER_PLOT(x:"ms", y:"n")
)
```

### S-COMP-8: 3-level nesting
```
ROW(
  COL(
    BAR_CHART(x:"cause", y:["n"]) + LINE_CHART(x:"cause", y:["avg_ms"]),
    HISTOGRAM(x:"ms", bins:8)
  ),
  PIE_CHART(category:"cause", value:"n")
)
```

### S-COMP-9: Categorical+continuous overlay (BAR + AREA)
BAR is categorical; AREA is continuous — overlay should show a warning or render both.

### S-COMP-10: ROW with LINK_X sync across LINE charts
```
ROW(
  LINE_CHART(x:"t", y:["ms"]) LINK_X($lo, $hi),
  LINE_CHART(x:"t", y:["heapUsed"]) LINK_X($lo, $hi)
)
```
Drag to pan on one chart → other chart pans in sync.

---

## 20. Bugs Found During Investigation

| # | Bug | Where found | Covered by test? |
|---|---|---|---|
| B-001 | Variables CollapsibleBlock starts collapsed after `handleAddVariable` — new var not visible until block toggled | `NotebookCell.tsx:387`, `CollapsibleBlock.tsx` | `test-workflows.mjs` S1 addCellVar helper |
| B-002 | Cell-local var inputs have no `placeholder` attribute — `input[placeholder="$name"]` selector returns nothing | `NotebookCell.tsx` | Fixed in helpers |
| B-003 | "Add Cell" button at y≈2878 off-screen in 1000px viewport — click fails without scroll | all e2e files | Fixed: `scrollIntoViewIfNeeded()` |
| B-004 | `runCellSql(n)` always targeted 1st run button globally — wrong cell after many adds | `test-workflows.mjs` | Fixed: `Math.min(cellNth, count-1)` |
| B-005 | Browser process closes mid-run when test helper throws — all subsequent tests fail with "Target page…closed" | `test-workflows.mjs` main() | Needs: try/catch in main to keep browser alive |
| B-006 | Global var input has `placeholder="$$name"` but old code used `placeholder="$name"` — selector mismatch | `SettingsPanel.tsx:185` | Fixed in `addGlobalVar` helper |
| B-007 | Nested ROW(COL(a,b), c) — only 2 chart containers found due to paint timing | `test-workflows.mjs` S4 | Fixed: `waitForTimeout(2000)` |
| B-008 | `LINK-Y` clause: clicking a bar does not trigger re-run in downstream cell unless auto-run is enabled | Live observation | scenario S-XC-3 |

---

## 21. Coverage Gaps (No Tests Yet)

- `ON HOVER TOOLTIP "..."` clause
- `TOOLTIP COLUMNS [...]` clause
- `AXIS-X LABEL / DOMAIN` clause
- `AXIS-Y DOMAIN [lo, hi]` clause
- `LINK_X` drag-to-pan interaction (S-P-LINE-7)
- `BRUSH MODE Y` and `BRUSH MODE XY`
- Transitive variable chain (`$a = $b = $c`)
- Local-wins-over-global var scope
- Custom views added in Settings surviving reload
- Cell move up/down drag reorder
- Cell duplicate
- Query history interactions
- Format SQL button
- "Download as PNG" for plot
- Schema search
- Show Internal Views toggle
- Sidebar macro click → preview
- Undo/Redo multi-step sequence
- Auto-Run on variable change
- Presenter Mode
- Multi-query `ON 1, 2` syntax
- FLAMEGRAPH click-to-zoom
- GANTT rendering
- RANGE plot
- `lineType: "dots"` LINE_CHART
- `connectNulls` AREA_CHART
- `logBins` HISTOGRAM
- `innerRadius` PIE_CHART donut
- BOX_PLOT with `category` grouping
- Multi-browser (Firefox, WebKit)
- Real backend / server mode

---

*Last updated: 2026-06-29. Generated from source audit (`components/plots/`, `utils/plotParser.ts`, `App.tsx`) and live Playwright exploration of the demo app.*
