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
