# Complete Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub docs-site pages with complete, accurate reference documentation for the notebook format, plot DSL, variable system, and all built-in views and macros.

**Architecture:** Pure documentation — create/modify Markdown files in docs-site/, update mkdocs.yml nav, verify with mkdocs build --strict.

**Tech Stack:** MkDocs Material, Markdown

---

## Task 1: Update `mkdocs.yml` nav

- [ ] Open `mkdocs.yml` at the repo root.
- [ ] Replace the existing `nav:` block with:

```yaml
nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Usage:
    - CLI Commands: cli.md
    - Web UI & Notebooks: web-ui.md
  - Reference:
    - Notebook Format: notebook-format.md
    - Plot DSL: plot-dsl.md
    - Variables: variables.md
    - Built-in Views & Macros: views-macros.md
  - Live App: https://parttimenerd.github.io/jfr-query/
```

- [ ] Do not modify any other keys in `mkdocs.yml` (theme, plugins, markdown_extensions, etc. stay as-is).

---

## Task 2: Update `docs-site/web-ui.md`

- [ ] Overwrite `docs-site/web-ui.md` with the following content. Keep any existing high-level intro paragraphs already in the file *if and only if* they are still accurate; otherwise use this content verbatim. If uncertain, use this content verbatim.

```markdown
# Web UI & Notebooks

The jfr-query web UI is a browser-based notebook environment for analysing Java Flight Recorder (JFR) files using SQL, DuckDB, and a declarative plot DSL.

Open a notebook, drop a `.jfr` file, and start writing SQL cells that query the recording. Each cell can render a table or one or more plots described with the plot DSL.

## Layout

- **Left sidebar** — file explorer, variable controls, schema browser, and AI chat.
- **Main area** — the notebook itself: a stack of cells with SQL, plots, and Markdown.
- **Right rail** — issues panel, dependency graph overlay, and cell metadata.
- **Top bar** — recording selector, workspace globals, baseline attach.

## Cells

A cell is a self-contained unit that can contain:

- Markdown prose (rendered on the fly).
- One or more `sql` code blocks (executed against DuckDB).
- One or more `plot` code blocks (rendered from the query results).
- Inline scalar expressions `${...}` embedded in Markdown.
- Conditional blocks that only render when a SQL predicate holds.

Cells are separated by an HTML comment delimiter:

```html
<!-- @cell name=my_handle -->
```

The `name=` attribute gives the cell a stable handle that can be referenced from other cells and from `cellConditions` in the front matter.

## Working with data

1. Drop a `.jfr` file onto the sidebar or use the file ingest UI.
2. jfr-query parses the recording into DuckDB tables. The schema browser lists every event type and column.
3. Write a SQL cell. Aliases (`-- alias name`) let downstream cells and plots reference the result set by name.
4. Add a plot cell using the plot DSL. By default a plot uses the query immediately preceding it.

## Live coupling

Interactive plots write back to variables:

- `BRUSH $var MODE X` writes the selected X range to `$var.lo` / `$var.hi`.
- `ON HOVER TOOLTIP "..."` can update variables that downstream SQL cells read.

When a variable changes, dependent SQL cells re-run automatically, and their plots re-render.

## Reference documentation

For complete reference material see:

- [Notebook Format](notebook-format.md) — front matter, cell delimiters, SQL blocks, inline scalars, conditional blocks, variable blocks.
- [Plot DSL](plot-dsl.md) — all plot types, inner arguments, tail clauses, composite plots, query references.
- [Variables](variables.md) — cell-local and notebook-level variables, substitution rules, live coupling.
- [Built-in Views & Macros](views-macros.md) — every canned view and macro shipped with jfr-query.
```

---

## Task 3: Create `docs-site/notebook-format.md`

- [ ] Write the following exact content to `docs-site/notebook-format.md`:

```markdown
# Notebook Format

A jfr-query notebook is a single Markdown file with optional YAML front matter, cell delimiters, SQL blocks, plot blocks, inline scalars, conditional blocks, and variable blocks.

This page is the complete reference for every construct the parser understands.

## File shape

```
---
title: My Notebook
description: A short description
---

