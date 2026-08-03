---
title: Threading & Contention
description: Thread activity, monitor contention, CPU load per thread, thread blocking, and virtual thread pinning.
tags: [threads, contention, virtual-threads]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## Threading & Contention

How threads behaved during the recording — live thread counts, where threads blocked waiting on monitors, which threads consumed the most CPU, and where virtual threads were pinned.

**What's here:**
- Thread counts over time (active vs peak)
- Thread CPU load — which threads consumed the most CPU
- Top monitor contention hotspots by total wait time
- Contention by calling site — which code holds the lock longest
- Thread blocking over time (parks + sleeps) — latency rhythm
- Virtual thread pinning — carrier thread blockages (Java 21+)

**Required events:** `JavaThreadStatistics`, `ThreadCPULoad`, `JavaMonitorEnter` (profile settings or `jdk.JavaMonitorEnter#enabled=true`), `ThreadPark`, `ThreadSleep`.

**Interpreting results:** A few threads consuming > 80% CPU is normal for CPU-bound work; unexpected high CPU in daemon or GC threads warrants investigation. Monitor contention > 10ms average is a scalability bottleneck. Virtual thread pinning prevents the carrier thread from being re-used and limits parallelism.

---

<!-- @cell name=thread-counts requires="JavaThreadStatistics" -->

## Thread Counts Over Time

Active thread count rising over time without falling back indicates a thread leak. A persistent gap between Active and Peak suggests threads were created but not reused.

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
LINE_CHART(x: "Time", y: ["Active", "Peak"]) TITLE "Thread Counts" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=thread-cpu requires="ThreadCPULoad" -->

## Thread CPU Load

CPU usage per thread at the last observed sample. High `System` CPU in a few threads may indicate JNI or native activity; high `User` CPU identifies hot application threads.

```sql
SELECT
  t.javaName AS "Thread",
  round(LAST(user) * 100, 1) AS "User %",
  round(LAST(system) * 100, 1) AS "System %",
  round((LAST(user) + LAST(system)) * 100, 1) AS "Total %"
FROM ThreadCPULoad l
JOIN Thread t ON l.eventThread = t._id
GROUP BY t.javaName
ORDER BY (LAST(user) + LAST(system)) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Thread", y: ["User %", "System %"], layout: "stacked", horizontal: true) TITLE "Thread CPU Load (%) — Last Sample"
```

---

<!-- @cell name=monitor-contention requires="JavaMonitorEnter" -->

## Top Monitor Contention by Class

Threads blocked waiting on a monitor. High total wait time in a single lock class is a scalability bottleneck — consider lock striping, reducing critical section size, or switching to `java.util.concurrent` primitives.

```sql
-- alias monitor_contention
SELECT
  c.javaName AS "Monitor Class",
  COUNT(*) AS "Events",
  round(SUM(e.duration) * 1000.0, 1) AS "Total Wait (ms)",
  round(AVG(e.duration) * 1000.0, 2) AS "Avg Wait (ms)",
  round(MAX(e.duration) * 1000.0, 1) AS "Max Wait (ms)"
FROM JavaMonitorEnter e
JOIN Class c ON e.monitorClass = c._id
GROUP BY c.javaName
ORDER BY SUM(e.duration) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Monitor Class", y: ["Total Wait (ms)"], horizontal: true) TITLE "Total Monitor Wait Time by Lock Class"
```

---

<!-- @cell name=contention-by-site requires="JavaMonitorEnter" -->

## Contention by Calling Site

Which methods are calling into the contested monitors — points to the actual code to fix.

```sql
SELECT
  (c.javaName || '.' || m.name) AS "Calling Site",
  COUNT(*) AS "Events",
  round(SUM(e.duration) * 1000.0, 1) AS "Total Wait (ms)",
  round(MAX(e.duration) * 1000.0, 1) AS "Max Wait (ms)"
FROM JavaMonitorEnter e
JOIN Method m ON e.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY c.javaName, m.name
ORDER BY SUM(e.duration) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=contention-over-time requires="JavaMonitorEnter" -->

## Monitor Contention Over Time

Wait events per second — spikes reveal when lock contention is highest and whether it correlates with GC pauses or CPU spikes.

```sql
SELECT
  time_bucket(INTERVAL '1 second', e.startTime) AS "Second",
  COUNT(*) AS "Contention Events",
  round(SUM(e.duration) * 1000.0, 1) AS "Total Wait (ms)"
FROM JavaMonitorEnter e
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Second", y: ["Contention Events", "Total Wait (ms)"], layout: "grouped") TITLE "Monitor Contention per Second" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=thread-blocking requires="ThreadPark,ThreadSleep" -->

## Thread Blocking Over Time

Parks and sleeps per second. Spikes in parks often correlate with lock contention peaks; spikes in sleeps indicate scheduled waits (e.g. timers, pollers). A flat baseline of parks across the whole recording is normal for thread pools.

```sql
SELECT
  time_bucket(INTERVAL '1 second', startTime) AS "Second",
  COUNT(*) FILTER (WHERE kind = 'park') AS "Parks",
  COUNT(*) FILTER (WHERE kind = 'sleep') AS "Sleeps"
FROM (
  SELECT startTime, 'park' AS kind FROM ThreadPark
  UNION ALL
  SELECT startTime, 'sleep' AS kind FROM ThreadSleep
)
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Second", y: ["Parks", "Sleeps"]) TITLE "Thread Blocking per Second" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=pinned-threads requires="VirtualThreadPinned" -->

## Virtual Thread Pinning

Virtual threads are pinned when they block while holding a monitor or running inside a `synchronized` block. Pinned threads occupy a carrier thread and reduce parallelism.

*Only present if the recording includes `VirtualThreadPinned` events (Java 21+).*

```sql
SELECT
  startTime AS "Time",
  round(duration * 1000, 2) AS "Duration (ms)",
  t.javaName AS "Carrier Thread"
FROM VirtualThreadPinned v
JOIN Thread t ON v.eventThread = t._id
ORDER BY duration DESC
LIMIT $limit
```

```plot
TABLE()
```

```plot
SCATTER(x: "Time", y: "Duration (ms)", color: "Carrier Thread") TITLE "Virtual Thread Pinning Events" LINK_X($start, $end) ZOOM
```
