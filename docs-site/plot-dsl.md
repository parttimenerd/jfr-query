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
| `HEATMAP` | — | 2D binned heatmap with `x`, `y`, and `value` (intensity). |
| `HISTOGRAM` | — | Frequency histogram over `x`. Supports `bins` (count) and `logBins: true` for log-scale bucketing. |
| `BOX_PLOT` | `BOX` | Box-and-whisker per `x` category. |
| `PIE_CHART` | `PIE` | Pie chart with `category` and `value` columns. |
| `FLAMEGRAPH` | `FLAME` | Flamegraph of stack frames — `frames` (frame list column) and `value` (weight column). |
| `TABLE` | — | Rendered results table. |
| `AREA_CHART` | `AREA` | Stacked / overlaid filled areas. |
| `GANTT` | — | Gantt bars with `start`, `end`, and `lane` (row category). Optional `task` (bar label). |
| `RANGE` | — | Range/interval band with `x`, `low`, `high`. Optional `center` line and `color`. |

Aliases are accepted anywhere the canonical name is. `LINE(x=t, y=v)` is equivalent to `LINE_CHART(x=t, y=v)`.
`PIE_CHART` also accepts the older names `name` / `labels` / `values` for backwards compatibility; prefer `category` / `value`.

## Inner arguments

Inner arguments go inside the parentheses after the plot type. All are optional; the sensible defaults for each plot type apply when omitted.

| Argument | Applies to | Meaning |
|----------|------------|---------|
| `x` | most types | Column bound to the X axis. |
| `y` | most types | Column bound to the Y axis. May be a list `[a, b, c]` for multi-series plots. |
| `value` | HEATMAP, FLAMEGRAPH | Intensity / weight column. |
| `category` | PIE_CHART | Column providing slice labels. |
| `label` | TABLE, BAR | Text label column. |
| `start` | GANTT | Column for the bar start time/value. |
| `end` | GANTT | Column for the bar end time/value. |
| `lane` | GANTT | Column for the row category on the Y axis. |
| `task` | GANTT | Optional text drawn inside each bar. |
| `low` | RANGE | Lower bound column for the shaded band. |
| `high` | RANGE | Upper bound column for the shaded band. |
| `center` | RANGE | Optional center-line column (e.g. median). |
| `frames` | FLAMEGRAPH | Column containing the list of stack frames. |
| `color` | most types | Column used to derive series/category colours. |
| `size` | SCATTER | Column used to derive marker size. |
| `title` | any | Inline title. Equivalent to the `TITLE` tail clause. |

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

- `PALETTE "name"` — colour palette name. Built-in palettes: `category10` (D3 default), `tableau10`, `pastel1`, `dark2`, `set2`.

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
FLAMEGRAPH(frames=stack, value=samples)
  HEIGHT 400px
```
````

## See also

- [Notebook Format](notebook-format.md)
- [Variables](variables.md)
- [Built-in Views & Macros](views-macros.md)