Markdown prose can appear before the first cell delimiter and belongs to an implicit intro cell.

<!-- @cell name=first_cell -->

More markdown, SQL blocks, and plot blocks belong to `first_cell`.

<!-- @cell name=second_cell -->

...
```

## Front matter

The front matter is standard YAML between two `---` fences at the top of the file. All fields are optional.

| Field | Type | Purpose |
|-------|------|---------|
| `title` | string | Display title of the notebook. |
| `description` | string | Short description shown in listings. |
| `tags` | list of strings | Free-form tags. |
| `license` | string | SPDX identifier or free text. |
| `decimalPlaces` | integer | Default number of decimals when formatting scalars and table cells. |
| `timeFormat` | string | Default time format token (e.g. `iso`, `relative`, `HH:mm:ss.SSS`). |
| `variables` | map | Notebook-level variables, keyed by `$$name`. Values are strings, numbers, booleans, or ISO datetime strings. |
| `views` | list of `{name, sql}` | Custom views available to every SQL cell. |
| `macros` | list of `{name, sql}` | Custom macros available to every SQL cell. |
| `cellConditions` | map | Visibility conditions per cell handle. Value is a SQL predicate. |
| `customSystemPrompt` | string | Custom AI system prompt for the chat panel. |

### Example

```yaml
---
title: GC Overview
description: Baseline analysis of GC pause behaviour
tags: [gc, pauses, baseline]
license: MIT
decimalPlaces: 3
timeFormat: relative
variables:
  $$threshold: 100
  $$window_start: "2024-01-01T00:00:00Z"
views:
  - name: long_pauses
    sql: |
      SELECT * FROM gc WHERE duration_ms > $$threshold
macros:
  - name: over_threshold
    sql: "duration_ms > $$threshold"
cellConditions:
  detail_cell: "SELECT COUNT(*) > 0 FROM long_pauses"
customSystemPrompt: |
  You are analysing GC pauses. Prefer P95 and P99 over averages.
---
```

## Cell delimiters

Cells are delimited by an HTML comment:

```html
<!-- @cell name=my_handle -->
```

- `name=` is required. The handle must match `[A-Za-z_][A-Za-z0-9_-]*`.
- Cells are ordered top-to-bottom in the file.
- Content before the first delimiter belongs to an implicit intro cell.

Cell handles are used by:

- `cellConditions` in the front matter.
- Cross-cell plot references (`cell_handle.alias_name`).
- Cell-scoped variables (`$name` is scoped to its declaring cell).

## SQL blocks

A SQL block is a fenced code block with the `sql` info string:

````
```sql
-- alias my_alias
SELECT * FROM gc LIMIT 10
```
````

### Aliases

The first line of a SQL block may be an alias comment:

```
-- alias my_alias
-- alias my_alias materialized
```

- `-- alias my_alias` — makes the query result addressable as `my_alias` from plot references and from other SQL cells.
- `-- alias my_alias materialized` — same, but forces the result to be materialised (cached) rather than re-executed on demand.

A cell can contain multiple SQL blocks. Aliases must be unique within a notebook.

### Referencing queries from SQL

Any aliased query can be used as a table in another SQL cell:

```sql
SELECT AVG(duration_ms) FROM my_alias
```

Cross-cell references use dotted notation:

```sql
SELECT * FROM other_cell.my_alias
```

## Inline scalars

Inline scalar expressions embed a SQL scalar into Markdown:

```
The recording contains ${SELECT COUNT(*) FROM gc} GC events.
Longest pause: ${SELECT MAX(duration_ms) FROM gc | duration_ms}.
```

The value between `${` and `}` is a full SQL query that must return a single scalar.

An optional format suffix follows a `|`:

| Suffix | Meaning |
|--------|---------|
| `duration_ms` | Millisecond duration, humanised (`1.23 s`, `42 ms`). |
| `duration_ns` | Nanosecond duration, humanised. |
| `bytes` | Byte count with SI suffix (`1.2 GiB`). |
| `pct` | Percentage. |
| `int` | Integer with thousands separators. |
| `float` | Floating-point using `decimalPlaces`. |
| `time` | Timestamp using `timeFormat`. |
| `raw` | No formatting — print the value as returned by DuckDB. |

If no suffix is given, jfr-query picks a default based on the column's inferred type.

## Conditional blocks

A conditional block only renders when a SQL predicate holds:

````
```{if SELECT max(duration_ms) > $$threshold FROM gc}
The recording has at least one pause above the threshold.

