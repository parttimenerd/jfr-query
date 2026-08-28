---
title: GC Log Analysis
description: Analyse JVM -Xlog GC logs — pause summary, heap timeline, phase breakdown, and collector-specific details.
tags: [gc, jvmlog, performance]
license: MIT
cellConditions:
  has-jvmlog-gc: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_gc_event'"
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
  has-gc-workers: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_gc_workers'"
  has-jfr-correlation: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_jfr_correlation'"
  has-safepoint: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_safepoint'"
  has-alloc-stall: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_alloc_stall'"
  has-gc-errors: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_gc_errors'"
  has-combined-timeline: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_heap_snapshot'"
  has-shenandoah: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_shenandoah_free'"
  has-zgc-stats: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'jvmlog_zgc_stats'"
---

<!-- @cell name=intro -->

## GC Log Analysis

A ready-to-run analysis of JVM garbage-collection logs captured with `-Xlog:gc*`.

**What's here:** Health dashboard, memory leak risk, SLA impact summary, collector diagnostics, pause summary and percentiles, heap + pause combined timeline, pause histogram, GC frequency, problematic GC events, error events, phase breakdown, and collector-specific details (G1, ZGC, Parallel, CMS, Shenandoah). Load a `.log` file to begin.

---

<!-- @cell name=collector-diagnostics requires="has-jvmlog-gc" -->

## Detected Collector and Collector-Specific Diagnostics

Auto-detects which GC collector is in use and provides targeted tuning guidance — **start here** for any GC log analysis session to orient which views are most relevant for your collector.

```sql
SELECT * FROM "jvmlog-collector-diagnostics"
```

---

<!-- @cell name=gc-health-dashboard requires="has-jvmlog-gc" -->

## GC Health Dashboard

Single-row KPI summary — pause percentiles, GC overhead, throughput, and automated **Health Status** verdict. The Health Status column gives an immediate diagnosis of the most critical GC issue found.

```sql
SELECT * FROM "jvmlog-gc-health-dashboard"
```

---

<!-- @cell name=gc-sla-impact-summary requires="has-jvmlog-gc" -->

## GC SLA Impact Summary

Multi-dimensional SLA compliance check — evaluates 4 key SLA criteria (200ms pause, 500ms pause, <10% GC overhead, <5% Full GC rate) with a PASS/FAIL verdict for each. Any FAIL row indicates a production-level SLA breach.

```sql
SELECT * FROM "jvmlog-gc-sla-impact-summary"
```

---

<!-- @cell name=memory-leak-risk requires="has-heap-snapshot" -->

## Memory Leak Risk Assessment

Linear regression on heap-after-GC values to detect steady heap growth — HIGH RISK with high R² means a confirmed leak; MEDIUM RISK means gradual growth; LOW RISK means the live data set is stable.

```sql
SELECT * FROM "jvmlog-memory-leak-risk"
```

---

<!-- @cell name=alloc-pressure-correlation requires="has-heap-snapshot" -->

## Allocation Pressure Correlation

Per-GC allocation rate combined with heap utilisation — CRITICAL rows (high utilisation AND high allocation rate) are the most dangerous cycles; these are the precursors to OOM errors.

```sql
SELECT * FROM "jvmlog-alloc-pressure-correlation"
```

```plot
LINE(x="Uptime (s)", y="Alloc Rate MB/s", color="Pressure Level")
```

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

<!-- @cell name=overall-pause-percentiles -->

## Overall Pause Percentiles

P50, P90, P95, P99, and max pause across all GC events — the key SLA check.

```sql
SELECT * FROM "jvmlog-pause-percentiles"
```

```plot
TABLE()
```

---

<!-- @cell name=throughput-summary -->

## Application Throughput

Time NOT spent in GC — the primary health metric. 99%+ throughput means < 1% of time is GC.

```sql
SELECT * FROM "jvmlog-throughput-summary"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-health-score -->

## GC Health Score

Traffic-light GC health assessment: throughput, P99 pause, Full GC count, and primary concern — the GCeasy-style diagnostic overview.

```sql
SELECT * FROM "jvmlog-gc-health-score"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-recommendations -->

## GC Tuning Recommendations

SQL-driven recommendations for each diagnostic category — severity-ranked from Critical to OK, with specific JVM flag suggestions. Inspired by GCeasy's recommendation engine.

```sql
SELECT * FROM "jvmlog-gc-recommendations"
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

<!-- @cell name=gc-type-breakdown -->

## GC Type Breakdown

Events classified into Young GC, Full GC, Concurrent STW, and other categories — shows what fraction of time each category consumes.

```sql
SELECT * FROM "jvmlog-gc-type-breakdown"
```

```plot
BAR(x="GC Category", y="% of Pause Time")
```

---

<!-- @cell name=young-vs-old-time -->

## Young vs Old Generation GC Time

STW time split between Young-only, Mixed, Full/Major, and concurrent-STW collections — a high Full GC share is a red flag; high Mixed GC share is normal for G1 managing Old gen.

```sql
SELECT * FROM "jvmlog-young-vs-old-time"
```

```plot
BAR(x="Generation Type", y="Total Pause (ms)")
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

<!-- @cell name=pause-variance -->

## Pause Time Variance by Cause

Standard deviation and coefficient of variation (CV) per GC cause — high CV (> 100%) means pause times are wildly inconsistent even if the average looks acceptable, causing unpredictable latency.

```sql
SELECT * FROM "jvmlog-pause-variance"
```

```plot
BAR(x="Cause", y="CV %")
```

---

<!-- @cell name=pause-sla -->

## Pause SLA Compliance

What fraction of pauses fall within common latency targets — maps directly to SLA requirements.

```sql
SELECT * FROM "jvmlog-pause-sla"
```

```plot
BAR(x="SLA Threshold (ms)", y="Pauses Within (%)")
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

<!-- @cell name=gc-error-timeline requires="has-gc-errors" -->

## GC Error Timeline

Error events in context — when each failure occurred during the JVM run and what pause surrounded it.

```sql
SELECT * FROM "jvmlog-gc-error-timeline"
```

```plot
SCATTER(x="Uptime (s)", y="Pause (ms)", color="Error Type")
```

---

<!-- @cell name=full-gc-analysis -->

## Full GC Events

Full GC and forced-collection events sorted by pause duration — these are the highest-latency events. Frequent Full GC with `Ergonomics` cause indicates the JVM can't recover with minor collections.

```sql
SELECT * FROM "jvmlog-full-gc-analysis"
```

```plot
BAR(x="GC ID", y="Pause (ms)")
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

<!-- @cell name=heap-fragmentation requires="has-heap-snapshot" -->

## Heap Fragmentation / Over-Reservation

Committed-but-unused heap headroom — large persistent headroom (> 50%) means the JVM is reserving far more heap than it needs. Consider reducing `-Xmx` if the headroom never shrinks.

```sql
SELECT * FROM "jvmlog-heap-fragmentation"
```

```plot
TABLE()
```

---

<!-- @cell name=heap-reclaim-ratio requires="has-combined-timeline" -->

## Heap Reclaim Ratio by Cause

Average heap reclaimed as a percentage of heap-before, grouped by GC cause. A low `Avg Reclaim %` for `Allocation Failure` indicates GC cannot keep up with allocation pressure — the JVM reclaims little before the next allocation cycle.

```sql
SELECT * FROM "jvmlog-heap-reclaim-ratio"
```

```plot
BAR(x="Cause", y="Avg Reclaim %")
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

<!-- @cell name=heap-fill-at-trigger requires="has-combined-timeline" -->

## Heap Fill Level at GC Trigger

How full is the heap when each GC cause fires? Near-full triggers (> 90%) indicate the GC is barely keeping up — any allocation spike will cause a long pause or OOM.

```sql
SELECT * FROM "jvmlog-heap-fill-at-trigger"
```

```plot
BAR(x="Cause", y="Avg Fill % Before")
```

---

<!-- @cell name=allocation-rate requires="has-combined-timeline" -->

## Allocation Rate

Heap allocation between consecutive GC events — high allocation rate drives frequent GC cycles and can reveal allocation hotspots.

```sql
SELECT * FROM "jvmlog-allocation-rate"
```

```plot
LINE(x="Uptime (s)", y="Allocation Rate (MB/s)")
```

---

<!-- @cell name=allocation-rate-timeline requires="has-combined-timeline" -->

## Allocation Rate Timeline

Average and peak allocation rate (MB/s) per 10-second window — rising peaks identify allocation bursts that spike GC pressure.

```sql
SELECT * FROM "jvmlog-allocation-rate-timeline"
```

```plot
LINE(x="Window Start (s)", y="Avg Alloc Rate (MB/s)")
```

---

<!-- @cell name=heap-growth-summary requires="has-combined-timeline" -->

## Heap Growth Summary

Linear regression over heap-after-GC values — positive growth rate with high R² strongly suggests a memory leak.

```sql
SELECT * FROM "jvmlog-heap-growth-summary"
```

```plot
TABLE()
```

---

<!-- @cell name=oom-risk-estimate requires="has-heap-snapshot" -->

## OOM Risk Estimate

Extrapolates the current heap growth rate (linear regression) to estimate time-to-OOM. Only meaningful when R² > 0.5 indicating a consistent growth trend. If the JVM is not leaking, this will report "No clear growth trend".

```sql
SELECT * FROM "jvmlog-oom-risk-estimate"
```

```plot
TABLE()
```

---

<!-- @cell name=heap-growth-trend requires="has-combined-timeline" -->

## Heap Growth Trend

Heap usage after each GC event over time with per-window max — a rising baseline is the hallmark of a memory leak.

```sql
SELECT * FROM "jvmlog-heap-growth-trend"
```

```plot
LINE(x="Window Start (s)", y="Max Heap After (MB)")
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

<!-- @cell name=throughput-degradation -->

## Throughput Degradation Trend

Linear regression on windowed application throughput — a declining trend (negative slope, high R²) indicates accumulating GC pressure over the JVM run. Use this to catch the "boiling frog" scenario where throughput slowly erodes.

```sql
SELECT * FROM "jvmlog-throughput-degradation"
```

```plot
TABLE()
```

---

<!-- @cell name=concurrent-overhead requires="has-gc-phase" -->

## Concurrent GC Overhead

Total time spent in concurrent GC phases as a percentage of JVM uptime — measures the background work overhead for G1/ZGC/Shenandoah. High values (> 20%) with low STW is normal for these collectors.

```sql
SELECT * FROM "jvmlog-concurrent-overhead"
```

```plot
TABLE()
```

---

<!-- @cell name=throughput-timeline -->

## Throughput Over Time

Application throughput per 10-second window — a declining trend here is a strong indicator of accumulating GC pressure.

```sql
SELECT * FROM "jvmlog-throughput-timeline"
```

```plot
LINE(x="Window Start (s)", y="Throughput %")
```

---

<!-- @cell name=pause-regression -->

## Pause Time Regression

P95 and P99 pause time per 30-second window — a rising P99 over time reveals GC degradation from memory pressure, fragmentation, or heap growth.

```sql
SELECT * FROM "jvmlog-pause-regression"
```

```plot
LINE(x="Window Start (s)", y="P99 Pause (ms)")
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

<!-- @cell name=cause-distribution -->

## GC Cause Distribution

What is triggering GC — typically dominated by allocation pressure, but `System.gc()` or ergonomics-driven causes indicate problems.

```sql
SELECT * FROM "jvmlog-cause-distribution"
```

```plot
BAR(x="Cause", y="Count")
```

---

<!-- @cell name=cause-first-occurrence -->

## GC Cause First Occurrence

When each GC cause first appeared during the JVM run — late-appearing causes (e.g., `Metadata GCThreshold` appearing at 300s) indicate class loading bursts or triggered operations that started well into the run.

```sql
SELECT * FROM "jvmlog-cause-first-occurrence"
```

```plot
BAR(x="Cause", y="First Occurrence (s)")
```

---

<!-- @cell name=gc-interval-stats -->

## GC Interval Statistics

Min, average, and P99 time between GC events — short P99 intervals indicate the JVM spends most of its time in GC.

```sql
SELECT * FROM "jvmlog-gc-interval-stats"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-interval-timeline -->

## GC Interval Timeline

Time between consecutive GC events over JVM lifetime — shrinking gaps indicate accelerating allocation pressure.

```sql
SELECT "Uptime (s)", "Interval (s)", "Type", "Cause" FROM "jvmlog-gc-interval"
WHERE "Interval (s)" IS NOT NULL
ORDER BY "Uptime (s)"
```

```plot
SCATTER(x="Uptime (s)", y="Interval (s)", color="Type")
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

<!-- @cell name=metaspace-detail requires="has-metaspace" -->

## Metaspace + Class Space Detail

Metaspace and compressed class space usage side-by-side — useful for tracking class loader leaks.

```sql
SELECT * FROM "jvmlog-metaspace-detail"
```

```plot
LINE(x="GC ID", y="Metaspace After (MB)")
```

---

<!-- @cell name=metaspace-growth-trend requires="has-metaspace" -->

## Metaspace Growth Trend

Linear regression on metaspace-after-GC values — high R² combined with positive growth rate strongly indicates a class loader leak. Class Space growth is a secondary signal.

```sql
SELECT * FROM "jvmlog-metaspace-growth-trend"
```

```plot
TABLE()
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

