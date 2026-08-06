---
title: ZGC Analysis
description: Analyse ZGC stop-the-world pauses, concurrent phases, and heap utilisation.
tags: [gc, zgc, performance]
license: MIT
variables:
  $threshold_ms: "5"
  $limit: "50"
---

<!-- @cell name=intro -->

## ZGC Analysis

A ready-to-run analysis of ZGC garbage-collection behaviour from your JFR recording.

**What's here:**
- ZGC STW pause breakdown by phase
- Concurrent phase durations
- Cycle statistics (total STW per cycle)
- Heap utilisation over time

**Required events:** `ZGCGarbageCollection` or `ZGCPhaseStatistics`

*Load a recording with ZGC enabled and recorded events to use all cells.*

---

<!-- @cell name=zgc-pause-overview requires="ZGCGarbageCollection" -->

## ZGC Stop-the-World Pauses

ZGC aims for sub-millisecond STW pauses. Each row is one STW phase. Long phases indicate JVM activity outside ZGC's control (e.g. weak reference processing, class unloading) or GC starvation due to allocation pressure.

*Requires `ZGCGarbageCollection` events.*

```sql
-- alias zgc_pauses
SELECT * FROM "zgc-pause-phases" ORDER BY "Time" DESC LIMIT $limit
```

```plot
TABLE() ON zgc_pauses TITLE "ZGC STW Phases (latest $limit)"
```

```plot
BAR_CHART(x: "Time", y: ["Duration ms"], color: "Phase") TITLE "ZGC STW Phase Duration" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=zgc-long-pauses requires="ZGCGarbageCollection" -->

## Long STW Pauses

Pauses exceeding `$threshold_ms` ms. ZGC's goal is < 1 ms; values above this threshold warrant investigation.

*Requires `ZGCGarbageCollection` events.*

```sql
-- alias zgc_long_pauses
SELECT * FROM "zgc-pause-phases"
WHERE "Duration ms" > $threshold_ms
ORDER BY "Duration ms" DESC
LIMIT $limit
```

```plot
TABLE() ON zgc_long_pauses TITLE "Long STW Pauses (> $threshold_ms ms)"
```

---

<!-- @cell name=zgc-cycle-stats requires="ZGCGarbageCollection" -->

## Cycle Statistics

Total STW time and phase count per GC cycle. Cycles with many STW phases or long total pause time may indicate allocation pressure forcing ZGC to run more frequently.

*Requires `ZGCGarbageCollection` events.*

```sql
-- alias zgc_cycles
SELECT * FROM "zgc-cycle-stats" ORDER BY "GC ID" DESC LIMIT $limit
```

```plot
TABLE() ON zgc_cycles TITLE "ZGC Cycle Summary (latest $limit)"
```

```plot
BAR_CHART(x: "GC ID", y: ["Total STW ms"]) TITLE "Total STW ms Per ZGC Cycle" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=zgc-concurrent-phases requires="ZGCPhaseStatistics" -->

## Concurrent Phase Durations

ZGC's concurrent phases run alongside application threads. Long concurrent phases (> hundreds of ms) can cause allocation stalls if the application fills the heap faster than ZGC clears it.

*Requires `ZGCPhaseStatistics` events.*

```sql
-- alias zgc_concurrent
SELECT * FROM "zgc-concurrent-phases" ORDER BY "Time" DESC LIMIT $limit
```

```plot
TABLE() ON zgc_concurrent TITLE "ZGC Concurrent Phases (latest $limit)"
```

```plot
LINE_CHART(x: "Time", y: ["Duration ms"], color: "Phase") TITLE "Concurrent Phase Durations" LINK_X($start, $end) ZOOM AXIS_Y LABEL "ms"
```

---

<!-- @cell name=zgc-heap requires="ZGCStatistics" -->

## Heap Utilisation

Heap used, capacity, and free-after-GC over time. A high used% with low free-after-GC means the heap is under pressure — consider increasing `-Xmx` or investigating allocation rates.

*Requires `ZGCStatistics` events.*

```sql
-- alias zgc_heap
SELECT * FROM "zgc-heap-stats" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Heap Used MB", "Heap Capacity MB"]) TITLE "ZGC Heap Used vs Capacity" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
LINE_CHART(x: "Time", y: ["Used %"]) TITLE "Heap Used %" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%" FORMAT ".1f"
```

---

<!-- @cell name=zgc-tuning-advisor requires="GarbageCollection" -->

## GC Tuning Advisor

Automated recommendations based on the observed GC behaviour in this recording.

```sql
-- alias zgc_tuning
SELECT * FROM "gc-tuning-advisor"
```

```plot
TABLE() ON zgc_tuning TITLE "GC Tuning Recommendations"
```