```sql
SELECT * FROM gc WHERE duration_ms > $$threshold ORDER BY duration_ms DESC
```
```
````

- The predicate is any SQL query that returns a single boolean-coercible scalar.
- The body is arbitrary notebook content — Markdown, SQL blocks, plot blocks, or nested constructs.
- Predicates are evaluated after variable substitution.

## Variables block

A `variables` fenced block declares cell-local variables with initial values:

````
```variables
$limit: 100
$event_type: "GC"
$window: [0, 1000]
```
````

- Keys must start with a single `$` (cell-local scope).
- Values are YAML: numbers, strings, booleans, lists, or ISO datetime strings.
- The block is stripped from the rendered output; its bindings feed the variable controls panel.

Notebook-level variables (`$$name`) are declared in the front matter `variables:` map, not in a variables block.

## Rendering rules

- Markdown outside code blocks is rendered as GFM.
- SQL blocks are executed; the result table is shown below the block (unless a plot cell consumes it).
- Plot blocks are rendered via the plot DSL. See [Plot DSL](plot-dsl.md).
- Inline scalars are evaluated on every dependency change.
- Conditional blocks re-evaluate their predicate whenever any referenced variable or upstream query changes.

## See also

- [Plot DSL](plot-dsl.md)
- [Variables](variables.md)
- [Built-in Views & Macros](views-macros.md)
```

---

## Task 4: Create `docs-site/plot-dsl.md`

- [ ] Write the following exact content to `docs-site/plot-dsl.md`:

```markdown
# Plot DSL

Plots are declared in fenced `plot` code blocks:

````
```plot
LINE_CHART(x=timestamp, y=duration_ms)
  ON recent_pauses
  TITLE "Recent GC pauses"
  AXIS_Y LABEL "ms" TYPE LOG
