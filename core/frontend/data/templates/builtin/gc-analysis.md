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

```sql
SELECT * FROM "gc-concurrent-phases"
```

```plot
TABLE() TITLE "Concurrent Phase Duration Summary (avg/P95/max)"
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

<!-- @cell name=g1-evacuation-failures requires="G1EvacuationYoungStatistics" -->

## G1 Evacuation Failures

Collections where G1 could not evacuate live objects — all regions were full. Evacuation failures cause additional stop-the-world work and heap fragmentation. Repeated failures indicate the heap is too small for the promotion rate, or the `InitiatingHeapOccupancyPercent` is set too high.

*Requires `G1EvacuationYoungStatistics` events.*

```sql
-- alias g1_evac_summary
SELECT * FROM "g1-evacuation-failure-summary"
```

```sql
-- alias g1_evac_timeline
SELECT * FROM "g1-evacuation-failures"
```

```plot
TABLE() ON g1_evac_summary TITLE "Evacuation Failure Summary"
```

```plot
BAR_CHART(x: "Time", y: ["Total Failures"]) ON g1_evac_timeline TITLE "Evacuation Failures Over Time" LINK_X($start, $end) ZOOM
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

---

<!-- @cell name=gc-tuning-advisor requires="GarbageCollection" -->

## GC Tuning Advisor

Automated recommendations based on the observed GC behaviour. Each row identifies a potential problem, its severity, and a tuning suggestion. Not every finding requires action — use them as starting points for investigation.

```sql
-- alias tuning_advice
SELECT * FROM "gc-tuning-advisor"
```

```plot
TABLE() ON tuning_advice TITLE "GC Tuning Recommendations"
```


---

<!-- @cell name=gc-ihop-tuning requires="G1AdaptiveIHOP" -->

## G1 Adaptive IHOP Tuning

G1's internal model for when to start concurrent marking. The **IHOP %** is the heap occupancy threshold at which G1 initiates a concurrent marking cycle.

- Rising **IHOP %** means G1 is trying to start marking earlier because allocation is fast.
- Rising **Predicted Mark Duration ms** means the concurrent cycle is expected to take longer — risk of not finishing before the heap fills (→ Concurrent Mode Failure).
- **Alloc Speed MB/s** tracks the JVM's predicted allocation rate used to tune the IHOP threshold.

*Requires `G1AdaptiveIHOP` events (G1 only, gc.jfc or gc-details.jfc).*

```sql
-- alias ihop_stats
SELECT * FROM "g1-ihop-stats" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["IHOP %"]) ON ihop_stats TITLE "G1 IHOP Threshold % Over Time" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%" FORMAT ".1f"
```

```plot
LINE_CHART(x: "Time", y: ["Alloc Speed MB/s"]) ON ihop_stats TITLE "Predicted Allocation Speed (MB/s)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB/s"
```

```plot
LINE_CHART(x: "Time", y: ["Predicted Mark Duration ms"]) ON ihop_stats TITLE "Predicted Concurrent Mark Duration (ms)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=gc-basic-ihop requires="G1BasicIHOP" -->

## G1 Basic IHOP

The fixed IHOP threshold — present when adaptive IHOP is disabled or for older JDK versions. Shows the static heap occupancy % at which G1 starts concurrent marking and whether the heap is consistently exceeding it.

*Requires `G1BasicIHOP` events (G1 only; appears when `-XX:-G1UseAdaptiveIHOP` or JDK < 9).*

```sql
-- alias basic_ihop
SELECT * FROM "g1-basic-ihop" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Heap Occupancy MB", "IHOP Threshold MB"]) ON basic_ihop TITLE "G1 IHOP: Heap Occupancy vs Fixed Threshold" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
TABLE() ON basic_ihop TITLE "G1 Basic IHOP Snapshots"
```

---

<!-- @cell name=gc-heap-regions requires="G1HeapRegionInformation" -->

## G1 Heap Region Map

Region count and used bytes by type over time. Each G1 region is ~1–32 MB depending on heap size.

- **Humongous Start** — objects > 50% of region size; each occupies its own region(s). High count = large objects fragmenting the heap.
- **Trash** — regions awaiting cleanup. A rising Trash count means concurrent cleanup is falling behind.
- **Pinned** — regions that cannot be moved; increase GC complexity.
- **Free** — available regions. A falling Free count under sustained allocation is a heap pressure signal.

*Requires `G1HeapRegionInformation` events (gc-details.jfc).*

```sql
-- alias region_types
SELECT * FROM "g1-region-types" ORDER BY "Time"
```

```plot
AREA_CHART(x: "Time", y: ["Count"], color: "Region Type", layout: "stacked") ON region_types TITLE "G1 Heap Region Count by Type" LINK_X($start, $end) ZOOM
```

```plot
AREA_CHART(x: "Time", y: ["Used MB"], color: "Region Type", layout: "stacked") ON region_types TITLE "G1 Heap Region Used MB by Type" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-string-dedup requires="StringDeduplicationStatistics" -->

