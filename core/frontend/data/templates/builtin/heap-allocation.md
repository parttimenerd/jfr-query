---
title: Heap Allocation
description: Where heap memory is going — top allocating classes and sampled allocation rate.
tags: [heap, allocation]
license: MIT
variables:
  $limit: "15"
---

<!-- @cell name=intro -->

## Heap Allocation

Where heap memory is going — which classes allocate the most and how the rate changes over time.

**What's here:**
- Top allocating classes by sampled weight (horizontal bar chart)
- Allocation rate over time in MB/s (line chart) — spikes often precede GC events

**Required events:** `ObjectAllocationSample` (needs `-XX:StartFlightRecording:settings=profile` or `jdk.ObjectAllocationSample#enabled=true`)

Counts are **sampled approximations**, not exact totals. The `$limit` variable controls how many top classes are shown.

**Interpreting results:** The top allocating class is the primary GC pressure source — reducing its allocation (e.g. via object pooling or caching) will lower GC frequency the most. An allocation rate > 1 GB/s is very high and will cause frequent young-gen GC. Correlate rate spikes with GC pause spikes in the GC Analysis template.

---

<!-- @cell name=top-classes requires="ObjectAllocationSample" -->

## Top Allocating Classes

```sql
-- alias top_alloc_classes
SELECT
  o.objectClass AS "Class",
  COUNT(*) AS "Samples",
  round(SUM(o.weight) / (1024.0 * 1024.0), 1) AS "Sampled MB",
  round(AVG(o.weight) / 1024.0, 1) AS "Avg KB/sample"
FROM ObjectAllocationSample o
GROUP BY o.objectClass
ORDER BY SUM(o.weight) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Sampled MB"], horizontal: true) TITLE "Top Allocating Classes (Sampled MB)"
```

---

<!-- @cell name=allocation-rate requires="ObjectAllocationSample" -->

## Allocation Rate

Sampled MB/s over time. Spikes often precede GC events.

```sql
-- alias alloc_rate
SELECT
  time_bucket(INTERVAL '1 second', startTime) AS "Bucket",
  round(SUM(weight) / (1024.0 * 1024.0), 2) AS "Sample MB/s"
FROM ObjectAllocationSample
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Bucket", y: ["Sample MB/s"]) TITLE "Allocation Rate (MB/s)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=object-histogram requires="ObjectCountAfterGC" -->

## Object Count After GC

Snapshot of live object counts and sizes immediately after a GC cycle. This is the ground truth of what is alive on the heap — unlike allocation samples, this counts actual retained objects.

- High count or size for a class that also tops the allocation chart = it's both allocated and retained (leak candidate).
- Large `byte[]` / `char[]` counts = string or buffer retention.

*Requires `ObjectCountAfterGC` events (gc-details.jfc or custom JFC with `jdk.ObjectCountAfterGC` enabled).*

```sql
SELECT * FROM "object-statistics" LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Count"], horizontal: true) TITLE "Live Object Count After GC"
```

```plot
TABLE() TITLE "Object Statistics After GC"
```

---

<!-- @cell name=alloc-flamegraph requires="ObjectAllocationSample" -->

## Allocation Flame Graph

Full call-stack breakdown of allocation samples, weighted by sampled MB. Wide frames = most allocation passes through that code path. Use this to find the deepest allocation root cause — not just the top class.

*Requires `ObjectAllocationSample` events with stack traces (`stackDepth > 0`).*

```sql
SELECT * FROM "alloc-flamegraph"
```

```plot
FLAME_GRAPH() TITLE "Allocation Flame Graph (sampled MB)"
```

---

<!-- @cell name=allocation-by-class-detail requires="ObjectAllocationSample" -->

## Allocation by Object Class — Detail

Sampled allocation broken down by object class: sample count, sampled bytes, and average sample weight. More detailed than the pressure view — useful for identifying which specific classes dominate allocation.

```sql
SELECT * FROM "allocation-by-class-detail"
```

```plot
TABLE() TITLE "Allocation by Object Class — sampled bytes"
```

---

<!-- @cell name=allocation-by-class-pressure requires="ObjectAllocationSample" -->

## Allocation Pressure by Object Class

Top 25 object classes by allocation pressure (fraction of total sampled weight). A single class > 30% of pressure indicates a hot allocation site worth profiling further.

```sql
SELECT * FROM "allocation-by-class"
```

```plot
TABLE() TITLE "Allocation Pressure by Class"
```

---

<!-- @cell name=allocation-by-thread-pressure requires="ObjectAllocationSample" -->

## Allocation Pressure by Thread

Which threads are responsible for the most sampled allocation. Complements the flame graph: identifies the allocating thread before drilling into its stack.

```sql
SELECT * FROM "allocation-by-thread"
```

```plot
TABLE() TITLE "Allocation Pressure by Thread"
```
