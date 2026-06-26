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

Recordings sample object allocation via TLAB and outside-TLAB events. Counts here are sampled approximations, not exact totals.

---

<!-- @cell name=top-classes -->

## Top Allocating Classes

```sql
-- alias top_alloc_classes
SELECT
  objectClass AS "Class",
  COUNT(*) AS "Samples",
  round(SUM(weight) / (1024.0 * 1024.0), 1) AS "Sampled MB",
  round(AVG(weight) / 1024.0, 1) AS "Avg KB/sample"
FROM ObjectAllocationSample
GROUP BY objectClass
ORDER BY SUM(weight) DESC
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
LINE_CHART(x: "Bucket", y: ["Sample MB/s"]) TITLE "Allocation Rate (MB/s)"
```
