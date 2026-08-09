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

<!-- @cell name=vm-operations requires="ExecuteVMOperation" -->

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

<!-- @cell name=safepoints requires="SafepointEnd" -->

## Safepoints Over Time

Each point is one safepoint — a moment when all application threads were paused. Tall spikes indicate long STW pauses. The "Sync Duration" is how long it took to bring all threads to a halt; a long sync means threads were deep in native code or JNI.

```sql
SELECT
  B.startTime AS "Time",
  round((epoch_ms(E.startTime::TIMESTAMP) - epoch_ms(B.startTime::TIMESTAMP)), 1) AS "Duration (ms)",
  round(S.duration * 1000, 1) AS "Sync (ms)",
  B.totalThreadCount AS "Threads"
FROM SafepointBegin B
JOIN SafepointEnd E ON B.safepointId = E.safepointId
LEFT JOIN SafepointStateSynchronization S ON B.safepointId = S.safepointId
ORDER BY B.startTime
```

```plot
SCATTER(x: "Time", y: "Duration (ms)") TITLE "Safepoint Duration Over Time (ms)" LINK_X($start, $end) ZOOM
```

```plot
TABLE()
```

---

<!-- @cell name=safepoints-over-time requires="SafepointEnd" -->

## Safepoint Overhead per Second

Total STW time per second — shows when the JVM spent the most time stopped. Sustained high safepoint overhead indicates GC or other VM operations dominating runtime.

```sql
SELECT
  time_bucket(INTERVAL '1 second', B.startTime) AS "Second",
  COUNT(*) AS "Count",
  round(SUM(epoch_ms(E.startTime::TIMESTAMP) - epoch_ms(B.startTime::TIMESTAMP)), 1) AS "Total STW (ms)"
FROM SafepointBegin B
JOIN SafepointEnd E ON B.safepointId = E.safepointId
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Second", y: ["Total STW (ms)"]) TITLE "Total Safepoint STW per Second" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=deoptimizations requires="Deoptimization" -->

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

```sql
SELECT
  time_bucket(INTERVAL '5 seconds', startTime) AS "Window",
  COUNT(*) AS "Deoptimizations"
FROM Deoptimization
GROUP BY 1
ORDER BY 1
```

```plot
LINE_CHART(x: "Window", y: ["Deoptimizations"]) TITLE "Deoptimizations Over Time" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=deoptimizations-by-site requires="Deoptimization" -->

## JIT Deoptimization Sites

Specific methods and bytecode offsets that triggered deoptimizations. Methods appearing here are JIT hot spots that the compiler had to abandon — the most valuable ones to fix.

```sql
SELECT * FROM "deoptimizations-by-site" LIMIT $limit
```

```plot
TABLE() TITLE "Top Deoptimization Sites by Method"
```

---

<!-- @cell name=class-loading requires="ClassLoad" -->

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

<!-- @cell name=compiler-phases requires="CompilerPhase" -->

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

---

<!-- @cell name=compiler-statistics requires="CompilerStatistics" -->

## JIT Compiler Statistics

Summary of JIT compilation work over the recording: total methods compiled, time spent, bailouts, and code sizes.

*Requires `CompilerStatistics` events (default.jfc).*

```sql
SELECT * FROM "compiler-statistics"
```

```plot
TABLE() TITLE "JIT Compiler Summary"
```

---

<!-- @cell name=longest-compilations requires="Compilation" -->

## Longest JIT Compilations

The 25 methods that took the most time to compile. Long compile times for hot methods can cause application pauses on first execution. Methods with `Succeeded = false` failed to compile and fell back to interpreted mode.

*Requires `Compilation` events (default.jfc with `jdk.Compilation#enabled=true`).*

```sql
SELECT * FROM "longest-compilations"
```

```plot
TABLE() TITLE "Longest JIT Compilation Events"
```

---

<!-- @cell name=class-loaders requires="ClassLoaderStatistics" -->

## Class Loader Statistics

Number of classes loaded per class loader. A class loader accumulating an unusual count may indicate a classloader leak (each application reload creates a new loader but the old one is not collected because references remain).

*Requires `ClassLoaderStatistics` events (default.jfc).*

```sql
SELECT * FROM "class-loaders"
```

```plot
BAR_CHART(x: "Class Loader", y: ["Classes"], horizontal: true) TITLE "Classes per Class Loader"
```

```plot
TABLE() TITLE "Class Loader Statistics"
```

---

<!-- @cell name=code-cache-full requires="CodeCacheFull" -->

## Code Cache Full

The JIT compiler stops compiling new methods when the code cache is exhausted. Compiled methods may be deoptimised to reclaim space, causing performance degradation.