<!-- @cell name=phases-per-gc requires="has-gc-phase" -->

## Phase Count per GC Cycle

How many phases execute per GC cycle, and total phase time — a lower-than-average phase count may indicate an aborted cycle; a higher count indicates more work phases were activated (e.g., reference processing).

```sql
SELECT * FROM "jvmlog-phases-per-gc"
```

```plot
TABLE()
```

---

<!-- @cell name=g1-mark-trend requires="has-gc-phase" -->

## G1: Concurrent Mark Duration Trend

Linear regression on concurrent mark durations over time — a degrading trend (positive slope, high R²) indicates an increasing live set or reduced CPU availability for concurrent marking, often a precursor to concurrent mark failures and Full GC.

```sql
SELECT * FROM "jvmlog-g1-mark-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=phase-top-slow requires="has-gc-phase" -->

## Slowest Phase Executions

Top 5 slowest individual executions per GC phase — reveals outlier events where a normally fast phase ran unusually long, indicating JVM or OS interference.

```sql
SELECT * FROM "jvmlog-phase-top-slow"
```

```plot
SCATTER(x="GC ID", y="Duration (ms)", color="Phase")
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

<!-- @cell name=gc-worker-summary requires="has-gc-workers" -->

## GC Worker Utilisation

Average and minimum worker thread counts per task — low utilisation indicates GC is not using all available parallel threads.

```sql
SELECT * FROM "jvmlog-gc-worker-summary"
```

```plot
BAR(x="Task", y="Utilisation %")
```

---

<!-- @cell name=gc-worker-efficiency-trend requires="has-gc-workers" -->

## GC Worker Efficiency Trend

Worker thread utilization regression per task — a declining trend indicates adaptive parallelism is reducing GC thread counts over the JVM run, which can limit throughput recovery under load spikes.

```sql
SELECT * FROM "jvmlog-gc-worker-efficiency-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-worker-timeline requires="has-gc-workers" -->

## GC Worker Usage Timeline

Per-GC worker usage — spot individual events where parallelism was reduced (e.g., thread pool contention or adaptive sizing).

```sql
SELECT * FROM "jvmlog-gc-worker-timeline"
LIMIT 1000
```

```plot
SCATTER(x="GC ID", y="Utilisation %", color="Task")
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

<!-- @cell name=g1-survivor-trend requires="has-g1-regions" -->

## G1: Survivor Region Trend

Survivor space usage and trend — survivor space at capacity (> 90% of max) causes premature promotion to the Old generation, accelerating Old gen growth and mixed GC pressure.

```sql
SELECT * FROM "jvmlog-g1-survivor-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=g1-old-region-trend requires="has-g1-regions" -->

## G1: Old Region Growth Trend

Linear regression on Old region count after each GC — a growing Old generation (positive slope, high R²) indicates promotion rate exceeds reclaim rate, often leading to mixed GC pressure and eventual concurrent mark failures.

```sql
SELECT * FROM "jvmlog-g1-old-region-trend"
```

```plot
TABLE()
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

<!-- @cell name=g1-humongous requires="has-g1-regions" -->

## G1: Humongous Object Analysis

G1 cycles where humongous regions (objects > 50% of region size) are present — allocation of humongous objects bypasses Eden, triggers concurrent cycles early, and increases fragmentation risk.

```sql
SELECT * FROM "jvmlog-g1-humongous"
```

```plot
BAR(x="GC ID", y="Humongous Before")
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

<!-- @cell name=heap-resize-summary requires="has-g1-ergo" -->

## G1: Heap Resize Summary

Expand vs shrink decision counts, total, and average sizes — frequent expansions with no shrinks suggests -Xms is too low.

```sql
SELECT * FROM "jvmlog-heap-resize-summary"
```

```plot
BAR(x="Decision", y="Count")
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

<!-- @cell name=zgc-phase-breakdown requires="has-zgc" -->

## ZGC: Phase Type Breakdown

All ZGC phases grouped by STW vs concurrent and by work category (Mark/Relocate/Reference Processing). Shows which phase categories dominate total cycle time.

```sql
SELECT * FROM "jvmlog-zgc-phase-breakdown"
```

```plot
BAR(x="Phase", y="Total (ms)", color="Type")
```

---

<!-- @cell name=zgc-generational requires="has-zgc" -->

## ZGC: Generational Breakdown (JDK 21+)

Young vs Old generation collection stats for Generational ZGC — cycle counts, total and average concurrent time, and max pause per generation.

```sql
SELECT * FROM "jvmlog-zgc-generational"
```

```plot
BAR(x="Generation", y="Total Concurrent (ms)")
```

---

<!-- @cell name=zgc-cycle-detail requires="has-zgc" -->

## ZGC: Full Cycle Detail

Per-cycle view combining pause time, concurrent work, heap before/after, and allocation pressure — scroll through cycles to correlate spikes.

```sql
SELECT * FROM "jvmlog-zgc-cycle-detail"
```

```plot
SCATTER(x="GC ID", y="Concurrent (ms)")
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

<!-- @cell name=zgc-allocation-rate requires="has-zgc-load" -->

## ZGC: Allocation Rate per Cycle

Per-GC-cycle allocation rate (MB/s) from the `[gc,load]` tag — spikes show when the application momentarily outpaces the GC and allocation stalls begin.

```sql
SELECT * FROM "jvmlog-zgc-allocation-rate"
```

```plot
LINE(x="GC ID", y="Alloc Rate (MB/s)")
```

---

<!-- @cell name=zgc-stats requires="has-zgc-stats" -->

## ZGC: Per-Cycle Live Set & Garbage

Used heap at each phase boundary (Mark Start, Mark End, Relocate Start/End) and live vs garbage breakdown — the key sizing data logged under `-Xlog:gc+stats`.

```sql
SELECT * FROM "jvmlog-zgc-stats"
```

```plot
LINE(x="GC ID", y="Live (MB)")
```

---

<!-- @cell name=zgc-garbage-ratio requires="has-zgc-stats" -->

## ZGC: Garbage Ratio per Cycle

Average and range of garbage % at Relocate Start — the fraction of heap that is garbage. High garbage % (> 60%) means efficient work; low garbage % means ZGC is running too often or the heap is dominated by live objects.

```sql
SELECT * FROM "jvmlog-zgc-garbage-ratio"
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

<!-- @cell name=parallel-gc-detail requires="has-parallel" -->

## Parallel: Full Cycle Detail

Per-cycle view combining pause duration, Young and Old generation sizes, and adaptive throughput percentage — the combined view for Parallel/CMS cycle analysis.

```sql
SELECT * FROM "jvmlog-parallel-gc-detail"
```

```plot
SCATTER(x="GC ID", y="Pause (ms)", color="Type")
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

<!-- @cell name=safepoint-ttr-stats requires="has-safepoint" -->

## Safepoint Time-to-Reach (TTR) Analysis

Time for all threads to reach a safepoint, per operation. High TTR % of STW indicates slow safepoint entry — commonly caused by long JNI calls, tight loops without safepoint polls, or large JIT-compiled methods.

```sql
SELECT * FROM "jvmlog-safepoint-ttr-stats"
```

```plot
BAR(x="Operation", y="P99 TTR (ms)")
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

<!-- @cell name=gc-efficiency-by-cause -->

## GC Efficiency by Cause

Heap reclaimed per millisecond of pause per GC cause — causes with low MB/ms are wasting stop-the-world budget and may benefit from tuning (e.g., `-XX:+ExplicitGCInvokesConcurrent` to handle `System.gc()` concurrently).

```sql
SELECT * FROM "jvmlog-gc-efficiency-by-cause"
```

```plot
BAR(x="Cause", y="MB Reclaimed/ms")
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

<!-- @cell name=top-pauses-by-cause -->

## Top Pauses by Cause

Top 10 longest pause events per GC cause — pinpoints the worst individual latency offenders within each trigger category.

```sql
SELECT * FROM "jvmlog-top-pauses-by-cause"
```

```plot
SCATTER(x="Uptime (s)", y="Pause (ms)", color="Cause")
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

<!-- @cell name=alloc-stall-rate-timeline requires="has-alloc-stall" -->

## Allocation Stall Rate Timeline

Stall count and duration per 30-second window — bursts of stalls show when GC throughput was insufficient to keep up with allocation and application threads were directly impacted.

```sql
SELECT * FROM "jvmlog-alloc-stall-rate-timeline"
```

```plot
BAR(x="Window Start (s)", y="Stalls")
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

<!-- @cell name=shenandoah-cycle-detail requires="has-shenandoah" -->

## Shenandoah: Full Cycle Detail

Per-cycle view with all pause phases (Init Mark, Final Mark, Init Update Refs, Final Update Refs), total STW, and heap before/after — the combined view for Shenandoah cycle analysis.

```sql
SELECT * FROM "jvmlog-shenandoah-cycle-detail"
```

```plot
BAR(x="GC ID", y="Total STW (ms)")
```

---

<!-- @cell name=shenandoah-mode-analysis requires="has-shenandoah" -->

## Shenandoah: Mode Analysis

Normal vs Degenerated vs Full GC classification — Degenerated and Full GC indicate Shenandoah cannot keep pace with allocation and has fallen back to stop-the-world collection. Frequent degraded cycles are a sign of allocation rate exceeding GC capacity.

```sql
SELECT * FROM "jvmlog-shenandoah-mode-analysis"
```

```plot
BAR(x="Mode", y="Count")
```

---

<!-- @cell name=shenandoah-headroom requires="has-shenandoah" -->

## Shenandoah: Free Headroom Analysis

Free headroom (space available before triggering Degenerated GC) with trend. Declining headroom means Shenandoah's concurrency margin is shrinking — when it hits zero, degenerated or full GC fires.

```sql
SELECT * FROM "jvmlog-shenandoah-headroom"
```

```plot
TABLE()
```

---

<!-- @cell name=shenandoah-free-timeline requires="has-shenandoah" -->

## Shenandoah: Free Heap Timeline

Free heap regions and headroom per GC cycle — shows how close the JVM is to running out of space and triggering degenerated or full GC.

```sql
SELECT * FROM "jvmlog-shenandoah-free-timeline"
```

```plot
LINE(x="GC ID", y="Free (MB)")
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
SELECT * FROM "jvmlog-unknown-summary"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-log-quality -->

## GC Log Quality Diagnostic

Log completeness check — missing GC IDs indicate log rotation or truncation, unmatched lines suggest new or non-standard patterns.

```sql
SELECT * FROM "jvmlog-gc-log-quality"
```

```plot
TABLE()
```

---

<!-- @cell name=evacuation-failure-detail requires="has-gc-errors" -->

## G1 Evacuation Failure Detail

G1 evacuation failure and to-space exhaustion events with heap fill level and pause overhead — each event here is a serious degradation where the GC couldn't complete normal evacuation.

```sql
SELECT * FROM "jvmlog-evacuation-failure-detail"
```

```plot
TABLE()
```

---

<!-- @cell name=log-time-range -->

## GC Log Coverage Statistics

First and last GC timestamps, total log duration, GC event rate, and overall pause overhead — a quick sanity check on how much of the JVM's lifetime the log captures.

```sql
SELECT * FROM "jvmlog-log-time-range"
```

```plot
TABLE()
```

---

<!-- @cell name=concurrent-gc-efficiency requires="has-phases" -->

## Concurrent vs STW Phase Time Split

What fraction of total GC phase work happens concurrently (off the application thread) vs as stop-the-world pauses. High concurrent % indicates an efficient concurrent collector configuration.

```sql
SELECT * FROM "jvmlog-concurrent-gc-efficiency"
```

```plot
BAR(x="Phase Class", y="% of All Phase Time", color="Phase Class")
```

---

<!-- @cell name=cause-pause-stats -->

## Pause Statistics per GC Cause

Full pause detail per GC cause: count, total, average, min, max, p50/p95/p99 percentiles, and standard deviation — equivalent to GCeasy's GC Causes panel.

```sql
SELECT * FROM "jvmlog-cause-pause-stats"
```

```plot
BAR(x="GC Cause", y="Avg Pause (ms)", color="GC Cause")
```

---

<!-- @cell name=pause-by-minute -->

## Pause Summary per Minute

GC activity bucketed into 1-minute windows: count, total/avg/min/max pause and overhead % per minute — mirrors GCViewer's pause-per-minute histogram for spotting bursty GC behaviour.

```sql
SELECT * FROM "jvmlog-pause-by-minute"
```

```plot
BAR(x="Minute", y="Total Pause (ms)")
```

---

<!-- @cell name=allocation-rate-trend -->

## Allocation Rate Trend

Allocation rate statistics derived from inter-GC heap growth: avg/min/max/p95 rates and a regression-based trend assessment — growing allocation pressure can indicate a memory leak or workload change.

