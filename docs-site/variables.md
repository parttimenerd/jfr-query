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

- `$range.brush.lo`, `$range.brush.hi` — X or Y mode.
- `$range.brush.x_lo`, `$range.brush.x_hi`, `$range.brush.y_lo`, `$range.brush.y_hi` — XY mode.

## Variable controls

The sidebar variable-controls panel renders a form for every declared variable. The widget is inferred from the type:

- Number → number input (or slider if bounds are known).
- Boolean → checkbox.
- String → text input; enum → dropdown when a list of allowed values is inferable.
- List → repeated widget.
- Struct → collapsible group of nested widgets.

Editing a control mutates the variable and triggers re-evaluation of every dependent SQL cell, plot, inline scalar, and conditional block.

### Inline input widgets

In addition to the sidebar, you can embed an interactive input widget directly inside a cell by adding `input=`, `var=`, and related attributes to the cell directive. This is useful when you want a control co-located with the query it drives.

Supported `input=` types:

| Type | Syntax | Rendered widget |
|------|--------|----------------|
| `slider` | `input="slider" var="$name" min="0" max="100"` | Range slider with live readout |
| `dropdown` | `input="dropdown" var="$name" options="GC,JIT,IO"` | Select dropdown |
| `datetime` | `input="datetime" var="$$start"` | Native datetime-local picker |

**Common attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `input=` | yes | Widget type: `slider`, `dropdown`, or `datetime`. |
| `var=` | yes | The variable name to write to (e.g. `var="$limit"` or `var="$$threshold"`). |
| `default=` | no | Initial value when the variable is not otherwise set. |
| `min=` | slider only | Minimum slider value (numeric). Default `0`. |
| `max=` | slider only | Maximum slider value (numeric). Default `100`. |
| `step=` | slider only | Step size for slider increments (numeric). Default `1`. |
| `options=` | dropdown only | Comma-separated list of option values (e.g. `options="GC,JIT,IO"`). |

**Example — slider-driven threshold:**

```html
<!-- @cell name=gc-filter input="slider" var="$limit" min="0" max="500" default="100" -->
```

```sql
SELECT * FROM gc WHERE duration_ms > $limit ORDER BY duration_ms DESC
```

**Example — dropdown event-type filter:**

```html
<!-- @cell name=event-picker input="dropdown" var="$event" options="GarbageCollection,JIT,IO" default="GarbageCollection" -->
```

## Live coupling

Interactive plot clauses write to variables:

- `BRUSH $var MODE X | Y | XY` — user drag on the plot updates `$var`.
- `LINK_X($start, $end, [master], [clamp])` — zoom/pan updates `$start` and `$end`.
- `LINK_Y($var)` — Y axis zoom updates `$var`.
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
SELECT * FROM gc WHERE timestamp BETWEEN $sel.brush.lo AND $sel.brush.hi
```
```plot
TABLE() ON selected
```
````

## Seeding variables from URL parameters

You can pre-populate cell-local or notebook-level variables via URL query parameters using the `var.NAME=VALUE` syntax:

```
http://localhost:3001/?var.threshold=500&var.event_type=GC
```

- The `var.` prefix is stripped; the remainder becomes the variable name.
- Names without a leading `$` have `$` prepended automatically.
- Values are parsed as numbers when possible, otherwise kept as strings.
- URL-seeded values merge into the notebook's initial variable state and can be overridden interactively.

This is useful for sharing pre-filtered notebook views or scripting notebook screenshots.

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
