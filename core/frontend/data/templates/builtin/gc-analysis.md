---
title: GC Pause Analysis
description: Identify long garbage-collection pauses and the work each pause performs.
tags: [gc, performance]
license: MIT
variables:
  $$threshold_ms: "100"
  $limit: "20"
cellConditions:
  pause-vs-concurrent: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'GCPhaseConcurrent'"
---

<!-- @cell name=intro -->

## GC Analysis

A ready-to-run analysis of garbage-collection behavior from your JFR recording.

**What's here:**
- Recording overview (start, end, total duration)
- Pause time breakdown by GC cause — which cause is costing the most stop-the-world time
- Long-pause drill-down (shown only when pauses exceed `$$threshold_ms` ms)
- Phase-level percentile table (P50 / P90 / P99 / Max per GC phase)
- GC pause events over time and pause-by-cause windows (linked time axis)
- Young vs Old/Full GC time split
- Eden/Survivor sizing and Old generation growth rate (G1)
- Time To SafePoint (TTSP) distribution
- Top allocating classes and per-thread allocation

**Required events:** `GarbageCollection`, `GCPhasePause`

Change `$$threshold_ms` in the Notebook Settings cell above to adjust the long-pause threshold.

**Quick navigation:** @cell:pause-summary | @cell:heap-over-time | @cell:pause-histogram | @cell:gc-overhead | @cell:concurrent-phases

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

<!-- @cell name=gc-config requires="GCConfiguration" -->

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

> See also: @cell:pause-histogram for duration distribution • @cell:long-pauses-section for individual events

---

<!-- @cell name=long-pauses-section requires="GarbageCollection" -->

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

<!-- @cell name=concurrent-phases requires="GCPhaseConcurrent" -->

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

<!-- @cell name=gc-allocation-trigger requires="AllocationRequiringGC" -->

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

<!-- @cell name=gc-references requires="GCReferenceStatistics" -->

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

<!-- @cell name=system-gc-blockers requires="SystemGC" -->

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

<!-- @cell name=metaspace requires="MetaspaceSummary" -->

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

<!-- @cell name=g1-regions requires="G1HeapSummary" -->

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

<!-- @cell name=tenuring requires="TenuringDistribution" -->

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

---

<!-- @cell name=jvm-memory-size requires="GCHeapConfiguration" -->

## JVM Memory Size: Allocated vs Peak

Configured heap maximum vs the peak heap actually used. A large gap between allocated and peak means the heap ceiling can be lowered to reduce GC overhead. A peak close to the max means the JVM is running near capacity.

*Requires `GCHeapConfiguration` events.*

```sql
SELECT * FROM "gc-memory-size"
```