- Each event = the JIT was forced to flush or stop.
- **Free MB** at event time shows how little headroom remained.
- Remedy: increase `-XX:ReservedCodeCacheSize` (default 240 MB).

*Requires `CodeCacheFull` events (gc.jfc or default.jfc).*

```sql
SELECT * FROM "gc-code-cache-full" ORDER BY "Time"
```

```plot
TABLE() TITLE "Code Cache Full Events"
```

---

<!-- @cell name=deprecated-methods requires="DeprecatedInvocation" -->

## Deprecated Method Invocations

Methods marked `@Deprecated(forRemoval=true)` that were actually called during this recording. Each row is a method that will break when the deprecated API is removed.

*Requires `DeprecatedInvocation` events (default.jfc, JDK 16+).*

```sql
SELECT * FROM "deprecated-methods-for-removal" ORDER BY "Deprecated Method"
```

```plot
TABLE() TITLE "Deprecated-For-Removal Methods Invoked"
```

---

<!-- @cell name=class-modifications requires="RedefineClasses" -->

## Class Redefinitions

Classes that were redefined or retransformed at runtime — typically by a Java agent (e.g. instrumentation, hot-reload, debugger). Frequent redefinitions can cause metaspace churn.

*Requires `RedefineClasses` events (default.jfc).*

```sql
SELECT * FROM "class-modifications" ORDER BY "Time"
```

```plot
TABLE() TITLE "Runtime Class Redefinitions"
```

---

<!-- @cell name=jdk-agents requires="JavaAgent" -->

## Java Agents

Java agents loaded at JVM startup, with their initialisation duration. Slow agent initialisation delays application start.

*Requires `JavaAgent` events (default.jfc).*

```sql
SELECT * FROM "jdk-agents" ORDER BY "Initialization"
```

```plot
TABLE() TITLE "Java Agents"
```

---

<!-- @cell name=jvm-flags requires="IntFlag" -->

## JVM Flags

All JVM flags active during this recording (boolean, integer, long, double, and string). The `IntFlagChanged` / `*FlagChanged` entries show flags that were modified at runtime (e.g. via `jcmd` or Management APIs).

*Requires `IntFlag` events (default.jfc). Additional flag types shown if present.*

```sql
SELECT * FROM "jvm-flags" ORDER BY "Name"
```

```plot
TABLE() TITLE "JVM Flag Values"
```

---

<!-- @cell name=native-library-failures requires="NativeLibraryLoad" -->

## Native Library Load Failures

Native library load and unload events with any error messages. A failing `dlopen` at startup often causes subtle functionality gaps or crashes.

*Requires `NativeLibraryLoad` events (default.jfc).*

```sql
SELECT * FROM "native-library-failures"
```

```plot
TABLE() TITLE "Native Library Load/Unload Events"
```

---

<!-- @cell name=jvm-modules requires="ModuleRequire" -->

## Loaded Modules

Module names from the Java Module System (`--module-path` / JPMS). Useful for auditing which modules are present on the module path.

*Requires `ModuleRequire` events (default.jfc, JDK 9+).*

```sql
SELECT * FROM "modules"
```

```plot
TABLE() TITLE "Java Modules"
```

---

<!-- @cell name=system-properties requires="InitialSystemProperty" -->

## System Properties

Java system properties set at JVM startup (`-D` flags and defaults). Useful for auditing configuration — look for unexpected values or missing expected properties.

*Requires `InitialSystemProperty` events (default.jfc).*

```sql
SELECT * FROM "system-properties"
```

```plot
TABLE() TITLE "JVM System Properties"
```

---

<!-- @cell name=environment-variables requires="InitialEnvironmentVariable" -->

## Environment Variables

OS environment variables visible to the JVM process at startup. Useful for auditing container configuration, proxy settings, and classpath-related env vars.

*Requires `InitialEnvironmentVariable` events (default.jfc).*

```sql
SELECT * FROM "environment-variables"
```

```plot
TABLE() TITLE "Environment Variables"
```

---

<!-- @cell name=native-libraries requires="NativeLibrary" -->

## Native Libraries

Native libraries loaded by the JVM process, with base and top addresses. Useful for identifying unexpected native dependencies or confirming that a specific native library version is loaded.

*Requires `NativeLibrary` events (default.jfc).*

```sql
SELECT * FROM "native-libraries"
```

```plot
TABLE() TITLE "Loaded Native Libraries"
```

---

<!-- @cell name=active-settings requires="ActiveSetting" -->

## JFR Event Settings

JFR event configuration that was active during this recording — which events were enabled, what thresholds and stack trace settings were used.

*Requires `ActiveSetting` events (always present in JFR recordings).*

```sql
SELECT * FROM "active-settings" WHERE "Enabled" = 'true'
```

```plot
TABLE() TITLE "Active JFR Event Settings"
```
