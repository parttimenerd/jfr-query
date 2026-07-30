---
title: Recording Overview
description: Adaptive first-look at a JFR recording — shows only sections relevant to the events present.
tags: [overview, gc, cpu, memory, io, threads]
license: MIT
cellConditions:
  gc-section: "SELECT count(*) > 0 FROM GarbageCollection"
  cpu-section: "SELECT count(*) > 0 FROM CPULoad"
  hot-methods-section: "SELECT count(*) > 0 FROM ExecutionSample"
  allocation-section: "SELECT count(*) > 0 FROM ObjectAllocationSample"
  contention-section: "SELECT count(*) > 0 FROM JavaMonitorEnter"
  io-section: "SELECT (SELECT count(*) FROM FileRead) + (SELECT count(*) FROM FileWrite) + (SELECT count(*) FROM SocketRead) > 0"
  exceptions-section: "SELECT count(*) > 0 FROM JavaExceptionThrow"
  container-section: "SELECT count(*) > 0 FROM ContainerCPUThrottling"
  leaks-section: "SELECT count(*) > 0 FROM OldObjectSample"
  threads-section: "SELECT count(*) > 0 FROM JavaThreadStatistics"
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

<!-- @cell name=gc-section -->

## GC Summary

GC pause time by cause. High "Total Pause" relative to recording duration indicates GC pressure. Use the **GC Analysis** template for a deeper investigation.

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

---

<!-- @cell name=cpu-section -->

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

<!-- @cell name=hot-methods-section -->

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

<!-- @cell name=allocation-section -->

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

<!-- @cell name=contention-section -->

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

Combined latency across all blocking event types. Use the **I/O & Latency** template for per-path and per-host breakdown.

```sql
SELECT * FROM "latencies-by-type"
```

```plot
BAR_CHART(x: "Event Type", y: ["Total"], horizontal: true) TITLE "Total Blocking Time by Type"
```

---

<!-- @cell name=exceptions-section -->

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

<!-- @cell name=leaks-section -->

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

<!-- @cell name=container-section -->

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

<!-- @cell name=threads-section -->

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
