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
LINE_CHART(x: "Second", y: ["Contention Events", "Total Wait (ms)"]) TITLE "Monitor Contention per Second" LINK_X($start, $end) ZOOM
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
SELECT * FROM "pinned-threads" LIMIT $limit
```

```plot
BAR_CHART(x: "Method", y: ["Pinned Count"], horizontal: true) TITLE "Top Pinning Methods by Occurrence"
```

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
SCATTER(x: "Time", y: "Duration (ms)", color: "Carrier Thread") TITLE "Virtual Thread Pinning Events" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=thread-lifetimes requires="ThreadStart" -->

## Thread Lifetimes

Threads created during this recording, their start time, lifetime duration, and the method that spawned them. Threads with "infinity" duration are still alive at recording end. A large number of short-lived threads indicates thread creation overhead — consider thread pooling.

*Requires `ThreadStart` events (default.jfc).*

```sql
SELECT * FROM "thread-start" LIMIT $limit
```

```plot
TABLE() TITLE "Thread Lifetimes"
```

---

<!-- @cell name=lock-flamegraph requires="JavaMonitorEnter" -->

## Lock Contention Flame Graph

Call-stack breakdown of all monitor wait events, weighted by total wait time (seconds). Wide frames = most blocking time passes through that code path. Use this to find the deepest root cause of contention, not just the top-level lock class.

*Requires `JavaMonitorEnter` events with stack traces enabled.*

```sql
SELECT * FROM "lock-flamegraph"
```

```plot
FLAME_GRAPH() TITLE "Lock Contention Flame Graph (wait time)"
```

---

<!-- @cell name=monitor-inflation requires="JavaMonitorInflate" -->

## Monitor Inflation

Java object monitors start thin (optimistic) and inflate to a heavyweight OS mutex when there is contention. Frequent inflation events indicate lock contention that could be replaced with `java.util.concurrent` primitives or reduced synchronisation scope.

*Requires `JavaMonitorInflate` events (default.jfc).*

```sql
SELECT * FROM "monitor-inflation" ORDER BY "Count" DESC LIMIT $limit
```

```plot
BAR_CHART(x: "Monitor Class", y: ["Count"], horizontal: true) TITLE "Monitor Inflations by Class"
```

```plot
TABLE() TITLE "Monitor Inflation — top inflated classes"
```

---

<!-- @cell name=thread-contention-by-class requires="JavaMonitorEnter" -->

## Monitor Contention by Lock Class

Lock contention grouped by the class of the monitored object. High contention on a single class points to a hotspot lock that could be replaced with a concurrent collection or lock striping.

```sql
SELECT * FROM "contention-by-class"
```

```plot
TABLE() TITLE "Monitor Contention by Lock Class"
```

---

<!-- @cell name=thread-contention-by-address requires="JavaMonitorEnter" -->

## Monitor Contention by Monitor Address

Contention grouped by the individual monitor object (address + class). Identifies the single most-contested object in the heap — useful when multiple instances of the same class exist but only one is a hotspot.

```sql
SELECT * FROM "contention-by-address"
```

```plot
TABLE() TITLE "Monitor Contention by Monitor Address"
```

---

<!-- @cell name=thread-contention-by-site requires="JavaMonitorEnter" -->

## Monitor Contention by Call Site

Which call sites (method + line) are waiting most on monitors. Complements the lock-class and thread views by showing the code path entering the contended lock.

```sql
SELECT * FROM "contention-by-site"
```

```plot
TABLE() TITLE "Monitor Contention by Call Site"
```

---

<!-- @cell name=thread-contention-by-thread requires="JavaMonitorEnter" -->

## Monitor Contention by Thread

Per-thread view of how long each thread waited on monitors. A single thread dominating the max column indicates it holds a heavily contested lock.

```sql
SELECT * FROM "contention-by-thread"
```

```plot
TABLE() TITLE "Monitor Contention by Thread"
```

---

<!-- @cell name=thread-count-over-time requires="JavaThreadStatistics" -->

## Thread Count Over Time

Active and daemon thread counts sampled over the recording. Rising thread counts that don't fall back indicate thread pool leaks or unbounded executor queues.

```sql
SELECT * FROM "thread-count"
```

```plot
LINE_CHART(x: "Start Time", y: ["Active Threads", "Daemon Threads", "Peak Threads"]) TITLE "Thread Count Over Time" LINK_X($start, $end) ZOOM AXIS_Y LABEL "threads"
```

---

<!-- @cell name=thread-allocation-summary requires="ThreadAllocationStatistics" -->

## Thread Allocation by Thread

Cumulative allocation pressure per thread — which threads are allocating the most. Complements the allocation flame graph: identifies the thread rather than the stack frame.

```sql
SELECT * FROM "thread-allocation"
```

```plot
TABLE() TITLE "Thread Allocation Pressure — cumulative bytes per thread"
```

---

<!-- @cell name=thread-cpu-load-summary requires="ThreadCPULoad" -->

## CPU Load by Thread

Last-sample user and system CPU time per thread. High user % = compute-bound; high system % = I/O or syscall-heavy.

```sql
SELECT * FROM "thread-cpu-load"
```

```plot
TABLE() TITLE "CPU Load by Thread"
```

---

<!-- @cell name=tlab-stats requires="ObjectAllocationInNewTLAB" -->

## TLAB Allocation Statistics

Thread-Local Allocation Buffer (TLAB) summary. Inside allocations are fast (bump-pointer within a TLAB). Outside allocations require the slow-path through the JVM. High outside totals indicate frequent large-object allocation bypassing TLABs.

```sql
SELECT * FROM "tlabs"
```

```plot
TABLE() TITLE "TLAB Allocation — inside vs outside"
```
