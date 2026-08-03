---
title: GC Pause Analysis
description: Identify long garbage-collection pauses and the work each pause performs.
tags: [gc, performance]
license: MIT
variables:
  $$threshold_ms: "100"
  $limit: "20"
cellConditions:
  long-pauses-section: "SELECT max(longestPause) * 1000 > $$threshold_ms FROM GarbageCollection"
  gc-allocation-trigger: "SELECT count(*) > 0 FROM AllocationRequiringGC"
  gc-references: "SELECT count(*) > 0 FROM GCReferenceStatistics"
  system-gc-blockers: "SELECT count(*) > 0 FROM SystemGC"
  metaspace: "SELECT count(*) > 0 FROM MetaspaceSummary"
  g1-regions: "SELECT count(*) > 0 FROM G1HeapSummary"
  tenuring: "SELECT count(*) > 0 FROM TenuringDistribution"
---

<!-- @cell name=intro -->

## GC Analysis

A ready-to-run analysis of garbage-collection behavior from your JFR recording.

**What's here:**
- Recording overview (start, end, total duration)
- Pause time breakdown by GC cause — which cause is costing the most stop-the-world time
- Long-pause drill-down (shown only when pauses exceed `$$threshold_ms` ms)
- Phase-level percentile table (P50 / P90 / P99 / Max per GC phase)

**Required events:** `GarbageCollection`, `GCPhasePause`

Change `$$threshold_ms` in the Notebook Settings cell above to adjust the long-pause threshold.

---

<!-- @cell name=overview -->

## Recording Overview

```sql
-- alias overview
SELECT
  recording_start() AS "Start",
  recording_end()   AS "End",
  round((epoch_ms(recording_end()) - epoch_ms(recording_start())) / 1000.0, 1) AS "Duration (s)"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-config -->

## GC & Heap Configuration

Collector, thread counts, pause target, and heap sizing for this recording.

```sql
-- alias gc_config
SELECT * FROM "gc-configuration"
```

```sql
-- alias heap_config
SELECT * FROM "heap-configuration"
```

```plot
TABLE() ON gc_config
```

```plot
TABLE() ON heap_config
```

---

<!-- @cell name=pause-summary -->

## GC Pause Summary

Total stop-the-world time per cause. Recording contains ${SELECT count(*) FROM GarbageCollection} collections.

```sql
-- alias gc_pauses
SELECT
  cause AS "Cause",
  COUNT(*) AS "Collections",
  round(SUM(sumOfPauses) * 1000, 1) AS "Total Pause (ms)",
  round(AVG(sumOfPauses) * 1000, 2) AS "Avg Pause (ms)",
  round(MAX(longestPause) * 1000, 2) AS "Max Pause (ms)"
FROM GarbageCollection
GROUP BY cause
ORDER BY SUM(sumOfPauses) DESC
```

```plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)", "Max Pause (ms)"], layout: "grouped") TITLE "GC Pause Time by Cause"
```

---

<!-- @cell name=long-pauses-section -->

## Long Pauses Detected

This section is shown because your recording contains at least one pause longer than $$threshold_ms ms. Max observed: ${SELECT round(max(longestPause) * 1000, 1) FROM GarbageCollection | duration_ms}.

```sql
SELECT
  gcId AS "GC ID",
  cause AS "Cause",
  round(longestPause * 1000, 1) AS "Longest Pause (ms)"
FROM GarbageCollection
WHERE longestPause * 1000 > $$threshold_ms
ORDER BY longestPause DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=phase-breakdown -->

## Pause Distribution by Phase

```sql
SELECT
  name AS "Phase",
  COUNT(*) AS "Count",
  round(MEDIAN(duration) * 1000, 3) AS "Median (ms)",
  round(quantile_cont(duration, 0.9) * 1000, 3) AS "P90 (ms)",
  round(quantile_cont(duration, 0.99) * 1000, 3) AS "P99 (ms)",
  round(MAX(duration) * 1000, 3) AS "Max (ms)"
FROM GCPhasePause
GROUP BY name
ORDER BY MAX(duration) DESC
```

```plot
BAR_CHART(x: "Phase", y: ["Median (ms)", "P90 (ms)", "P99 (ms)", "Max (ms)"], layout: "grouped") TITLE "Pause Percentiles by Phase"
```

---

<!-- @cell name=heap-over-time -->

## Heap Usage Over Time

Heap used (MB) before and after each GC. A narrow gap between Before/After means GC isn't reclaiming much — watch for a rising "After" trend indicating a memory leak.

```sql
SELECT
  g."startTime" AS "Time",
  round(h."heapUsed" / 1048576.0, 1) AS "Heap Used MB",
  h."when" AS "Phase"
FROM "GCHeapSummary" h
JOIN "GarbageCollection" g ON g."gcId" = h."gcId"
ORDER BY g."startTime"
```

```plot
LINE_CHART(x: "Time", y: ["Heap Used MB"], color: "Phase") TITLE "Heap Used (MB) — Before/After Each GC" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=allocation-rate -->

## Allocation Rate

Sampled allocation rate in MB/s per second. Spikes often correlate with GC pauses — high allocation pressure forces more frequent collections.

*Requires `ObjectAllocationSample` events. If this cell shows no data, re-record with allocation profiling enabled.*

```sql
SELECT
  "Bucket" AS "Time",
  round("Sample MB/s", 2) AS "Alloc MB/s"
