---
title: JVM Internals
description: Safepoints, VM operations, JIT deoptimizations, and class loading — low-level JVM overhead.
tags: [jvm, safepoints, jit, compilation]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## JVM Internals

Low-level JVM overhead that can cause latency spikes invisible to application-level profiling. Stop-the-world safepoints, JIT deoptimizations, and slow class loading all show up here.

**What's here:**
- VM operations by total pause time — which VM operations cost the most
- Safepoint timeline — when the JVM paused all threads and for how long
- JIT deoptimizations by reason — frequent deoptimizations hurt throughput
- Longest class-loading events — slow startup or dynamic class generation

**Required events:** `SafepointBegin`, `SafepointEnd`, `ExecuteVMOperation`, `Deoptimization`, `ClassLoad` (all on by default).

**Interpreting results:** Any single VM operation type with > 10ms average duration is worth investigating. Frequent `make_not_compilable` or `recompile_with_exception_handlers` deoptimizations indicate the JIT is struggling. Safepoint sync duration > 10ms suggests threads are slow to reach a safe point (common with JNI or heavy native code).

---

<!-- @cell name=vm-operations -->

## VM Operations by Total Pause Time

Stop-the-world VM operations grouped by type. GC is expected here; unexpected entries like `RevokeBias`, `Cleanup`, or `FindDeadlocks` in quantity may indicate issues.

```sql
SELECT
  operation AS "VM Operation",
  COUNT(*) AS "Count",
  round(AVG(duration) * 1000, 2) AS "Avg (ms)",
  round(MAX(duration) * 1000, 2) AS "Max (ms)",
  round(SUM(duration) * 1000, 1) AS "Total (ms)"
FROM ExecuteVMOperation
GROUP BY operation
ORDER BY SUM(duration) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "VM Operation", y: ["Total (ms)"], horizontal: true) TITLE "VM Operation Total Pause Time (ms)"
```

---

<!-- @cell name=safepoints -->

## Safepoints Over Time

Each row is one safepoint — a moment when all application threads were paused. The "Sync Duration" is how long it took to bring all threads to a halt; long sync means threads were deep in native code or JNI.

```sql
SELECT
  "Start Time",
  "Duration",
  "State Synchronization",
  "Total Threads"
FROM "safepoints"
ORDER BY "Start Time"
```

```plot
TABLE()
```

---

<!-- @cell name=deoptimizations -->

## JIT Deoptimizations by Reason

Deoptimizations force the JVM back from compiled to interpreted code. Occasional deoptimizations are normal; frequent ones (especially `unstable_if` or `null_check`) indicate hot code paths with unstable types or unexpected nulls.

```sql
SELECT
  reason AS "Reason",
  COUNT(*) AS "Count",
  COUNT(DISTINCT compiler) AS "Compilers",
  round(SUM(duration) * 1000, 2) AS "Total (ms)"
FROM Deoptimization
GROUP BY reason
ORDER BY COUNT(*) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Reason", y: ["Count"], horizontal: true) TITLE "Deoptimizations by Reason"
```

---

<!-- @cell name=class-loading -->

## Slowest Class Loading Events

Class loading happens continuously in dynamic environments. Outliers here may indicate classpath scanning, bytecode manipulation frameworks, or dynamically-generated proxy classes creating overhead.

```sql
SELECT
  name AS "Class",
  round(duration * 1000, 2) AS "Duration (ms)",
  startTime AS "Time"
FROM ClassLoad
ORDER BY duration DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=compiler-phases -->

## JIT Compiler Phase Durations

Time spent in each JIT compilation phase. Long `COMPILE_CODE` phases may indicate complex methods being compiled; this is expected for hot code but can cause pauses on first execution.

```sql
SELECT
  phase AS "Phase",
  COUNT(*) AS "Count",
  round(AVG(duration) * 1000, 2) AS "Avg (ms)",
  round(MAX(duration) * 1000, 2) AS "Max (ms)",
  round(SUM(duration) * 1000, 1) AS "Total (ms)"
FROM CompilerPhase
GROUP BY phase
ORDER BY SUM(duration) DESC
LIMIT $limit
```

```plot
TABLE()
```
