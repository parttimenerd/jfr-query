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

A ready-to-run analysis of garbage-collection behavior from your JFR recording. Sections below appear or hide based on what your recording actually contains.

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
