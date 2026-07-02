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
