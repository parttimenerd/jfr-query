---
title: Memory Leak Detection
description: Long-lived objects and allocation sites that may be leaking — uses OldObjectSample events.
tags: [memory, leaks, heap]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## Memory Leak Detection

Identifies objects that survived multiple GC cycles and the code that allocated them. `OldObjectSample` is JFR's low-overhead leak profiler — it tracks a sample of old objects and records where each was allocated.

**What's here:**
- Long-lived objects by class — which types are accumulating on the heap
- Oldest surviving objects by allocation site — where in your code the suspects were created
- Heap trend over time — rising "after-GC" heap is the clearest leak signal

**Required events:** `OldObjectSample` (needs `-XX:StartFlightRecording:settings=profile` or `jdk.OldObjectSample#enabled=true`, also requires `-Xmx` to be set).

**Interpreting results:** A leak shows up as the same class appearing repeatedly with increasing object age, and a rising "heap after GC" trend in the bottom chart. One-off old objects are normal; a pattern where a specific class always appears and grows older is suspicious.

---

<!-- @cell name=leaks-by-class requires="OldObjectSample" -->

## Long-Lived Objects by Class

Classes whose instances are still alive on the heap, ranked by recency of the oldest surviving sample. A class appearing here repeatedly across recordings is a strong leak signal.

```sql
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Samples",
  round(MAX(os.objectAge), 1) AS "Max Age (s)",
  round(AVG(os.objectAge), 1) AS "Avg Age (s)"
FROM OldObjectSample os
JOIN OldObject o ON os.object = o._id
JOIN Class c ON o.type = c._id
GROUP BY c.javaName
ORDER BY MAX(os.objectAge) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Samples"], horizontal: true) TITLE "Long-Lived Object Samples by Class"
```

---

<!-- @cell name=leaks-by-site requires="OldObjectSample" -->

## Oldest Surviving Objects by Allocation Site

Application methods that allocated the oldest still-live objects. The combination of a specific method + old age + large heap impact is the clearest leak pointer.

```sql
SELECT
  (c.javaName || '.' || m.name) AS "Allocation Site",
  COUNT(*) AS "Samples",
  round(MAX(os.objectAge), 1) AS "Max Age (s)",
  round(AVG(os.objectAge), 1) AS "Avg Age (s)"
FROM OldObjectSample os
JOIN Method m ON os.stackTrace$topApplicationMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY os.stackTrace$topApplicationMethod, c.javaName, m.name
ORDER BY MAX(os.objectAge) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=heap-trend -->

## Heap After GC Over Time

The clearest leak indicator: if heap-after-GC rises steadily over the recording, GC cannot keep up with object creation. A flat line here means no leak; a rising trend means investigate the classes above.

```sql
SELECT
  g."startTime" AS "Time",
  round(h."heapUsed" / 1048576.0, 1) AS "Heap Used MB"
FROM "GCHeapSummary" h
JOIN "GarbageCollection" g ON g."gcId" = h."gcId"
WHERE h."when" = 'After GC'
ORDER BY g."startTime"
```

```plot
LINE_CHART(x: "Time", y: ["Heap Used MB"]) TITLE "Heap Used After GC (MB)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=native-memory requires="NativeMemoryUsage" -->

## Native Memory Usage

JVM Native Memory Tracking (NMT) data — committed and reserved memory broken down by type (Heap, Class, Thread, Code, GC, Internal, etc.).

- **Committed** = memory currently backed by physical pages or swap.
- **Reserved** = address space reserved but not yet backed.
- Large **Thread** committed = many live threads (each Java thread's stack is committed native memory).
- Large **Class** committed = heavy class loading or metaspace pressure.

Enable NMT with `-XX:NativeMemoryTracking=summary` (adds ~5% overhead).

*Requires `NativeMemoryUsage` events (default.jfc with NMT enabled).*

```sql
SELECT * FROM "native-memory-committed" ORDER BY "Average" DESC
```

```plot
BAR_CHART(x: "Memory Type", y: ["Maximum"], horizontal: true) TITLE "Peak Native Memory Committed by Type (bytes)"
```

```plot
TABLE() TITLE "Native Memory Committed — by type"
```
