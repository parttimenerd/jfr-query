---
title: Recording Overview
description: Adaptive first-look at a JFR recording — shows only sections relevant to the events present.
tags: [overview, gc, cpu, memory, io, threads]
license: MIT
priority: 1
cellConditions:
  io-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name IN ('FileRead', 'SocketRead', 'FileWrite', 'ThreadPark', 'JavaMonitorEnter')"
---

<!-- @cell name=intro -->

## Recording Overview

A first-look summary of this JFR recording. Sections below are shown only when the relevant events are present — hidden sections mean those events weren't recorded.

**Quick navigation:** The sections below cover GC, CPU, memory allocation, thread contention, I/O, and exceptions. Use the specific analysis templates (GC Analysis, CPU Profiling, I/O & Latency, etc.) for deeper investigation of any area.

```sql
SELECT
  recording_start() AS "Start",
  recording_end()   AS "End",
  round((epoch_ms(recording_end()) - epoch_ms(recording_start())) / 1000.0, 1) AS "Duration (s)"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-section requires="GarbageCollection" -->

## GC Summary

GC pause time by cause plus heap usage over time. High "Total Pause" relative to recording duration indicates GC pressure. Use the **GC Analysis** template for a deeper investigation.

```sql
SELECT
  cause AS "Cause",
  COUNT(*) AS "Collections",
  round(SUM(sumOfPauses) * 1000, 1) AS "Total Pause (ms)",
  round(MAX(longestPause) * 1000, 2) AS "Max Pause (ms)"
FROM GarbageCollection
GROUP BY cause
ORDER BY SUM(sumOfPauses) DESC
```

```plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)"], horizontal: true) TITLE "GC Total Pause by Cause"
```

```sql
SELECT
  "Time",
  round("Used MB", 1) AS "Used MB",
  round("Committed MB", 1) AS "Committed MB"
FROM "heap-committed-vs-used"
ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Used MB", "Committed MB"]) TITLE "Heap Used vs Committed (MB)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=cpu-section requires="CPULoad" -->

## CPU Load

JVM CPU usage over the recording. A flat line at 100% means the JVM is CPU-bound. Use the **CPU Profiling** template to find hot methods.

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

<!-- @cell name=hot-methods-section requires="ExecutionSample" -->

## Top Hot Methods

Methods with the most CPU execution samples. Use the **CPU Profiling** template for the full flame graph.

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
LIMIT 10
```

```plot
BAR_CHART(x: "Method", y: ["CPU %"], horizontal: true) TITLE "Top 10 Hot Methods"
```

---

<!-- @cell name=allocation-section requires="ObjectAllocationSample" -->

## Top Allocating Classes

Classes responsible for the most heap allocation (sampled). Use the **Heap Allocation** or **Memory Leak Detection** templates for deeper analysis.

```sql
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Samples",
  round(SUM(o.weight) / 1048576.0, 1) AS "Sampled MB"
FROM ObjectAllocationSample o
JOIN Class c ON o.objectClass = c._id
GROUP BY c.javaName
ORDER BY SUM(o.weight) DESC
LIMIT 10
```

```plot
BAR_CHART(x: "Class", y: ["Sampled MB"], horizontal: true) TITLE "Top 10 Allocating Classes"
```

---

<!-- @cell name=contention-section requires="JavaMonitorEnter" -->

## Monitor Contention Hotspots

Locks with the most blocking time. Use the **Threading & Contention** template for per-thread and per-site breakdown.

```sql
SELECT
  c.javaName AS "Monitor Class",
  COUNT(*) AS "Events",
  round(SUM(e.duration) * 1000.0, 1) AS "Total Wait (ms)",
  round(MAX(e.duration) * 1000.0, 1) AS "Max Wait (ms)"
FROM JavaMonitorEnter e
JOIN Class c ON e.monitorClass = c._id
GROUP BY c.javaName
ORDER BY SUM(e.duration) DESC
LIMIT 10
```

```plot
BAR_CHART(x: "Monitor Class", y: ["Total Wait (ms)"], horizontal: true) TITLE "Top 10 Contended Locks"
```

---

<!-- @cell name=io-section -->

## I/O Overview

Combined blocking time across all event types. The dominant type is the primary latency bottleneck. Use the **I/O & Latency** template for per-path and per-host breakdown.

```sql
SELECT * FROM "latencies-by-type"
```

```plot
BAR_CHART(x: "Event Type", y: ["Total"], horizontal: true) TITLE "Total Blocking Time by Type"
```

---

<!-- @cell name=exceptions-section requires="JavaExceptionThrow" -->

## Top Exceptions

Exception types thrown most frequently. Frequent `NullPointerException` or `SocketTimeoutException` may indicate control-flow exceptions — an expensive anti-pattern. Use the **Exceptions & Errors** template for detail.

```sql
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Throws"
FROM JavaExceptionThrow e
JOIN Class c ON e.thrownClass = c._id
GROUP BY c.javaName
ORDER BY COUNT(*) DESC
LIMIT 10
```

```plot
BAR_CHART(x: "Class", y: ["Throws"], horizontal: true) TITLE "Top 10 Thrown Exceptions"
```

---

<!-- @cell name=leaks-section requires="OldObjectSample" -->

## Potential Memory Leaks

Long-lived objects detected by the leak profiler. Repeated appearances of the same class with increasing age across recordings indicates a leak. Use the **Memory Leak Detection** template for allocation sites.

```sql
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Samples",
  round(MAX(os.objectAge), 1) AS "Max Age (s)"
FROM OldObjectSample os
JOIN OldObject o ON os.object = o._id
JOIN Class c ON o.type = c._id
GROUP BY c.javaName
ORDER BY MAX(os.objectAge) DESC
LIMIT 10
```

```plot
TABLE()
```

---

<!-- @cell name=container-section requires="ContainerCPUThrottling" -->

## Container Pressure

CPU throttling detected — the JVM was CPU-starved by cgroup limits during the recording. Use the **Container & Cloud** template for the full breakdown.

```sql
SELECT
  startTime AS "Time",
  round(cpuThrottledCount * 100.0 / NULLIF(cpuPeriodCount, 0), 1) AS "Throttle %"
FROM ContainerCPUThrottling
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Throttle %"]) TITLE "CPU Throttle %" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=threads-section requires="JavaThreadStatistics" -->

## Thread Activity

Active thread count over time. A rising trend that never falls back indicates a thread leak.

```sql
SELECT
  startTime AS "Time",
  activeCount AS "Active",
  peakCount AS "Peak"
FROM JavaThreadStatistics
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Active", "Peak"]) TITLE "Thread Counts" LINK_X($start, $end) ZOOM
```
