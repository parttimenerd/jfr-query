---
title: GC Deep Dive
description: Extended GC analysis — pause timelines, cause breakdown, old-gen growth, allocation pressure, TTSP, and collector-specific region sizing.
tags: [gc, memory, allocation, performance]
license: MIT
priority: 12
variables:
  $$threshold_ms: "50"
  $$limit: "20"
cellConditions:
  g1-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'G1HeapSummary'"
  alloc-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ObjectAllocationSample'"
  safepoint-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'SafepointBegin'"
  concurrent-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'GCPhaseConcurrent'"
  tlab-section: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ObjectAllocationInNewTLAB'"
---

<!-- @cell name=intro -->

## GC Deep Dive

This template focuses on the **causes and mechanisms** behind GC pressure — going beyond pause counts to show *why* pauses happen, *where* memory pressure originates, and *how* the collector is spending its time.

**What's covered:**

- Pause timelines and cause breakdown over time
- Young vs Old/Full GC split
- Top individual pauses (longest phases)
- Old generation growth rate (memory leak signal)
- Eden and Survivor region sizing (G1)
- TTSP distribution (thread response latency)
- Allocation pressure by class and thread
- GC throughput and efficiency
- Concurrent phase breakdown

**Variables:**
- `$$threshold_ms` — long-pause threshold (default 50 ms); adjust with the slider below.

<!-- @cell name=threshold input="slider" var="$$threshold_ms" min="0" max="500" default="50" -->

---

<!-- @cell name=summary-header requires="GarbageCollection" -->

## Overview

```sql
-- alias gc_overview
SELECT
    COUNT(*) AS "Total GC Events",
    format_duration(SUM(sumOfPauses)) AS "Total STW Time",
    format_duration(AVG(sumOfPauses)) AS "Avg Pause",
    format_duration(MAX(longestPause)) AS "Worst Pause",
    ROUND(100.0 * SUM(sumOfPauses) / (MAX(startTime) - MIN(startTime)), 2) AS "GC Overhead %"
FROM GarbageCollection
```

```plot
TABLE() ON gc_overview TITLE "Recording-Level GC Summary"
```

---

<!-- @cell name=gc-pause-over-time requires="GarbageCollection" -->

## Pause Events Over Time

Individual pause durations plotted across the recording. Use the brush to zoom into busy regions, then scroll down — linked charts will follow.

Pauses above `$$threshold_ms` ms are the actionable ones.

```sql
SELECT * FROM "gc-pause-over-time" ORDER BY "Time"
```

```plot
SCATTER(x: "Time", y: "Pause (ms)", color: "Cause") TITLE "GC Pause Events Over Time" LINK_X($start, $end, master) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=long-pauses requires="GarbageCollection" -->

## Long Pauses (> $$threshold_ms ms)

```sql
SELECT
    startTime AS "Time",
    cause AS "Cause",
    ROUND(sumOfPauses * 1000, 2) AS "STW (ms)",
    ROUND(longestPause * 1000, 2) AS "Longest Phase (ms)"
FROM GarbageCollection
WHERE sumOfPauses * 1000 > $$threshold_ms
ORDER BY sumOfPauses DESC
LIMIT $$limit
```

```plot
TABLE() TITLE "Long Pauses Above $$threshold_ms ms" SORT DESC LIMIT $$limit
```

---

<!-- @cell name=gc-top-individual-pauses requires="GCPhasePause" -->

## Top 20 Longest Phases

The 20 longest individual phase pauses from the raw event log. These pinpoint *which phase* is slow (e.g. `G1 Evacuation Pause` vs `Parallel Marking`).

```sql
SELECT * FROM "gc-top-pauses"
```

```plot
TABLE() TITLE "Top 20 Longest Individual Phase Pauses" SORT DESC LIMIT 20
```

---

<!-- @cell name=gc-young-old-time requires="GarbageCollection" -->

## Young vs Old/Full GC Time

Time split between Young, Mixed, and Old/Full collections. Young-dominant workloads are healthy. A growing Old/Full fraction means the old generation can't keep up with promotion.

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

## Cause Breakdown Over Time

30-second windows showing which cause dominated pause time. A sudden shift in cause (e.g. from `G1 Young Generation` to `GCLocker`) pinpoints when a problem started.

```sql
SELECT * FROM "gc-pause-cause-over-time"
```

```plot
AREA_CHART(x: "Window", y: ["Pause (ms)"], color: "Cause", layout: "stacked") TITLE "STW Pause by Cause (30s windows)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=gc-throughput requires="GarbageCollection" -->

## Application Throughput

Percentage of time the application was NOT in a GC pause (10-second windows). Target > 95%. Below 90% means the application is spending more than 1 in 10 seconds collecting garbage.

```sql
SELECT * FROM "gc-throughput"
```

```plot
LINE_CHART(x: "Window", y: ["Throughput %"]) TITLE "Application Throughput (10s windows)" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%" FORMAT ".1f"
```

---

<!-- @cell name=gc-efficiency requires="GCHeapSummary" -->

## GC Efficiency (MB Reclaimed per Second)

Collections with low `MB/s reclaimed` and high pause time are the least efficient — often caused by fragmentation or humongous allocations.

```sql
SELECT * FROM "gc-efficiency"
```

```plot
TABLE() TITLE "GC Efficiency — Reclaimed MB per Second" SORT DESC LIMIT 20
```

---

<!-- @cell name=heap-committed requires="GCHeapSummary" -->

## Committed vs Used Heap