```plot
BAR_CHART(x: "Region", y: ["MB"], horizontal: true) TITLE "JVM Heap: Allocated vs Peak Used" AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-duration-buckets requires="GCPhasePause" -->

## GC Pause Duration Distribution

Count of GC pause events grouped into duration ranges. A healthy JVM has most pauses in the short (sub-10ms) bucket; a long tail in the 100ms+ buckets signals tuning opportunities.

```sql
SELECT "Range", "Count", "Percentage"
FROM "gc-duration-buckets"
```

```plot
BAR_CHART(x: "Range", y: ["Count"], horizontal: false) TITLE "GC Pause Duration Ranges" AXIS_Y LABEL "Pauses"
```

---

<!-- @cell name=gc-phase-stats requires="GCPhasePause" -->

## GC Phase Statistics

Per-phase statistics including count, total time, average, and standard deviation. A high standard deviation relative to the mean suggests inconsistent GC behavior — investigate phases with high stddev first.

```sql
SELECT * FROM "gc-phase-stats"
```

```plot
TABLE() TITLE "GC Phase Statistics"
```

---

<!-- @cell name=pause-vs-concurrent requires="GCPhaseConcurrent" -->

## Pause vs Concurrent GC Time

Total wall-clock time split between stop-the-world pauses and concurrent GC work. Concurrent collectors (G1, ZGC, Shenandoah) aim to shift most work to concurrent phases — a large STW share relative to concurrent indicates the collector is under stress.

*Requires `GCPhaseConcurrent` events.*

```sql
SELECT * FROM "gc-time-split"
```

```plot
PIE_CHART(category: "Type", value: "Total (ms)") TITLE "STW vs Concurrent GC Time"
```

---

<!-- @cell name=object-stats requires="ObjectAllocationSample" -->

## Object Allocation Statistics

Total sampled allocation volume and average allocation rate over the recording. High allocation rates are the root cause of most GC pressure — reducing object churn is often the highest-leverage GC optimization.

*Requires `ObjectAllocationSample` events. Enable allocation profiling to populate this section.*

```sql
SELECT * FROM "gc-object-stats"
```

```plot
TABLE() TITLE "Object Allocation Summary"
```

---

<!-- @cell name=cpu-stats requires="GCCPUTime" -->

## GC CPU Time

CPU time consumed by GC threads across the recording. High GC CPU time relative to total recording duration indicates the collector is competing significantly with the application for CPU.

*Requires `GCCPUTime` events.*

```sql
SELECT * FROM "gc-cpu-time"
```

```plot
TABLE() TITLE "GC CPU Time Summary"
```

---

<!-- @cell name=safepoint-summary requires="SafepointEnd" -->

## Safepoint Summary

Total time all JVM threads were stopped at safepoints, average per safepoint, and percentage of the recording. Safepoints are not limited to GC — JVM operations like deoptimization and class redefinition also trigger them.

*Requires `SafepointBegin` and `SafepointEnd` events.*

```sql
SELECT * FROM "gc-safepoint-summary"
```

```plot
TABLE() TITLE "Safepoint Stop-the-World Summary"
```

---

<!-- @cell name=consecutive-full-gcs requires="GarbageCollection" -->

## Consecutive Full GCs

Full GC events that occurred without an intervening Young/Mixed GC. Back-to-back Full GCs are a strong signal of heap exhaustion or a memory leak — the collector cannot reclaim enough memory to make forward progress.

```sql
SELECT * FROM "gc-consecutive-full" LIMIT 50
```

```plot
TABLE() TITLE "Consecutive Full GC Events"
```

---

<!-- @cell name=promotion-rate requires="G1HeapSummary" -->

## Promotion Rate Over Time

Old-generation growth per GC as a proxy for object promotion (G1 only). Steady promotion is healthy; a rising or spiking promotion rate means short-lived objects are surviving into the old generation, which can trigger Mixed or Full GCs.

*Requires `G1HeapSummary` events.*

```sql
SELECT "Time", "GC ID", "Promoted MB"
FROM "gc-promotion-rate"
ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Promoted MB"]) TITLE "Promotion Rate (Old Gen Growth per GC)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-throughput requires="GarbageCollection" -->

## GC Throughput Over Time

Application throughput (% of time NOT spent in GC pauses) per 10-second window. Values above 95% are typically acceptable; below 90% indicates the GC is imposing significant overhead.

```sql
SELECT "Window" AS "Time", "Throughput %", "GC Time (ms)", "Mutator Time (ms)"
FROM "gc-throughput"
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["Throughput %"]) TITLE "Application Throughput % (10s windows)" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"
```

---

<!-- @cell name=parallel-phases requires="GCPhaseParallel" -->

## Parallel GC Phase Statistics

Per-phase timing for parallel (multi-threaded) GC work. High P95/Max relative to Average reveals phases with inconsistent parallelism — a sign of OS scheduling interference or unbalanced work distribution.

*Requires `GCPhaseParallel` events.*

```sql
SELECT * FROM "gc-parallel-phases"
```

```plot
TABLE() TITLE "Parallel GC Phase Statistics"
```

---

<!-- @cell name=tlab-efficiency requires="ObjectAllocationInNewTLAB" -->

## TLAB Allocation Efficiency

Thread-local allocation buffer (TLAB) fill ratio and sizing. A fill ratio below 0.5 means threads are wasting more than half each TLAB — consider `-XX:TLABSize` tuning. Large outside-TLAB allocations trigger GC directly.

*Requires `ObjectAllocationInNewTLAB` events.*

```sql
SELECT "Bucket (5s)" AS "Time", round("Fill Ratio", 3) AS "Fill Ratio", "Allocations", "Total TLAB", "Total Allocated"
FROM "tlab-efficiency"
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["Fill Ratio"]) TITLE "TLAB Fill Ratio Over Time" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 1] LABEL "ratio"
```

---

<!-- @cell name=finalizers requires="FinalizerStatistics" -->

## Finalizer Queue Depth

Classes with pending or completed finalizers. Objects with `finalize()` methods survive at least one extra GC cycle — a growing count signals finalizer queue buildup, which delays memory reclamation.