```
````

A plot expression consists of:

1. A **plot type** with **inner arguments** in parentheses.
2. Zero or more **tail clauses**.
3. Optionally combined with other plots using **composite operators**.

## Plot types

| Canonical | Aliases | Renders |
|-----------|---------|---------|
| `LINE_CHART` | `LINE` | Line chart with one series per `color` group. |
| `BAR_CHART` | `BAR` | Vertical bar chart. |
| `SCATTER_PLOT` | `SCATTER` | Scatter plot with optional `size` and `color`. |
| `HEATMAP` | — | 2D binned heatmap with `x`, `y`, and `z` (intensity). |
| `HISTOGRAM` | — | Frequency histogram over `x`. |
| `BOX_PLOT` | `BOX` | Box-and-whisker per `x` category. |
| `PIE_CHART` | `PIE` | Pie chart with `label` and `y` (magnitude). |
| `FLAMEGRAPH` | `FLAME` | Flamegraph of stack frames. |
| `TABLE` | — | Rendered results table. |
| `AREA_CHART` | `AREA` | Stacked / overlaid filled areas. |
| `GANTT_CHART` | `GANTT` | Gantt bars with `x` (start), `x2` (end), and `label` per row. |
| `RANGE_PLOT` | `RANGE` | Range/interval strips per `label`. |

Aliases are accepted anywhere the canonical name is. `LINE(x=t, y=v)` is equivalent to `LINE_CHART(x=t, y=v)`.

## Inner arguments

Inner arguments go inside the parentheses after the plot type. All are optional; the sensible defaults for each plot type apply when omitted.

| Argument | Meaning |
|----------|---------|
| `x` | Column bound to the X axis. |
| `y` | Column bound to the Y axis. May be a list `[a, b, c]` for multi-series plots. |
| `z` | Third dimension (heatmap intensity, bubble depth). |
| `label` | Column used as a text label (pie slices, gantt rows, flamegraph frames). |
| `color` | Column used to derive series/category colours. |
| `size` | Column used to derive marker size (scatter). |
| `frames` | For flamegraph: column containing the stack (list of frames). |
| `title` | Inline title. Equivalent to the `TITLE` tail clause. |

Values are column names from the bound query. String literals are wrapped in double quotes.

## Tail clauses

Tail clauses come after the closing paren of the plot type and each other, in any order (unless noted).

### Titles and layout

- `TITLE "text"` — chart title. Overrides the `title=` inner argument if both are given.
- `WIDTH size` — CSS width (`400px`, `50%`, `100%`).
- `HEIGHT size` — CSS height.
- `ZOOM factor` — scale factor within the current grid cell (e.g. `ZOOM 1.5`).

### Data source

- `ON query_ref[, query_ref, ...]` — bind the plot to one or more queries. See "Query references" below. Default: the query immediately preceding the plot block.
- `DATASET name` — use a named view as data source. Equivalent to `ON name` for view-backed data.

### Legend

- `LEGEND HIDDEN` — hide the legend.
- `LEGEND AT RIGHT | LEFT | TOP | BOTTOM | NONE` — legend position. `NONE` is equivalent to `HIDDEN`.

### Palette

- `PALETTE "name"` — colour palette name. Built-in palettes include `default`, `viridis`, `magma`, `plasma`, `cividis`, `sap`, `sap-dark`.

### Linking / brushing

- `LINK_X($start, $end, [master], [clamp])` — link the X zoom range to variables `$start` and `$end`. Optional `master` marks this plot as the driver. Optional `clamp` prevents zooming beyond the data domain.
- `LINK_Y($var)` — link Y axis zoom to a variable.
- `LINK_XY($var)` — link both axes to a variable.
- `LINK_SCROLL "group"` — synchronise scroll position with other plots in the same named group.
- `BRUSH $var MODE X | Y | XY` — capture user brush selection into `$var`. `$var.lo` / `$var.hi` hold the range for X/Y; `$var.x_lo` / `$var.x_hi` / `$var.y_lo` / `$var.y_hi` for XY.

### Axes

- `AXIS_X DOMAIN [min, max]` — fixed X domain.
- `AXIS_X LABEL "text"` — X axis label.
- `AXIS_X TYPE LINEAR | LOG | TIME | BAND` — axis scale type.
- `AXIS_X FORMAT "fmt"` — tick format string.
- `AXIS_Y DOMAIN [min, max]` — fixed Y domain.
- `AXIS_Y LABEL "text"` — Y axis label.
- `AXIS_Y TYPE LINEAR | LOG | TIME | BAND` — Y scale type.
- `AXIS_Y FORMAT "fmt"` — Y tick format string.

Multiple axis modifiers may be chained: `AXIS_Y DOMAIN [0, 100] LABEL "ms" TYPE LOG`.

### Tooltips

- `TOOLTIP COLUMNS [col1, col2, ...]` — restrict tooltip to specific columns.
- `ON HOVER TOOLTIP "format"` — custom tooltip format string with `{column}` placeholders.

### Constants

- `LET @name = value` — declare a plot-local constant. Referenced in inner arguments and other tail clauses as `@name`.

## Composite plots

Plots can be composed:

- `A + B` — overlay `B` on top of `A` with shared axes. Type-checked: mixing incompatible plot types (e.g. `PIE + LINE`) is rejected.
- `ROW(A, B, C)` — horizontal layout of independent plots.
- `COL(A, B, C)` — vertical layout of independent plots.

`ROW` and `COL` can be nested to build grids:

```
ROW(
  COL(A, B),
  C
)
```

## Query references

Inside `ON`, plots refer to queries by:

- **1-based index** — `1`, `2` — the Nth SQL block in the enclosing cell.
- **Alias name** — `my_alias` — any SQL block with `-- alias my_alias`.
- **Cross-cell** — `cell_handle.alias_name` — an alias from another cell.

Multiple sources are comma-separated: `ON pauses_p50, pauses_p99`. Each source becomes a series in a compatible plot type.

## Examples

### Simple line

````
```plot
LINE(x=timestamp, y=duration_ms) TITLE "GC pauses"
```
````

### Overlay P50 and P99 from two queries

````
```sql
-- alias p50
SELECT ts, quantile_cont(duration_ms, 0.5) AS ms FROM gc GROUP BY ts
```
```sql
-- alias p99
SELECT ts, quantile_cont(duration_ms, 0.99) AS ms FROM gc GROUP BY ts
```
```plot
LINE(x=ts, y=ms) ON p50, p99
  AXIS_Y LABEL "ms" TYPE LOG
  LEGEND AT RIGHT
