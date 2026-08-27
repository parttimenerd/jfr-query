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
  has-g1-mixed: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_g1_mixed_gc'"
  has-zgc: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_phases'"
  has-zgc-director: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_director'"
  has-zgc-load: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_load'"
  has-parallel: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_parallel_sizing'"
  has-stringdedup: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_stringdedup'"
  has-metaspace: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_metaspace'"
  has-jfr-correlation: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_jfr_correlation'"
  has-safepoint: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_safepoint'"
  has-alloc-stall: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_alloc_stall'"
  has-gc-errors: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_gc_errors'"
  has-combined-timeline: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_heap_snapshot'"
---

<!-- @cell name=intro -->

## GC Log Analysis

A ready-to-run analysis of JVM garbage-collection logs captured with `-Xlog:gc*`.

**What's here:** Pause summary and percentiles, heap + pause combined timeline, pause histogram, GC frequency, problematic GC events, error events, phase breakdown, and collector-specific details (G1, ZGC, Parallel, CMS, Shenandoah). Load a `.log` file to begin.

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

<!-- @cell name=pause-by-type -->

## Pause by GC Type

Count, average, and max pause grouped by GC algorithm / collection type.

```sql
SELECT * FROM "jvmlog-gc-pause-by-type"
```

```plot
BAR(x="Type", y="Avg (ms)")
```

---

<!-- @cell name=pause-percentiles -->

## Pause Percentiles

P50, P95, and P99 pause times per GC cause.

```sql
SELECT * FROM "jvmlog-pause-percentiles-by-cause"
```

```plot
BAR(x="Cause", y="P99 (ms)")
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

<!-- @cell name=cumulative-pause -->

## Cumulative Pause Time

Running total of stop-the-world time — shows how pause load accumulates over the JVM's lifetime.

```sql
SELECT * FROM "jvmlog-gc-cumulative-pause"
```

```plot
LINE(x="GC ID", y="Cumulative (ms)")
```

---

<!-- @cell name=combined-timeline requires="has-combined-timeline" -->

## Heap + Pause Combined Timeline

Pause duration and heap usage before/after each GC event in one view.

```sql
SELECT * FROM "jvmlog-combined-timeline"
```

```plot
LINE(x="Uptime (s)", y="Heap Before (MB)")
```

---

<!-- @cell name=problematic-gcs requires="has-combined-timeline" -->

## Problematic GC Events

GC events in the top 10% of pause time or reclaiming less than 10% of heap — the events most likely causing latency or memory pressure.

```sql
SELECT * FROM "jvmlog-problematic-gcs"
```

```plot
BAR(x="GC ID", y="Pause (ms)")
```

---

<!-- @cell name=gc-errors requires="has-gc-errors" -->

## GC Error Events

To-space exhaustion, evacuation failures, and OOM events.

```sql
SELECT * FROM "jvmlog-gc-error-summary"
```

```plot
BAR(x="Error Type", y="Count")
```

---

<!-- @cell name=heap-timeline requires="has-heap-snapshot" -->

## Heap Before / After

Heap usage before and after each GC event.

```sql
SELECT * FROM "jvmlog-heap-timeline"
```

```plot
LINE(x="gcId", y="Heap Before (MB)")
```

---

<!-- @cell name=heap-efficiency requires="has-heap-snapshot" -->

## Heap Collection Efficiency

Memory reclaimed per GC event as MB and percentage.

```sql
SELECT * FROM "jvmlog-heap-efficiency"
```

```plot
LINE(x="GC ID", y="Reclaim %")
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

<!-- @cell name=gc-frequency -->

## GC Frequency Over Time

Number of GC events and total pause per 10-second window — shows when GC pressure spikes.

```sql
SELECT * FROM "jvmlog-gc-frequency"
```

```plot
BAR(x="Window Start (s)", y="GC Count")
```

---

<!-- @cell name=pause-histogram -->

## Pause Duration Histogram

Distribution of pause durations across logarithmic buckets — reveals whether pauses cluster below latency targets.

```sql
SELECT * FROM "jvmlog-pause-histogram"
```

```plot
BAR(x="Bucket (ms)", y="Count")
```

---

<!-- @cell name=gc-pressure-timeline requires="has-combined-timeline" -->

## GC Pressure Timeline

Pause duration, heap before/after, and windowed GC overhead in a single scrollable view — use this to spot correlated heap pressure and latency spikes.

```sql
SELECT * FROM "jvmlog-gc-pressure-timeline"
```

```plot
SCATTER(x="Uptime (s)", y="Pause (ms)", color="Type")
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

<!-- @cell name=g1-cycle-detail requires="has-g1-regions" -->

## G1: Full Cycle Detail

Per-GC event with region counts, heap before/after, and pause duration in one scrollable table — the combined view for G1 cycle analysis.

```sql
SELECT * FROM "jvmlog-g1-cycle-detail"
```

```plot
SCATTER(x="GC ID", y="Pause (ms)", color="Type")
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

<!-- @cell name=g1-mixed requires="has-g1-mixed" -->

## G1: Mixed GC Decisions

When G1 decides to start or skip a mixed collection — driven by old-gen reclaimable percentage vs. threshold.

```sql
SELECT * FROM "jvmlog-g1-mixed-gc"
```

```plot
TABLE()
```

---

<!-- @cell name=g1-mixed-summary requires="has-g1-mixed" -->

## G1: Mixed GC Decision Summary

Counts of initiate/skip/do decisions with average reclaimable % — reveals if G1 is frequently skipping mixed collections.

```sql
SELECT * FROM "jvmlog-g1-mixed-gc-summary"
```

```plot
BAR(x="Decision", y="Count")
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

<!-- @cell name=zgc-load requires="has-zgc-load" -->

## ZGC: Load & Allocation Pressure

System load averages and allocation stalls per GC cycle — identifies cycles that ran under heavy application pressure.

```sql
SELECT * FROM "jvmlog-zgc-load"
```

```plot
LINE(x="GC ID", y="Load 1s")
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

<!-- @cell name=safepoint-timeline requires="has-safepoint" -->

## Safepoint Timeline

Individual safepoint events in log order — useful for spotting periodic or irregular stop-the-world spikes.

```sql
SELECT * FROM "jvmlog-safepoint-timeline"
```

```plot
SCATTER(x="#", y="Total (ms)", color="Operation")
```

---

<!-- @cell name=longest-pauses -->

## Longest GC Pauses

Top 20 individual GC pause events by duration.

```sql
SELECT * FROM "jvmlog-longest-pauses"
```

```plot
BAR(x="GC ID", y="Pause (ms)")
```

---

<!-- @cell name=alloc-stall requires="has-alloc-stall" -->

## Allocation Stalls

Threads stalled waiting for GC to free memory — grouped by thread name.

```sql
SELECT * FROM "jvmlog-alloc-stall-summary"
```

```plot
BAR(x="Thread", y="Total Stall (ms)")
```

---

<!-- @cell name=alloc-stall-timeline requires="has-alloc-stall" -->

## Allocation Stall Timeline

Individual stall events in log order.

```sql
SELECT * FROM "jvmlog-alloc-stall-timeline"
```

```plot
SCATTER(x="GC ID", y="Stall (ms)", color="Thread")
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
