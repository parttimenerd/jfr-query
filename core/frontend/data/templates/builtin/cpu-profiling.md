---
title: CPU Profiling
description: CPU load over time, hottest methods, thread-state breakdown, and a flame graph of execution samples.
tags: [cpu, profiling, performance]
license: MIT
variables:
  $limit: "25"
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

<!-- @cell name=cpu-load requires="CPULoad" -->

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

<!-- @cell name=hot-methods requires="ExecutionSample" -->

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

<!-- @cell name=cpu-by-state requires="ExecutionSample" -->

## CPU Samples by Thread State Over Time

Breakdown of execution samples per second by thread state. `STATE_RUNNABLE` = actively on CPU; `STATE_SLEEPING` / `STATE_BLOCKED_ON_MONITOR_WAIT` = off-CPU waits captured by the profiler. A high proportion of non-runnable samples means the profiler is capturing wait time, not CPU time.

```sql
SELECT
  time_bucket(INTERVAL '1 second', es.startTime) AS "Second",
  COUNT(*) FILTER (WHERE es.state = 'STATE_RUNNABLE') AS "Runnable",
  COUNT(*) FILTER (WHERE es.state != 'STATE_RUNNABLE') AS "Waiting"
FROM ExecutionSample es
GROUP BY 1
ORDER BY 1
```

```plot
AREA_CHART(x: "Second", y: ["Runnable", "Waiting"], layout: "stacked") TITLE "CPU Samples by State per Second" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=flamegraph requires="ExecutionSample" -->

## CPU Flame Graph

Full call-stack breakdown of all execution samples. Wide frames = more time. Click a frame to zoom in; use the breadcrumbs to navigate back up the call tree.

*Requires `ExecutionSample` events with stack traces enabled (`stackDepth > 0`).*

```sql
SELECT * FROM "cpu-flamegraph"
```

```plot
FLAME_GRAPH() TITLE "CPU Flame Graph"
```

---

<!-- @cell name=native-methods requires="NativeMethodSample" -->

## Native Method Hot Spots

Execution samples collected while the JVM thread was in native (JNI) code. High native sample counts can indicate bottlenecks in native libraries, system calls, or JNI boundary overhead.

*Requires `NativeMethodSample` events (profiling.jfc or custom JFC with native sampling enabled).*

```sql
SELECT * FROM "native-methods" ORDER BY "Samples" DESC LIMIT $limit
```

```plot
BAR_CHART(x: "Method", y: ["Samples"], horizontal: true) TITLE "Top Native Method Samples"
```

```plot
TABLE() TITLE "Native Method Hot Spots"
```

---

<!-- @cell name=method-timing requires="MethodTiming" -->

## Method Timing

Precise invocation counts and min/avg/max execution times for methods targeted with `@MethodTiming` annotations or custom JFC settings.

*Requires `MethodTiming` events (custom JFC with `jdk.MethodTiming` enabled).*

```sql
SELECT * FROM "method-timing" ORDER BY "Invocations" DESC LIMIT $limit
```

```plot
TABLE() TITLE "Method Timing Statistics"
```

---

<!-- @cell name=method-calls requires="MethodTrace" -->

## Method Call Trace

All recorded invocations of methods configured for tracing, with their caller. Useful for understanding call frequency and which callers trigger a particular method.

*Requires `MethodTrace` events (custom JFC with `jdk.MethodTrace` enabled).*

```sql
SELECT * FROM "method-calls" ORDER BY "Invocations" DESC LIMIT $limit
```

```plot
TABLE() TITLE "Method Call Trace"
```