```sql
SELECT * FROM "jvmlog-allocation-rate-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-init-detail requires="has-gc-init" -->

## JVM GC Configuration Detail

Extended JVM GC configuration parameters from gc,init lines: heap sizes, worker counts, hardware resources, and collector-specific settings.

```sql
SELECT * FROM "jvmlog-gc-init-detail"
```

```plot
TABLE()
```

---

<!-- @cell name=full-gc-frequency -->

## Full GC Frequency and Impact

Full GC count, pause times, inter-event interval, heap fill at trigger, reclaim efficiency, and rate per minute — high frequency or short intervals indicate severe memory pressure.

```sql
SELECT * FROM "jvmlog-full-gc-frequency"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-type-per-minute -->

## GC Type Activity per Minute

Young, Mixed, Full, and Concurrent-STW GC counts per 1-minute window — spot shifts in GC pattern over time, equivalent to GCeasy's GC Activity Chart.

```sql
SELECT * FROM "jvmlog-gc-type-per-minute"
```

```plot
BAR(x="Minute", y="Count", color="GC Type")
```

---

<!-- @cell name=memory-reclaimed -->

## Memory Reclaimed per GC

Bytes freed per GC type: avg/min/max/p50/p95 reclaim and total GBs reclaimed — shows which GC types do the most memory recovery work.

```sql
SELECT * FROM "jvmlog-memory-reclaimed"
```

```plot
BAR(x="GC Type", y="Avg Reclaimed (MB)", color="GC Type")
```

---

<!-- @cell name=pause-outliers -->

## GC Pause Outliers

Pauses that are statistical outliers (|Z-score| > 2.0 from mean) — abnormally long pauses indicate heap pressure, JIT de-optimisation, or safepoint delays and deserve individual investigation.

```sql
SELECT * FROM "jvmlog-pause-outliers"
ORDER BY "Z-Score" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=heap-after-trend -->

## Post-GC Heap Level Trend

Post-GC heap fill % trend over the log — a rising trend indicates live data set growth and potential memory leak, mirroring GCViewer's tenured generation fill chart.

```sql
SELECT * FROM "jvmlog-heap-after-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=alloc-pressure-timeline -->

## Allocation Pressure Timeline

Bytes allocated between consecutive GCs and instantaneous allocation rate — allocation spikes show up as sudden jumps in allocated MB or MB/s.

```sql
SELECT * FROM "jvmlog-alloc-pressure-timeline"
```

```plot
LINE(x="Uptime (s)", y="Alloc Rate (MB/s)")
```

---

<!-- @cell name=sla-breach-by-cause -->

## SLA Breach Rate per GC Cause

Pause SLA breach counts per GC cause at 200ms, 500ms, and 1s thresholds with breach % — shows which causes are responsible for the most latency violations.

```sql
SELECT * FROM "jvmlog-sla-breach-by-cause"
ORDER BY "Breaches >200ms" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=pause-burst-windows -->

## High-Pause Burst Windows

Consecutive sequences of GC pauses >200ms — bursts of back-to-back high pauses indicate sustained heap pressure or concurrent-mode failure, not isolated spikes.

```sql
SELECT * FROM "jvmlog-pause-burst-windows"
ORDER BY "Total Pause (ms)" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=health-timeline -->

## GC Health Score Over Time

Health score (0-100) per 1-minute window — tracks how GC health evolves over the log and surfaces degradation periods that a single aggregate score conceals.

```sql
SELECT * FROM "jvmlog-health-timeline"
```

```plot
LINE(x="Minute", y="Health Score")
```

---

<!-- @cell name=heap-efficiency-by-type -->

## Heap Efficiency per GC Type

MB reclaimed per ms of pause by GC type — high efficiency means fast, effective reclamation; Full GC typically has the lowest ratio despite large reclaim volumes.

```sql
SELECT * FROM "jvmlog-heap-efficiency-by-type"
```

```plot
BAR(x="GC Type", y="MB/ms (Efficiency)", color="GC Type")
```

---

<!-- @cell name=gc-cause-heatmap -->

## GC Cause Activity Heatmap

GC cause × 5-minute uptime window — cross-tabulation showing when specific causes dominate and how the cause mix evolves across the log duration.

```sql
SELECT * FROM "jvmlog-gc-cause-heatmap"
ORDER BY "5-Min Window", "Total Pause (ms)" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=interval-distribution -->

## Inter-GC Interval Distribution

Histogram of time between consecutive GC events — frequent very-short intervals (<0.1s) indicate extreme GC pressure; long intervals (10s+) indicate a healthy, lightly-loaded heap.

```sql
SELECT * FROM "jvmlog-interval-distribution"
```

```plot
BAR(x="Interval Bucket", y="Count")
```

---

<!-- @cell name=live-data-estimate -->

## Live Data Set Estimate

Minimum and p10 post-GC heap levels approximate the live data set — the floor of memory the JVM cannot reclaim regardless of GC effort. Compare against heap max to check head room.

```sql
SELECT * FROM "jvmlog-live-data-estimate"
```

```plot
TABLE()
```

---

<!-- @cell name=young-gc-frequency -->

## Young GC Frequency Over Time

Young GC count and pause time per 1-minute window — a rising rate indicates increasing allocation pressure; consistently high rates suggest the Young gen is undersized.

```sql
SELECT * FROM "jvmlog-young-gc-frequency"
```

```plot
LINE(x="Minute", y="Young GC Count")
```

---

<!-- @cell name=allocation-surges -->

## Allocation Rate Surges

GCs where the preceding allocation rate was a statistical outlier (Z-score > 2.0) — burst allocation spikes often trigger emergency or back-to-back GCs.

```sql
SELECT * FROM "jvmlog-allocation-surges"
ORDER BY "Z-Score" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=safepoint-heatmap requires="has-safepoints" -->

## Safepoint Operation Frequency Heatmap

Safepoint operation count and STW time per 1-minute window — shows which operations dominate in each period and whether problematic operations cluster at a particular time.

```sql
SELECT * FROM "jvmlog-safepoint-heatmap"
ORDER BY "Minute", "Total STW (ms)" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=class-space-trend requires="has-metaspace" -->

## Class Space Growth Trend

Linear regression on class space after each GC — steadily growing class space indicates classloader accumulation, a common source of `OutOfMemoryError: Metaspace`.

```sql
SELECT * FROM "jvmlog-class-space-trend"
```

```plot
TABLE()
```

---

<!-- @cell name=throughput-consistency -->

## GC Throughput Consistency

Coefficient of variation (CV%) of per-minute GC overhead — low CV% means steady overhead; high CV% means erratic GC spikes that cause unpredictable latency.

```sql
SELECT * FROM "jvmlog-throughput-consistency"
```

```plot
TABLE()
```

---

<!-- @cell name=heap-headroom-timeline -->

## Heap Headroom Over Time

Post-GC headroom (free capacity) per GC event — declining headroom means the JVM is approaching the heap ceiling and Full GCs are increasingly likely.

```sql
SELECT * FROM "jvmlog-heap-headroom-timeline"
```

```plot
LINE(x="Uptime (s)", y="Headroom %")
```

---

<!-- @cell name=concurrent-mode-failure requires="has-gc-errors" -->

## Concurrent Mode Failure Analysis

Rates of evacuation failures, to-space exhaustion, degenerated GCs, and OOM events — these indicate the concurrent collector cannot keep pace with allocation pressure.

```sql
SELECT * FROM "jvmlog-concurrent-mode-failure"
ORDER BY "Count" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=metaspace-pressure requires="has-metaspace" -->

## Metaspace Pressure Assessment

Metaspace usage vs committed, peak fill %, growth rate, and health assessment — detects `OutOfMemoryError: Metaspace` risk before it occurs.

```sql
SELECT * FROM "jvmlog-metaspace-pressure"
```

```plot
TABLE()
```

---

<!-- @cell name=pause-histogram-by-type -->

## Pause Time Histogram per GC Type

Pause distribution bucketed by GC type — reveals whether Young GCs have a long tail that would be hidden in the global pause histogram.

```sql
SELECT * FROM "jvmlog-pause-histogram-by-type"
ORDER BY "GC Type", "Pause Bucket"
```

```plot
TABLE()
```

---

<!-- @cell name=alloc-reclaim-balance -->

## Allocation vs Reclaim Balance

Total allocated vs reclaimed across the log and the net live data set growth — high net growth is a strong indicator of a memory leak or growing workload.

```sql
SELECT * FROM "jvmlog-alloc-reclaim-balance"
```

```plot
TABLE()
```

---

<!-- @cell name=cause-categories -->

## GC Cause Category Summary

GC causes grouped into high-level categories (Evacuation, Allocation Pressure, Explicit, Ergonomics, Metaspace, etc.) — simplifies cause analysis when many distinct cause strings appear.

```sql
SELECT * FROM "jvmlog-cause-categories"
ORDER BY "Total GCs" DESC
```

```plot
BAR(x="Category", y="Total GCs", color="Category")
```

---

<!-- @cell name=gc-cpu-estimate -->

## Estimated GC CPU Consumption

Approximate CPU-seconds consumed by GC: total STW pause × GC worker threads, and GC's share of total CPU capacity — useful for capacity planning.

```sql
SELECT * FROM "jvmlog-gc-cpu-estimate"
```

```plot
TABLE()
```

---

<!-- @cell name=pause-heap-correlation -->

## Pause Duration vs Heap Fill Correlation

Pearson correlation and regression between heap fill % at GC trigger and pause duration per GC type — strong correlation means heap pressure directly drives longer pauses.

```sql
SELECT * FROM "jvmlog-pause-heap-correlation"
ORDER BY "Correlation (r)" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=overhead-by-type -->

## Pause Overhead Contribution per GC Type

Which GC types account for the most total pause time? Full GC typically dominates despite being rare; this view separates each type's share of total overhead.

```sql
SELECT * FROM "jvmlog-overhead-by-type"
ORDER BY "Total Pause (ms)" DESC
```

```plot
BAR(x="GC Type", y="% of All Pause", color="GC Type")
```

---

<!-- @cell name=g1-old-gen-tracking requires="has-g1-regions" -->

## G1 Old Generation Region Tracking

Old region count before/after per GC type — mixed GCs should reduce Old region count; positive average delta means the Old gen is growing despite GC effort.

```sql
SELECT * FROM "jvmlog-g1-old-gen-tracking"
ORDER BY "Avg Δ vs Previous GC" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=phase-by-gc-type requires="has-phases" -->

## Phase Duration by GC Type

Average, max, and p95 phase durations broken down by GC type — highlights which phases dominate within each collection type and cross-type timing differences.

```sql
SELECT * FROM "jvmlog-phase-by-gc-type"
ORDER BY "GC Type", "Total (ms)" DESC
LIMIT 40
```

```plot
TABLE()
```

---

<!-- @cell name=zgc-minor-vs-major requires="has-zgc-phases" -->

## ZGC Minor vs Major Cycle Comparison

Young (minor) vs Old/Full (major) ZGC cycle counts and timing — high major frequency or growing major duration indicates old generation pressure in generational ZGC.

```sql
SELECT * FROM "jvmlog-zgc-minor-vs-major"
```

```plot
BAR(x="Cycle Type", y="Avg Duration (ms)", color="Cycle Type")
```

---

<!-- @cell name=pause-spike-frequency -->

## Pause Spike Frequency Over Time

High-pause event count per 1-minute window at 100ms/200ms/500ms/1s thresholds — identifies which periods had the most latency violations and whether they're isolated or recurring.

```sql
SELECT * FROM "jvmlog-pause-spike-frequency"
```

```plot
LINE(x="Minute", y="Spikes >200ms")
```

---

<!-- @cell name=app-vs-gc-time -->

## Application vs GC Time Running Totals

Cumulative GC time and running throughput % per GC event — shows whether GC overhead is accelerating, decelerating, or steady across the full log duration.

```sql
SELECT * FROM "jvmlog-app-vs-gc-time"
ORDER BY "Uptime (s)"
LIMIT 200
```

```plot
LINE(x="Uptime (s)", y="Running GC Overhead %")
```

---

<!-- @cell name=metaspace-expansions requires="has-metaspace" -->

## Metaspace Expansion Events

GC events where metaspace usage grew by >1MB since the previous GC — repeated expansions indicate steady class loading or a classloader leak.

```sql
SELECT * FROM "jvmlog-metaspace-expansions"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-pressure-index -->

## GC Pressure Index Over Time

Composite pressure score (0-100) per 1-minute window combining overhead, max pause, heap fill, full GC count, and spike count — a single number to quickly spot the most problematic periods.

```sql
SELECT * FROM "jvmlog-gc-pressure-index"
```

```plot
LINE(x="Minute", y="Pressure Index")
```

---

<!-- @cell name=long-concurrent-phases requires="has-phases" -->

## Long Concurrent Phase Detection

Concurrent phases with duration more than 2 standard deviations above their mean — unusually long concurrent marks can delay the next pause and indicate heap pressure or OS interference.

```sql
SELECT * FROM "jvmlog-long-concurrent-phases"
ORDER BY "Z-Score" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=eden-fill-at-trigger requires="has-g1-regions" -->

## Eden Region Fill at GC Trigger

Eden fill % at GC trigger per GC type — consistently low fill means G1 is over-triggering; consistently 100% means Eden is too small for the allocation rate.

```sql
SELECT * FROM "jvmlog-eden-fill-at-trigger"
```