## G1 String Deduplication

G1's string deduplication reduces heap usage by identifying `String` objects with equal content and having them share the same backing `char[]`. This cell shows the savings over time.

- **Deduped Savings MB** — heap saved by deduplication so far.
- **Hash Misses** — candidate strings that failed the hash check (no savings).
- Rising savings = dedup is actively working; flat savings = no new duplicate strings.

Enable with `-XX:+UseStringDeduplication` (requires G1GC).

*Requires `StringDeduplicationStatistics` events (gc.jfc with G1 + string dedup enabled).*

```sql
-- alias dedup_stats
SELECT * FROM "gc-string-dedup" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Deduped Savings MB"]) ON dedup_stats TITLE "String Deduplication Savings MB" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
TABLE() ON dedup_stats TITLE "String Deduplication Statistics"
```

---

<!-- @cell name=gc-rss-vs-heap requires="ResidentSetSize" -->

## OS Resident Set Size vs Committed Heap

**RSS** is the amount of physical memory the JVM process is using at the OS level, sampled every second.

- RSS ≈ Committed Heap: typical healthy state.
- RSS >> Committed Heap: significant off-heap usage — check metaspace, code cache, direct buffers, native libraries.
- RSS growing after Full GC: native memory leak.

*Requires `ResidentSetSize` events (SapMachine JDK 21+, OpenJDK 22+, gc.jfc profile).*

```sql
-- alias rss_data
SELECT * FROM "gc-rss-vs-heap" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["RSS MB", "Committed MB"]) ON rss_data TITLE "RSS vs Committed Heap (MB)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
LINE_CHART(x: "Time", y: ["Off-Heap MB"]) ON rss_data TITLE "Off-Heap Memory (RSS − Committed Heap)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-memory-pools requires="GCHeapMemoryPoolUsage" -->

## Memory Pool Usage Detail

Used and committed bytes per memory pool around each GC cycle. Provides finer granularity than the total heap summary.

- **Eden** fills rapidly between GCs and resets to near-zero after a Young GC.
- **Old** grows gradually; persistently high **Used %** signals promotion pressure.
- **Metaspace** growth after classloading peaks = classloader leak.
- **CodeHeap** growth = JIT-compiled code accumulation (rarely a problem but worth watching in dynamic workloads).

*Requires `GCHeapMemoryPoolUsage` events (SapMachine JDK 25+ gc.jfc, or gc-details.jfc).*

```sql
-- alias pool_data
SELECT * FROM "gc-memory-pools" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Used MB"], color: "Pool") ON pool_data TITLE "Memory Pool Used MB Over Time" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
LINE_CHART(x: "Time", y: ["Used %"], color: "Pool") ON pool_data TITLE "Memory Pool Fill % Over Time" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%" FORMAT ".1f"
```

---

<!-- @cell name=gc-evacuation-detail requires="EvacuationInformation" -->

## Evacuation Efficiency

Measures how efficiently G1 copies live objects during evacuation (Young and Mixed GC).

- **Regions Evacuated** — regions processed per GC; high counts = large young gen or many mixed-GC regions.
- **Fill % per Region** — how full each evacuated region was on average. Low values (< 50%) = fragmented heap; G1 copies mostly empty space.
- **Promoted MB** — bytes promoted to old gen per GC. Rising trend = allocation rate exceeds GC throughput.

*Requires `EvacuationInformation` events (G1 only, gc.jfc or gc-details.jfc).*

```sql
-- alias evac_data
SELECT * FROM "gc-evacuation-efficiency" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Bytes Copied MB", "Promoted MB"]) ON evac_data TITLE "Bytes Copied vs Promoted per GC (MB)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
LINE_CHART(x: "Time", y: ["Fill % per Region"]) ON evac_data TITLE "Evacuation Fill % per Region — low = fragmented" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%" FORMAT ".1f"
```

---

<!-- @cell name=gc-promotion-failure requires="PromotionFailed" -->

## GC Failure Events

**Any row here means the GC fell back to a stop-the-world Full GC.** These are high-impact pause events.

| Failure Type | Trigger | Usual Cause |
|---|---|---|
| **Promotion Failed** | Young GC can't promote objects to old gen | Old gen full, survivor overflow |
| **Evacuation Failed** | G1 can't find a free region to copy into | Heap nearly full, fragmentation |
| **Concurrent Mode Failure** | Concurrent marking didn't finish in time | Allocation rate too high for IHOP threshold |

Each event typically causes a pause 10–100× longer than a normal Young GC.

*Requires `PromotionFailed` events. `EvacuationFailed` and `ConcurrentModeFailure` shown if present.*

```sql
SELECT * FROM "gc-failure-events" ORDER BY "Time"
```

```plot
TABLE() TITLE "GC Failure Events — each row triggered a Full GC"
```

---

<!-- @cell name=gc-concurrent-failure requires="ConcurrentModeFailure" -->

## Concurrent Mode Failures

Each event means concurrent marking could not complete before the heap was exhausted, forcing a stop-the-world Full GC. Typically caused by:
- Allocation rate exceeding the concurrent mark throughput
- IHOP threshold set too high (mark starts too late)
- Long concurrent mark duration (object graph too large)

Cross-reference with the **Adaptive IHOP** cell above: if `Last Mark Duration` is rising and failures appear, G1 needs more headroom (`-XX:G1ReservePercent`, smaller `-XX:InitiatingHeapOccupancyPercent`).

*Requires `ConcurrentModeFailure` events (gc.jfc or gc-details.jfc).*

```sql
SELECT startTime AS "Time", gcId AS "GC ID"
FROM ConcurrentModeFailure
ORDER BY startTime
```

```plot
TABLE() TITLE "Concurrent Mode Failure Events"
```

---

<!-- @cell name=gc-allocation-stalls requires="AllocationStall" -->

## Allocation Stalls

Each event is a **thread that blocked** while waiting for GC to reclaim enough memory to satisfy an allocation request. These are direct evidence that the GC cannot keep up with the allocation rate.

- A high count of stalls = allocation pressure exceeds GC throughput.
- Long stall durations (> 10 ms) indicate Full GC is running while the application thread waits.
- Correlate with the **Pause Timeline** and **Concurrent Mode Failure** cells: stalls typically cluster around the same GC cycles.

*Requires `AllocationStall` events (gc.jfc, G1 and CMS collectors).*

```sql
-- alias stalls
SELECT * FROM "gc-allocation-stalls" ORDER BY "Time"
```

```plot
SCATTER_PLOT(x: "Time", y: "Stall ms") ON stalls TITLE "Allocation Stall Duration per Thread" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

