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