```plot
BAR(x="GC Type", y="Avg Eden Fill %", color="GC Type")
```

---

<!-- @cell name=trend-summary -->

## Multi-Metric Trend Summary

Pause duration, heap fill at trigger, and post-GC heap level trends in a single view — each with slope, R², and a plain-language direction assessment.

```sql
SELECT * FROM "jvmlog-trend-summary"
```

```plot
TABLE()
```

---

<!-- @cell name=safepoint-ttr-outliers requires="has-safepoints" -->

## Safepoint Time-to-Reach Outliers

Safepoints where time-to-reach was more than 2 standard deviations above the mean — often caused by JNI, compiled loops without safepoint polls, or OS scheduling delays.

```sql
SELECT * FROM "jvmlog-safepoint-ttr-outliers"
ORDER BY "Z-Score" DESC
```

```plot
TABLE()
```

---

<!-- @cell name=survivor-occupancy-timeline requires="has-g1-regions" -->

## G1 Survivor Region Occupancy Timeline

Survivor region fill % per GC event — consistently high survivor fill indicates objects surviving too many collections and being promoted to the Old gen prematurely.

```sql
SELECT * FROM "jvmlog-survivor-occupancy-timeline"
LIMIT 200
```

```plot
LINE(x="Uptime (s)", y="Survivor Fill %")
```

---

<!-- @cell name=stringdedup-rate-timeline requires="has-stringdedup" -->

## String Dedup Savings Rate Timeline

String deduplication savings per 1-minute window — declining savings rate over time may indicate reduced dedup effectiveness or changing string allocation patterns.

```sql
SELECT * FROM "jvmlog-stringdedup-rate-timeline"
```

```plot
LINE(x="Minute", y="Bytes Saved (MB)")
```

---

<!-- @cell name=full-gc-recovery -->

## Full GC Recovery Analysis

Per-Full-GC detail: heap fill before/after, bytes reclaimed, reclaim %, and MB/ms efficiency — low reclaim % after a Full GC indicates a very high live data set.

```sql
SELECT * FROM "jvmlog-full-gc-recovery"
ORDER BY "Uptime (s)"
```

```plot
TABLE()
```

---

<!-- @cell name=dominant-cause-timeline -->

## Dominant GC Cause per 5-Minute Window

The most frequent GC cause per 5-minute window — cause transitions (e.g., from Evacuation to Allocation Failure) indicate escalating heap pressure.

```sql
SELECT * FROM "jvmlog-dominant-cause-timeline"
```

```plot
TABLE()
```

---

<!-- @cell name=heap-max-proximity requires="has-jvmlog-gc" -->

## Heap Utilisation vs Committed Ceiling

Per-GC heap before/after as a percentage of the committed heap ceiling — a rising "Before / Committed %" trend means the JVM is running out of headroom and will soon trigger GC at every allocation.

```sql
SELECT * FROM "jvmlog-heap-max-proximity"
```

```plot
LINE(x="Uptime (s)", y="Before / Committed %", color="GC Type")
```

---

<!-- @cell name=gc-type-mix-trend requires="has-jvmlog-gc" -->

## GC Type Mix Over Time

Young/Mixed/Full GC counts and percentages per 5-minute window — a growing Full% means the heap is no longer reclaimable by minor collections; a growing Mixed% signals G1 is struggling to stay ahead of tenuring.

```sql
SELECT * FROM "jvmlog-gc-type-mix-trend"
```

```plot
BAR(x="5-Min Window", y=["Young %","Mixed %","Full %"], stacked=true)
```

---

<!-- @cell name=alloc-rate-by-cause requires="has-jvmlog-gc" -->

## Allocation Rate by GC Cause

Average, max, and p95 allocation rate (MB/s) grouped by trigger cause — "Allocation Failure" at high rates means objects are being allocated faster than minor GC can reclaim them; other causes at high rates reveal unexpected pressure sources.

```sql
SELECT * FROM "jvmlog-alloc-rate-by-cause"
```

```plot
TABLE()
```

---

<!-- @cell name=pause-trend-by-cause requires="has-jvmlog-gc" -->

## Pause Duration Trend per GC Cause

Linear regression of pause time over JVM uptime for each cause — "Degrading" causes have a statistically significant positive slope (R² > 0.4), meaning pauses for that cause are reliably getting longer as the session progresses.