*Requires `FinalizerStatistics` events.*

```sql
SELECT * FROM "finalizers"
```

```plot
TABLE() TITLE "Finalizer Statistics by Class"
```

---

<!-- @cell name=gc-pause-over-time requires="GarbageCollection" -->

## GC Pause Over Time

Individual pause durations plotted over the recording. Hover over points to see cause and GC ID. A clustering of long pauses in a short window is a strong signal of heap pressure.

```sql
SELECT * FROM "gc-pause-over-time" ORDER BY "Time"
```

```plot
SCATTER(x: "Time", y: "Pause (ms)", color: "Cause") TITLE "GC Pause Events Over Time" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=gc-young-old-time requires="GarbageCollection" -->

## Young vs Old/Full GC Time

Time spent in Young, Mixed, and Old/Full GC phases. Young-dominant workloads are healthy; a high Old/Full fraction indicates the old generation is under pressure.

```sql
SELECT * FROM "gc-young-old-time"
```

```plot
BAR_CHART(x: "Generation", y: ["Total Pause (ms)", "Avg Pause (ms)"], layout: "grouped") TITLE "Pause Time by GC Generation"
```

```plot
PIE_CHART(category: "Generation", value: "Total Pause (ms)") TITLE "Total STW Time by Generation"
```

---

<!-- @cell name=gc-pause-cause-over-time requires="GarbageCollection" -->

## Pause by Cause Over Time

30-second windows showing which GC cause contributed the most pause time. A shift in cause dominance often pinpoints when a problem started.

```sql
SELECT * FROM "gc-pause-cause-over-time"
```

```plot
AREA_CHART(x: "Window", y: ["Pause (ms)"], color: "Cause", layout: "stacked") TITLE "Pause Time by Cause (30s windows)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=gc-eden-size requires="G1HeapSummary" -->

## Eden and Survivor Region Sizing

Eden used vs allocated, and survivor sizes after each GC. Eden frequently at capacity forces more frequent Young collections.

*Requires `G1HeapSummary` events.*

```sql
SELECT * FROM "gc-eden-size" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Eden Used MB", "Survivor MB"], color: "Phase") TITLE "Eden and Survivor Sizing (G1)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-safepoint-distribution requires="SafepointBegin" -->

## Time To SafePoint (TTSP) Distribution

Time for all JVM threads to reach a safepoint. High TTSP means threads are slow to respond to stop-the-world requests — often caused by long loops without safepoint polls (use `-XX:+UseCountedLoopSafepoints`).

*Requires `SafepointBegin` and `SafepointEnd` events.*

```sql
-- alias ttsp
SELECT * FROM "gc-safepoint-distribution" LIMIT 200
```

```plot
HISTOGRAM(x: "TTSP (ms)", logBins: true) TITLE "TTSP Distribution" ON ttsp
```

---

<!-- @cell name=gc-allocation-by-class requires="ObjectAllocationSample" -->

## Top Allocating Classes

Classes contributing most to allocation volume. Target the top 3-5 classes for allocation reduction — reducing churn from these directly lowers GC frequency.

*Requires `ObjectAllocationSample` events.*

```sql
SELECT * FROM "gc-allocation-by-class"
```

```plot
BAR_CHART(x: "Class", y: ["Approx MB"], horizontal: true) TITLE "Top Allocating Classes (sampled)" AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-thread-allocation requires="ObjectAllocationSample" -->

## Per-Thread Allocation

Threads that allocate the most. High single-thread allocation often indicates a worker thread generating garbage — consider allocating outside hot loops.

*Requires `ObjectAllocationSample` events.*

```sql
SELECT * FROM "gc-thread-allocation"
```

```plot
BAR_CHART(x: "Thread", y: ["Approx MB"], horizontal: true) TITLE "Allocation by Thread (sampled)"
```

---

<!-- @cell name=gc-old-gen-growth requires="G1HeapSummary" -->

## Old Generation Growth Rate

Old generation min/max size per minute. A steadily rising minimum is the clearest early warning sign of a memory leak — the GC cannot reclaim as much as the application produces.

*Requires `G1HeapSummary` events.*

```sql
SELECT * FROM "gc-old-gen-growth" ORDER BY "Minute"
```

```plot
LINE_CHART(x: "Minute", y: ["Old Gen Max MB", "Old Gen Min MB"]) TITLE "Old Generation Size Over Time" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

