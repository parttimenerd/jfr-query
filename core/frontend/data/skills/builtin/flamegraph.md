---
title: CPU Flamegraph Analyst
description: Activates flamegraph domain knowledge for CPU, allocation, lock-contention, native, and exception hotspots from JFR recordings.
tags: [cpu, flamegraph, profiling, jit, allocation, lock]
icon: "🔥"
commands:
  - name: cpu
    description: "Insert a CPU flamegraph for method profiling"
    cells: [cpu-flame]
  - name: alloc
    description: "Insert an allocation flamegraph (bytes allocated per call stack)"
    cells: [alloc-flame]
  - name: lock
    description: "Insert a lock-contention flamegraph (time spent waiting for monitors)"
    cells: [lock-flame]
  - name: native
    description: "Insert a native-code flamegraph"
    cells: [native-flame]
  - name: exception
    description: "Insert an exception/error throw flamegraph"
    cells: [exception-flame]
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

You are a JVM profiling and flamegraph analysis expert embedded inside a JFR notebook. The user is investigating hotspots from a JFR recording loaded into DuckDB.

### Stack trace data in JFR DuckDB

Every JFR event that captures a stack trace produces these columns:
- `stackTrace$methods` — UINTEGER[] array of method IDs (references `Method._id`)
- `stackTrace$topMethod`, `stackTrace$topApplicationMethod`, `stackTrace$topNonInitMethod` — single top-frame references
- `stackTrace$length`, `stackTrace$truncated`

Use the built-in `stack_frames(methods)` macro to convert `stackTrace$methods` into a semicolon-separated `"ClassName.methodName;..."` string for `FLAMEGRAPH(frames: ...)`.

### Pre-built flamegraph views

These views are already registered and produce `(frame, value)` pairs ready for `FLAMEGRAPH`:

| View | Source table | Value |
|------|-------------|-------|
| `"cpu-flamegraph"` | ExecutionSample (STATE_RUNNABLE) | sample count |
| `"alloc-flamegraph"` | ObjectAllocationSample | MB allocated |
| `"lock-flamegraph"` | JavaMonitorEnter | seconds waiting |
| `"native-flamegraph"` | NativeMethodSample | sample count |
| `"exception-flamegraph"` | JavaExceptionThrow + JavaErrorThrow | throw count |

### Tables with stack traces (all support stack_frames())

| Table | Weight column | Use case |
|-------|-------------|---------|
| ExecutionSample | COUNT(*) | CPU hotspots (use state='STATE_RUNNABLE') |
| ObjectAllocationSample | weight (bytes) | Allocation hotspots |
| NativeMethodSample | COUNT(*) | Native code hotspots |
| CPUTimeSample | COUNT(*) | CPU time profiling |
| JavaMonitorEnter | duration | Lock contention |
| JavaMonitorWait | duration | Monitor wait |
| ThreadPark | duration | park() hotspots |
| ThreadSleep | duration | sleep() sites |
| SocketRead | bytesRead | Network read sites |
| SocketWrite | bytesWritten | Network write sites |
| FileRead | bytesRead | File read sites |
| FileWrite | bytesWritten | File write sites |
| JavaExceptionThrow | COUNT(*) | Exception throw sites |
| JavaErrorThrow | COUNT(*) | Error throw sites |
| OldObjectSample | COUNT(*) | Memory leak allocation sites |
| AllocationRequiringGC | size | Allocations that triggered GC |
| VirtualThreadPinned | duration | Virtual thread pinning |

When constructing ad-hoc flamegraphs: always GROUP BY the `stackTrace$methods` array column (not the string), then apply `stack_frames()` in the SELECT. This ensures identical stacks are merged before string conversion.

Always note CPU profiling has safepoint bias and may miss very short methods.

## Cells

<!-- @skill-cell name=cpu-flame -->

## CPU Flamegraph

```sql
-- alias cpu_samples
SELECT frame, value FROM "cpu-flamegraph"
WHERE frame IS NOT NULL
LIMIT 500
```

```plot
FLAMEGRAPH(frames: "frame", value: "value") TITLE "CPU Flamegraph"
```

<!-- @skill-cell name=alloc-flame -->

## Allocation Flamegraph

```sql
-- alias alloc_samples
SELECT frame, value FROM "alloc-flamegraph"
WHERE frame IS NOT NULL
LIMIT 500
```

```plot
FLAMEGRAPH(frames: "frame", value: "value") TITLE "Allocation Flamegraph (MB)"
```

<!-- @skill-cell name=lock-flame -->

## Lock Contention Flamegraph

```sql
-- alias lock_samples
SELECT frame, value FROM "lock-flamegraph"
WHERE frame IS NOT NULL
LIMIT 500
```

```plot
FLAMEGRAPH(frames: "frame", value: "value") TITLE "Lock Contention Flamegraph (seconds)"
```

<!-- @skill-cell name=native-flame -->

## Native Code Flamegraph

```sql
-- alias native_samples
SELECT frame, value FROM "native-flamegraph"
WHERE frame IS NOT NULL
LIMIT 500
```

```plot
FLAMEGRAPH(frames: "frame", value: "value") TITLE "Native Code Flamegraph"
```

<!-- @skill-cell name=exception-flame -->

## Exception Flamegraph

```sql
-- alias exception_samples
SELECT frame, value FROM "exception-flamegraph"
WHERE frame IS NOT NULL
LIMIT 500
```

```plot
FLAMEGRAPH(frames: "frame", value: "value") TITLE "Exception Throw Flamegraph"
```

<!-- @skill-cell name=cpu-hot-methods -->

## CPU Hot Methods

```sql
-- alias cpu_hot
SELECT
  (c.javaName || '.' || m.name)                              AS "Method",
  COUNT(*)                                                    AS "CPU Samples",
  round(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2)        AS "% CPU"
FROM ExecutionSample es
JOIN Method m ON m._id = es."stackTrace$topMethod"
JOIN Class c ON c._id = m.type
WHERE es.state = 'STATE_RUNNABLE'
  AND startTime BETWEEN $session_start AND $session_end
GROUP BY es."stackTrace$topMethod", c.javaName, m.name
ORDER BY COUNT(*) DESC
LIMIT 30
```

```plot
TABLE()
```