```
````

### Brushable range driving a variable

````
```plot
LINE(x=timestamp, y=duration_ms)
  BRUSH $range MODE X
  LINK_X($range.lo, $range.hi, master, clamp)
```
````

### Composite grid

````
```plot
ROW(
  LINE(x=t, y=heap_used) TITLE "Heap",
  COL(
    BAR(x=cause, y=count) TITLE "Causes",
    PIE(label=cause, y=count) TITLE "Share"
  )
)
```
````

### Flamegraph

````
```plot
FLAMEGRAPH(frames=stack, size=samples) ON cpu-flamegraph
  HEIGHT 400px
```
````

## See also

- [Notebook Format](notebook-format.md)
- [Variables](variables.md)
- [Built-in Views & Macros](views-macros.md)
```

---

## Task 5: Create `docs-site/variables.md`

- [ ] Write the following exact content to `docs-site/variables.md`:

```markdown
# Variables

Variables let notebooks stay parameterised. They connect the variable-controls sidebar, SQL cells, plot tail clauses, conditional blocks, and interactive plot events into a single reactive graph.

## Scopes

There are two scopes, distinguished by the number of leading `$` signs:

| Sigil | Scope | Declared in |
|-------|-------|-------------|
| `$name` | Cell-local. Only visible inside the cell that declared it. | A ` ```variables ` block in the cell. |
| `$$name` | Notebook-level. Visible to every cell. | The `variables:` map in the front matter. |

Cell-local variables of the same name in different cells are independent.

## Declaring

### Notebook-level

```yaml
---
variables:
  $$threshold: 100
  $$event_type: "GC"
  $$window_start: "2024-01-01T00:00:00Z"
  $$labels: ["young", "old"]
---
```

### Cell-local

````
```variables
$limit: 100
$event_type: "GC"
$brush: {lo: 0, hi: 1000}
```
````

Values are YAML — numbers, booleans, strings, lists, maps, or ISO datetime strings.

## Substitution

Before a SQL query, plot expression, or conditional predicate is executed, jfr-query substitutes every `$name` and `$$name` token with the current variable value.

- Substitution is **transitive**: a variable that expands to text containing another `$name` triggers another pass, up to 10 passes.
- The engine is **cycle-safe**: a cycle raises a diagnostic in the issues panel and leaves the tokens unsubstituted.
- **ISO datetime** strings are automatically quoted for SQL, so `WHERE ts > $$window_start` produces `WHERE ts > TIMESTAMP '2024-01-01T00:00:00Z'` rather than a bare identifier.
- Numeric, boolean, list, and map values are rendered using SQL-compatible literal forms.
- Strings that are not ISO datetimes are inserted verbatim; wrap them in quotes in the source if you need a SQL string literal.

### Struct access

Struct-typed variables (e.g. from `BRUSH $range`) expose fields with dot notation:

- `$range.lo`, `$range.hi` — X mode.
- `$range.x_lo`, `$range.x_hi`, `$range.y_lo`, `$range.y_hi` — XY mode.

## Variable controls

The sidebar variable-controls panel renders a form for every declared variable. The widget is inferred from the type:

- Number → number input (or slider if bounds are known).
- Boolean → checkbox.
- String → text input; enum → dropdown when a list of allowed values is inferable.
- List → repeated widget.
- Struct → collapsible group of nested widgets.

Editing a control mutates the variable and triggers re-evaluation of every dependent SQL cell, plot, inline scalar, and conditional block.

