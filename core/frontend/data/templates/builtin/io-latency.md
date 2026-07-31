---
title: I/O & Latency
description: File I/O, socket I/O, thread blocking, and a combined latency breakdown across all blocking event types.
tags: [io, latency, network, threads]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## I/O & Latency

Where is your application spending time waiting? This notebook covers all blocking event types — file I/O, socket I/O, thread parks/sleeps, and monitor waits — to identify the biggest latency contributors.

**What's here:**
- Combined latency breakdown — which blocking type costs the most total time
- File I/O by path — top files by bytes read/written
- Socket I/O by host — network calls that move the most data
- Thread blocking — parks and sleeps over time

**Required events:** `FileRead`, `FileWrite`, `SocketRead`, `SocketWrite`, `ThreadPark`, `ThreadSleep` (all enabled in the `profile` configuration; `FileRead`/`FileWrite`/`SocketRead`/`SocketWrite` may also need a threshold of 0ms to capture all events).

**Interpreting results:** A single event type dominating total wait time is the primary bottleneck. For socket I/O, check whether a single slow host drives the latency. For file I/O, large reads from a single path can indicate missing caching.

---

<!-- @cell name=latency-overview -->

## Combined Latency Overview

Total blocking time across all event types. The type with the highest "Total" is your biggest latency bottleneck.

```sql
SELECT
  eventType AS "Event Type",
  COUNT(*) AS "Count",
  round(SUM(duration) * 1000, 1) AS "Total (ms)",
  round(AVG(duration) * 1000, 2) AS "Avg (ms)",
  round(MAX(duration) * 1000, 2) AS "Max (ms)"
FROM (
  SELECT 'Java Monitor Wait' AS eventType, duration FROM JavaMonitorWait
  UNION ALL
  SELECT 'Java Monitor Enter' AS eventType, duration FROM JavaMonitorEnter
  UNION ALL
  SELECT 'Thread Park' AS eventType, duration FROM ThreadPark
  UNION ALL
  SELECT 'Thread Sleep' AS eventType, duration FROM ThreadSleep
  UNION ALL
  SELECT 'Socket Read' AS eventType, duration FROM SocketRead
  UNION ALL
  SELECT 'Socket Write' AS eventType, duration FROM SocketWrite
  UNION ALL
  SELECT 'File Read' AS eventType, duration FROM FileRead
  UNION ALL
  SELECT 'File Write' AS eventType, duration FROM FileWrite
)
GROUP BY eventType
ORDER BY SUM(duration) DESC
```

```plot
BAR_CHART(x: "Event Type", y: ["Total (ms)"], horizontal: true) TITLE "Total Blocking Time by Type (ms)"
```

---

<!-- @cell name=file-reads -->

## File Reads by Path

```sql
SELECT
  path AS "Path",
  COUNT(*) AS "Reads",
  round(SUM(bytesRead) / 1048576.0, 2) AS "Total Read (MB)",
  round(AVG(duration) * 1000, 2) AS "Avg Duration (ms)"
FROM FileRead
GROUP BY path
ORDER BY SUM(bytesRead) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=file-writes -->

## File Writes by Path

```sql
SELECT
  path AS "Path",
  COUNT(*) AS "Writes",
  round(SUM(bytesWritten) / 1048576.0, 2) AS "Total Written (MB)",
  round(AVG(duration) * 1000, 2) AS "Avg Duration (ms)"
FROM FileWrite
GROUP BY path
ORDER BY SUM(bytesWritten) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=socket-reads -->

## Socket Reads by Host

```sql
SELECT
  host AS "Host",
  port AS "Port",
  COUNT(*) AS "Reads",
  round(SUM(bytesRead) / 1024.0, 1) AS "Total Read (KB)",
  round(AVG(duration) * 1000, 2) AS "Avg Duration (ms)",
  round(MAX(duration) * 1000, 2) AS "Max Duration (ms)"
FROM SocketRead
GROUP BY host, port
ORDER BY SUM(bytesRead) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=socket-writes -->

## Socket Writes by Host

```sql
SELECT
  host AS "Host",
  port AS "Port",
  COUNT(*) AS "Writes",
  round(SUM(bytesWritten) / 1024.0, 1) AS "Total Written (KB)",
  round(AVG(duration) * 1000, 2) AS "Avg Duration (ms)"
FROM SocketWrite
GROUP BY host, port
ORDER BY SUM(bytesWritten) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=thread-parks-over-time -->

## Thread Blocking Over Time

Thread parks and sleeps per second — spikes indicate periods of high blocking that may correlate with latency spikes.

```sql
SELECT
  time_bucket(INTERVAL '1 second', startTime) AS "Second",
  COUNT(*) FILTER (WHERE eventType = 'park') AS "Parks",
  COUNT(*) FILTER (WHERE eventType = 'sleep') AS "Sleeps"
FROM (
  SELECT startTime, 'park' AS eventType FROM ThreadPark
  UNION ALL
  SELECT startTime, 'sleep' AS eventType FROM ThreadSleep
)
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Second", y: ["Parks", "Sleeps"]) TITLE "Thread Blocking Events per Second" LINK_X($start, $end) ZOOM
```
