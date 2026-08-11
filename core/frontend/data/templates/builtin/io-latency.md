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

**Required events:** `FileRead`, `FileWrite`, `SocketRead`, `SocketWrite`, `ThreadPark`, `ThreadSleep` (all enabled in the `profile` configuration; `FileRead`/`FileWrite`/`SocketRead`/`SocketWrite` may also need a threshold of 0ms to capture all events). The combined latency overview requires all these event types; individual sections show only what's available.

**Interpreting results:** A single event type dominating total wait time is the primary bottleneck. For socket I/O, check whether a single slow host drives the latency. For file I/O, large reads from a single path can indicate missing caching.

---

<!-- @cell name=latency-overview requires="JavaMonitorWait" -->

## Combined Latency Overview

Total blocking time across all event types. The type with the highest "Total" is your biggest latency bottleneck.

```sql
SELECT * FROM "latencies-by-type"
```

```plot
BAR_CHART(x: "Event Type", y: ["Total (s)"], horizontal: true) TITLE "Total Blocking Time by Type"
```

---

<!-- @cell name=file-reads requires="FileRead" -->

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

<!-- @cell name=file-writes requires="FileWrite" -->

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

<!-- @cell name=socket-reads requires="SocketRead" -->

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

<!-- @cell name=socket-writes requires="SocketWrite" -->

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

<!-- @cell name=thread-parks-over-time requires="ThreadPark,ThreadSleep" -->

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

---

<!-- @cell name=network-utilization requires="NetworkUtilization" -->

## Network Utilization

Read and write throughput per network interface. Spikes in write rate often accompany socket-write latency spikes.

*Requires `NetworkUtilization` events (default.jfc).*

```sql
SELECT * FROM "network-utilization"
```

```plot
TABLE() TITLE "Network Utilization by Interface"
```

---

<!-- @cell name=file-reads-by-path-cell requires="FileRead" -->

## File Reads by Path

Top files by total bytes read. Unexpected large reads from temp directories or repeated reads from config files are common candidates for buffering or caching improvements.

```sql
SELECT * FROM "file-reads-by-path"
```

```plot
TABLE() TITLE "File Reads — total bytes by path"
```

---

<!-- @cell name=file-writes-by-path-cell requires="FileWrite" -->

## File Writes by Path

Top files by total bytes written. Continuous writes to a single log file may indicate an opportunity for async logging or write buffering.

```sql
SELECT * FROM "file-writes-by-path"
```

```plot
TABLE() TITLE "File Writes — total bytes by path"
```

---

<!-- @cell name=socket-reads-by-host-cell requires="SocketRead" -->

## Socket Reads by Host

Inbound data volume grouped by remote host. Unexpected large reads from internal hosts may indicate a misconfigured keep-alive timeout triggering repeated reconnects.

```sql
SELECT * FROM "socket-reads-by-host"
```

```plot
TABLE() TITLE "Socket Reads — total bytes by host"
```

---

<!-- @cell name=socket-writes-by-host-cell requires="SocketWrite" -->

## Socket Writes by Host

Outbound data volume grouped by remote host. Large writes to a single host indicate a potential batching opportunity or a chatty protocol.

```sql
SELECT * FROM "socket-writes-by-host"
```

```plot
TABLE() TITLE "Socket Writes — total bytes by host"
```