## Live coupling

Interactive plot clauses write to variables:

- `BRUSH $var MODE X | Y | XY` — user drag on the plot updates `$var`.
- `LINK_X($start, $end, [master], [clamp])` — zoom/pan updates `$start` and `$end`.
- `LINK_Y($var)` / `LINK_XY($var)` — similar for other axes.
- `ON HOVER TOOLTIP "..."` — hover writes to variables referenced in the format string.

Because dependent cells re-run automatically, brushing a chart re-runs downstream SQL and re-renders every downstream plot.

## Example: parameterised threshold

```yaml
---
variables:
  $$threshold: 100
---
```

Cell:

````
```sql
-- alias hot_pauses
SELECT * FROM gc WHERE duration_ms > $$threshold
```
```plot
BAR(x=cause, y=count(*)) ON hot_pauses
```
````

Editing `$$threshold` in the sidebar re-runs `hot_pauses` and re-renders the bar chart.

## Example: brush-driven detail

````
```plot
LINE(x=timestamp, y=duration_ms)
  BRUSH $sel MODE X
```
```sql
-- alias selected
SELECT * FROM gc WHERE timestamp BETWEEN $sel.lo AND $sel.hi
```
```plot
TABLE() ON selected
```
````

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
```

---

## Task 6: Create `docs-site/views-macros.md`

- [ ] Write the following exact content to `docs-site/views-macros.md`:

```markdown
# Built-in Views & Macros

jfr-query ships a large library of canned SQL views and macros over the JFR event tables. This page lists every one bundled with the tool.

Custom views and macros can be added per-notebook via the front matter `views:` and `macros:` fields — see [Notebook Format](notebook-format.md).

## Views

Views are pre-defined SQL result sets. Reference them from any SQL block as if they were tables:

```sql
SELECT * FROM gc-pauses ORDER BY duration_ms DESC LIMIT 10
```

### Recording & System

- `active-recordings`
- `active-settings`
- `recording`
- `system-information`
- `system-processes`
- `system-properties`
- `environment-variables`
- `jvm-flags`
- `jvm-information`
- `jdk-agents`
- `modules`
- `native-libraries`
- `native-library-failures`

### GC & Memory

- `gc`
- `gc-allocation-trigger`
- `gc-concurrent-phases`
- `gc-concurrent-phases-detail`
- `gc-configuration`
- `gc-cpu-time`
- `gc-efficiency`
- `gc-overhead`
- `gc-parallel-phases`
- `gc-pause-distribution`
- `gc-pause-phases`
- `gc-pauses`
- `gc-phase-breakdown`
- `gc-references`
- `gc-throughput`
- `gc-top-pauses`
- `gc-young-vs-old`
- `heap-committed-vs-used`
- `heap-configuration`
- `heap-summary-over-time`
- `blocked-by-system-gc`
- `native-memory-committed`
- `native-memory-reserved`
- `object-statistics`
- `finalizers`
- `tlab-efficiency`
- `tlabs`
- `safepoints`
- `safepoint-overhead`
- `vm-operations`

### CPU & Threads

- `cpu-flamegraph`
- `cpu-information`
- `cpu-load`
- `cpu-load-samples`
- `cpu-time-hot-methods`
- `cpu-time-statistics`
- `cpu-tsc`
- `hot-methods`
- `method-calls`
- `method-timing`
- `native-methods`
- `thread-allocation`
- `thread-count`
- `thread-cpu-load`
- `thread-start`
- `pinned-threads`
- `latencies-by-type`

### I/O & Network

- `file-reads-by-path`
- `file-writes-by-path`
- `socket-reads-by-host`
- `socket-writes-by-host`
- `network-utilization`

### Compiler & JVM

- `compiler-configuration`
- `compiler-phases`
- `compiler-statistics`
- `deoptimizations-by-reason`
- `deoptimizations-by-site`
- `deprecated-methods-for-removal`
- `class-loaders`
- `class-modifications`
- `longest-class-loading`
- `longest-compilations`
- `events-by-count`
- `events-by-name`

### Allocation & Leaks

