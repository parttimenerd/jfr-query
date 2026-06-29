---
title: GC Analysis Expert
description: Activates JVM garbage-collection domain knowledge, inserts GC analysis cells, and adds /gc-analysis sub-commands.
tags: [gc, jvm, performance, memory]
icon: "♻"
commands:
  - name: overview
    description: "Insert a GC overview cell (recording timeline + collection summary)"
    cells: [gc-overview, gc-summary]
  - name: pauses
    description: "Show the longest GC pauses"
    cells: [gc-pauses]
  - name: phases
    description: "Break down GC pause time by phase"
    cells: [gc-phases]
  - name: help
    description: "Show available GC analysis commands"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM garbage-collection analysis expert embedded inside a JFR notebook. The user is investigating GC behaviour recorded in a JFR file loaded into DuckDB.

Key tables for GC analysis:
- `GarbageCollection` — one row per collection: gcId, cause, name (collector), sumOfPauses, longestPause, startTime, duration
- `GCPhasePause` — sub-phases of each GC: gcId, name, duration, startTime
- `GCPhasePauseLevel2` / `GCPhasePauseLevel3` — nested sub-phase detail
- `GCHeapSummary` — heap used/committed before and after each GC

When analysing GC:
- Always query `GarbageCollection` first to understand collection frequency and cause distribution
- Long pauses (longestPause * 1000 > 200ms) are usually Remark or Mixed phases in G1
- `cause = 'G1 Humongous Allocation'` indicates objects ≥ regionSize/2 bypassing TLAB
- For ZGC: pauses are < 1ms; look at concurrent phase durations instead
- For Shenandoah: check evacuation failures via cause
- Always suggest the user look at allocation rate if they see frequent collections
- Recommend `$sessionStart` / `$sessionEnd` variables to scope time windows

Prefer SQL that surfaces actionable insight: top pause causes, worst pauses, phase breakdown, heap reclamation efficiency. Keep queries short (< 20 lines). Use the TABLE() or BAR_CHART() plot types.

## Cells

<!-- @skill-cell name=gc-overview -->

## GC Recording Overview

```sql
-- alias gc_overview
SELECT
  strftime('%Y-%m-%d %H:%M:%S', recording_start()::TIMESTAMP) AS "Recording Start",
  strftime('%Y-%m-%d %H:%M:%S', recording_end()::TIMESTAMP)   AS "Recording End",
  round((epoch_ms(recording_end()) - epoch_ms(recording_start())) / 1000.0, 1) AS "Duration (s)",
  COUNT(*)                                          AS "Total Collections",
  round(SUM(sumOfPauses) * 1000, 1)                AS "Total Pause (ms)",
  round(AVG(longestPause) * 1000, 2)               AS "Avg Longest Pause (ms)",
  round(MAX(longestPause) * 1000, 2)               AS "Max Pause (ms)"
FROM GarbageCollection
```

```plot
TABLE()
```

<!-- @skill-cell name=gc-summary -->

## GC Summary by Cause

```sql
-- alias gc_by_cause
SELECT
  cause,
  name                                          AS "Collector",
  COUNT(*)                                      AS "Collections",
  round(SUM(sumOfPauses)  * 1000, 1)           AS "Total Pause (ms)",
  round(AVG(longestPause) * 1000, 2)           AS "Avg Pause (ms)",
  round(MAX(longestPause) * 1000, 2)           AS "Max Pause (ms)"
FROM GarbageCollection
GROUP BY cause, name
ORDER BY SUM(sumOfPauses) DESC
```

```plot
BAR_CHART(x: "cause", y: ["Total Pause (ms)"]) TITLE "Total GC Pause Time by Cause"
```

<!-- @skill-cell name=gc-pauses -->

## Longest GC Pauses

```sql
-- alias gc_long_pauses
SELECT
  gcId,
  cause,
  name                                          AS "Collector",
  round(longestPause * 1000, 2)                AS "Longest Pause (ms)",
  round(sumOfPauses  * 1000, 2)                AS "Sum of Pauses (ms)",
  strftime('%H:%M:%S.%f', startTime::TIMESTAMP) AS "Start Time"
FROM GarbageCollection
ORDER BY longestPause DESC
LIMIT 25
```

```plot
TABLE()
```

<!-- @skill-cell name=gc-phases -->

## GC Phase Breakdown

```sql
-- alias gc_phases
SELECT
  name                            AS "Phase",
  COUNT(*)                        AS "Count",
  round(SUM(duration)  * 1000, 1) AS "Total (ms)",
  round(AVG(duration)  * 1000, 2) AS "Avg (ms)",
  round(MAX(duration)  * 1000, 2) AS "Max (ms)"
FROM GCPhasePause
GROUP BY name
ORDER BY SUM(duration) DESC
LIMIT 20
```

```plot
BAR_CHART(x: "Phase", y: ["Total (ms)"]) TITLE "GC Phase Time Distribution"
```