Committed heap is the OS-allocated pool; used heap is what objects actually occupy. The gap between committed and used is the JVM's free headroom.

```sql
SELECT * FROM "heap-committed-vs-used" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Committed MB", "Used MB"], color: "Phase") TITLE "Heap Committed vs Used" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-old-gen-growth requires="G1HeapSummary" cellCondition="g1-section" -->

## Old Generation Growth (G1)

Old generation size bounds per minute. A **steadily rising minimum** is the clearest early sign of a memory leak — the GC cannot reclaim as much as the application promotes.

*Requires `G1HeapSummary` events (G1 collector only).*

```sql
SELECT * FROM "gc-old-gen-growth" ORDER BY "Minute"
```

```plot
LINE_CHART(x: "Minute", y: ["Old Gen Max MB", "Old Gen Min MB"]) TITLE "Old Generation Growth Rate (G1)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-eden-size requires="G1HeapSummary" cellCondition="g1-section" -->

## Eden and Survivor Region Sizing (G1)

Eden used at each GC event. Eden filling to capacity forces more frequent Young collections. Watch for Eden regularly exhausting before the next concurrent cycle starts.

*Requires `G1HeapSummary` events.*

```sql
SELECT * FROM "gc-eden-size" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Eden Used MB", "Survivor MB"]) TITLE "Eden and Survivor Sizing (G1)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=consecutive-full-gcs requires="GarbageCollection" -->

## Consecutive Full GC Detection

Runs of 3+ consecutive Full GCs are a critical signal — the old generation cannot recover between collections. This is almost always a memory leak or severely undersized heap.

```sql
SELECT * FROM "gc-consecutive-full"
```

```plot
TABLE() TITLE "Consecutive Full GC Runs (≥ 3)"
```

---

<!-- @cell name=gc-safepoint-distribution requires="SafepointBegin" cellCondition="safepoint-section" -->

## Time To SafePoint (TTSP) Distribution

How long it takes all threads to reach a safepoint. High TTSP (> 10 ms) means threads are slow to respond to stop-the-world requests — commonly caused by long loops without safepoint polls.

Fix: add `-XX:+UseCountedLoopSafepoints` to JVM args.

*Requires `SafepointBegin` and `SafepointEnd` events.*

```sql
-- alias ttsp
SELECT * FROM "gc-safepoint-distribution" LIMIT 500
```

```plot
HISTOGRAM(x: "TTSP (ms)", logBins: true) TITLE "Time To SafePoint Distribution" ON ttsp
```

```plot
TABLE() TITLE "TTSP Percentiles" ON ttsp LIMIT 10
```

---

<!-- @cell name=concurrent-phases requires="GCPhaseConcurrent" cellCondition="concurrent-section" -->

## Concurrent Phase Gantt

Concurrent GC phases running alongside the application. Phases that overlap with Young collections may signal concurrent mode failure risk.

*Requires `GCPhaseConcurrent` events.*

```sql
SELECT * FROM "gc-concurrent-phases-detail"
```

```plot
TABLE() TITLE "Concurrent Phase Timeline" SORT DESC LIMIT 50
```

---

<!-- @cell name=gc-allocation-by-class requires="ObjectAllocationSample" cellCondition="alloc-section" -->

## Top Allocating Classes

Classes generating the most object churn. Reducing allocation in the top 3–5 classes directly lowers GC pressure.

*Requires `ObjectAllocationSample` events (enable with `-XX:FlightRecorderOptions=stackdepth=128`).*

```sql
SELECT * FROM "gc-allocation-by-class"
```

```plot
BAR_CHART(x: "Class", y: ["Approx MB"], horizontal: true) TITLE "Top Allocating Classes (sampled)" SORT DESC LIMIT $$limit AXIS_Y LABEL "MB"
```

---

<!-- @cell name=gc-thread-allocation requires="ObjectAllocationSample" cellCondition="alloc-section" -->

## Per-Thread Allocation

Threads driving the most allocation. A single thread allocating orders of magnitude more than others suggests a hot code path that would benefit from object pooling or batch processing.

*Requires `ObjectAllocationSample` events.*

```sql
SELECT * FROM "gc-thread-allocation"
```

```plot
BAR_CHART(x: "Thread", y: ["Approx MB"], horizontal: true) TITLE "Allocation by Thread (sampled)" SORT DESC LIMIT $$limit
```

---

<!-- @cell name=allocation-by-site requires="ObjectAllocationSample" cellCondition="alloc-section" -->

## Allocation by Call Site

Specific methods causing the most allocation. These are the precise locations to target for allocation reduction.

*Requires `ObjectAllocationSample` with method stack frames.*

```sql
SELECT * FROM "allocation-by-site" LIMIT $$limit
```

```plot
TABLE() TITLE "Top Allocating Call Sites" SORT DESC LIMIT $$limit
```

---

<!-- @cell name=tlab-efficiency requires="ObjectAllocationInNewTLAB" cellCondition="tlab-section" -->

## TLAB Efficiency

TLAB (Thread-Local Allocation Buffer) fill ratio. Values below 0.5 mean TLABs are frequently discarded partially full — increase `-XX:TLABSize` or reduce `XX:TLABWasteTargetPercent` to improve efficiency.

*Requires `ObjectAllocationInNewTLAB` events.*

```sql
SELECT * FROM "tlab-efficiency" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Fill Ratio"]) TITLE "TLAB Fill Ratio Over Time" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 1] LABEL "ratio" FORMAT ".2f"
```