- `alloc-flamegraph`
- `allocation-by-class`
- `allocation-by-class-detail`
- `allocation-by-site`
- `allocation-by-thread`
- `allocation-rate`
- `memory-leaks-by-class`
- `memory-leaks-by-site`
- `native-flamegraph`

### Contention & Locks

- `contention-by-address`
- `contention-by-class`
- `contention-by-site`
- `contention-by-thread`
- `lock-flamegraph`
- `monitor-inflation`

### Exceptions

- `exception-by-message`
- `exception-by-site`
- `exception-by-type`
- `exception-count`
- `exception-flamegraph`

### Container

- `container-configuration`
- `container-cpu-throttling`
- `container-cpu-usage`
- `container-io-usage`
- `container-memory-usage`

## Macros

Macros are inline SQL fragments. Call them like SQL functions:

```sql
SELECT P95(duration_ms) FROM gc
```

### Statistical

- `P90(col)` — 90th percentile.
- `P95(col)` — 95th percentile.
- `P99(col)` — 99th percentile.
- `P999(col)` — 99.9th percentile.
- `normalized(x)` — value normalised to `[0, 1]` over its column range.
- `COUNT_UNIQUE(x)` — distinct count.
- `diff(col)` — difference from previous row (window).
- `rolling_avg(value, window_ms, ts)` — time-windowed rolling average.
- `rolling_sum(value, window_ms, ts)` — time-windowed rolling sum.

### Formatting

- `format_decimals(num, decimals)` — fixed decimal places.
- `format_percentage(num, decimals:=2)` — render as percentage.
- `format_memory(bytes, decimals:=2)` — humanised byte count.
- `format_duration(seconds, decimals:=2)` — humanised duration from seconds.
- `format_human_duration(sec)` — coarse humanised duration.
- `format_hex(i)` — hexadecimal representation.

### Time & GC helpers

- `before_gc(ts)` — GC event immediately before `ts`.
- `after_gc(ts)` — GC event immediately after `ts`.
- `duration_since_last_gc(ts)` — time since previous GC.
- `HEAP_BEFORE_GC(gc_id)` — heap usage before a GC by id.
- `HEAP_AFTER_GC(gc_id)` — heap usage after a GC by id.
- `GC_TYPE(gc_id)` — GC type label for an id.
- `recording_start()` — timestamp of the first event.
- `recording_end()` — timestamp of the last event.
- `relative_ms(ts)` — milliseconds since `recording_start()`.
- `time_since(prev_ts, ts)` — elapsed time between two timestamps.
- `time_bucket(ts, width_ms)` — bucket a timestamp into fixed-width windows.
- `in_range(ts, t_start, t_end)` — boolean range test.

### Event & stack helpers

- `EVENT_TYPE_LABEL(et)` — human-readable label for an event type id.
- `EVENT_NAME_FOR_ID(id)` — event name for an event id.
- `stack_frames(methods)` — flatten a stack into a list of frame labels.

### Introspection

- `view_sql(name)` — return the SQL text of a named view.
- `macro_sql(macro_name)` — return the SQL text of a named macro.

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
- [Variables](variables.md)
```

---

## Task 7: Verify MkDocs builds and commit

- [ ] From the repo root, run:

```bash
mkdocs build --strict
```

- [ ] If the build fails, read the error, fix the offending Markdown (usually mismatched fences or unclosed admonitions), and re-run until the strict build succeeds.
- [ ] Once the build is clean, stage the changed and new files:

```bash
git add mkdocs.yml docs-site/web-ui.md docs-site/notebook-format.md docs-site/plot-dsl.md docs-site/variables.md docs-site/views-macros.md
```

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
docs: complete reference docs for notebook format, plot DSL, variables, views, macros

Replaces stub pages with a full reference: notebook front matter and cell
syntax, the plot DSL (every type, inner arg, and tail clause), the variable
system (scopes, substitution, live coupling), and the complete list of
built-in views (grouped by category) and macros.
EOF
)"
```

- [ ] Verify:

```bash
git status
mkdocs build --strict
```

Both should succeed with no pending changes.