FROM "allocation-rate"
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["Alloc MB/s"]) TITLE "Allocation Rate (sampled MB/s)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=gc-overhead -->

## GC Overhead Over Time

Stop-the-world time as a percentage of each 10-second window. Sustained values above ~5% indicate the collector is competing significantly with the application.

```sql
SELECT "Window" AS "Time", "GC Overhead %", "Collections"
FROM "gc-overhead"
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["GC Overhead %"]) TITLE "GC Overhead % (10-second windows)" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"
```

---

<!-- @cell name=pause-histogram -->

## Pause Duration Distribution

Distribution of individual stop-the-world pause durations. Log-scale bins reveal the long tail that averages hide — a bimodal distribution (many fast + a few very long) is a common GC tuning problem.

```sql
SELECT round(duration * 1000, 3) AS "Pause (ms)"
FROM GCPhasePause
WHERE name NOT LIKE '%Level%'
ORDER BY 1
```

```plot
HISTOGRAM(x: "Pause (ms)", logBins: true, yLog: true) TITLE "GC Pause Duration Distribution"
```

---

<!-- @cell name=concurrent-phases -->

## Concurrent GC Phase Timeline

Timeline of concurrent (non-stop-the-world) GC work. Overlapping concurrent phases with short gaps between pauses indicate the collector is struggling to keep up with allocation.

```sql
SELECT
  startTime AS "Start",
  startTime + to_seconds(duration) AS "End",
  name AS "Phase",
  CAST(gcId AS VARCHAR) AS "GC"
FROM GCPhaseConcurrent
ORDER BY startTime
```

```plot
GANTT(start: "Start", end: "End", lane: "Phase", task: "GC") TITLE "Concurrent GC Phase Timeline" LINK_X($start, $end)
```

---

<!-- @cell name=gc-allocation-trigger -->

## Allocation Triggers

Application methods that directly triggered GC by allocating objects too large for TLAB. These are prime candidates for allocation reduction — consider object pooling or smaller allocation units.

*Requires `AllocationRequiringGC` events.*

```sql
SELECT * FROM "gc-allocation-trigger" LIMIT 20
```

```plot
BAR_CHART(x: "Trigger Method (Non-JDK)", y: ["Count"], horizontal: true) TITLE "Top GC Allocation Triggers"
```

---

<!-- @cell name=gc-references -->

## Reference Pressure

Soft, Weak, Phantom, and Final reference counts per GC. A rising Soft reference count means the JVM is holding objects in memory under memory pressure. Rising Final references suggest finalizer queue buildup.

*Requires `GCReferenceStatistics` events.*

```sql
SELECT "Time", "Soft Ref.", "Weak Ref.", "Phantom Ref.", "Final Ref."
FROM "gc-references"
ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Soft Ref.", "Weak Ref.", "Phantom Ref.", "Final Ref."]) TITLE "GC Reference Counts Over Time" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=system-gc-blockers -->

## Explicit System.gc() Calls

Code paths that call `System.gc()` explicitly. These force full collections regardless of heap occupancy and are almost always a performance bug.

*Requires `SystemGC` events.*

```sql
SELECT
    (c.javaName || '.' || m.name) AS "Caller",
    COUNT(*) AS "Calls"
FROM SystemGC s
JOIN Method m ON s.stackTrace$topApplicationMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY c.javaName, m.name
ORDER BY COUNT(*) DESC
LIMIT 20
```

```plot
TABLE() TITLE "Explicit System.gc() Callers"
```

---

<!-- @cell name=metaspace -->

## Metaspace Usage Over Time

Metaspace grows as classes are loaded. When it approaches the GC threshold, a Full GC is triggered. Continuous growth without plateauing indicates a class loader leak (e.g., from repeated hot deployments or dynamic code generation).

*Requires `MetaspaceSummary` events.*

```sql
SELECT * FROM "metaspace-over-time" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Metaspace Used MB", "GC Threshold MB"]) TITLE "Metaspace Usage Over Time" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=g1-regions -->

## G1 Heap Region Breakdown

Eden, Survivor, and Old generation sizes after each GC. A steadily growing Old Gen between mixed collections means G1's IHOP threshold may need tuning (`-XX:InitiatingHeapOccupancyPercent`).

*Only present for G1 recordings with `G1HeapSummary` events.*

```sql
SELECT * FROM "g1-heap-regions" ORDER BY "Time"
```

```plot
AREA_CHART(x: "Time", y: ["Eden MB", "Survivor MB", "Old Gen MB"], layout: "stacked") TITLE "G1 Heap Regions After Each GC" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=tenuring -->

## Survivor Tenuring Distribution

Object age distribution in survivor space after the most recent GC. Objects piling up at the max tenuring threshold are being promoted prematurely — the survivor space is too small. Consider `-XX:SurvivorRatio` or increasing `-Xmn`.

*Requires `TenuringDistribution` events (G1, CMS, Serial, Parallel collectors).*

```sql
SELECT "Age", "MB", "Objects", "Max Tenure Threshold", "Desired Survivor MB"
FROM "tenuring-distribution"
```

```plot
BAR_CHART(x: "Age", y: ["MB"]) TITLE "Survivor Age Distribution (most recent GC)" AXIS_X LABEL "Survivor Age" AXIS_Y LABEL "MB"
```

