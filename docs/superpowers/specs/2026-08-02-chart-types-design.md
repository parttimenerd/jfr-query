# Chart Types — Design Spec

**Date:** 2026-08-02  
**Status:** Approved

---

## Summary

Add four new chart types (VIOLIN_PLOT, SUNBURST, SANKEY, CROSSTAB) and fix a bug where TREEMAP and WATERFALL are not reachable via the lowercase DSL form. All new charts integrate with the existing BRUSH variable system. CROSSTAB extends BRUSH to support two output variables.

---

## 1. Parser Bug Fix

**Problem:** `TREEMAP` and `WATERFALL` exist as React renderer components and have entries in `plotRegistry.ts`, but are missing from two lookup tables, so the lowercase DSL form (`treemap { ... }`) silently fails to parse.

**Fix:**

`components/editor/plot/parser.ts` — add to `SHAPE_NORMALIZE`:
```typescript
treemap: 'treemap',
waterfall: 'waterfall',
```

`components/editor/plot/derive.ts` — add to `LOWERCASE_TO_UC`:
```typescript
treemap: 'TREEMAP',
waterfall: 'WATERFALL',
```

No UI or rendering changes needed — the renderers already exist.

---

## 2. VIOLIN_PLOT

**Purpose:** Distribution shape for numeric data, optionally grouped by category.

### DSL

```
VIOLIN_PLOT(value: duration)
VIOLIN_PLOT(value: duration, category: gcType, bins: 30)
VIOLIN_PLOT(value: duration, category: gcType) BRUSH $selected
```

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `value` | numeric column | yes | — | The distribution axis |
| `category` | categorical column | no | — | One violin per category |
| `bins` | integer literal | no | 20 | KDE resolution |

### Rendering

Uses mirrored recharts `Area` shapes (same approach as existing BoxPlot) with a custom KDE pass in the component. No new dependencies.

### Interaction

`BRUSH $var` — click a violin (category) writes that category name to `$var`. Without `BRUSH`, clicks are no-ops.

---

## 3. SUNBURST

**Purpose:** Hierarchical part-of-whole visualization.

### DSL

```
SUNBURST(path: [pkg, class, method], value: samples)
SUNBURST(path: "pkg/class/method", value: samples)
SUNBURST(path: [pkg, class], value: samples) BRUSH $level
```

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | array of columns OR single slash-delimited string column | yes | Defines hierarchy depth |
| `value` | numeric column | yes | Size of each leaf |

### Rendering

Uses recharts `SunburstChart` (already in recharts 3.5.0 — no new dependency).

### Interaction

- Click an inner ring segment → drill down (re-root view at that node)
- Click the center circle → go up one level
- `BRUSH $var` — writes the currently focused root path (slash-joined string) to `$var` on each navigation

---

## 4. SANKEY

**Purpose:** Flow between categorical nodes, with re-rootable navigation for hierarchical data (flamegraph-like drill-down through call graphs, class hierarchies).

### DSL

```
SANKEY(source: caller, target: callee, value: samples)
SANKEY(source: caller, target: callee, value: samples) BRUSH $focused
```

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `source` | categorical column | yes | Left-side node |
| `target` | categorical column | yes | Right-side node |
| `value` | numeric column | yes | Flow width |

### Rendering

Uses recharts `Sankey` (already in recharts 3.5.0 — no new dependency).

### Navigation model

Click a node → re-root the view **client-side** (filter edges to only those passing through the focused node — both incoming and outgoing). This mirrors the flamegraph drill-down model already in the codebase. A breadcrumb bar above the chart shows the navigation path; click any crumb to jump back.

`BRUSH $var` — writes the currently focused node name to `$var` on each click.

---

## 5. CROSSTAB

**Purpose:** Aggregation table (pivot-style) with cell-level color scaling.

### DSL

```
CROSSTAB(row: gcType, col: phase, value: duration)
CROSSTAB(row: gcType, col: phase, value: samples, agg: COUNT)
CROSSTAB(row: gcType, col: phase, value: duration, agg: AVG) BRUSH $row_var $col_var
```

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `row` | categorical column | yes | — | Row labels |
| `col` | categorical column | yes | — | Column headers |
| `value` | numeric column | yes | — | Cell aggregate |
| `agg` | SUM \| AVG \| COUNT \| MAX \| MIN | no | SUM | Aggregation function |

### Rendering

Pure React table — no recharts dependency. Cell background color scales linearly from white → accent color based on value within the full result range.

### Interaction

`BRUSH $row_var $col_var` — click a cell writes the row label to `$row_var` and the column label to `$col_var`.

**Syntax extension:** The BRUSH tail currently accepts one variable (`BRUSH $var`). CROSSTAB requires exactly two. The parser and derive pipeline must accept `BRUSH $var1 $var2` as valid syntax. Existing single-variable charts are unaffected.

---

## 6. DSL Documentation

`docs-site/web-ui.md` must be updated to document all six charts (including the now-fixed TREEMAP and WATERFALL) with example snippets for each parameter and the BRUSH syntax.

---

## 7. Testing

### Unit tests (Vitest)

- Parser round-trips: each new shape parses and round-trips without error in both uppercase and lowercase form
- BRUSH two-variable parsing: `BRUSH $a $b` yields two variable refs in the AST
- Derive/validate: valid parameter sets pass; missing required params produce diagnostics; unknown agg values produce diagnostics

### E2E / visual (Playwright)

- Each chart type renders without React errors given valid data
- BRUSH single-var: clicking the interactive element updates the variable store
- BRUSH two-var: clicking a CROSSTAB cell updates both variables
- SANKEY breadcrumb: click node → breadcrumb appears; click breadcrumb → view resets

---

## 8. Model Retraining (post-implementation)

After all charts are implemented and documented:

1. **Plot suggester model**: Re-run the training pipeline (`scripts/train/`) with updated DSL examples covering the new shapes so the model learns to suggest VIOLIN_PLOT, SUNBURST, SANKEY, and CROSSTAB.
2. **SQL completion model** (if applicable): Update eval/training data with any new column-type patterns introduced by the new charts.

---

## Implementation Order

1. Parser bug fix (TREEMAP/WATERFALL) — no UI, low risk, immediate value
2. VIOLIN_PLOT — isolated renderer, no new dependencies
3. SUNBURST — recharts SunburstChart, standard drill-down
4. SANKEY — recharts Sankey, breadcrumb navigation
5. CROSSTAB — parser extension (two-var BRUSH), pure React renderer
6. Documentation update
7. Model retraining