```sql
SELECT * FROM "jvmlog-pause-trend-by-cause"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-footprint requires="has-heap-snapshot" -->

## Heap Footprint Summary

GCViewer-style heap footprint: min/avg/max heap after GC and committed heap across the entire log — the minimum heap after GC is the true working set, and max committed shows peak reservation.

```sql
SELECT * FROM "jvmlog-gc-footprint"
```

```plot
TABLE()
```

---

<!-- @cell name=heap-committed-timeline requires="has-heap-snapshot" -->

## Committed Heap Timeline

Committed and used heap at every GC event — a flat committed line with rising utilisation% indicates the JVM has stopped resizing (Xms=Xmx or GCLocker) and saturation is imminent.

```sql
SELECT * FROM "jvmlog-heap-committed-timeline"
```

```plot
LINE(x="Uptime (s)", y=["Used Before (MB)","Committed (MB)"])
```

---

<!-- @cell name=pause-sla-compliance requires="has-jvmlog-gc" -->

## Pause SLA Compliance

Percentage of GC pauses under common latency thresholds — GCeasy-style pass/fail for 10 ms, 50 ms, 100 ms, 200 ms, and 500 ms pause budgets.

```sql
SELECT * FROM "jvmlog-pause-sla-compliance"
```

```plot
TABLE()
```

---

<!-- @cell name=g1-humongous-timeline requires="has-g1-regions" -->

## G1 Humongous Region Count Timeline

Humongous regions before/after each GC — persistent humongous regions across GCs indicate large object retention; a high before-count that doesn't drop after GC means those objects are still live.

```sql
SELECT * FROM "jvmlog-g1-humongous-timeline"
```

```plot
LINE(x="Uptime (s)", y="Humongous Regions Before")
```

---

<!-- @cell name=concurrent-stall-timeline requires="has-alloc-stall" -->

## Concurrent GC Allocation Stall Rate

Allocation stall count and cumulative stall time in rolling 20-event buckets — for ZGC/Shenandoah, stalls mean the mutator was blocked waiting for the concurrent collector to catch up.

```sql
SELECT * FROM "jvmlog-concurrent-stall-timeline"
```

```plot
BAR(x="Bucket (20 events)", y="Total Stall (ms)")
```

---

<!-- @cell name=heap-reclaim-efficiency requires="has-heap-snapshot" -->

## Heap Reclaim Efficiency

MB reclaimed per ms of pause time, grouped by GC type and cause — low efficiency means GC spends more pause time per unit of heap freed, indicating fragmentation or high tenure pressure.

```sql
SELECT * FROM "jvmlog-heap-reclaim-efficiency"
```

```plot
BAR(x="GC Type", y="Reclaim Rate (MB/ms)")
```

---

<!-- @cell name=safepoint-non-gc requires="has-safepoint" -->

## Non-GC Safepoint Operations

JIT deoptimisation, biased-lock revocation, and other non-GC STW events — these contribute to application pauses independent of the garbage collector.

```sql
SELECT * FROM "jvmlog-safepoint-non-gc"
```

```plot
BAR(x="Operation", y="Total STW (ms)")
```

---

<!-- @cell name=young-gen-sizing-trend requires="has-g1-regions" -->

## G1 Young Generation Sizing Trend

Eden and Survivor max region counts per GC event — G1 adapts the young generation size dynamically; steady growth in Eden max means G1 is responding to allocation pressure by enlarging the young generation.

```sql
SELECT * FROM "jvmlog-young-gen-sizing-trend"
```

```plot
LINE(x="Uptime (s)", y=["Eden Max Regions","Survivor Max Regions"])
```

---

<!-- @cell name=gc-interval-histogram requires="has-jvmlog-gc" -->

## GC Interval Distribution

Histogram of inter-GC times — a spike in '< 0.1s' means GCs are back-to-back (heap exhaustion); a spike in '>= 30s' means GC is infrequent (healthy throughput mode for ZGC/Shenandoah).

```sql
SELECT * FROM "jvmlog-gc-interval-histogram"
```

```plot
BAR(x="Interval Bucket", y="Count")
```

---

<!-- @cell name=phase-worst-by-type requires="has-gc-phase" -->

## Worst GC Phases per GC Type

Top-5 slowest phases per GC collection type — identifies where Young GC and Mixed GC spend most of their pause budget, enabling focused tuning of the dominant phases.

```sql
SELECT * FROM "jvmlog-phase-worst-by-type"
```

```plot
TABLE()
```

---

<!-- @cell name=promotion-rate requires="has-heap-snapshot" -->

## Object Promotion Rate to Old Gen

Estimated heap growth between consecutive Young GCs per minute — a proxy for object promotion rate; sustained high values mean survivor spaces are overflowing into Old gen, raising Full GC risk.

```sql
SELECT * FROM "jvmlog-promotion-rate"
```

```plot
LINE(x="Minute", y="Total Promoted (MB)")
```

---

<!-- @cell name=metaspace-gc-trigger requires="has-metaspace" -->

## Metaspace-Triggered GC Events

GC events caused by Metadata GC Threshold or Last Ditch Collection — repeated metaspace-triggered GCs indicate class loading pressure or classloader leaks.

```sql
SELECT * FROM "jvmlog-metaspace-gc-trigger"
```

```plot
TABLE()
```

---

<!-- @cell name=g1-mixed-trigger-analysis requires="has-g1-mixed" -->

## G1 Mixed GC Trigger Analysis

G1 ergonomics decisions to start or skip mixed GC cycles, with reclaimable% vs threshold% — if "Skip Mixed GC" dominates, G1 is abandoning cycles because too little Old gen is reclaimable.

```sql
SELECT * FROM "jvmlog-g1-mixed-trigger-analysis"
```

```plot
TABLE()
```

---

<!-- @cell name=concurrent-phase-efficiency requires="has-gc-phase" -->

## Concurrent Phase Efficiency

Ratio of STW pause to preceding concurrent work per GC event — a high Pause/Concurrent% means the concurrent collector fell behind, forcing more STW work during the final pause.

```sql
SELECT * FROM "jvmlog-concurrent-phase-efficiency"
ORDER BY "Pause / Concurrent %" DESC
LIMIT 50
```

```plot
TABLE()
```

---

<!-- @cell name=heap-saturation-events requires="has-heap-snapshot" -->

## Heap Saturation Events (≥ 90% Full)

GC events where heap was at least 90% full before collection — repeated saturation events mean the JVM is running at the edge of capacity and OutOfMemoryError is imminent without heap expansion.

```sql
SELECT * FROM "jvmlog-heap-saturation-events"
```

```plot
TABLE()
```

---

<!-- @cell name=gc-burst-detection requires="has-jvmlog-gc" -->

## GC Burst Windows (Rapid-Fire GC)

30-second windows with more than 3 GC events — burst GC means the application is allocating faster than minor GC can keep up with, indicating allocation-rate spikes or heap exhaustion.

```sql
SELECT * FROM "jvmlog-gc-burst-detection"
```

```plot
BAR(x="Window Start (s)", y="GC Count in 30s")
```

---

<!-- @cell name=full-gc-cause-summary requires="has-jvmlog-gc" -->

## Full GC Events by Cause

Full/Major GC events grouped by trigger cause — System.gc() indicates explicit calls; Allocation Failure or Last Ditch Collection means heap is exhausted.

```sql
SELECT * FROM "jvmlog-full-gc-cause-summary"
```

```plot
BAR(x="Cause", y="Full GCs")
```

---

<!-- @cell name=gc-duration-vs-pause requires="has-jvmlog-gc" -->

## Total Duration vs STW Pause Ratio

STW pause as a fraction of total GC duration per collection type — concurrent collectors should have a low STW/Duration%; a rising ratio means concurrent phases are being cut short and more work falls into STW.

```sql
SELECT * FROM "jvmlog-gc-duration-vs-pause"
```

```plot
BAR(x="GC Type", y="STW / Duration %")
```

---

<!-- @cell name=zgc-garbage-ratio-by-cycle requires="has-zgc" -->

## ZGC Garbage vs Live Bytes per Cycle

Live and garbage bytes at Relocate Start per ZGC cycle — Garbage% shows how much of the heap is actual garbage; low Garbage% means ZGC is working hard for small gains.

```sql
SELECT * FROM "jvmlog-zgc-garbage-ratio-by-cycle"
```

```plot
LINE(x="Uptime (s)", y="Garbage %")
```

---

<!-- @cell name=zgc-load-timeline requires="has-zgc-load" -->

## ZGC System Load and Allocation Rate per Cycle

System load averages and allocation rate at each ZGC cycle — high load at GC time means CPU contention with other processes; rising allocation rate often precedes allocation stalls.

```sql
SELECT * FROM "jvmlog-zgc-load-timeline"
```

```plot
LINE(x="Uptime (s)", y="Alloc Rate (MB/s)")
```

---

<!-- @cell name=gc-worker-utilisation requires="has-gc-workers" -->

## GC Worker Thread Utilisation

Average workers used vs available per GC task — tasks consistently below 80% utilisation indicate under-parallelisation; may be tunable with `-XX:ParallelGCThreads`.

```sql
SELECT * FROM "jvmlog-gc-worker-utilisation"
```

```plot
BAR(x="Task", y="Utilisation %")
```

---

<!-- @cell name=gc-pause-by-hour requires="has-jvmlog-gc" -->

## GC Pause Aggregated by Hour

Total and average GC pause per hour of JVM uptime — useful for detecting degradation over long-running sessions; rising GC overhead% per hour indicates heap fragmentation or tenuring pressure buildup.

```sql
SELECT * FROM "jvmlog-gc-pause-by-hour"
```

```plot
BAR(x="Hour", y="GC Overhead %")
```

---

<!-- @cell name=old-gen-growth requires="has-g1-regions" -->

## G1 Old Generation Growth Trend

Old generation region count after each GC with rolling 10-GC trend — a consistently positive trend means Old gen is growing faster than GC can reclaim it, a precursor to Concurrent Mode Failure.

```sql
SELECT * FROM "jvmlog-old-gen-growth"
```

```plot
LINE(x="Uptime (s)", y="Old Regions After GC")
```

---

<!-- @cell name=shenandoah-summary requires="has-jvmlog-gc" -->

## Shenandoah Pause Summary by Phase

Shenandoah STW phase breakdown — Init/Final Mark and Update Refs should be short (< 10ms); long Final Mark means concurrent marking didn't finish in time; Degenerated means a full STW fallback occurred.

```sql
SELECT * FROM "jvmlog-shenandoah-summary"
```

```plot
BAR(x="STW Phase", y="Avg Pause (ms)")
```

---

<!-- @cell name=gc-summary requires="has-jvmlog-gc" -->

## GC Pause Summary by Cause

GC event counts, total pause, and percentiles grouped by cause — the highest "Total ms" cause is your primary optimization target; repeated "Allocation Failure" triggers indicate the heap is too small or allocation rate too high.

```sql
SELECT * FROM "jvmlog-gc-summary"
```

```plot
BAR(x="Cause", y="Total ms")
```

---

<!-- @cell name=gc-pause-by-type requires="has-jvmlog-gc" -->

## GC Pause by Collector Type

Average and maximum pause grouped by GC type (Young, Mixed, Full) — Full GC pauses orders-of-magnitude higher than Young GC indicates a problem with the tenured generation.

```sql
SELECT * FROM "jvmlog-gc-pause-by-type"
```

```plot
BAR(x="Type", y="Avg (ms)")
```

---

<!-- @cell name=gc-cumulative-pause requires="has-jvmlog-gc" -->

## Cumulative GC Pause Over Time

Running total of STW pause time — a steep slope means GC is consuming an increasing fraction of runtime; a flat region indicates a period of low GC activity.

```sql
SELECT * FROM "jvmlog-gc-cumulative-pause"
```

```plot
LINE(x="GC ID", y="Cumulative (ms)")
```

---

<!-- @cell name=pause-percentiles-by-cause requires="has-jvmlog-gc" -->

## Pause Percentiles by Cause

P50/P95/P99/Max breakdown per trigger cause — compare P99 to your SLA target; causes with high P99 relative to median indicate occasional very long pauses that will breach latency budgets.

```sql
SELECT * FROM "jvmlog-pause-percentiles-by-cause"
```

```plot
BAR(x="Cause", y="P99 (ms)")
```

---

<!-- @cell name=gc-phase-breakdown requires="has-gc-phases" -->

## GC Phase Breakdown (Sub-Phase Timing)

Time spent per internal GC phase across all GCs — the slowest phase is the bottleneck; phases with high max/avg ratios indicate occasional stragglers.

```sql
SELECT * FROM "jvmlog-gc-phase-breakdown"
```

```plot
BAR(x="Phase", y="Avg (ms)")
```

---

<!-- @cell name=gc-init-summary requires="has-jvmlog-gc" -->

## JVM GC Initialisation Summary

GC algorithm, JDK version, heap sizing, and thread counts recorded at startup — verify that Xmx, initial heap, and worker counts match your deployment configuration.

```sql
SELECT * FROM "jvmlog-gc-init-summary"
```

---

<!-- @cell name=heap-snapshot-raw requires="has-heap-snapshot" -->

## Raw Heap Snapshot per GC

Per-GC before/after heap and committed sizes — use this as the raw data source for custom heap analysis; committed growing over time without dropping indicates heap fragmentation.

```sql
SELECT * FROM "jvmlog-heap-snapshot-raw"
```

```plot
LINE(x="GC ID", y="Heap After (MB)")
```

---

<!-- @cell name=zgc-cycle requires="has-zgc-stats" -->

## ZGC Cycle — Concurrent vs Pause Time

Per-cycle split between concurrent phase time and STW pause time — ZGC should spend < 1ms in STW; rising STW time signals a load spike or insufficient concurrent threads.

```sql
SELECT * FROM "jvmlog-zgc-cycle"
```

```plot
BAR(x="GC ID", y="Pause ms")
```

---

<!-- @cell name=zgc-director-summary requires="has-zgc-stats" -->

## ZGC Director Decision Summary

ZGC director's per-cycle rule triggers, allocation rate, free heap %, and time-to-OOM estimates — watch for low "Time to OOM" values which indicate the allocator is racing against GC.

```sql
SELECT * FROM "jvmlog-zgc-director-summary"
```

---

<!-- @cell name=stringdedup-summary requires="has-jvmlog-gc" -->

## String Deduplication Summary

Per-GC string deduplication statistics — bytes saved and objects deduplicated; if savings are near zero, deduplication is not reducing footprint and may be disabled.

```sql
SELECT * FROM "jvmlog-stringdedup-summary"
```

```plot
BAR(x="GC ID", y="Bytes Saved")
```

---

<!-- @cell name=gc-error-summary requires="has-gc-errors" -->

## GC Error and Failure Summary

Counts and average durations for GC error types (Concurrent Mode Failure, Evacuation Failure, etc.) — any non-zero count warrants immediate investigation.

```sql
SELECT * FROM "jvmlog-gc-error-summary"
```

```plot
BAR(x="Error Type", y="Count")
```

---

<!-- @cell name=gc-interval requires="has-jvmlog-gc" -->

## GC Interval Between Collections

Time elapsed between consecutive GC events — very short intervals (< 1s) indicate the allocator is always triggering GC; increasing intervals with stable pause time means load is reducing.

```sql
SELECT * FROM "jvmlog-gc-interval"
```

```plot
LINE(x="Uptime (s)", y="Interval (s)")
```

---

<!-- @cell name=gc-pause-summary requires="has-jvmlog-gc" -->

## GC Pause Raw Summary Table

Per-GC pause, duration, type, and cause in chronological order — useful for spotting individual outlier events that skew averages in aggregate views.

```sql
SELECT * FROM "jvmlog-gc-pause-summary"
```

---

<!-- @cell name=unknown-summary requires="has-jvmlog-gc" -->

## Unknown GC Cause Summary

GC events where the cause could not be determined — a large count indicates log parsing gaps or a GC algorithm that does not log cause; investigate with `-Xlog:gc*:file` for full output.

```sql
SELECT * FROM "jvmlog-unknown-summary"
```

---

<!-- @cell name=g1-heap-expansion requires="has-jvmlog-gc" -->

## G1 Heap Expansion Events

G1 GC heap expansion decisions: requested and actual expansion sizes — frequent expansions indicate Xms is set too low; the JVM is growing the heap reactively under allocation pressure.

```sql
SELECT * FROM "jvmlog-g1-heap-expansion"
```

---

<!-- @cell name=g1-mixed-gc requires="has-g1-mixed" -->

## G1 Mixed GC Decision Log

G1 mixed GC triggering decisions including reclaimable percentage and threshold — when reclaimable% stays above threshold without triggering mixed GC, tune `-XX:G1MixedGCCountTarget`.

```sql
SELECT * FROM "jvmlog-g1-mixed-gc"
```

---

<!-- @cell name=g1-mixed-gc-summary requires="has-g1-mixed" -->

## G1 Mixed GC Summary

Aggregated statistics for G1 mixed GC decisions: how often the decision was triggered and average reclaimable fraction — low reclaimable% at trigger time means old gen is not accumulating garbage efficiently.

```sql
SELECT * FROM "jvmlog-g1-mixed-gc-summary"
```


---

<!-- @cell name=safepoint-sync-hotspot requires="has-safepoint" -->

## Safepoint Operations — Thread Sync Hotspots

Safepoint operations ranked by maximum thread rendezvous time — high sync time (> 10ms) means threads are slow to reach a safe state; common culprits are JNI critical sections, unrolled counted loops, and high thread counts.

```sql
SELECT * FROM "jvmlog-safepoint-sync-hotspot"
```

```plot
BAR(x="Operation", y="Max Sync (ms)")
```

---

<!-- @cell name=zgc-liveness-trend requires="has-zgc-stats" -->

## ZGC Live Set Trend at Relocate Start

Live and garbage fractions per ZGC cycle at the moment relocation begins — growing live% indicates long-lived object accumulation; garbage% below 30% suggests ZGC is over-triggering.

```sql
SELECT * FROM "jvmlog-zgc-liveness-trend"
```

```plot
LINE(x="GC ID", y="Live %")
```

---

<!-- @cell name=shenandoah-concurrent-efficiency requires="has-gc-phases" -->

## Shenandoah Concurrent-to-STW Efficiency

Per-cycle ratio of concurrent phase time to total cycle time — STW fraction above 10% means concurrent phases are not finishing before the heap fills, leading to degenerated or full GC fallbacks.

```sql
SELECT * FROM "jvmlog-shenandoah-concurrent-efficiency"
```

```plot
LINE(x="GC ID", y="STW Fraction (%)")
```

---

<!-- @cell name=heap-before-after-delta requires="has-heap-snapshot" -->

## Heap Before/After Delta per GC

Per-GC heap reclaim in MB and as a fraction of pre-GC heap — reclaim% below 50% for Young GC indicates oversized survivor regions or too-low tenuring threshold.

```sql
SELECT * FROM "jvmlog-heap-before-after-delta"
```

```plot
LINE(x="Uptime (s)", y="Reclaimed (MB)")
```

---

<!-- @cell name=gc-overhead-trend requires="has-jvmlog-gc" -->

## GC Overhead Trend Over Time

Percentage of application time spent in GC per 5-minute window with severity label — Critical (≥10%) is an OutOfMemoryError risk; High (5-10%) will degrade p99 latency.

```sql
SELECT * FROM "jvmlog-gc-overhead-trend"
```

```plot
LINE(x="Uptime (min)", y="GC Overhead %")
```


---

<!-- @cell name=alloc-stall-summary requires="has-alloc-stall" -->

## Allocation Stall Summary by Thread

Per-thread allocation stall statistics — threads with high total stall time are the primary victims of GC pressure; cross-reference with the allocation rate view to identify the producer threads.

```sql
SELECT * FROM "jvmlog-alloc-stall-summary"
```

```plot
BAR(x="Thread", y="Total Stall (ms)")
```


---

<!-- @cell name=gc-pause-regression requires="has-jvmlog-gc" -->

## GC Pause Degradation Trend (Linear Regression)

Linear regression of pause time over JVM uptime — a positive slope means GC is getting slower over time; "Projected +1h Change" shows expected additional milliseconds of pause per GC after one hour at the current trend.

```sql
SELECT * FROM "jvmlog-gc-pause-regression"
```

---

<!-- @cell name=alloc-stall-by-gc requires="has-alloc-stall" -->

## Allocation Stalls per GC Cycle

GC cycles ranked by total allocation stall time they caused — the top entries here held up application threads the longest; cross-reference GC ID with the pause summary to confirm whether the stall-causing GC was also the longest STW event.

```sql
SELECT * FROM "jvmlog-alloc-stall-by-gc"
```

```plot
BAR(x="GC ID", y="Total Stall (ms)")
```

---

<!-- @cell name=zgc-reloc-pressure requires="has-zgc-stats" -->

## ZGC Relocation Pressure

Per-cycle ZGC heap usage at Mark Start, Relocate Start, and Relocate End — "Allocated During Mark" quantifies how much the application allocated while ZGC was marking concurrently; if this exceeds "Freed by Reloc", allocation is outpacing the collector.

```sql
SELECT * FROM "jvmlog-zgc-reloc-pressure"
```

```plot
LINE(x="GC ID", y="Allocated During Mark (MB)")
```

---

<!-- @cell name=phase-timing-matrix requires="has-gc-phases" -->

## GC Phase Timing Matrix

All internal GC phases ranked by total time — the highest "Total (ms)" phase is the throughput bottleneck; phases with Max/Avg ratios > 5x have occasional stragglers that inflate tail latency.

```sql
SELECT * FROM "jvmlog-phase-timing-matrix"
```

```plot
BAR(x="Phase", y="Total (ms)")
```

---

<!-- @cell name=safepoint-operation-mix requires="has-safepoint" -->

## Safepoint Operation Mix Over Time

Safepoint activity in 6 equal time buckets — rising "Total STW" across buckets indicates increasing safepoint pressure; growing "Distinct Ops" means more types of operations are triggering stop-the-world events over time.

```sql
SELECT * FROM "jvmlog-safepoint-operation-mix"
```

```plot
LINE(x="Bucket", y="Total STW (ms)")
```


---

<!-- @cell name=heap-usage-histogram requires="has-heap-snapshot" -->

## Post-GC Heap Usage Distribution

Histogram of heap sizes after GC in 50MB buckets — the modal bucket is your typical resting heap size; buckets concentrated near Xmx mean the heap has no headroom after collection.

```sql
SELECT * FROM "jvmlog-heap-usage-histogram"
```

```plot
BAR(x="Heap After Bucket (MB)", y="GC Count")
```

---

<!-- @cell name=young-gen-gc-rate requires="has-jvmlog-gc" -->

## Young GC Rate per 5-min Window

Young GC events per minute over time — above 10 GC/min indicates Eden is too small for the allocation rate; rising GC/min with stable pause time means allocation rate is growing, not heap fragmentation.

```sql
SELECT * FROM "jvmlog-young-gen-gc-rate"
```

```plot
LINE(x="Uptime (min)", y="GC/min")
```

---

<!-- @cell name=alloc-stall-distribution requires="has-alloc-stall" -->

## Allocation Stall Duration Distribution

Histogram of stall durations by severity bucket — entries in ">=500ms" mean application threads blocked for half a second; cross-reference with safepoint data to identify which GC operation caused the stall.

```sql
SELECT * FROM "jvmlog-alloc-stall-distribution"
```

```plot
BAR(x="Stall Range", y="Count")
```

---

<!-- @cell name=gc-wall-vs-concurrent requires="has-gc-phases" -->

## GC Wall Time vs Concurrent Phase Time

Per-cycle split between STW pause and concurrent work time — STW fraction above 20% for ZGC/Shenandoah indicates concurrent phases are not completing before heap pressure forces a stop-the-world fallback.

```sql
SELECT * FROM "jvmlog-gc-wall-vs-concurrent"
```

```plot
LINE(x="Start (s)", y="STW Fraction (%)")
```

---

<!-- @cell name=full-gc-interval requires="has-jvmlog-gc" -->

## Time Between Full GCs

Interval in seconds/minutes between consecutive Full GC events — a decreasing interval is an early warning of OutOfMemoryError; use as a trend indicator to set alert thresholds before production incidents.

```sql
SELECT * FROM "jvmlog-full-gc-interval"
```

```plot
LINE(x="Uptime (s)", y="Since Last Full GC (s)")
```


---

<!-- @cell name=gc-start-of-trouble requires="has-jvmlog-gc" -->

## GC Cause First Occurrence Timeline

When each GC cause first appeared in the log — causes that appear late in the run indicate state transitions (heap growth, class loading spikes, load pattern changes); worst pause per cause identifies the most impactful triggers.

```sql
SELECT * FROM "jvmlog-gc-start-of-trouble"
```

---

<!-- @cell name=safepoint-gc-split requires="has-safepoint" -->

## Safepoint Time: GC-Triggered vs Non-GC

STW time attributed to GC operations vs non-GC safepoints (deoptimization, class unloading, etc.) — high Non-GC STW indicates JIT deoptimization or class loading storms competing with GC for stop-the-world time.

```sql
SELECT * FROM "jvmlog-safepoint-gc-split"
```

```plot
BAR(x="Category", y="Total STW (ms)")
```

---

<!-- @cell name=metaspace-oom-proximity requires="has-metaspace" -->

## Metaspace OOM Proximity

Metaspace usage as a percentage of committed space with status classification — Critical (>90%) means the next class loading spike may trigger a Metaspace OutOfMemoryError; growth trend > 0 means ongoing class loading is consuming the space.

```sql
SELECT * FROM "jvmlog-metaspace-oom-proximity"
```

---

<!-- @cell name=gc-cause-first-last requires="has-jvmlog-gc" -->

## GC Cause Timeline — Activity Window per Cause

Per-cause GC summary with temporal extent — 'Active Window' shows how long a cause was triggering GC; causes with a short window and many events are burst patterns that may respond to tuning or rate-limiting.

```sql
SELECT * FROM "jvmlog-gc-cause-first-last"
```

```plot
BAR(x="Cause", y="Count")
```

---

<!-- @cell name=zgc-allocation-rate-trend requires="has-zgc-load" -->

## ZGC Allocation Rate Trend

ZGC allocation rate per cycle with pressure classification — Critical (>500 MB/s) means the allocator is faster than the collector; rising allocStalls confirms the application is blocked waiting for the collector to keep up.

```sql
SELECT * FROM "jvmlog-zgc-allocation-rate-trend"
```

```plot
LINE(x="GC ID", y="Alloc Rate (MB/s)")
```


---

<!-- @cell name=gc-errors-timeline requires="has-gc-errors" -->

## GC Error Events Timeline

Chronological list of serious GC error events — evacuation failures, to-space exhaustion, OOM events, and degenerated GC fallbacks. Any entry here represents a health problem that caused application pauses or potential data loss.

```sql
SELECT * FROM "jvmlog-gc-errors-timeline"
```

---

<!-- @cell name=shenandoah-free-headroom requires="has-shenandoah-ergo" -->

## Shenandoah Free Heap and Headroom per Cycle

Free regions and headroom (free minus spikes and penalties) after each Shenandoah GC — headroom approaching 0 means Shenandoah is about to run out of room for concurrent evacuation, which triggers a Degenerated (STW) GC fallback.

```sql
SELECT * FROM "jvmlog-shenandoah-free-headroom"
```

```plot
LINE(x="GC ID", y="Headroom (MB)")
```

---

<!-- @cell name=g1-concurrent-phase-summary requires="has-gc-phases" -->

## G1 Concurrent Phase Summary

G1 concurrent phase statistics (Concurrent Cycle, Mark from Roots, Rebuild Remembered Sets) — non-zero Aborts mean mixed GC was triggered before marking completed (allocation outpacing marking); tune with `-XX:G1HeapWastePercent`.

```sql
SELECT * FROM "jvmlog-g1-concurrent-phase-summary"
```

```plot
BAR(x="Phase", y="Avg (ms)")
```

---

<!-- @cell name=metaspace-class-space-trend requires="has-metaspace" -->

## Metaspace Usage per GC Cycle

Per-GC metaspace before/after with delta — a positive delta on every GC means continuous class loading; a large drop means class unloading fired; monitor Committed against `-XX:MaxMetaspaceSize` if set.

```sql
SELECT * FROM "jvmlog-metaspace-class-space-trend"
```

```plot
LINE(x="GC ID", y="Meta After (MB)")
```

---

<!-- @cell name=gc-error-by-type-timeline requires="has-gc-errors" -->

## GC Error Frequency Over Time

GC error counts per 5-minute window — sustained errors indicate a chronic heap problem; isolated clusters suggest a transient load spike that can be addressed with tuning.

```sql
SELECT * FROM "jvmlog-gc-error-by-type-timeline"
```

```plot
BAR(x="Uptime (min)", y="Count")
```


---

<!-- @cell name=heap-growth-rate requires="has-heap-snapshot" -->

## Heap Live Set Growth Rate (Regression)

Linear regression of post-GC heap size — 'Growth Slope' > 0 means the live set is growing; 'Projected +1h Growth' extrapolates how much additional heap will be needed. Rapid Growth (>1 MB/s) is a memory leak indicator.

```sql
SELECT * FROM "jvmlog-heap-growth-rate"
```

---

<!-- @cell name=g1-region-waste requires="has-g1-regions" -->

## G1 Humongous Region Utilisation

Humongous object regions as a percentage of total — high humongous% fragments the heap and forces eager Full GC; tune with `-XX:G1HeapRegionSize` to make large objects regular rather than humongous.

```sql
SELECT * FROM "jvmlog-g1-region-waste"
```

```plot
LINE(x="GC ID", y="Humongous % Before")
```

---

<!-- @cell name=pause-budget-analysis requires="has-jvmlog-gc" -->

## Pause Budget Analysis — SLA Compliance Summary

What fraction of GC events fit within 100ms, 200ms, and 500ms pause budgets — P99 above your SLA target means 1% of requests will miss the deadline; prioritise reducing P99 over reducing average pause.

```sql
SELECT * FROM "jvmlog-pause-budget-analysis"
```

---

<!-- @cell name=gc-overhead-by-type requires="has-jvmlog-gc" -->

## GC Overhead by Collector Type

STW pause contribution per GC type as a percentage of total STW time — Full GC taking > 20% of total is a red flag; if Young GC dominates but is frequent, consider increasing heap size.

```sql
SELECT * FROM "jvmlog-gc-overhead-by-type"
```

```plot
BAR(x="GC Type", y="% of Total STW")
```

---

<!-- @cell name=survivor-to-old-rate requires="has-g1-regions" -->

## G1 Survivor→Old Promotion Rate

Per-GC old generation growth from survivor promotion — high "Promoted % of Live" means objects are tenuring quickly; sustained old gen growth without Full GC suggests premature tenuring, tune with `-XX:MaxTenuringThreshold`.

```sql
SELECT * FROM "jvmlog-survivor-to-old-rate"
```

```plot
LINE(x="GC ID", y="Old Growth (regions)")
```


---

<!-- @cell name=pause-worst-10 requires="has-jvmlog-gc" -->

## Top 10 Worst GC Pauses

The 10 highest-latency GC events with cause, type, and timestamp — inspect these for patterns: pauses clustering at the same uptime indicate a load spike; repeated Full GC in the top-10 means old generation is consistently under pressure.

```sql
SELECT * FROM "jvmlog-pause-worst-10"
```

---

<!-- @cell name=safepoint-top-ops requires="has-safepoint" -->

## Top 10 Safepoint Operations by Total STW Time

Safepoint operations ranked by cumulative STW time — non-GC operations (RevokeBias, Deoptimize) appearing in the top 10 indicates JIT activity or thread-state management is competing for stop-the-world time.

```sql
SELECT * FROM "jvmlog-safepoint-top-ops"
```

```plot
BAR(x="Operation", y="Total STW (ms)")
```

---

<!-- @cell name=worker-utilisation-by-phase requires="has-gc-workers" -->

## GC Worker Thread Utilisation by Phase

Average worker utilisation per GC task phase — tasks below 60% utilisation are under-parallelised; verify `-XX:ParallelGCThreads` is set appropriate to your available CPU count.

```sql
SELECT * FROM "jvmlog-worker-utilisation-by-phase"
```

```plot
BAR(x="Task", y="Avg Utilisation %")
```

---

<!-- @cell name=gc-pause-interval-correlation requires="has-jvmlog-gc" -->

## GC Pause vs Inter-GC Interval

Per-GC pause duration with interval since last GC and frequency class — Burst class (< 1s intervals) means back-to-back collections starving the application; Infrequent class with high pause means a rare but severe event (humongous allocation, Full GC).

```sql
SELECT * FROM "jvmlog-gc-pause-interval-correlation"
```

---

<!-- @cell name=g1-eden-fill-rate requires="has-g1-regions" -->

## G1 Eden Region Fill Rate

How many Eden regions are filled per minute — a high fill rate with small Eden Max means Eden is too small for the allocation rate; consider increasing `-XX:NewSize` or letting G1 adaptively resize Eden.

```sql
SELECT * FROM "jvmlog-g1-eden-fill-rate"
```

```plot
LINE(x="Uptime (s)", y="Fill Rate (regions/min)")
```

---

<!-- @cell name=gc-bottleneck-summary requires="has-jvmlog-gc" -->

## GC Primary Bottleneck Identification

Automated bottleneck classification — evaluates Full GC rate, pause overhead, P99 latency, GC frequency, and average pause to surface the single most impactful GC problem, similar to GCeasy's diagnostic summary.

```sql
SELECT * FROM "jvmlog-gc-bottleneck-summary"
```

---

<!-- @cell name=pause-p99-rolling requires="has-jvmlog-gc" -->

## Rolling P99 Pause Latency

P99 pause over a rolling 50-GC window — a rising P99 with stable average pause signals outlier events becoming more frequent; use alongside `pause-worst-10` to identify the cause.

```sql
SELECT * FROM "jvmlog-pause-p99-rolling"
```

```plot
LINE(x="Uptime (s)", y="Rolling P99 (ms)")
```

---

<!-- @cell name=alloc-stall-gc-phase requires="has-alloc-stall" -->

## Allocation Stalls vs Concurrent GC Phase

Allocation stalls correlated with the concurrent phase in progress — high stall percentage during a phase means GC cannot keep pace with allocation during that phase; consider reducing allocation rate or tuning phase concurrency.

```sql
SELECT * FROM "jvmlog-alloc-stall-gc-phase"
```

```plot
BAR(x="Concurrent Phase", y="Stall % of Phase")
```

---

<!-- @cell name=zgc-capacity-trend requires="has-zgc" -->

## ZGC Heap Capacity Trend

Heap usage at ZGC Mark Start over time with 10-cycle growth rate — a growing trend with positive MB/cycle growth rate indicates a heap leak or allocation surge; use to decide when to adjust `-Xmx`.

```sql
SELECT * FROM "jvmlog-zgc-capacity-trend"
```

```plot
LINE(x="GC ID", y="Used at Mark Start (MB)")
```

---

<!-- @cell name=gc-pause-sla-by-cause requires="has-jvmlog-gc" -->

## GC Pause SLA Compliance by Cause

Pause SLA compliance broken down by GC cause — shows what fraction of pauses for each trigger meet 100ms, 200ms, and 500ms thresholds; causes with low 200ms SLA % are candidates for allocation rate reduction or GC tuning.

```sql
SELECT * FROM "jvmlog-gc-pause-sla-by-cause"
```

```plot
BAR(x="Cause", y="200ms SLA %")
```

---

<!-- @cell name=heap-footprint-report requires="has-heap-snapshot" -->

## Heap Footprint Report

GCViewer-style heap footprint summary — min, max, and average heap before and after collection, committed range, and average bytes reclaimed per GC cycle. High "Max Before" relative to "Max After" indicates healthy reclaim; a small gap indicates a growing live data set.

```sql
SELECT * FROM "jvmlog-heap-footprint-report"
```

---

<!-- @cell name=pause-distribution-histogram requires="has-jvmlog-gc" -->

## Pause Duration Distribution Histogram

GC pauses bucketed by latency band — a healthy application has the vast majority of events in the 0–50ms buckets with zero entries in 500ms+. Any entries in the 200–500ms or 500ms+ buckets breach typical cloud SLOs.

```sql
SELECT * FROM "jvmlog-pause-distribution-histogram"
```

```plot
BAR(x="Pause Bucket", y="Count")
```

---

<!-- @cell name=alloc-stall-thread-hotspots requires="has-alloc-stall" -->

## Allocation Stall Hotspot Threads

Application threads ranked by total allocation stall time — these are the threads being most harmed by GC backpressure; profile their allocation sites with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation` or async-profiler to find the hot allocators.

