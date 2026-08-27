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
  has-stringdedup: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_stringdedup'"
  has-metaspace: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_metaspace'"
  has-jfr-correlation: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_jfr_correlation'"
  has-safepoint: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_safepoint'"
---

<!-- @cell name=intro -->

## GC Log Analysis

A ready-to-run analysis of JVM garbage-collection logs captured with `-Xlog:gc*`.

**What's here:** Pause summary, heap timeline, phase breakdown, and collector-specific details (G1, ZGC, Parallel, CMS, Shenandoah). Load a `.log` file to begin.

---

<!-- @cell name=gc-init -->

## GC Overview

Algorithm, JDK version, heap configuration, and worker counts from JVM startup lines.

```sql
SELECT * FROM "jvmlog-gc-init-summary"
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
LINE(x="gcId", y="heapBeforeMB")
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

<!-- @cell name=metaspace-timeline requires="has-metaspace" -->

## Metaspace Timeline

Metaspace usage before and after each GC event.

```sql
SELECT * FROM "jvmlog-metaspace-timeline"
```

```plot
LINE(x="GC ID", y="Metaspace After (MB)")
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

<!-- @cell name=phase-timeline requires="has-gc-phase" -->

## Phase Timeline

Individual phase durations over JVM uptime — useful for spotting degradation trends.

```sql
SELECT * FROM "jvmlog-phase-timeline"
WHERE "Uptime (s)" IS NOT NULL
LIMIT 1000
```

```plot
SCATTER(x="Uptime (s)", y="Duration (ms)", color="Phase")
```

---

<!-- @cell name=g1-regions requires="has-g1-regions" -->

## G1: Region Counts

Eden, Survivor, Old, and Humongous region counts per GC event.

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
SELECT * FROM "jvmlog-g1-heap-expansion"
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
SELECT * FROM "jvmlog-zgc-director-summary"
```

```plot
TABLE()
```

---

<!-- @cell name=parallel-sizing requires="has-parallel" -->

## Parallel: Generation Sizing

Young and Old generation sizes and throughput per GC cycle.

```sql
SELECT * FROM "jvmlog-parallel-sizing"
```

```plot
LINE(x="GC ID", y="Throughput %")
```

---

<!-- @cell name=stringdedup requires="has-stringdedup" -->

## String Deduplication

Objects deduped, duration, and bytes saved per GC cycle.

```sql
SELECT * FROM "jvmlog-stringdedup-summary"
```

```plot
BAR(x="GC ID", y="Bytes Saved")
```

---

<!-- @cell name=safepoint-summary requires="has-safepoint" -->

## Safepoints

Safepoint operations ranked by total stop-the-world time.

```sql
SELECT * FROM "jvmlog-safepoint-summary"
```

```plot
BAR(x="Operation", y="Total (ms)")
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
