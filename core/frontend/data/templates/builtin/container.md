---
title: Container & Cloud
description: CPU throttling, memory limits, and I/O usage for JVMs running in Docker or Kubernetes.
tags: [container, kubernetes, docker, cloud]
license: MIT
---

<!-- @cell name=intro -->

## Container & Cloud Analysis

When a JVM runs inside a container, it may be throttled by cgroup CPU quotas or killed by OOM limits. This notebook surfaces that external pressure alongside what the JVM itself observed.

**What's here:**
- Container CPU throttling — how often and how severely the container was throttled
- Container memory usage vs. limit — how close you are to the OOM killer
- Container I/O usage — disk read/write throughput at the cgroup level
- Container CPU usage — CPU consumed by the container over time

**Required events:** `ContainerCPUThrottling`, `ContainerMemoryUsage`, `ContainerIOUsage`, `ContainerCPUUsage`, `ContainerConfiguration` (enabled when running inside a container; needs `-XX:+UseContainerSupport`, which is the default since JDK 10).

**Interpreting results:** Any throttled period means the JVM was running at less than its requested CPU. If `throttledTime > 0` frequently, consider increasing the CPU limit or reducing parallel thread counts. Memory usage close to the limit indicates risk of OOM eviction.

---

<!-- @cell name=container-config requires="ContainerConfiguration" -->

## Container Configuration

```sql
SELECT * FROM ContainerConfiguration
LIMIT 1
```

```plot
TABLE()
```

---

<!-- @cell name=cpu-throttling requires="ContainerCPUThrottling" -->

## CPU Throttling Over Time

`throttledTime` is the total nanoseconds the container was throttled in each observation window. Sustained throttling means the JVM is CPU-starved at the container level, regardless of what `CPULoad` shows.

```sql
SELECT
  startTime AS "Time",
  cpuThrottledCount AS "Throttled Periods",
  round(cpuThrottledTime / 1e9, 3) AS "Throttled Seconds",
  cpuPeriodCount AS "Total Periods",
  round(cpuThrottledCount * 100.0 / NULLIF(cpuPeriodCount, 0), 1) AS "Throttle %"
FROM ContainerCPUThrottling
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Throttle %"]) TITLE "CPU Throttle Percentage Over Time" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=cpu-usage requires="ContainerCPUUsage" -->

## Container CPU Usage Over Time

```sql
SELECT
  startTime AS "Time",
  round(cpuUsage * 100, 1) AS "CPU %"
FROM ContainerCPUUsage
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["CPU %"]) TITLE "Container CPU Usage (%)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=memory-usage requires="ContainerMemoryUsage" -->

## Container Memory Usage vs. Limit

`memoryUsage / memoryLimit` approaching 1.0 means the container is near the OOM kill threshold. A soft limit (`memoryAndSwapLimit`) being hit indicates swap is in play, which degrades Java performance significantly.

```sql
SELECT
  startTime AS "Time",
  round(memoryUsage / 1048576.0, 1) AS "Used MB",
  round(memoryLimit / 1048576.0, 1) AS "Limit MB",
  round(memoryUsage * 100.0 / NULLIF(memoryLimit, 0), 1) AS "Usage %"
FROM ContainerMemoryUsage
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Used MB", "Limit MB"]) TITLE "Container Memory Usage (MB)" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=io-usage requires="ContainerIOUsage" -->

## Container I/O Usage

```sql
SELECT
  startTime AS "Time",
  round(readBytes / 1048576.0, 2) AS "Read MB",
  round(writeBytes / 1048576.0, 2) AS "Written MB"
FROM ContainerIOUsage
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Read MB", "Written MB"]) TITLE "Container I/O (MB)" LINK_X($start, $end) ZOOM
```