```sql
SELECT * FROM "jvmlog-alloc-stall-thread-hotspots"
```

```plot
BAR(x="Thread", y="Total Stall (ms)")
```

---

<!-- @cell name=pause-consistency-by-type requires="has-jvmlog-gc" -->

## GC Pause Consistency by Type

Coefficient of variation (CV%) per GC type — low CV% (< 30%) means predictable pauses that are easy to SLA-bound; high CV% means highly variable pauses with outliers; P25/P75/P99 columns show the spread.

```sql
SELECT * FROM "jvmlog-pause-consistency-by-type"
```

```plot
BAR(x="GC Type", y="CV %")
```

---

<!-- @cell name=gc-type-timeline requires="has-jvmlog-gc" -->

## GC Type Mix Timeline

Per-GC type timeline with cumulative counts — use the "Cumulative Count" column to see when the Full GC line starts to rise steeply, which marks the inflection point where heap pressure exceeded the collector's capacity.

```sql
SELECT * FROM "jvmlog-gc-type-timeline"
```

```plot
LINE(x="Uptime (s)", y="Cumulative Count", color="GC Type")
```

---

<!-- @cell name=gc-event-density requires="has-jvmlog-gc" -->

## GC Event Density per 10-Second Window

GC events and overhead per 10-second time window — JVM Mon-style density view; windows with GC overhead above 10% or multiple Full GCs are hot spots indicating the application was under severe memory pressure during that interval.

