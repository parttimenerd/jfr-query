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
| `cellConditions` | map | Advanced visibility conditions per cell handle. Value is any SQL predicate. When the predicate returns a falsy value the cell is dimmed and collapsed. Re-evaluated whenever a dependency changes. Use `requires:` or inline `requires=` for the common case of checking table/view availability. |
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
requires:
  detail_cell: GarbageCollection
  allocation_cell: ObjectAllocationSample
cellConditions:
  io_section: >
    SELECT count(*) > 0 FROM information_schema.tables
    WHERE table_name IN ('FileRead', 'SocketRead', 'FileWrite')
customSystemPrompt: |
  You are analysing GC pauses. Prefer P95 and P99 over averages.
---
```

## Cell delimiters

Cells are delimited by an HTML comment:

```html
<!-- @cell name=my_handle -->
```

- `name=` is required. The handle must match `[A-Za-z_]\w*` (letters, digits, underscores; may not start with a digit).
- Cells are ordered top-to-bottom in the file.
- Content before the first delimiter belongs to an implicit intro cell.

Cell handles are used by:

- `cellConditions` in the front matter.
- Cross-cell plot references (`cell_handle.alias_name`).
- Cell-scoped variables (`$name` is scoped to its declaring cell).

## Cell visibility conditions

A cell can be hidden when specific JFR tables, views, or SQL conditions are not satisfied. This is how built-in templates stay useful across JFR recordings that don't have every event type enabled — sections that have no data simply don't appear.

A cell is visible by default. When a visibility condition is defined and it evaluates to a falsy value, the cell header turns amber and the content is collapsed. Conditions are re-evaluated whenever data changes.

### Inline `requires=` (recommended)

Declare visibility directly on the cell directive:

```html
<!-- @cell name=gc-section requires="GarbageCollection" -->
<!-- @cell name=blocking   requires="ThreadPark,ThreadSleep" -->
<!-- @cell name=heap-trend requires="SELECT count(*) > 0 FROM heap_summary_view" -->
```

The `requires=` attribute accepts three forms:

| Form | Example | Behaviour |
|------|---------|-----------|
| Single table or view name | `requires="GarbageCollection"` | Cell shown only when that table or view exists |
| Comma-separated names | `requires="ThreadPark,ThreadSleep"` | Cell shown only when **all** named tables/views exist |
| Raw SQL predicate | `requires="SELECT count(*) > 0 FROM my_view"` | Cell shown when the predicate returns a truthy value |

Names match both tables and views — you don't need to know whether something is a JFR event table or a built-in view.

You can set or remove `requires=` without editing the Markdown: hover over any cell header to reveal a **`+ requires`** button (or **`⚡ requires`** when a condition already exists). Clicking it opens a small editor where you can type the condition and press Enter or Save.

### Front-matter `requires:` shorthand

Use this when you want to declare visibility for many cells in one place (e.g. in a template file):

```yaml
---
requires:
  gc-config:    GCConfiguration
  blocking:     [ThreadPark, ThreadSleep]
  heap-section: GarbageCollection
---
```

The same three value forms are accepted. Front-matter `requires:` entries are expanded at parse time and behave identically to inline `requires=`.

### Front-matter `cellConditions:` (advanced)

For full SQL predicates that don't fit the `requires=` syntax:

```yaml
cellConditions:
  io-section: >
    SELECT count(*) > 0 FROM information_schema.tables
    WHERE table_name IN ('FileRead','SocketRead','FileWrite','ThreadPark','JavaMonitorEnter')
  detail-cell: "SELECT COUNT(*) > 0 FROM long_pauses"
```

Any SQL predicate is valid. Variable substitution (`$var`) is supported.

### Precedence

When the same cell name is defined in multiple places, `cellConditions` wins over `requires:` (front-matter) which wins over `requires=` (inline). This lets templates define complex fallback conditions while individual cells can set simple table checks.


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

## Standalone plot blocks

A `plot` block that appears **before any SQL block** in the cell is a *standalone plot*. It fetches data directly from a DuckDB table or view using a `DATASET` clause, without needing a preceding SQL query:

````
```plot
LINE_CHART(x: "startTime", y: ["heapUsed", "heapCommitted"])
  DATASET heap-committed-vs-used
  TITLE "Heap over time"
```
````

- The `DATASET <name>` clause names any DuckDB table, view, or alias visible in the current session.
- Standalone plots appear at the top of the cell, above any SQL blocks.
- They update automatically when the underlying table changes (e.g. after a new JFR file is loaded).
- Use `+ Add Plot` at the bottom of any cell to insert a standalone plot pre-filled with the first available table.

Standalone plots support all the same plot types, inner arguments, and tail clauses as SQL-attached plots — except `ON` (no SQL query to reference).

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
