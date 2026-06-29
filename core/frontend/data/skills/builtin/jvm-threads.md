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
- `JavaMonitorEnter` — monitor (synchronized block) acquisition events: monitorClass, duration, startTime, thread
- `JavaMonitorWait` — threads waiting on a monitor (Object.wait): monitorClass, duration, startTime, thread
- `ThreadPark` — LockSupport.park calls (used by java.util.concurrent): parkedClass, duration, startTime, thread
- `ThreadSleep` — Thread.sleep calls: duration, startTime, thread
- `JavaThreadStatistics` — periodic snapshot of live/daemon/peak thread counts: activeCount, daemonCount, peakedCount
- `VirtualThreadPinned` — virtual threads (Project Loom) pinned to platform threads: duration, startTime (JDK 21+)

When analysing threading:
- High `JavaMonitorEnter` duration means lock contention — look at `monitorClass` to find the hot lock
- `ThreadPark` with no `parkedClass` is often j.u.c. locks — check the stackTrace when available
- Virtual thread pinning shows where Loom's scheduler is blocked — often native code or `synchronized`
- For contention hot-spots, group by `monitorClass` and sum `duration`
- Avoid suggesting `Thread.sleep` reduction as a fix without understanding the intent
- `activeCount` from JavaThreadStatistics shows thread pool sizing — spikes indicate task queuing

Always correlate contention windows with GC pause times to distinguish GC-induced stop-the-world from true lock contention.

## Cells

<!-- @skill-cell name=thread-overview -->

## Thread Count Over Time

```sql
-- alias thread_stats
SELECT
  strftime('%H:%M:%S', startTime::TIMESTAMP)  AS "Time",
  activeCount                       AS "Active",
  daemonCount                       AS "Daemon",
  peakedCount                       AS "Peak"
FROM JavaThreadStatistics
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
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
  monitorClass                                  AS "Monitor Class",
  COUNT(*)                                      AS "Enter Events",
  round(SUM(duration) * 1000, 1)               AS "Total Wait (ms)",
  round(AVG(duration) * 1000, 2)               AS "Avg Wait (ms)",
  round(MAX(duration) * 1000, 2)               AS "Max Wait (ms)"
FROM JavaMonitorEnter
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY monitorClass
ORDER BY SUM(duration) DESC
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
  thread                                         AS "Thread",
  COUNT(*)                                       AS "Block Events",
  round(SUM(duration)  * 1000, 1)              AS "Total Blocked (ms)",
  round(AVG(duration)  * 1000, 2)              AS "Avg Block (ms)"
FROM (
  SELECT thread, duration FROM JavaMonitorEnter
  UNION ALL
  SELECT thread, duration FROM ThreadPark
)
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY thread
ORDER BY SUM(duration) DESC
LIMIT 20
```

```plot
TABLE()
```