```sql
SELECT * FROM "jvmlog-gc-event-density"
```

```plot
BAR(x="Window Start (s)", y="GC Overhead % (window)")
```

---

<!-- @cell name=shenandoah-uncommit-trend requires="has-shenandoah" -->

## Shenandoah Memory Uncommit Trend

How much memory Shenandoah is returning to the OS per cycle — positive "Delta Uncommitted" means the GC is successfully releasing pages; if this column is always zero, the heap is under constant pressure and the JVM is holding onto all committed memory.

```sql
SELECT * FROM "jvmlog-shenandoah-uncommit-trend"
```

```plot
LINE(x="GC ID", y="Uncommitted (MB)")
```

---

<!-- @cell name=zgc-mmu-approximation requires="has-jvmlog-gc" -->

## ZGC Minimum Mutator Utilisation (Approximation)

Approximate MMU over a 200ms window — values below 95% mean the application was paused for more than 10ms in a 200ms slice, violating typical low-latency SLOs. ZGC targets 99%+ MMU; consistently lower values indicate the heap is too small or allocation rate too high.

```sql
SELECT * FROM "jvmlog-zgc-mmu-approximation"
```

```plot
LINE(x="Uptime (s)", y="Approx MMU % (200ms window)")
```

---

<!-- @cell name=metaspace-growth-acceleration requires="has-metaspace" -->

## Metaspace Growth Acceleration

Second derivative of metaspace usage — "Delta KB/cycle" shows growth per cycle; "Accel KB/cycle²" is the change in growth rate. Sustained positive acceleration with rising committed size indicates a classloader leak; immediately check for frameworks creating new classloaders per request.

```sql
SELECT * FROM "jvmlog-metaspace-growth-acceleration"
```

```plot
LINE(x="GC ID", y="Delta KB/cycle")
```

---

<!-- @cell name=safepoint-gc-vs-nongc-stw requires="has-safepoint" -->

## Safepoint STW — GC vs Non-GC Breakdown

What fraction of total stop-the-world time is caused by GC versus other JVM operations (deoptimisation, class loading, biased lock revocation) — if non-GC STW is > 20% of total, investigate deoptimisation storms with `-XX:+PrintCompilation` or async-profiler's wall-clock mode.

```sql
SELECT * FROM "jvmlog-safepoint-gc-vs-nongc-stw"
```

```plot
BAR(x="Category", y="Total STW (ms)")
```

---

<!-- @cell name=g1-humongous-objects requires="has-g1-regions" -->

## G1 Humongous Object Allocation Pressure

GC cycles with humongous region allocations — humongous objects (larger than half a G1 region) bypass Eden and go directly to the old generation, skipping young GC collection. Frequent humongous allocations inflate old gen and trigger expensive mixed GCs; profile allocators with `-XX:+G1SummarizeRSetStats`.

```sql
SELECT * FROM "jvmlog-g1-humongous-objects"
```

```plot
BAR(x="Cause", y="Humongous Regions Before")
```

---

<!-- @cell name=gc-cause-shift requires="has-jvmlog-gc" -->

## GC Cause Distribution Shift

Cause distribution comparison between the first and second half of the recording — a rising share of "Allocation Failure" or "G1 Evacuation Pause" in the second half indicates a growing live data set eating into heap headroom; increase `-Xmx` or investigate memory leaks.

```sql
SELECT * FROM "jvmlog-gc-cause-shift"
```

---

<!-- @cell name=gc-phase-summary requires="has-gc-phase" -->

## GC Phase Aggregated Duration Summary

Total and P50/P95/Max duration per concurrent GC phase — the phase with the highest total time is the dominant cost driver; a large gap between P95 and Max indicates occasional phase stalls that cause latency outliers.

```sql
SELECT * FROM "jvmlog-gc-phase-summary"
```

```plot
BAR(x="Phase", y="Total (ms)")
```

---

<!-- @cell name=heap-pressure-events requires="has-heap-snapshot" -->

## High Heap Pressure Events

GC events where heap utilisation before collection exceeded 80% of committed capacity — these events are precursors to OOM; if they cluster in time, the application reached heap saturation and needs either a larger `-Xmx` or reduced allocation rate.

```sql
SELECT * FROM "jvmlog-heap-pressure-events"
```

```plot
LINE(x="Uptime (s)", y="Utilisation %")
```

---

<!-- @cell name=worker-saturation-rate requires="has-gc-workers" -->

## GC Worker Thread Saturation Rate

Average worker utilisation and saturation rate per GC task — tasks below 70% average saturation are under-using available parallel threads; check that `-XX:ParallelGCThreads` matches available CPUs and that the task is not artificially limited by work queue depth.

```sql
SELECT * FROM "jvmlog-worker-saturation-rate"
```

```plot
BAR(x="Task", y="Avg Saturation %")
```

---

<!-- @cell name=zgc-stall-to-gc-ratio requires="has-jvmlog-gc" -->

## ZGC Allocation Stalls per GC Cycle

Each ZGC cycle annotated with whether it had allocation stalls — cycles marked "Stalled" had application threads waiting for GC to free memory; if most cycles are "Stalled", the GC pace cannot keep up with the allocation rate and heap size should be increased.

```sql
SELECT * FROM "jvmlog-zgc-stall-to-gc-ratio"
```

```plot
BAR(x="GC ID", y="Total Stall (ms)", color="Status")
```

---

<!-- @cell name=g1-mixed-effectiveness requires="has-g1-regions" -->

## G1 Mixed GC Effectiveness

Old generation regions reclaimed per mixed GC cycle — low reclaim percentage (below 30%) means mixed GC is not collecting effectively, possibly due to high object survival rates in old gen; consider tuning `-XX:G1MixedGCLiveThresholdPercent`.

```sql
SELECT * FROM "jvmlog-g1-mixed-effectiveness"
```

```plot
BAR(x="GC ID", y="Old Reclaim %")
```

---

<!-- @cell name=concurrent-mark-duration-trend requires="has-gc-phase" -->

## Concurrent Mark Phase Duration Trend

How long concurrent marking takes per cycle with rolling average and trend — a rising trend (positive ms/cycle) indicates the live object graph is growing, requiring more marking work each cycle; consider checking for growing caches or session objects.

```sql
SELECT * FROM "jvmlog-concurrent-mark-duration-trend"
```

```plot
LINE(x="GC ID", y="Duration (ms)")
```

---

<!-- @cell name=stringdedup-savings-trend requires="has-stringdedup" -->

## String Deduplication Savings Trend

Heap savings from JVM string deduplication per cycle (`-XX:+UseStringDeduplication`) — low efficiency suggests most strings are already unique and deduplication overhead may exceed its benefit; consider disabling it if savings are consistently below 1% of heap.

```sql
SELECT * FROM "jvmlog-stringdedup-savings-trend"
```

```plot
LINE(x="GC ID", y="Saved (MB)")
```

---

<!-- @cell name=parallel-gen-sizing-trend requires="has-parallel" -->

## Parallel/CMS Old Gen Sizing Trend

CMS or Parallel collector old generation utilisation per collection — utilisation approaching 100% means the old gen is nearly full; a persistent upward trend indicates a memory leak or that `-Xmx` is too small for the application's live data set.

```sql
SELECT * FROM "jvmlog-parallel-gen-sizing-trend"
```

```plot
LINE(x="GC ID", y="Old Gen Utilisation %")
```

---

<!-- @cell name=gc-pause-sla-rolling requires="has-jvmlog-gc" -->

## Rolling GC Pause SLA Compliance

Rolling 10-cycle 200ms SLA compliance percentage — a declining rolling SLA% is an early warning signal before a full SLA breach; correlate the decline with the GC type timeline and cause shift views to identify the trigger.

```sql
SELECT * FROM "jvmlog-gc-pause-sla-rolling"
```

```plot
LINE(x="Uptime (s)", y="Rolling 10-cycle SLA %")
```

---

<!-- @cell name=g1-survivor-overflow requires="has-g1-regions" -->

## G1 Survivor Region Overflow Events

G1 GC cycles where survivor regions filled to capacity — "Overflow" events promote objects to old gen prematurely, aging the object graph too fast and inflating old gen size; reduce promotion pressure with `-XX:MaxTenuringThreshold` or increase `-XX:SurvivorRatio`.

```sql
SELECT * FROM "jvmlog-g1-survivor-overflow"
```

```plot
BAR(x="GC ID", y="Survivor Fill %", color="Status")
```

---

<!-- @cell name=zgc-relocate-garbage requires="has-zgc" -->

## ZGC Relocate Start — Live vs Garbage Ratio

Garbage percentage at ZGC relocation start — higher garbage % means ZGC has more to reclaim; consistently low garbage % (< 20%) with high allocation pressure means the heap is undersized; consider increasing `-Xmx` so more garbage accumulates before collection.

```sql
SELECT * FROM "jvmlog-zgc-relocate-garbage"
```

```plot
LINE(x="GC ID", y="Garbage %")
```

---

<!-- @cell name=heap-churn-rate requires="has-heap-snapshot" -->

## Heap Allocation Rate (Churn Rate)

Bytes allocated per second between GC events — high MB/s correlates with application allocation bursts and frequently precedes GC pause spikes; use allocation profiling (async-profiler with `alloc` event) to identify the top allocators at burst time.

```sql
SELECT * FROM "jvmlog-heap-churn-rate"
```

```plot
LINE(x="Uptime (s)", y="Alloc Rate MB/s")
```

---

<!-- @cell name=safepoint-sync-outliers requires="has-safepoint" -->

## Safepoint Sync Time Outliers

Top 50 slowest times to reach a global safepoint — high sync time (> 10ms) means application threads are slow to check safepoint polls; common causes are counted loops, JNI code, or compiled code with infrequent safepoint checks; force more frequent polls with `-XX:+UseCountedLoopSafepoints`.

```sql
SELECT * FROM "jvmlog-safepoint-sync-outliers"
```

