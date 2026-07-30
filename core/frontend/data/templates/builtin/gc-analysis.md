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
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)"], layout: "grouped") TITLE "GC Pause Time by Cause"
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
