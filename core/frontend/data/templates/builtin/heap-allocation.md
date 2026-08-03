---
title: Heap Allocation
description: Where heap memory is going — top allocating classes and sampled allocation rate.
tags: [heap, allocation]
license: MIT
variables:
  $limit: "15"
cellConditions:
  top-classes: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ObjectAllocationSample'"
  allocation-rate: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ObjectAllocationSample'"
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

<!-- @cell name=top-classes -->

## Top Allocating Classes

```sql
-- alias top_alloc_classes
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Samples",
  round(SUM(o.weight) / (1024.0 * 1024.0), 1) AS "Sampled MB",
  round(AVG(o.weight) / 1024.0, 1) AS "Avg KB/sample"
FROM ObjectAllocationSample o
JOIN Class c ON o.objectClass = c._id
GROUP BY c.javaName
ORDER BY SUM(o.weight) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Sampled MB"], horizontal: true) TITLE "Top Allocating Classes (Sampled MB)"
```

---

<!-- @cell name=allocation-rate -->

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
