---
title: CPU Profiling
description: CPU load over time, hottest methods, and a flame graph of execution samples.
tags: [cpu, profiling, performance]
license: MIT
variables:
  $limit: "25"
cellConditions:
  cpu-load: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'CPULoad'"
  hot-methods: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ExecutionSample'"
  flamegraph: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ExecutionSample'"
---

<!-- @cell name=intro -->

## CPU Profiling

Where is CPU time being spent? This notebook analyses `ExecutionSample` events captured during the recording.

**What's here:**
- CPU load over time (JVM user + system + total machine %)
- Top hot methods by execution sample count (table)
- CPU flame graph — full call stack breakdown

**Required events:** `CPULoad` for the load chart; `ExecutionSample` for hot methods and the flame graph. Both are enabled by default in the `default` and `profile` settings.

---

<!-- @cell name=cpu-load -->

## CPU Load Over Time

JVM user-space CPU, JVM system CPU, and total machine CPU percentage over time. A flat line at 100% suggests the JVM is CPU-bound; low JVM % with high machine % may indicate contention from other processes.

```sql
SELECT
  "startTime" AS "Time",
  round("jvmUser" * 100, 1) AS "JVM User %",
  round("jvmSystem" * 100, 1) AS "JVM System %",
  round("machineTotal" * 100, 1) AS "Machine Total %"
FROM "CPULoad"
ORDER BY "startTime"
```

```plot
LINE_CHART(x: "Time", y: ["JVM User %", "JVM System %", "Machine Total %"]) TITLE "CPU Load (%)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=hot-methods -->

## Hottest Methods

Top methods by execution sample count. Higher sample count = more CPU time spent in that method. Percentage is relative to all samples in the recording.

```sql
SELECT
  (c."javaName" || '.' || m."name") AS "Method",
  COUNT(*) AS "Samples",
  round(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM "ExecutionSample"), 2) AS "CPU %"
FROM "ExecutionSample" es
JOIN "Method" m ON es."stackTrace$topMethod" = m."_id"
JOIN "Class" c ON m."type" = c."_id"
GROUP BY c."javaName", m."name"
ORDER BY COUNT(*) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Method", y: ["CPU %"], horizontal: true) TITLE "Top CPU Methods (% of samples)"
```

---

<!-- @cell name=flamegraph -->

## CPU Flame Graph

Full call-stack breakdown of all execution samples. Wide frames = more time. Click a frame to zoom in; use the breadcrumbs to navigate back up the call tree.

*Requires `ExecutionSample` events with stack traces enabled (`stackDepth > 0`).*

```sql
SELECT * FROM "cpu-flamegraph"
```

```plot
FLAME_GRAPH() TITLE "CPU Flame Graph"
```