```plot
BAR(x="Operation", y="Sync Time (ms)", color="Sync Category")
```

---

<!-- @cell name=gc-phase-hot-spot requires="has-gc-phase" -->

## GC Phase Hot-Spot (Which Phase Dominates STW)

Every GC phase ranked by its total share of stop-the-world time — use this as the first view when latency is high; the top phase is the bottleneck, not GC overhead overall; e.g. high evacuation time → tune region size or survivor ratios; high marking time → reduce live set or enable string deduplication.

```sql
SELECT * FROM "jvmlog-gc-phase-hot-spot"
```

```plot
BAR(x="Phase", y="% of Total STW")
```

---

<!-- @cell name=pause-recovery-time requires="has-jvmlog-gc" -->

## Pause Spike Recovery Time

GC pause spikes (>3σ above rolling baseline) with measured recovery time — how quickly pause times normalise after a spike characterises GC instability; spikes with "No recovery observed" or "Very slow" recovery indicate a structural memory pressure problem rather than a transient event.

```sql
SELECT * FROM "jvmlog-pause-recovery-time"
```

```plot
BAR(x="Spike At (s)", y="Recovery Time (s)", color="Recovery Category")
```

---

<!-- @cell name=safepoint-stw-breakdown requires="has-safepoint" -->

## Safepoint STW Breakdown — GC vs Non-GC

Total stop-the-world time split between GC and non-GC JVM operations — if non-GC operations account for >10% of STW, investigate deoptimisation, class unloading, or bias revocation as sources of application latency that GC tuning alone cannot fix.

```sql
SELECT * FROM "jvmlog-safepoint-stw-breakdown"
```

```plot
BAR(x="Category", y="% of All STW")
```

---

<!-- @cell name=gc-worker-phase-efficiency requires="has-gc-workers" -->

## GC Worker Parallelism Efficiency per Phase

Average parallel worker utilisation per GC phase — phases below 80% utilisation are not using all available threads; common causes are insufficient work units (too few small regions) or task imbalance; consider reducing `-XX:ParallelGCThreads` for under-utilised phases to reduce OS scheduling overhead.

```sql
SELECT * FROM "jvmlog-gc-worker-phase-efficiency"
```

```plot
BAR(x="Phase / Task", y="Avg Utilisation %")
```

---

<!-- @cell name=heap-live-data-ratio requires="has-heap-snapshot" -->

## Heap Live-Data Ratio (Live Set vs Committed Heap)

Average and peak fraction of committed heap occupied by live objects after GC — the most direct heap-sizing metric; >85% is CRITICAL (GC will thrash), 70-85% is WARNING, <50% may be over-provisioned; adjust `-Xmx` so the live set ratio stays between 40-65% for healthy GC behaviour.

```sql
SELECT * FROM "jvmlog-heap-live-data-ratio"
```

---

<!-- @cell name=zgc-load-vs-duration requires="has-zgc-load" -->

## ZGC System Load vs Cycle Duration

OS load averages logged per ZGC cycle correlated with GC duration and allocation rate — if cycle duration increases with load1s, the JVM is CPU-bound rather than heap-bound; reduce `-XX:ZCollectionInterval` or increase heap so fewer cycles occur under high CPU load.

```sql
SELECT * FROM "jvmlog-zgc-load-vs-duration"
```

```plot
LINE(x="GC ID", y="Cycle Duration (ms)", color="Load Category")
```

---

<!-- @cell name=gc-interval-trend requires="has-jvmlog-gc" -->

## GC Interval Trend (Is GC Frequency Accelerating?)

Linear regression on the time between GC events — "ACCELERATING" means GC is happening more frequently over the run duration, which is a reliable early warning of growing memory pressure; combine with the memory-leak-risk view to determine if the root cause is a leak or under-provisioned heap.

```sql
SELECT * FROM "jvmlog-gc-interval-trend"
```

---

<!-- @cell name=g1-mixed-decision-log requires="has-g1-mixed" -->

## G1 Mixed GC Decision History

Complete history of G1's Do/Skip/Initiate Mixed GC decisions with reclaimable percentage — frequent "Skip Mixed GC" decisions with high reclaimable% indicate `-XX:G1MixedGCLiveThresholdPercent` is set too low (default 85%); lower the threshold to force more aggressive mixed collection and reduce old gen accumulation.

```sql
SELECT * FROM "jvmlog-g1-mixed-decision-log"
```

```plot
BAR(x="GC ID", y="Reclaimable %", color="Decision")
```

---

<!-- @cell name=alloc-stall-cause-summary requires="has-alloc-stall" -->

## Allocation Stall Summary by Thread

Which threads stall most during GC allocation pressure and for how long — profile the top thread with `async-profiler -e alloc` to identify the allocation hot-path; consider object pooling, batching, or reducing large array allocations in the hot path.

```sql
SELECT * FROM "jvmlog-alloc-stall-cause-summary"
```

```plot
BAR(x="Thread", y="Total Stall (ms)", color="Frequency Verdict")
```

---

<!-- @cell name=gc-overhead-forecast requires="has-jvmlog-gc" -->

## GC Overhead Forecast (When Will 20% Threshold Be Breached?)

Linear regression on per-minute GC overhead projects when overhead will exceed the 20% application-impact threshold — R² > 0.5 means the trend is reliable; plan capacity changes or heap tuning before the projection point to avoid reactive emergency changes.

```sql
SELECT * FROM "jvmlog-gc-overhead-forecast"
```

---

<!-- @cell name=gc-error-frequency requires="has-gc-errors" -->

## GC Error Frequency Over Time

GC errors (evacuation failures, OOM events, to-space exhaustion) counted per occurrence with persistence assessment — persistent errors across multiple minutes indicate structural heap or configuration problems that a single patch won't fix; isolated errors may be transient burst events.

```sql
SELECT * FROM "jvmlog-gc-error-frequency"
```

```plot
BAR(x="Error Type", y="Total Occurrences", color="Severity Assessment")
```

---

<!-- @cell name=safepoint-dominant-ops requires="has-safepoint" -->

## Dominant Safepoint Operations (80% of STW)

The minimal set of safepoint operations that together account for 80% of all stop-the-world time — focus tuning effort here; the long tail of rare operations typically contributes little total impact and doesn't justify configuration changes.

```sql
SELECT * FROM "jvmlog-safepoint-dominant-ops"
```

```plot
BAR(x="Operation", y="% of STW")
```

---

<!-- @cell name=phase-heap-pressure requires="has-gc-phase" -->

## GC Phase Duration vs Heap Pressure

Correlation between each GC phase's execution time and heap fill percentage at GC trigger — phases with STRONG coupling will directly benefit from heap sizing changes; phases with WEAK coupling are bottlenecked by something other than live data (e.g., promotion, CPU saturation, or remembered sets).

```sql
SELECT * FROM "jvmlog-phase-heap-pressure"
```

---

<!-- @cell name=young-vs-full-pause-trend requires="has-jvmlog-gc" -->

## Young vs Full GC Pause Time Share per Minute

Per-minute breakdown of GC pause time split between young and full/major collections — a rising Full % trend indicates old gen accumulation; if Full % reaches >30%, investigate heap sizing, survivor tuning, or allocation patterns before full GC pauses dominate application latency.

```sql
SELECT * FROM "jvmlog-young-vs-full-pause-trend"
```

```plot
LINE(x="Minute", y="Full %")
```

---

<!-- @cell name=gc-efficiency-trend requires="has-heap-snapshot" -->

## GC Efficiency Trend (MB Reclaimed per ms of Pause)

Rolling average of megabytes reclaimed per millisecond of GC pause time — a declining trend means GC is working harder to reclaim less memory, indicating heap fragmentation or growing live set; stable high efficiency (>1 MB/ms) indicates a well-tuned heap with healthy object turnover.

```sql
SELECT * FROM "jvmlog-gc-efficiency-trend"
```

```plot
LINE(x="Uptime (s)", y="Rolling Avg Efficiency (MB/ms)", color="Efficiency Rating")
```

---

<!-- @cell name=g1-region-composition requires="has-g1-regions" -->

## G1 Region Composition per GC

Per-cycle breakdown of Eden/Survivor/Old/Humongous region counts — sustained old region growth each cycle means promotion rate exceeds old gen capacity; watch for Eden Used % approaching 100% (triggers GC) and growing Humongous counts (large allocations causing frequent young GC cycles).

```sql
SELECT * FROM "jvmlog-g1-region-composition"
```

---

<!-- @cell name=zgc-live-vs-garbage requires="has-zgc-stats" -->

## ZGC Live Set vs Garbage per Cycle

Live set and garbage percentage at ZGC relocation start — <20% garbage means GC runs too frequently for small gains (heap may be undersized); >70% garbage indicates very productive cycles; use this alongside the ZGC capacity trend to determine if heap sizing changes are warranted.

```sql
SELECT * FROM "jvmlog-zgc-live-vs-garbage"
```

```plot
LINE(x="GC ID", y="Garbage %", color="Garbage Assessment")
```

---

<!-- @cell name=stringdedup-roi requires="has-stringdedup" -->

## String Deduplication ROI

Memory savings per millisecond of CPU time spent on string deduplication — LOW ROI suggests disabling `-XX:+UseStringDeduplication` to reclaim the CPU overhead; HIGH ROI confirms the feature pays for itself for this workload's string allocation patterns.

```sql
SELECT * FROM "jvmlog-stringdedup-roi"
```

---

<!-- @cell name=gc-pause-percentile-timeline requires="has-jvmlog-gc" -->

## GC Pause Percentile Timeline (P50/P90/P99 per Minute)

P50, P90, P95, P99, and Max GC pause times bucketed per minute — growing P99 with stable P50 identifies tail-latency regressions from occasional full GCs; growing P99-P50 spread indicates increasing pause variance that affects SLA compliance even when median latency looks fine.

```sql
SELECT * FROM "jvmlog-gc-pause-percentile-timeline"
```

```plot
LINE(x="Minute", y="P99 (ms)")
```

---

<!-- @cell name=concurrent-vs-stw-work requires="has-gc-phase" -->

## Concurrent Work vs STW Pause Time per GC Type

Concurrent background work time vs stop-the-world pause time ratio — for ZGC and Shenandoah, Concurrent/STW > 10 is expected; falling ratio indicates the collector can't finish concurrent work before the application allocates faster than GC can process, leading to stalls and degenerated GC modes.

```sql
SELECT * FROM "jvmlog-concurrent-vs-stw-work"
```

```plot
BAR(x="GC Type", y="Concurrent/STW Ratio")
```

---

<!-- @cell name=oom-risk-timeline requires="has-heap-snapshot" -->

## OOM Risk Timeline

Rolling heap fill percentage with risk score — CRITICAL (>90%) means OutOfMemoryError is imminent and immediate heap size increase is required; combine this view with the memory-leak-risk and gc-overhead-forecast views to distinguish a temporary burst from a structural heap exhaustion trend.

```sql
SELECT * FROM "jvmlog-oom-risk-timeline"
```

```plot
LINE(x="Uptime (s)", y="Rolling Fill %", color="Risk Level")
```

---

<!-- @cell name=gc-jitter-analysis requires="has-jvmlog-gc" -->

## GC Pause Jitter Analysis (Predictability by GC Type)

Coefficient of variation and P99/P50 ratio per GC type — HIGH JITTER (CV > 100%) means pause times are unpredictable, making SLA compliance impossible even when the average is low; ZGC and Shenandoah should have CV < 50%; high CV on G1 typically indicates humongous allocations or evacuation failures.

```sql
SELECT * FROM "jvmlog-gc-jitter-analysis"
```

```plot
BAR(x="GC Type", y="Coeff of Variation %", color="Jitter Assessment")
```

---

<!-- @cell name=heap-utilisation-heatmap requires="has-heap-snapshot" -->

## Heap Utilisation Heatmap

GC event counts per time-bucket × heap-fill-% bucket — dense clusters at high fill% late in the run signal approaching OOM; a diagonal pattern (fill% rising over time) indicates heap growth or memory leak; uniform distribution across fill% buckets indicates healthy, stable heap behaviour.

```sql
SELECT * FROM "jvmlog-heap-utilisation-heatmap"
```

---

<!-- @cell name=old-gen-occupancy-trend requires="has-parallel-sizing" -->

## Old Gen Occupancy Trend (Parallel/CMS)

Old generation used bytes vs capacity over time for Parallel/CMS collectors — sustained rolling average growth indicates the old gen is accumulating objects faster than collections can reclaim them; CRITICAL status (>90% fill) means the next Full GC will likely trigger an OOM.

```sql
SELECT * FROM "jvmlog-old-gen-occupancy-trend"
```

```plot
LINE(x="GC ID", y="Old Gen Fill %", color="Occupancy Status")
```

---

<!-- @cell name=gc-log-completeness -->

## GC Log Completeness Assessment

What data types and detail levels are present in this GC log — MINIMAL logs (only gc) restrict analysis to pause times and basic metrics; upgrade to `-Xlog:gc*` to unlock heap, phase, worker, and safepoint analysis views; shows exact coverage percentages to help decide whether re-running with richer logging is worth it.

```sql
SELECT * FROM "jvmlog-gc-log-completeness"
```