```plot
TABLE() ON stalls TITLE "Allocation Stalls — threads that blocked waiting for GC"
```

---

<!-- @cell name=gc-pause-distribution requires="GCPhasePause" -->

## GC Phase Pause Distribution

Min/median/P90/P99/max pause time broken down by GC phase name. A large gap between median and P99 for a specific phase indicates occasional outlier pauses — typically caused by fragmentation, metaspace pressure, or JNI.

```sql
SELECT * FROM "gc-pause-distribution"
```

```plot
TABLE() TITLE "GC Phase Pause Percentiles"
```

---

<!-- @cell name=gc-humongous requires="GarbageCollection" -->

## Humongous Allocation GC Events

GC events triggered by humongous object allocations (objects > 50% of one G1 region). Frequent humongous-triggered GC means the application is allocating many large objects that bypass the normal young-gen fast path.

- Consider increasing the G1 region size (`-XX:G1HeapRegionSize`) to raise the humongous threshold.
- Or refactor to avoid large short-lived allocations (e.g. large byte arrays).

*Shows only GC events whose `cause` contains "Humongous". Requires `GarbageCollection` events (G1 only).*

```sql
SELECT * FROM "gc-humongous"
```

```plot
TABLE() TITLE "Humongous Allocation GC Events"
```

---

<!-- @cell name=gc-system-gc requires="SystemGC" -->

## System.gc() Calls

Explicit GC invocations triggered by `System.gc()` or `Runtime.getRuntime().gc()`. These are stop-the-world Full GCs triggered from application code. If these are unexpected, use `-XX:+DisableExplicitGC` to suppress them (note: this may affect RMI or DirectBuffer cleanup).

*Requires `SystemGC` events (default.jfc).*

```sql
SELECT * FROM "blocked-by-system-gc" ORDER BY "Time"
```

```plot
TABLE() TITLE "System.gc() Invocations (blocking only)"
```
