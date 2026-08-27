---
title: GC Log Analysis
description: Analyse JVM -Xlog GC logs — pause summary, heap timeline, phase breakdown, and collector-specific details.
tags: [gc, jvmlog, performance]
license: MIT
cellConditions:
  has-heap-snapshot: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_heap_snapshot'"
  has-gc-phase: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_gc_phase'"
  has-g1-regions: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_g1_regions'"
  has-g1-ergo: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_g1_ergonomics'"
  has-zgc: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_phases'"
  has-zgc-director: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_director'"
  has-parallel: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_parallel_sizing'"
  has-jfr-correlation: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_jfr_correlation'"
---

<!-- @cell name=intro -->

## GC Log Analysis

A ready-to-run analysis of JVM garbage-collection logs captured with `-Xlog:gc*`.

**What's here:** Pause summary, heap timeline, phase breakdown, and collector-specific details (G1, ZGC, Parallel). Load a `.log` file to begin.

---

<!-- @cell name=gc-init -->

## GC Overview

Algorithm, JDK version, and heap configuration from JVM startup lines.

```sql
SELECT algorithm AS "Collector", jdkVersion AS "JDK Version",
       maxHeap / 1048576 AS "Max Heap (MB)", initialHeap / 1048576 AS "Initial Heap (MB)",
       parallelWorkers AS "Parallel Workers", concurrentWorkers AS "Concurrent Workers"
FROM jvmlog_gc_init LIMIT 5
```

```plot
TABLE()
```

---

<!-- @cell name=pause-summary -->

## Pause Summary

Count, total pause, and percentiles grouped by GC cause.

```sql
SELECT * FROM "jvmlog-gc-summary"
```

```plot
BAR(x="Cause", y="Total ms")
```

---

<!-- @cell name=pause-timeline -->

## Pause Timeline

Each GC pause coloured by GC type over JVM uptime.

```sql
SELECT uptimeSecs AS "Uptime (s)", pauseMs AS "Pause (ms)", gcType AS "Type", cause AS "Cause"
FROM jvmlog_gc_event
WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
ORDER BY uptimeSecs
```

```plot
SCATTER(x="Uptime (s)", y="Pause (ms)", color="Type")
```

---

<!-- @cell name=heap-timeline requires="has-heap-snapshot" -->

## Heap Before / After

Heap usage before and after each GC event.

```sql
SELECT * FROM "jvmlog-heap-timeline"
```

```plot
LINE(x="GC ID", y="Heap Before (MB)")
```

---

<!-- @cell name=gc-overhead -->

## GC Overhead

Stop-the-world time as a percentage of wall time, in 10-second windows.

```sql
SELECT * FROM "jvmlog-gc-overhead"
```

```plot
BAR(x="Window Start (s)", y="GC Overhead %")
```

---

<!-- @cell name=phase-breakdown requires="has-gc-phase" -->

## Phase Breakdown

Average and P99 duration per GC phase.

```sql
SELECT * FROM "jvmlog-phase-breakdown"
ORDER BY "Avg ms" DESC
```

```plot
BAR(x="Phase", y="Avg ms")
```

---

<!-- @cell name=g1-regions requires="has-g1-regions" -->

## G1: Region Counts

Eden region counts per GC event.

```sql
SELECT * FROM "jvmlog-g1-regions"
```

```plot
LINE(x="GC ID", y="Eden Before")
```

---

<!-- @cell name=g1-ergonomics requires="has-g1-ergo" -->

## G1: Ergonomics Decisions

Heap expand/shrink decisions.

```sql
SELECT gcId AS "GC ID",
       requestedExpansionBytes / 1048576.0 AS "Requested MB",
       actualExpansionBytes / 1048576.0 AS "Actual MB",
       decision AS "Decision"
FROM jvmlog_g1_ergonomics
ORDER BY gcId
```

```plot
TABLE()
```

---

<!-- @cell name=zgc-phases requires="has-zgc" -->

## ZGC: Phase Timeline

Concurrent vs stop-the-world time per GC cycle.

```sql
SELECT * FROM "jvmlog-zgc-cycle"
ORDER BY "GC ID"
```

```plot
BAR(x="GC ID", y="Concurrent ms")
```

---

<!-- @cell name=zgc-director requires="has-zgc-director" -->

## ZGC: Director Rules

Allocation rate, free heap %, and time-to-OOM that triggered each GC.

```sql
SELECT gcId AS "GC ID", ruleName AS "Rule",
       round(allocationRateMbps, 1) AS "Alloc Rate (MB/s)",
       round(freeHeapPct, 1) AS "Free Heap %",
       round(timeUntilOomSecs, 1) AS "Time to OOM (s)"
FROM jvmlog_zgc_director
ORDER BY gcId
```

```plot
TABLE()
```

---

<!-- @cell name=parallel-sizing requires="has-parallel" -->

## Parallel: Generation Sizing

Eden, Survivor, and Old generation sizes after each GC.

```sql
SELECT gcId AS "GC ID",
       youngGenBytes / 1048576.0 AS "Young Gen (MB)",
       oldGenBytes / 1048576.0 AS "Old Gen (MB)",
       round(throughputPct, 1) AS "Throughput %"
FROM jvmlog_parallel_sizing
ORDER BY gcId
```

```plot
LINE(x="GC ID", y="Throughput %")
```

---

<!-- @cell name=jfr-correlation requires="has-jfr-correlation" -->

## JFR vs Log Correlation

Side-by-side comparison of pause times from JFR and the GC log.

```sql
SELECT * FROM "jvmlog-jfr-correlation"
ORDER BY "Delta ms" DESC LIMIT 20
```

```plot
TABLE()
```

---

<!-- @cell name=unknown-lines -->

## Unmatched Log Lines

Log lines that did not match any known pattern.

```sql
SELECT tags AS "Tags", level AS "Level", messagePrefix AS "Message Prefix", count AS "Count"
FROM jvmlog_unknown_lines
ORDER BY count DESC
LIMIT 50
```

```plot
TABLE()
```
