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

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
