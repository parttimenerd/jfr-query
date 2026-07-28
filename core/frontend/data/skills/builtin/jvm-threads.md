---
title: JVM Threading Expert
description: Activates JVM threading domain knowledge — monitor contention, thread lifecycle, blocked threads, virtual threads (Project Loom).
tags: [threading, concurrency, locks, loom]
icon: "🧵"
commands:
  - name: overview
    description: "Thread count and lifecycle summary"
    cells: [thread-overview]
  - name: contention
    description: "Top monitor contention hot-spots"
    cells: [monitor-contention]
  - name: blocked
    description: "Threads that spent the most time blocked"
    cells: [blocked-threads]
  - name: help
    description: "Show available threading analysis commands"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM threading and concurrency analysis expert embedded inside a JFR notebook. The user is investigating thread behaviour from a JFR recording loaded into DuckDB.

Key tables for threading analysis:
- `JavaMonitorEnter` — monitor (synchronized block) acquisition events: monitorClass (FK→Class._id), duration, startTime, eventThread (FK→Thread._id)
- `JavaMonitorWait` — threads waiting on a monitor (Object.wait): monitorClass (FK→Class._id), duration, startTime, eventThread (FK→Thread._id)
- `ThreadPark` — LockSupport.park calls (used by java.util.concurrent): parkedClass (FK→Class._id), duration, startTime, eventThread (FK→Thread._id)
- `ThreadSleep` — Thread.sleep calls: duration, startTime, eventThread (FK→Thread._id)
- `JavaThreadStatistics` — periodic snapshot of live/daemon/peak thread counts: activeCount, daemonCount, peakCount
- `VirtualThreadPinned` — virtual threads (Project Loom) pinned to platform threads: duration, startTime (JDK 21+)

IMPORTANT: `monitorClass`, `parkedClass` are BIGINT foreign keys to `Class._id`; `eventThread` is a BIGINT FK to `Thread._id`. Always JOIN to get names:
```sql
JOIN Class c ON e.monitorClass = c._id   -- c.javaName = monitor class name
JOIN Thread t ON e.eventThread = t._id   -- t.javaName = thread name
```

Session variables: use `$session_start` and `$session_end` (with underscores) for time filtering.

When analysing threading:
- High `JavaMonitorEnter` duration means lock contention — look at `monitorClass` to find the hot lock
- `ThreadPark` with no `parkedClass` is often j.u.c. locks — check the stackTrace when available
- Virtual thread pinning shows where Loom's scheduler is blocked — often native code or `synchronized`
- `activeCount` from JavaThreadStatistics shows thread pool sizing — spikes indicate task queuing

Always correlate contention windows with GC pause times to distinguish GC-induced stop-the-world from true lock contention.

## Cells

<!-- @skill-cell name=thread-overview -->

## Thread Count Over Time

```sql
-- alias thread_stats
SELECT
  startTime                          AS "Time",
  activeCount                        AS "Active",
  daemonCount                        AS "Daemon",
  peakCount                          AS "Peak"
FROM JavaThreadStatistics
WHERE startTime BETWEEN $session_start AND $session_end
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Active", "Daemon"]) TITLE "Thread Count Over Time"
```

<!-- @skill-cell name=monitor-contention -->

## Monitor Contention Hot-spots

```sql
-- alias monitor_contention
SELECT
  c.javaName                                    AS "Monitor Class",
  COUNT(*)                                      AS "Enter Events",
  round(SUM(e.duration) * 1000, 1)             AS "Total Wait (ms)",
  round(AVG(e.duration) * 1000, 2)             AS "Avg Wait (ms)",
  round(MAX(e.duration) * 1000, 2)             AS "Max Wait (ms)"
FROM JavaMonitorEnter e
JOIN Class c ON e.monitorClass = c._id
WHERE e.startTime BETWEEN $session_start AND $session_end
GROUP BY c.javaName
ORDER BY SUM(e.duration) DESC
LIMIT 20
```

```plot
BAR_CHART(x: "Monitor Class", y: ["Total Wait (ms)"]) TITLE "Monitor Contention by Class"
```

<!-- @skill-cell name=blocked-threads -->

## Most Blocked Threads

```sql
-- alias blocked_threads
SELECT
  t.javaName                                     AS "Thread",
  COUNT(*)                                       AS "Block Events",
  round(SUM(e.duration) * 1000, 1)              AS "Total Blocked (ms)",
  round(AVG(e.duration) * 1000, 2)              AS "Avg Block (ms)"
FROM (
  SELECT eventThread, duration, startTime FROM JavaMonitorEnter
  UNION ALL
  SELECT eventThread, duration, startTime FROM ThreadPark
) e
JOIN Thread t ON e.eventThread = t._id
WHERE e.startTime BETWEEN $session_start AND $session_end
GROUP BY t.javaName
ORDER BY SUM(e.duration) DESC
LIMIT 20
```

```plot
TABLE()
```
