---
title: Comprehensive Feature Test
description: Tests all major notebook features — variables, multi-query cells, charts, linked axes, scatter plots, and cross-cell references.
tags: [test, gc, performance, allocation]
license: MIT
variables:
  $limit: "20"
  $min_pause_ms: "5"
---

<!-- @cell name=intro -->

## Comprehensive Notebook Test

This notebook exercises all major features in a single place. Each cell below demonstrates a different combination of SQL, plots, and variables.

---

<!-- @cell name=recording-info -->

## Recording Info

Two queries in one cell — the second references the first via an alias.

```sql
-- alias rec_bounds
SELECT
  recording_start() AS "Start",
  recording_end()   AS "End",
  round((epoch_ms(recording_end()) - epoch_ms(recording_start())) / 1000.0, 1) AS "Duration (s)"
```

```plot
TABLE()
```

```sql
SELECT
  count(*) AS "Total GC Events",
  round(sum(sumOfPauses) * 1000, 1) AS "Total Pause (ms)",
  round(avg(sumOfPauses) * 1000, 2) AS "Avg Pause (ms)",
  round(max(longestPause) * 1000, 2) AS "Max Pause (ms)"
FROM GarbageCollection
```

```plot
TABLE()
```

---

<!-- @cell name=gc-by-cause -->

## GC Events by Cause

Bar chart with grouped layout. Uses `$limit` variable to cap rows.

```variables
$limit = 20
$min_pause_ms = 5
```

```sql
SELECT
  cause AS "Cause",
  count(*) AS "Count",
  round(sum(sumOfPauses) * 1000, 1) AS "Total Pause (ms)",
  round(avg(sumOfPauses) * 1000, 2) AS "Avg Pause (ms)",
  round(max(longestPause) * 1000, 2) AS "Max Pause (ms)"
FROM GarbageCollection
WHERE sumOfPauses * 1000 >= $min_pause_ms
GROUP BY cause
ORDER BY sum(sumOfPauses) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)", "Max Pause (ms)"], layout: "grouped") TITLE "Pause Time by GC Cause"
```

---

<!-- @cell name=pause-scatter -->

## Pause vs Reclaimed — Scatter

Scatter plot correlating pause duration with memory reclaimed. Each point is one GC event.

```sql
SELECT
  g.gcId AS "GC ID",
  g.cause AS "Cause",
  round(g.sumOfPauses * 1000, 2) AS "Pause (ms)",
  round((b.heapUsed - a.heapUsed) / (1024.0 * 1024.0), 1) AS "Reclaimed (MB)",
  round(b.heapUsed / (1024.0 * 1024.0), 1) AS "Heap Before (MB)"
FROM GarbageCollection g
JOIN GCHeapSummary b ON g.gcId = b.gcId AND b."when" = 'Before GC'
JOIN GCHeapSummary a ON g.gcId = a.gcId AND a."when" = 'After GC'
ORDER BY g.gcId
```

```plot
SCATTER_PLOT(x: "Pause (ms)", y: "Reclaimed (MB)", color: "Cause") TITLE "Reclaimed vs Pause Time"
```

---

<!-- @cell name=heap-timeline -->

## Heap Over Time — Linked Line Charts

Two line charts that **share the same x-axis** via `LINK_X`. Pan or zoom one and the other follows.

```variables
$limit = 500
```

```sql
SELECT
  "Time",
  round("Used MB", 1) AS "Used MB",
  round("Committed MB", 1) AS "Committed MB"
FROM "heap-committed-vs-used"
ORDER BY "Time"
LIMIT $limit
```

```plot
LINE_CHART(x: "Time", y: ["Used MB", "Committed MB"]) LINK_X($start, $end) TITLE "Heap MB Over Time"
```

---

<!-- @cell name=gc-phase-percentiles -->

## GC Phase Percentile Table + Chart

One query feeds both a TABLE and a BAR_CHART in the same cell.

```sql
-- alias phase_stats
SELECT
  name AS "Phase",
  count(*) AS "N",
  round(median(duration) * 1000, 3)                    AS "Median (ms)",
  round(quantile_cont(duration, 0.90) * 1000, 3)       AS "P90 (ms)",
  round(quantile_cont(duration, 0.99) * 1000, 3)       AS "P99 (ms)",
  round(max(duration) * 1000, 3)                       AS "Max (ms)"
FROM GCPhasePause
GROUP BY name
ORDER BY max(duration) DESC
```

```plot
TABLE()
```

```plot
BAR_CHART(x: "Phase", y: ["Median (ms)", "P90 (ms)", "P99 (ms)", "Max (ms)"], layout: "grouped") TITLE "Pause Percentiles by Phase"
```

---

<!-- @cell name=allocation-hotspots -->

## Top Allocation Hotspots

Horizontal bar chart with `$limit` controlling depth.

```variables
$limit = 15
```

```sql
SELECT
  c.javaName AS "Class",
  count(*)    AS "Samples",
  round(sum(o.weight) / (1024.0 * 1024.0), 2) AS "Sampled MB"
FROM ObjectAllocationSample o
JOIN Class c ON o.objectClass = c._id
GROUP BY c.javaName
ORDER BY sum(o.weight) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Sampled MB"], horizontal: true) TITLE "Top Allocating Classes"
```

---

<!-- @cell name=cross-cell-summary -->

## Cross-Cell Prose Summary

This cell contains only text — no SQL, no plot. It references a number derived earlier.

Look at the **Recording Info** cell above: the recording spans roughly 12 minutes and
contains many GC events. The scatter plot in **Pause vs Reclaimed** shows the relationship
between pause duration and how much memory was recovered — outliers in the top-left
(high pause, low reclaim) indicate inefficient collections worth investigating.

---

<!-- @cell name=drill-down -->

## Drill-Down: Single GC Event

Change `$gc_id` to inspect a specific collection. The variable is referenced in the WHERE clause.

```variables
$gc_id = 1
$limit = 20
```

```sql
SELECT
  "GC ID",
  "Phase",
  "Duration",
  "Start"
FROM "gc-phase-breakdown"
WHERE "GC ID" = $gc_id
ORDER BY "Start"
LIMIT $limit
```

```plot
TABLE()
```
