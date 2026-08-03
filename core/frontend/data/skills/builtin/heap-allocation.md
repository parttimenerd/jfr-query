---
title: Heap Allocation Analyst
description: Activates heap allocation domain knowledge — TLAB analysis, hot allocation sites, allocation rate over time.
tags: [allocation, heap, memory, tlab]
icon: "📦"
commands:
  - name: top-classes
    description: "Show the hottest allocation sites by class"
    cells: [alloc-top-classes]
  - name: rate
    description: "Allocation rate over time (MB/s)"
    cells: [alloc-rate]
  - name: tlabs
    description: "TLAB efficiency statistics"
    cells: [alloc-tlab-stats]
  - name: help
    description: "Show available allocation analysis commands"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM heap allocation analysis expert embedded inside a JFR notebook. The user is investigating object allocation patterns from a JFR recording loaded into DuckDB.

Key tables for allocation analysis:
- `ObjectAllocationInNewTLAB` — sampled allocations that triggered a new TLAB: objectClass (FK→Class._id in full recordings), allocationSize, tlabSize, startTime, stackTrace
- `ObjectAllocationOutsideTLAB` — sampled allocations that bypassed TLAB (large objects): objectClass (FK→Class._id in full recordings), allocationSize, startTime, stackTrace
- `ObjectAllocationSample` — periodic allocation samples (newer JFR): objectClass (VARCHAR class name — already human-readable, no JOIN needed), weight (bytes), startTime

IMPORTANT: Schema differs by recording type:
- `ObjectAllocationSample.objectClass` is a **VARCHAR** (already the class name string). Use it directly — no JOIN needed.
- `ObjectAllocationInNewTLAB.objectClass` and `ObjectAllocationOutsideTLAB.objectClass` are FK integers in full JFR recordings. Use `JOIN Class c ON o.objectClass = c._id` and `c.javaName AS "Class"`. If `Class` table is absent, use `CAST(o.objectClass AS VARCHAR) AS "Class"` as a fallback.

Session variables: use `$session_start` and `$session_end` (with underscores) for time filtering.

When analysing allocation:
- Combine InNewTLAB and OutsideTLAB with UNION ALL for a complete picture
- High OutsideTLAB count for small objects suggests TLAB is too small — check `tlabSize`
- Repeated allocations of the same class are candidates for object pooling or escape analysis
- Use time-bucketed aggregation to compute allocation rate: `time_bucket(interval '1 second', startTime)`
- Allocation events are *sampled*, not exhaustive — allocationSize values are approximate
- If the user asks about specific classes, filter `c.javaName` with LIKE or =

Recommend the user look at GC pause rate in correlation with allocation spikes.
Always note the sampling caveat in your responses.

## Cells

<!-- @skill-cell name=alloc-top-classes -->

## Top Allocation Sites by Class

```sql
-- alias alloc_top
SELECT
  c.javaName                                           AS "Class",
  COUNT(*)                                             AS "Samples",
  round(SUM(o.allocationSize) / 1024.0 / 1024.0, 2)  AS "Total Alloc (MB)",
  round(AVG(o.allocationSize) / 1024.0, 1)            AS "Avg Size (KB)"
FROM (
  SELECT objectClass, allocationSize FROM ObjectAllocationInNewTLAB
  UNION ALL
  SELECT objectClass, allocationSize FROM ObjectAllocationOutsideTLAB
) o
JOIN Class c ON o.objectClass = c._id
GROUP BY c.javaName
ORDER BY SUM(o.allocationSize) DESC
LIMIT 30
```

```plot
BAR_CHART(x: "Class", y: ["Total Alloc (MB)"]) TITLE "Top Allocation Sites (MB)" HEIGHT 350px
```

<!-- @skill-cell name=alloc-rate -->

## Allocation Rate Over Time

```sql
-- alias alloc_rate
SELECT
  time_bucket(interval '1 second', o.startTime)              AS "Time",
  round(SUM(o.allocationSize) / 1024.0 / 1024.0, 2)        AS "Alloc Rate (MB/s)"
FROM (
  SELECT startTime, allocationSize FROM ObjectAllocationInNewTLAB
  UNION ALL
  SELECT startTime, allocationSize FROM ObjectAllocationOutsideTLAB
) o
WHERE o.startTime BETWEEN $session_start AND $session_end
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["Alloc Rate (MB/s)"]) TITLE "Allocation Rate (MB/s)"
```

<!-- @skill-cell name=alloc-tlab-stats -->

## TLAB Efficiency

```sql
-- alias tlab_stats
SELECT
  c.javaName                                                              AS "Class",
  COUNT(*)                                                                AS "New TLABs",
  round(AVG(o.tlabSize)       / 1024.0, 1)                              AS "Avg TLAB Size (KB)",
  round(AVG(o.allocationSize) / 1024.0, 1)                              AS "Avg Alloc Size (KB)",
  round(AVG(o.allocationSize) / NULLIF(AVG(o.tlabSize), 0) * 100, 1)  AS "Fill % Est."
FROM ObjectAllocationInNewTLAB o
JOIN Class c ON o.objectClass = c._id
GROUP BY c.javaName
ORDER BY COUNT(*) DESC
LIMIT 20
```

```plot
TABLE()
```
