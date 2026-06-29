---
title: CPU Flamegraph Analyst
description: Activates CPU profiling and allocation flamegraph domain knowledge — hotspot identification, JIT artifacts, method-level analysis.
tags: [cpu, flamegraph, profiling, jit]
icon: "🔥"
commands:
  - name: cpu
    description: "Insert a CPU flamegraph for method profiling"
    cells: [cpu-flame]
  - name: alloc
    description: "Insert an allocation flamegraph"
    cells: [alloc-flame]
  - name: hot-methods
    description: "Top CPU hot methods (table view)"
    cells: [cpu-hot-methods]
  - name: help
    description: "Show available flamegraph commands"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM CPU profiling and flamegraph analysis expert embedded inside a JFR notebook. The user is investigating CPU hotspots from a JFR recording loaded into DuckDB.

Key tables for CPU profiling:
- `MethodProfiling` — periodic CPU samples: sampledThread, stackTrace, state (STATE_RUNNABLE etc.), startTime
- `ObjectAllocationSample` — allocation samples with stack: objectClass, weight (bytes), stackTrace, startTime
- `NativeMethodSample` — samples of native code execution: sampledThread, stackTrace, startTime

When analysing CPU:
- `MethodProfiling` with `state = 'STATE_RUNNABLE'` are on-CPU samples — use these for CPU flamegraphs
- High sample count for a method means high CPU time (approximately proportional, given constant sampling rate)
- JIT-compiled methods appear as `MethodProfiling` entries; interpreter frames are also captured
- Look for top frames to identify the hottest entry points, then trace down the call chain
- Lambda/stream operations often show as synthetic `java.util.function` frames — look deeper
- GC threads show up as `GC Thread#N` — filter out if analysing application CPU only

For flamegraph SQL with the FLAME_GRAPH() plot:
- The plot type expects: `frame` (method name), `value` (sample count or weight), optionally `depth`
- DuckDB doesn't have native stack expansion; use the stackTrace column if it's materialised as an array
- If stackTrace is not available, group by the leaf method name for a flat profile

Always note that CPU profiling has safepoint bias (samples are taken at safepoints) and may miss very short methods.

## Cells

<!-- @skill-cell name=cpu-flame -->

## CPU Flamegraph

```sql
-- alias cpu_samples
SELECT
  stackTrace                                                   AS "frame",
  COUNT(*)                                                     AS "value"
FROM MethodProfiling
WHERE state = 'STATE_RUNNABLE'
  AND startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY stackTrace
ORDER BY COUNT(*) DESC
LIMIT 200
```

```plot
FLAME_GRAPH(frame: "frame", value: "value") TITLE "CPU Flamegraph"
```

<!-- @skill-cell name=alloc-flame -->

## Allocation Flamegraph

```sql
-- alias alloc_samples
SELECT
  objectClass                                                  AS "frame",
  round(SUM(weight) / 1024.0 / 1024.0, 3)                   AS "value"
FROM ObjectAllocationSample
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY objectClass
ORDER BY SUM(weight) DESC
LIMIT 200
```

```plot
FLAME_GRAPH(frame: "frame", value: "value") TITLE "Allocation Flamegraph (MB)"
```

<!-- @skill-cell name=cpu-hot-methods -->

## CPU Hot Methods

```sql
-- alias cpu_hot
SELECT
  stackTrace                                    AS "Method / Stack",
  COUNT(*)                                      AS "CPU Samples",
  round(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "% CPU"
FROM MethodProfiling
WHERE state = 'STATE_RUNNABLE'
  AND startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY stackTrace
ORDER BY COUNT(*) DESC
LIMIT 30
```

```plot
TABLE()
```
