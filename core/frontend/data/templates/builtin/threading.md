---
title: Threading & Contention
description: Thread activity and monitor contention hotspots.
tags: [threads, contention]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## Threading & Contention

How threads behaved during the recording — live thread counts and where threads blocked waiting on monitors.

**What's here:**
- Thread counts over time (active vs peak)
- Top monitor contention hotspots by total wait time

**Required events:** `JavaThreadStatistics`, `JavaMonitorEnter`

If `JavaThreadStatistics` is missing, enable it with `-XX:StartFlightRecording:settings=default`. Monitor contention requires `-XX:StartFlightRecording:settings=profile` or enabling `jdk.JavaMonitorEnter`.

---

<!-- @cell name=thread-counts -->

## Thread Counts Over Time

```sql
-- alias thread_counts
SELECT
  startTime AS "Time",
  activeCount AS "Active",
  peakCount AS "Peak"
FROM JavaThreadStatistics
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Active", "Peak"]) TITLE "Thread Counts"
```

---

<!-- @cell name=monitor-contention -->

## Top Monitor Contention

Threads blocked waiting on a monitor; the longest waits are the most interesting.

```sql
-- alias monitor_contention
SELECT
  monitorClass AS "Monitor",
  COUNT(*) AS "Events",
  round(SUM(duration) / 1000000.0, 1) AS "Total Wait (ms)",
  round(MAX(duration) / 1000000.0, 1) AS "Max Wait (ms)"
FROM JavaMonitorEnter
GROUP BY monitorClass
ORDER BY SUM(duration) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Monitor", y: ["Total Wait (ms)"], horizontal: true) TITLE "Total Wait Time by Monitor"
```
