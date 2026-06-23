// Auto-extracted from MacroCollection.java and ViewCollection.java
// Run these after JFR import in WASM mode to register built-in views and macros.

export const BUILTIN_MACROS_SQL: string[] = [
  // Statistical functions and percentiles
  `CREATE OR REPLACE MACRO P90(col) AS quantile(col, 0.90)`,
  `CREATE OR REPLACE MACRO P95(col) AS quantile(col, 0.95)`,
  `CREATE OR REPLACE MACRO P99(col) AS quantile(col, 0.99)`,
  `CREATE OR REPLACE MACRO P999(col) AS quantile(col, 0.999)`,
  `CREATE OR REPLACE MACRO normalized(x) AS (
  x / NULLIF(MAX(x) OVER(), 0)
)`,

  // JFR aggregate functions
  `CREATE OR REPLACE MACRO diff(col) AS (col - LAG(col) OVER (ORDER BY col))`,
  `CREATE OR REPLACE MACRO COUNT_UNIQUE(x) AS count(DISTINCT x)`,

  // Unit conversion functions
  `CREATE OR REPLACE MACRO format_decimals(num, decimals) AS (
    CASE
        WHEN decimals == 0 THEN FLOOR(num)::VARCHAR
        ELSE format('{:.' || decimals || 'f}', num)
    END)`,
  `CREATE OR REPLACE MACRO format_percentage(num, decimals := 2) AS (
  format_decimals(num * 100.0, decimals) || '%'
)`,
  `CREATE OR REPLACE MACRO format_memory(bytes, decimals := 2) AS (
  CASE
    WHEN bytes IS NULL THEN NULL
    ELSE
      (CASE WHEN bytes < 0 THEN '-' ELSE '' END) ||
      (CASE
         WHEN abs(bytes) >= 1099511627776 THEN format_decimals(abs(bytes)/1099511627776.0, decimals) || ' TB'
         WHEN abs(bytes) >= 1073741824 THEN format_decimals(abs(bytes)/1073741824.0, decimals) || ' GB'
         WHEN abs(bytes) >= 1048576 THEN format_decimals(abs(bytes)/1048576.0, decimals) || ' MB'
         WHEN abs(bytes) >= 1024 THEN format_decimals(abs(bytes)/1024.0, decimals) || ' KB'
         ELSE format_decimals(abs(bytes) * 1.0, decimals) || ' B'
      END)
  END
)`,
  `CREATE OR REPLACE MACRO format_human_duration(sec) AS (
   CASE
      WHEN sec IS NULL THEN NULL
      ELSE
        (CASE WHEN sec < 0 THEN '-' ELSE '' END) ||
        (
          WITH vals AS (
            SELECT
              -- total nanoseconds (rounded)
              CAST(ROUND(sec * 1000000000.0) AS BIGINT) AS total_ns
          ),
          a AS (
            SELECT
              ABS(total_ns) AS ns
            FROM vals
          ),
          u AS (
            SELECT
              CAST(floor(ns / 86400000000000.0) AS BIGINT) AS days,
              CAST(floor((ns % 86400000000000.0) / 3600000000000.0) AS BIGINT) AS hours,
              CAST(floor((ns % 3600000000000.0) / 60000000000.0) AS BIGINT) AS minutes,
              CAST(floor((ns % 60000000000.0) / 1000000000.0) AS BIGINT) AS seconds,
              CAST(floor((ns % 1000000000.0) / 1000000.0) AS BIGINT) AS milliseconds,
              CAST(floor((ns % 1000000.0) / 1000.0) AS BIGINT) AS microseconds,
              ns % 1000 AS nanoseconds,
              ns AS total_ns
            FROM a
          )
          SELECT
            CASE
              WHEN total_ns = 0 THEN '0s'
              WHEN days > 0 THEN CAST(days AS VARCHAR) || 'd' || (CASE WHEN hours > 0 THEN ' ' || CAST(hours AS VARCHAR) || 'h' ELSE '' END)
              WHEN hours > 0 THEN CAST(hours AS VARCHAR) || 'h' || (CASE WHEN minutes > 0 THEN ' ' || CAST(minutes AS VARCHAR) || 'm' ELSE '' END)
              WHEN minutes > 0 THEN CAST(minutes AS VARCHAR) || 'm' || (CASE WHEN seconds > 0 THEN ' ' || CAST(seconds AS VARCHAR) || 's' ELSE '' END)
              WHEN seconds > 0 THEN CAST(seconds AS VARCHAR) || 's' || (CASE WHEN milliseconds > 0 THEN ' ' || CAST(milliseconds AS VARCHAR) || 'ms' ELSE '' END)
              WHEN milliseconds > 0 THEN CAST(milliseconds AS VARCHAR) || 'ms' || (CASE WHEN microseconds > 0 THEN ' ' || CAST(microseconds AS VARCHAR) || 'us' ELSE '' END)
              WHEN microseconds > 0 THEN CAST(microseconds AS VARCHAR) || 'us' || (CASE WHEN nanoseconds > 0 THEN ' ' || CAST(nanoseconds AS VARCHAR) || 'ns' ELSE '' END)
              ELSE CAST(nanoseconds AS VARCHAR) || 'ns'
            END
          FROM u
        )
    END
)`,
  `CREATE OR REPLACE MACRO format_duration(seconds, decimals := 2) AS (
  CASE
    WHEN seconds IS NULL THEN NULL
    WHEN abs(seconds) > 1000.0 * 365 * 24 * 3600 THEN NULL  -- more than 1000 years
    ELSE
      (CASE WHEN seconds < 0 THEN '-' ELSE '' END) ||
      (CASE
         WHEN seconds = 0 THEN '0s'
         WHEN abs(seconds) >= 1 THEN format_decimals(abs(seconds) * 1.0, decimals) || 's'
         WHEN abs(seconds) >= 0.001 THEN format_decimals(abs(seconds) * 1000.0, decimals) || 'ms'
         WHEN abs(seconds) >= 0.000001 THEN format_decimals(abs(seconds) * 1000000.0, decimals) || 'us'
         ELSE format_decimals(abs(seconds) * 1000000000.0, decimals) || 'ns'
      END)
  END
)`,
  `CREATE OR REPLACE MACRO format_hex(i) AS format('0x{:x}', i)`,

  // Garbage collection analysis
  `CREATE OR REPLACE MACRO before_gc(ts) AS (
  COALESCE(
    (SELECT gcId
     FROM GarbageCollection
     WHERE startTime <= ts
     ORDER BY startTime DESC
     LIMIT 1),
    -1
  )
)`,
  `CREATE OR REPLACE MACRO after_gc(ts) AS (
  COALESCE(
    (SELECT gcId
     FROM GarbageCollection
     WHERE startTime > ts
     ORDER BY startTime ASC
     LIMIT 1),
    -1
  )
)`,
  `CREATE OR REPLACE MACRO duration_since_last_gc(ts) AS (
  COALESCE(
    (SELECT ts - startTime
     FROM GarbageCollection
     WHERE startTime <= ts
     ORDER BY startTime DESC
     LIMIT 1),
    INTERVAL '-1' SECOND
  )
)`,
  `CREATE OR REPLACE MACRO HEAP_BEFORE_GC(gc_id) AS (
  (SELECT heapUsed
   FROM GCHeapSummary
   WHERE gcId = gc_id AND "when" = 'Before GC'
   LIMIT 1)
)`,
  `CREATE OR REPLACE MACRO HEAP_AFTER_GC(gc_id) AS (
  (SELECT heapUsed
   FROM GCHeapSummary
   WHERE gcId = gc_id AND "when" = 'After GC'
   LIMIT 1)
)`,
  `CREATE OR REPLACE MACRO GC_TYPE(gc_id) AS (
  COALESCE(
    (SELECT 'Young' FROM YoungGarbageCollection WHERE gcId = gc_id LIMIT 1),
    (SELECT 'Old' FROM OldGarbageCollection WHERE gcId = gc_id LIMIT 1),
    'Unknown'
  )
)`,

  // Time-window helpers
  `CREATE OR REPLACE MACRO time_bucket(ts, width_ms) AS (
  epoch_ms(ts) - (epoch_ms(ts) % width_ms)
)`,
  `CREATE OR REPLACE MACRO in_range(ts, t_start, t_end) AS (
  ts >= t_start AND ts <= t_end
)`,
  `CREATE OR REPLACE MACRO recording_start() AS (
  (SELECT MIN(startTime) FROM ActiveRecording)
)`,
  `CREATE OR REPLACE MACRO recording_end() AS (
  (SELECT MAX(startTime) FROM ActiveRecording)
)`,
  `CREATE OR REPLACE MACRO relative_ms(ts) AS (
  epoch_ms(ts) - epoch_ms(recording_start())
)`,
  `CREATE OR REPLACE MACRO time_since(prev_ts, ts) AS (
  epoch_ms(ts) - epoch_ms(prev_ts)
)`,

  // JFR field accessors
  `CREATE OR REPLACE MACRO EVENT_TYPE_LABEL(et) AS (SELECT label FROM EventLabels WHERE name = et LIMIT 1)`,
  `CREATE OR REPLACE MACRO EVENT_NAME_FOR_ID(_id) AS (SELECT name FROM EventIDs event WHERE id = _id LIMIT 1)`,

  // Misc database utility functions
  `CREATE OR REPLACE MACRO macro_sql(macro_name) AS (SELECT macro_definition FROM duckdb_functions() WHERE function_name = macro_name AND function_type = 'macro' AND NOT internal LIMIT 1)`,
  `CREATE OR REPLACE MACRO view_sql(name) AS (SELECT sql FROM duckdb_views() WHERE view_name = name LIMIT 1)`,

  // Rolling window aggregates
  `CREATE OR REPLACE MACRO rolling_avg(value, window_ms, ts) AS (
  AVG(value) OVER (
    ORDER BY ts
    RANGE BETWEEN INTERVAL (window_ms * 1000) MICROSECONDS PRECEDING AND CURRENT ROW
  )
)`,
  `CREATE OR REPLACE MACRO rolling_sum(value, window_ms, ts) AS (
  SUM(value) OVER (
    ORDER BY ts
    RANGE BETWEEN INTERVAL (window_ms * 1000) MICROSECONDS PRECEDING AND CURRENT ROW
  )
)`,
];

export const BUILTIN_VIEWS_SQL: string[] = [
  `CREATE OR REPLACE VIEW "active-recordings" AS
SELECT
    LAST(recordingStart) AS "Start",
    LAST(recordingDuration) AS "Duration",
    LAST(name) AS "Name",
    LAST(destination) AS "Destination",
    LAST(maxAge) AS "Max Age",
    LAST(maxSize) AS "Max Size"
FROM ActiveRecording
GROUP BY id`,

  `CREATE OR REPLACE VIEW "active-settings" AS
SELECT
    EVENT_NAME_FOR_ID(id) AS "Event Type",
    MAX(CASE WHEN name = 'enabled' THEN value END) AS "Enabled",
    MAX(CASE WHEN name = 'threshold' THEN value END) AS "Threshold",
    MAX(CASE WHEN name = 'stackTrace' THEN value END) AS "Stack Trace",
    MAX(CASE WHEN name = 'period' THEN value END) AS "Period",
    MAX(CASE WHEN name = 'cutoff' THEN value END) AS "Cutoff",
    MAX(CASE WHEN name = 'throttle' THEN value END) AS "Throttle"
FROM ActiveSetting
GROUP BY id
ORDER BY "Event Type"`,

  `CREATE OR REPLACE VIEW "allocation-by-class" AS
SELECT cls.javaName as "Object Type", format_percentage(pressure) as "Allocation Pressure" FROM (SELECT
    objectClass AS _objectType,
    SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
FROM ObjectAllocationSample
GROUP BY objectClass
ORDER BY pressure DESC
LIMIT 25), Class cls
WHERE _objectType = cls._id
ORDER BY pressure DESC`,

  `CREATE OR REPLACE VIEW "allocation-by-thread" AS
SELECT th.javaName AS "Thread", format_percentage(pressure) AS "Allocation Pressure" FROM (SELECT
    eventThread AS _thread,
    SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
FROM ObjectAllocationSample
GROUP BY eventThread
ORDER BY pressure DESC
LIMIT 25), Thread th
WHERE _thread = th._id
ORDER BY pressure DESC`,

  `CREATE OR REPLACE VIEW "allocation-by-site" AS
SELECT "Method", format_percentage(pressure) AS "Allocation Pressure" FROM
(SELECT
    (c.javaName || m.name || m.descriptor) AS "Method",
    SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
FROM ObjectAllocationSample
LEFT JOIN Method m ON m._id = stackTrace$topMethod
LEFT JOIN Class c ON c._id = m.type
GROUP BY stackTrace$topMethod, c.javaName, m.name, m.descriptor
ORDER BY pressure DESC
LIMIT 25
)
ORDER BY pressure DESC`,

  `CREATE OR REPLACE VIEW "blocked-by-system-gc" AS
SELECT
    startTime AS "Time",
    format_duration(duration) AS "Duration",
    (c.javaName || '.' || m.name || m.descriptor) AS "Stack Trace"
FROM SystemGC sgc
LEFT JOIN Method m ON m._id = sgc.stackTrace$topApplicationMethod
LEFT JOIN Class c ON c._id = m.type
WHERE invokedConcurrent = 'false'
ORDER BY sgc.duration DESC
LIMIT 25`,

  `CREATE OR REPLACE VIEW "class-loaders" AS
SELECT
    cl.javaName AS "Class Loader",
    LAST(hiddenClassCount) AS "Hidden Classes",
    LAST(classCount) AS "Classes"
FROM ClassLoaderStatistics cls
LEFT JOIN ClassLoader cl ON cls.classLoader = cl._id
GROUP BY classLoader, cl.javaName
ORDER BY "Classes" DESC`,

  `CREATE OR REPLACE VIEW "class-modifications" AS
SELECT
    format_duration(duration) AS "Time",
    (c.javaName || '.' || m.name || m.descriptor) AS "Requested By",
    CASE
        WHEN eventType = 'redefine' THEN 'Redefine Classes'
        WHEN eventType = 'retransform' THEN 'Retransform Classes'
        ELSE eventType
    END AS "Operation",
    classCount AS "Classes"
FROM (
    SELECT
        'redefine' AS eventType,
        duration,
        stackTrace$topApplicationMethod,
        classCount
    FROM RedefineClasses
    UNION ALL
    SELECT
        'retransform' AS eventType,
        duration,
        stackTrace$topApplicationMethod,
        classCount
    FROM RetransformClasses
) AS combined
LEFT JOIN Method m ON m._id = stackTrace$topApplicationMethod
LEFT JOIN Class c ON c._id = m.type
ORDER BY duration DESC`,

  `CREATE OR REPLACE VIEW "compiler-configuration" AS
SELECT
    LAST(threadCount) AS "Compiler Threads",
    LAST(dynamicCompilerThreadCount) AS "Dynamic Compiler Threads",
    LAST(tieredCompilation) AS "Tiered Compilation"
FROM CompilerConfiguration`,

  `CREATE OR REPLACE VIEW "compiler-statistics" AS
SELECT
    LAST(compileCount) AS "Compiled Methods",
    format_duration(LAST(peakTimeSpent)) AS "Peak Time",
    format_duration(LAST(totalTimeSpent)) AS "Total Time",
    LAST(bailoutCount) AS "Bailouts",
    LAST(osrCompileCount) AS "OSR Compilations",
    LAST(standardCompileCount) AS "Standard Compilations",
    format_memory(LAST(osrBytesCompiled)) AS "OSR Bytes Compiled",
    format_memory(LAST(standardBytesCompiled)) AS "Standard Bytes Compiled",
    format_memory(LAST(nmethodsSize)) AS "Compilation Resulting Size",
    format_memory(LAST(nmethodCodeSize)) AS "Compilation Resulting Code Size"
FROM CompilerStatistics`,

  `CREATE OR REPLACE VIEW "compiler-phases" AS
SELECT
    phaseLevel AS "Level",
    phase AS "Phase",
    format_duration(AVG(duration)) AS "Average",
    format_duration(P95(duration)) AS "P95",
    format_duration(MAX(duration)) AS "Longest",
    COUNT(*) AS "Count",
    format_duration(SUM(duration)) AS "Total"
FROM CompilerPhase
GROUP BY phase, phaseLevel
ORDER BY phaseLevel ASC, SUM(duration) DESC`,

  `CREATE OR REPLACE VIEW "container-configuration" AS
SELECT
    LAST(containerType) AS "Container Type",
    format_duration(LAST(cpuSlicePeriod)) AS "CPU Slice Period",
    format_duration(LAST(cpuQuota)) AS "CPU Quota",
    LAST(cpuShares) AS "CPU Shares",
    LAST(effectiveCpuCount) AS "Effective CPU Count",
    format_memory(LAST(memorySoftLimit)) AS "Memory Soft Limit",
    format_memory(LAST(memoryLimit)) AS "Memory Limit",
    format_memory(LAST(swapMemoryLimit)) AS "Swap Memory Limit",
    format_memory(LAST(hostTotalMemory)) AS "Host Total Memory"
FROM ContainerConfiguration`,

  `CREATE OR REPLACE VIEW "container-cpu-usage" AS
SELECT
    format_duration(LAST(cpuTime)) AS "CPU Time",
    format_duration(LAST(cpuUserTime)) AS "CPU User Time",
    format_duration(LAST(cpuSystemTime)) AS "CPU System Time"
FROM ContainerCPUUsage`,

  `CREATE OR REPLACE VIEW "container-memory-usage" AS
SELECT
    LAST(memoryFailCount) AS "Memory Fail Count",
    format_memory(LAST(memoryUsage)) AS "Memory Usage",
    format_memory(LAST(swapMemoryUsage)) AS "Swap Memory Usage"
FROM ContainerMemoryUsage`,

  `CREATE OR REPLACE VIEW "container-io-usage" AS
SELECT
    LAST(serviceRequests) AS "Service Requests",
    format_memory(LAST(dataTransferred)) AS "Data Transferred"
FROM ContainerIOUsage`,

  `CREATE OR REPLACE VIEW "container-cpu-throttling" AS
SELECT
    LAST(cpuElapsedSlices) AS "CPU Elapsed Slices",
    LAST(cpuThrottledSlices) AS "CPU Throttled Slices",
    format_duration(LAST(cpuThrottledTime)) AS "CPU Throttled Time"
FROM ContainerCPUThrottling`,

  `CREATE OR REPLACE VIEW "contention-by-thread" AS
SELECT
    th.javaName AS "Thread",
    COUNT(*) AS "Count",
    format_duration(AVG(duration)) AS "Avg",
    format_duration(P90(duration)) AS "P90",
    format_duration(MAX(duration)) AS "Max."
FROM JavaMonitorEnter jme
JOIN Thread th ON jme.eventThread = th._id
GROUP BY eventThread, th.javaName
ORDER BY MAX(duration) DESC`,

  `CREATE OR REPLACE VIEW "contention-by-class" AS
SELECT
    c.javaName AS "Lock Class",
    COUNT(*) AS "Count",
    format_duration(AVG(duration)) AS "Avg.",
    format_duration(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration)) AS "P90",
    format_duration(MAX(duration)) AS "Max."
FROM JavaMonitorEnter jme
JOIN Class c ON jme.monitorClass = c._id
GROUP BY monitorClass, c.javaName
ORDER BY MAX(duration) DESC`,

  `CREATE OR REPLACE VIEW "contention-by-site" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "StackTrace",
    COUNT(*) AS "Count",
    format_duration(AVG(duration)) AS "Avg.",
    format_duration(MAX(duration)) AS "Max."
FROM JavaMonitorEnter jme
JOIN Method m ON jme.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY c.javaName, m.name, m.descriptor
ORDER BY MAX(duration) DESC`,

  `CREATE OR REPLACE VIEW "contention-by-address" AS
SELECT
    format_hex(jme.address) AS "Monitor Address",
    c.javaName AS "Class",
    COUNT(DISTINCT eventThread) AS "Threads",
    format_duration(MAX(duration)) AS "Max Duration"
FROM JavaMonitorEnter jme
JOIN Class c ON jme.monitorClass = c._id
GROUP BY jme.address, c.javaName
ORDER BY MAX(duration) DESC`,

  `CREATE OR REPLACE VIEW "deprecated-methods-for-removal" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Deprecated Method",
    list(DISTINCT (cc.javaName) ORDER BY cc.javaName) AS "Called from Class"
FROM DeprecatedInvocation di
JOIN Method m ON di.method = m._id
JOIN Class c ON m.type = c._id
JOIN Method cm ON di.stackTrace$topMethod = cm._id
JOIN Class cc ON cm.type = cc._id
WHERE forRemoval = 'true'
GROUP BY di.method, c.javaName, m.name, m.descriptor
ORDER BY c.javaName, m.name, m.descriptor`,

  `CREATE OR REPLACE VIEW "cpu-information" AS
SELECT
    cpu AS "CPU",
    sockets AS "Sockets",
    cores AS "Cores",
    hwThreads AS "Hardware Threads",
    description AS "Description"
FROM CPUInformation
GROUP BY cpu, sockets, cores, hwThreads, description`,

  `CREATE OR REPLACE VIEW "cpu-load" AS
SELECT
    format_percentage(MIN(jvmUser)) AS "JVM User (Minimum)",
    format_percentage(AVG(jvmUser)) AS "JVM User (Average)",
    format_percentage(MAX(jvmUser)) AS "JVM User (Maximum)",
    format_percentage(MIN(jvmSystem)) AS "JVM System (Minimum)",
    format_percentage(AVG(jvmSystem)) AS "JVM System (Average)",
    format_percentage(MAX(jvmSystem)) AS "JVM System (Maximum)",
    format_percentage(MIN(machineTotal)) AS "Machine Total (Minimum)",
    format_percentage(AVG(machineTotal)) AS "Machine Total (Average)",
    format_percentage(MAX(machineTotal)) AS "Machine Total (Maximum)"
FROM CPULoad`,

  `CREATE OR REPLACE VIEW "cpu-load-samples" AS
SELECT
    startTime AS "Time",
    format_percentage(jvmUser) AS "JVM User",
    format_percentage(jvmSystem) AS "JVM System",
    format_percentage(machineTotal) AS "Machine Total"
FROM CPULoad
ORDER BY startTime`,

  `CREATE OR REPLACE VIEW "cpu-tsc" AS
SELECT
    LAST(fastTimeAutoEnabled) AS "Fast Time Auto Enabled",
    LAST(fastTimeEnabled) AS "Fast Time Enabled",
    LAST(fastTimeFrequency) || ' Hz' AS "Fast Time Frequency",
    LAST(osFrequency) || ' Hz' AS "OS Frequency"
FROM CPUTimeStampCounter`,

  `CREATE OR REPLACE VIEW "deoptimizations-by-reason" AS
SELECT
    reason AS "Reason",
    COUNT(reason) AS "Count"
FROM Deoptimization
GROUP BY reason
ORDER BY COUNT(reason) DESC`,

  `CREATE OR REPLACE VIEW "deoptimizations-by-site" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    d.lineNumber AS "Line Number",
    d.bci AS "BCI",
    COUNT(d.reason) AS "Count"
FROM Deoptimization d
JOIN Method m ON d.method = m._id
JOIN Class c ON m.type = c._id
GROUP BY d.method, d.lineNumber, d.bci, c.javaName, m.name, m.descriptor
ORDER BY COUNT(d.reason) DESC`,

  `CREATE OR REPLACE VIEW "events-by-count" AS
SELECT
    label AS "Event Label",
    count AS "Count"
FROM Events
JOIN EventLabels ON Events.name = EventLabels.name
ORDER BY count DESC`,

  `CREATE OR REPLACE VIEW "events-by-name" AS
SELECT
    label AS "Event Label",
    count AS "Count"
FROM Events
JOIN EventLabels ON Events.name = EventLabels.name
ORDER BY Events.name ASC`,

  `CREATE OR REPLACE VIEW "environment-variables" AS
SELECT
    key AS "Key",
    value AS "Value"
FROM InitialEnvironmentVariable
GROUP BY key, value
ORDER BY key`,

  `CREATE OR REPLACE VIEW "exception-count" AS
SELECT
    LAST(throwables) - FIRST(throwables) AS "Exceptions Thrown"
FROM ExceptionStatistics`,

  `CREATE OR REPLACE VIEW "exception-by-type" AS
SELECT
    c.javaName AS "Class",
    COUNT(*) AS "Count"
FROM (
    SELECT thrownClass FROM JavaErrorThrow
    UNION ALL
    SELECT thrownClass FROM JavaExceptionThrow
) AS combined
JOIN Class c ON combined.thrownClass = c._id
GROUP BY combined.thrownClass, c.javaName
ORDER BY COUNT(*) DESC`,

  `CREATE OR REPLACE VIEW "exception-by-message" AS
SELECT
    message AS "Message",
    COUNT(*) AS "Count"
FROM (
    SELECT message FROM JavaErrorThrow
    UNION ALL
    SELECT message FROM JavaExceptionThrow
) AS combined
GROUP BY message
ORDER BY COUNT(*) DESC`,

  `CREATE OR REPLACE VIEW "exception-by-site" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    COUNT(*) AS "Count"
FROM (
    SELECT stackTrace$topNonInitMethod as ni FROM JavaErrorThrow
    UNION ALL
    SELECT stackTrace$topNonInitMethod as ni FROM JavaExceptionThrow
) AS combined
JOIN Method m ON combined.ni = m._id
JOIN Class c ON m.type = c._id
GROUP BY combined.ni, c.javaName, m.name, m.descriptor
ORDER BY COUNT(*) DESC`,

  `CREATE OR REPLACE VIEW "file-reads-by-path" AS
SELECT
    path AS "Path",
    COUNT(*) AS "Reads",
    format_memory(SUM(bytesRead)) AS "Total Read"
FROM FileRead
GROUP BY path
ORDER BY SUM(bytesRead) DESC`,

  `CREATE OR REPLACE VIEW "file-writes-by-path" AS
SELECT
    path AS "Path",
    COUNT(*) AS "Writes",
    format_memory(SUM(bytesWritten)) AS "Total Written"
FROM FileWrite
GROUP BY path
ORDER BY SUM(bytesWritten) DESC`,

  `CREATE OR REPLACE VIEW "finalizers" AS
SELECT
    c.javaName AS "Finalizable Class",
    LAST(objects) AS "Objects",
    LAST(totalFinalizersRun) AS "Total Finalizers Run"
FROM FinalizerStatistics fs
JOIN Class c ON fs.finalizableClass = c._id
GROUP BY fs.finalizableClass, c.javaName
ORDER BY LAST(objects) DESC`,

  `CREATE OR REPLACE VIEW "gc" AS
SELECT
    G.startTime                          AS "Start",
    G.gcId                               AS "GC ID",
    COALESCE(G.name, 'Unknown')          AS "Type",
    format_memory(B.heapUsed)            AS "Heap Before GC",
    format_memory(A.heapUsed)            AS "Heap After GC",
    format_duration(G.longestPause)      AS "Longest Pause"
FROM GarbageCollection G
JOIN GCHeapSummary B ON G.gcId = B.gcId AND B.when = 'Before GC'
JOIN GCHeapSummary A ON G.gcId = A.gcId AND A.when = 'After GC'
ORDER BY G.gcId`,

  `CREATE OR REPLACE VIEW "gc-concurrent-phases" AS
SELECT
    name AS "Name",
    format_duration(AVG(duration)) AS "Average",
    format_duration(P95(duration)) AS "P95",
    format_duration(MAX(duration)) AS "Longest",
    COUNT(*) AS "Count",
    format_duration(SUM(duration)) AS "Total"
FROM GCPhaseConcurrent
GROUP BY name
ORDER BY SUM(duration) DESC`,

  `CREATE OR REPLACE VIEW "gc-parallel-phases" AS
SELECT
    name AS "Name",
    format_duration(AVG(duration)) AS "Average",
    format_duration(P95(duration)) AS "P95",
    format_duration(MAX(duration)) AS "Longest",
    COUNT(*) AS "Count",
    format_duration(SUM(duration)) AS "Total"
FROM GCPhaseParallel
GROUP BY name
ORDER BY SUM(duration) DESC`,

  `CREATE OR REPLACE VIEW "gc-configuration" AS
SELECT
    LAST(youngCollector) AS "Young GC",
    LAST(oldCollector) AS "Old GC",
    LAST(parallelGCThreads) AS "Parallel GC Threads",
    LAST(concurrentGCThreads) AS "Concurrent GC Threads",
    LAST(usesDynamicGCThreads) AS "Dynamic GC Threads",
    LAST(isExplicitGCConcurrent) AS "Concurrent Explicit GC",
    LAST(isExplicitGCDisabled) AS "Disable Explicit GC",
    format_duration(LAST(pauseTarget)) AS "Pause Target",
    LAST(gcTimeRatio) AS "GC Time Ratio"
FROM GCConfiguration`,

  `CREATE OR REPLACE VIEW "gc-references" AS
SELECT
    FIRST(G.startTime) AS "Time",
    G.gcId AS "GC ID",
    S.count AS "Soft Ref.",
    W.count AS "Weak Ref.",
    P.count AS "Phantom Ref.",
    F.count AS "Final Ref.",
    (S.count + W.count + P.count + F.count) AS "Total Count"
FROM GCReferenceStatistics S
JOIN GCReferenceStatistics W ON S.gcId = W.gcId
JOIN GCReferenceStatistics P ON S.gcId = P.gcId
JOIN GCReferenceStatistics F ON S.gcId = F.gcId
JOIN GCReferenceStatistics G ON S.gcId = G.gcId
WHERE S.type = 'Soft reference'
  AND W.type = 'Weak reference'
  AND P.type = 'Phantom reference'
  AND F.type = 'Final reference'
GROUP BY G.gcId, S.count, W.count, P.count, F.count
ORDER BY G.gcId ASC`,

  `CREATE OR REPLACE VIEW "gc-pause-phases" AS
SELECT
    eventTypeLabel AS "Type",
    name AS "Name",
    format_duration(AVG(duration)) AS "Average",
    format_duration(P95(duration)) AS "P95",
    format_duration(MAX(duration)) AS "Longest",
    COUNT(*) AS "Count",
    format_duration(SUM(duration)) AS "Total"
FROM (
    SELECT 'GC Phase Pause' as eventTypeLabel, name, duration FROM GCPhasePause
    UNION ALL
    SELECT 'GC Phase Pause Level 1' as eventTypeLabel, name, duration FROM GCPhasePauseLevel1
    UNION ALL
    SELECT 'GC Phase Pause Level 2' as eventTypeLabel, name, duration FROM GCPhasePauseLevel2
    UNION ALL
    SELECT 'GC Phase Pause Level 3' as eventTypeLabel, name, duration FROM GCPhasePauseLevel3
    UNION ALL
    SELECT 'GC Phase Pause Level 4' as eventTypeLabel, name, duration FROM GCPhasePauseLevel4
) phases
GROUP BY eventTypeLabel, name
ORDER BY eventTypeLabel ASC, SUM(duration) DESC`,

  `CREATE OR REPLACE VIEW "gc-pauses" AS
SELECT
    format_duration(SUM(duration)) AS "Total Pause Time",
    COUNT(duration) AS "Number of Pauses",
    format_duration(MIN(duration)) AS "Minimum Pause Time",
    format_duration(MEDIAN(duration)) AS "Median Pause Time",
    format_duration(AVG(duration)) AS "Average Pause Time",
    format_duration(P90(duration)) AS "P90 Pause Time",
    format_duration(P95(duration)) AS "P95 Pause Time",
    format_duration(P99(duration)) AS "P99 Pause Time",
    format_duration(P999(duration)) AS "P99.9% Pause Time",
    format_duration(MAX(duration)) AS "Maximum Pause Time"
FROM GCPhasePause`,

  `CREATE OR REPLACE VIEW "gc-allocation-trigger" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Trigger Method (Non-JDK)",
    COUNT(*) AS "Count",
    format_memory(SUM(ar.size)) AS "Total Requested"
FROM AllocationRequiringGC ar
JOIN Method m ON ar.stackTrace$topApplicationMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY ar.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
ORDER BY COUNT(*) DESC, SUM(ar.size) DESC`,

  `CREATE OR REPLACE VIEW "gc-cpu-time" AS
SELECT
    format_duration(SUM(userTime)) AS "GC User Time",
    format_duration(SUM(systemTime)) AS "GC System Time",
    format_duration(SUM(realTime)) AS "GC Wall Clock Time",
    format_duration(epoch(MAX(startTime) - MIN(startTime))) AS "Total Time",
    COUNT(*) AS "GC Count"
FROM GCCPUTime`,

  // GC Analysis views
  `CREATE OR REPLACE VIEW "gc-pause-distribution" AS
SELECT
    name AS "Phase",
    COUNT(*) AS "Count",
    format_duration(MIN(duration)) AS "Min",
    format_duration(MEDIAN(duration)) AS "Median",
    format_duration(P90(duration)) AS "P90",
    format_duration(P99(duration)) AS "P99",
    format_duration(MAX(duration)) AS "Max",
    format_duration(SUM(duration)) AS "Total"
FROM GCPhasePause
GROUP BY name
ORDER BY MAX(duration) DESC`,

  `CREATE OR REPLACE VIEW "gc-top-pauses" AS
SELECT
    startTime AS "Start Time",
    name AS "Phase",
    gcId AS "GC ID",
    format_duration(duration) AS "Duration"
FROM GCPhasePause
ORDER BY duration DESC
LIMIT 20`,

  `CREATE OR REPLACE VIEW "gc-phase-breakdown" AS
SELECT
    gcId AS "GC ID",
    name AS "Phase",
    format_duration(duration) AS "Duration",
    startTime AS "Start"
FROM GCPhasePause
ORDER BY gcId, startTime`,

  `CREATE OR REPLACE VIEW "gc-young-vs-old" AS
SELECT
    cause AS "Cause",
    COUNT(*) AS "Collections",
    format_duration(SUM(sumOfPauses)) AS "Total Pause",
    format_duration(AVG(sumOfPauses)) AS "Avg Pause",
    format_duration(MAX(longestPause)) AS "Max Single Pause"
FROM GarbageCollection
GROUP BY cause
ORDER BY SUM(sumOfPauses) DESC`,

  `CREATE OR REPLACE VIEW "gc-efficiency" AS
SELECT
    g.gcId AS "GC ID",
    g.cause AS "Cause",
    format_duration(g.sumOfPauses) AS "Pause",
    format_memory(before.heapUsed - after.heapUsed) AS "Reclaimed",
    CASE WHEN g.sumOfPauses > 0 THEN
        round((before.heapUsed - after.heapUsed) / (1024.0 * 1024.0)
            / g.sumOfPauses, 1)
    ELSE 0 END AS "MB/s reclaimed"
FROM GarbageCollection g
JOIN GCHeapSummary before ON g.gcId = before.gcId AND before."when" = 'Before GC'
JOIN GCHeapSummary after  ON g.gcId = after.gcId  AND after."when"  = 'After GC'
ORDER BY g.gcId`,

  `CREATE OR REPLACE VIEW "heap-summary-over-time" AS
SELECT
    startTime AS "Time",
    gcId AS "GC ID",
    "when" AS "When",
    format_memory(heapUsed) AS "Heap Used"
FROM GCHeapSummary
ORDER BY startTime`,

  `CREATE OR REPLACE VIEW "heap-committed-vs-used" AS
SELECT
    startTime AS "Time",
    "when" AS "Phase",
    heapUsed / (1024.0 * 1024.0) AS "Used MB"
FROM GCHeapSummary
ORDER BY startTime`,

  `CREATE OR REPLACE VIEW "allocation-rate" AS
SELECT
    time_bucket(startTime, 1000) AS "Bucket",
    SUM(weight) / (1024.0 * 1024.0) AS "Sample MB/s",
    COUNT(*) AS "Samples"
FROM ObjectAllocationSample
GROUP BY time_bucket(startTime, 1000)
ORDER BY 1`,

  `CREATE OR REPLACE VIEW "allocation-by-class-detail" AS
SELECT
    objectClass AS "Class",
    COUNT(*) AS "Sample Events",
    format_memory(SUM(weight)) AS "Sampled Bytes",
    format_memory(AVG(weight)) AS "Avg Sample Weight"
FROM ObjectAllocationSample
GROUP BY objectClass
ORDER BY SUM(weight) DESC
LIMIT 30`,

  `CREATE OR REPLACE VIEW "gc-concurrent-phases-detail" AS
SELECT
    startTime AS "Start",
    name AS "Phase",
    gcId AS "GC ID",
    format_duration(duration) AS "Duration"
FROM GCPhaseConcurrent
ORDER BY startTime`,

  `CREATE OR REPLACE VIEW "safepoint-overhead" AS
SELECT
    sb.startTime AS "Start",
    sb.safepointId AS "Safepoint ID",
    format_duration(ss.duration) AS "Sync Duration",
    sb.initialThreadCount AS "Initial Threads",
    sb.runningThreadCount AS "Running Threads"
FROM SafepointBegin sb
LEFT JOIN SafepointStateSynchronization ss ON sb.safepointId = ss.safepointId
ORDER BY sb.startTime`,

  `CREATE OR REPLACE VIEW "tlab-efficiency" AS
SELECT
    time_bucket(startTime, 5000) AS "Bucket (5s)",
    SUM(allocationSize) / NULLIF(SUM(tlabSize), 0) AS "Fill Ratio",
    COUNT(*) AS "Allocations",
    format_memory(SUM(tlabSize)) AS "Total TLAB",
    format_memory(SUM(allocationSize)) AS "Total Allocated"
FROM ObjectAllocationInNewTLAB
GROUP BY time_bucket(startTime, 5000)
ORDER BY 1`,

  `CREATE OR REPLACE VIEW "gc-throughput" AS
SELECT
    time_bucket(startTime, 10000) AS "Window",
    SUM(sumOfPauses) * 1000 AS "GC Time (ms)",
    10000 - (SUM(sumOfPauses) * 1000) AS "Mutator Time (ms)",
    ROUND(100.0 - (SUM(sumOfPauses) * 1000 / 10000.0 * 100), 1) AS "Throughput %"
FROM GarbageCollection
GROUP BY time_bucket(startTime, 10000)
ORDER BY 1`,

  `CREATE OR REPLACE VIEW "gc-overhead" AS
SELECT
    time_bucket(startTime, 10000) AS "Window",
    ROUND(SUM(sumOfPauses) * 1000 / 10000.0 * 100, 2) AS "GC Overhead %",
    SUM(sumOfPauses) * 1000 AS "Pause ms",
    COUNT(*) AS "Collections"
FROM GarbageCollection
GROUP BY time_bucket(startTime, 10000)
ORDER BY 1`,

  `CREATE OR REPLACE VIEW "heap-configuration" AS
SELECT
    format_memory(LAST(initialSize)) AS "Initial Size",
    format_memory(LAST(minSize)) AS "Minimum Size",
    format_memory(LAST(maxSize)) AS "Maximum Size",
    LAST(usesCompressedOops) AS "If Compressed Oops Are Used",
    LAST(compressedOopsMode) AS "Compressed Oops Mode"
FROM GCHeapConfiguration`,

  `CREATE OR REPLACE VIEW "hot-methods" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    COUNT(*) AS "Samples",
    format_percentage(COUNT(*) / (SELECT COUNT(*) FROM ExecutionSample)) AS "Percent"
FROM ExecutionSample es
JOIN Method m ON es.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY es.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
ORDER BY COUNT(*) DESC
LIMIT 25`,

  `CREATE OR REPLACE VIEW "cpu-time-hot-methods" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    COUNT(*) AS "Samples",
    format_percentage(COUNT(*) / (SELECT COUNT(*) FROM CPUTimeSample)) AS "Percent"
FROM CPUTimeSample cs
JOIN Method m ON cs.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY cs.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
ORDER BY COUNT(*) DESC
LIMIT 25`,

  `CREATE OR REPLACE VIEW "cpu-time-statistics" AS
SELECT
    (SELECT COUNT(*) FROM CPUTimeSample WHERE failed = FALSE) AS "Successful Samples",
    (SELECT COUNT(*) FROM CPUTimeSample WHERE failed = TRUE) AS "Failed Samples",
    (SELECT COUNT(*) FROM CPUTimeSample WHERE biased = TRUE) AS "Biased Samples",
    (SELECT COUNT(*) FROM CPUTimeSample) AS "Total Samples",
    (SELECT SUM(lostSamples) FROM CPUTimeSamplesLost) AS "Lost Samples"`,

  `CREATE OR REPLACE VIEW "jdk-agents" AS
SELECT
    t AS "Time",
    format_duration(d) AS "Initialization",
    name AS "Name",
    o AS "Options"
FROM (
    SELECT LAST(initializationTime) AS t, LAST(initializationDuration) AS d, name, LAST(options) AS o FROM JavaAgent GROUP BY name
    UNION ALL
    SELECT LAST(initializationTime) AS t, LAST(initializationDuration) AS d, name, LAST(options) AS o FROM NativeAgent GROUP BY name
) agents
ORDER BY t`,

  `CREATE OR REPLACE VIEW "jvm-flags" AS
SELECT
    name AS "Name",
    value AS "Value"
FROM (
    SELECT name, CAST(value AS VARCHAR) AS value FROM IntFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedIntFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM BooleanFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM LongFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedLongFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM DoubleFlag
    UNION ALL
    SELECT name, value FROM StringFlag
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM IntFlagChanged
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedIntFlagChanged
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM BooleanFlagChanged
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM LongFlagChanged
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedLongFlagChanged
    UNION ALL
    SELECT name, CAST(value AS VARCHAR) AS value FROM DoubleFlagChanged
    UNION ALL
    SELECT name, value FROM StringFlagChanged
) flags
GROUP BY name, value
ORDER BY name ASC`,

  `CREATE OR REPLACE VIEW "jvm-information" AS
SELECT
    LAST(pid) AS "PID",
    LAST(jvmStartTime) AS "VM Start",
    LAST(jvmName) AS "Name",
    LAST(jvmVersion) AS "Version",
    LAST(jvmArguments) AS "VM Arguments",
    LAST(javaArguments) AS "Program Arguments"
FROM JVMInformation`,

  `CREATE OR REPLACE VIEW "latencies-by-type" AS
SELECT
    eventType AS "Event Type",
    COUNT(*) AS "Count",
    format_duration(AVG(duration)) AS "Average",
    format_duration(P99(duration)) AS "P 99",
    format_duration(MAX(duration)) AS "Longest",
    format_duration(SUM(duration)) AS "Total"
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
    SELECT 'File Write' AS eventType, duration FROM FileWrite
    UNION ALL
    SELECT 'File Read' AS eventType, duration FROM FileRead
) latencies
GROUP BY eventType
ORDER BY SUM(duration) DESC`,

  `CREATE OR REPLACE VIEW "memory-leaks-by-class" AS
SELECT
    LAST(allocationTime) AS "Alloc. Time",
    c.javaName AS "Object Class",
    format_duration(LAST(objectAge)) AS "Object Age",
    format_memory(LAST(lastKnownHeapUsage)) AS "Heap Usage"
FROM OldObjectSample os
JOIN OldObject o ON os.object = o._id
JOIN Class c ON o.type = c._id
GROUP BY c.javaName
ORDER BY LAST(allocationTime) ASC`,

  `CREATE OR REPLACE VIEW "memory-leaks-by-site" AS
SELECT
    LAST(allocationTime) AS "Alloc. Time",
    (c.javaName || '.' || m.name || m.descriptor) AS "Application Method",
    format_duration(LAST(objectAge)) AS "Object Age",
    format_memory(LAST(lastKnownHeapUsage)) AS "Heap Usage"
FROM OldObjectSample os
JOIN Method m ON os.stackTrace$topApplicationMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY os.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
ORDER BY LAST(allocationTime) ASC`,

  `CREATE OR REPLACE VIEW "method-timing" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Timed Method",
    LAST(invocations) AS "Invocations",
    format_duration(LAST(minimum)) AS "Minimum Time",
    format_duration(LAST(average)) AS "Average Time",
    format_duration(LAST(maximum)) AS "Maximum Time"
FROM MethodTiming mt
JOIN Method m ON mt.method = m._id
JOIN Class c ON m.type = c._id
GROUP BY mt.method, c.javaName, m.name, m.descriptor
ORDER BY LAST(average) ASC`,

  `CREATE OR REPLACE VIEW "method-calls" AS
SELECT
    (cm.javaName || '.' || m.name || m.descriptor) AS "Traced Method",
    (cc.javaName || '.' || sm.name || sm.descriptor) AS "Caller",
    COUNT(*) AS "Invocations"
FROM MethodTrace mt
JOIN Method m ON mt.method = m._id
JOIN Class cm ON m.type = cm._id
JOIN Method sm ON mt.stackTrace$topMethod = sm._id
JOIN Class cc ON sm.type = cc._id
GROUP BY mt.method, mt.stackTrace$topMethod, cm.javaName, m.name, m.descriptor, cc.javaName, sm.name, sm.descriptor
ORDER BY COUNT(*) DESC`,

  `CREATE OR REPLACE VIEW "modules" AS
SELECT
    LAST(m.name) AS "Module Name"
FROM ModuleRequire
JOIN Module m ON ModuleRequire.source = m._id
GROUP BY source
ORDER BY "Module Name" ASC`,

  `CREATE OR REPLACE VIEW "monitor-inflation" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    mc.javaName AS "Monitor Class",
    COUNT(*) AS "Count",
    format_duration(SUM(jmi.duration)) AS "Total Duration"
FROM JavaMonitorInflate jmi
JOIN Method m ON jmi.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
JOIN Class mc ON jmi.monitorClass = mc._id
GROUP BY jmi.stackTrace$topApplicationMethod, mc.javaName, c.javaName, m.name, m.descriptor
ORDER BY SUM(jmi.duration) DESC`,

  `CREATE OR REPLACE VIEW "native-libraries" AS
SELECT
    name AS "Name",
    format_hex(baseAddress) AS "Base Address",
    format_hex(topAddress) AS "Top Address"
FROM NativeLibrary
GROUP BY name, baseAddress, topAddress
ORDER BY name ASC`,

  `CREATE OR REPLACE VIEW "native-library-failures" AS
SELECT
    eventType AS "Operation",
    name AS "Library",
    errorMessage AS "Error Message"
FROM (
    SELECT 'Native Library Unload' AS eventType, name, errorMessage, success FROM NativeLibraryUnload
    UNION ALL
    SELECT 'Native Library Load' AS eventType, name, errorMessage, success FROM NativeLibraryLoad
) failures
WHERE success = FALSE
ORDER BY eventType ASC, name ASC`,

  `CREATE OR REPLACE VIEW "native-memory-committed" AS
SELECT
    type AS "Memory Type",
    FIRST(committed) AS "First Observed",
    format_memory(AVG(committed)) AS "Average",
    LAST(committed) AS "Last Observed",
    format_memory(MAX(committed)) AS "Maximum"
FROM NativeMemoryUsage
GROUP BY type
ORDER BY MAX(committed) DESC`,

  `CREATE OR REPLACE VIEW "native-memory-reserved" AS
SELECT
    type AS "Memory Type",
    FIRST(reserved) AS "First Observed",
    format_memory(AVG(reserved)) AS "Average",
    LAST(reserved) AS "Last Observed",
    format_memory(MAX(reserved)) AS "Maximum"
FROM NativeMemoryUsage
GROUP BY type
ORDER BY MAX(reserved) DESC`,

  `CREATE OR REPLACE VIEW "native-methods" AS
SELECT
    (c.javaName || '.' || m.name || m.descriptor) AS "Method",
    COUNT(*) AS "Samples",
    format_percentage(COUNT(*) / (SELECT COUNT(*) FROM NativeMethodSample)) AS "Percent"
FROM NativeMethodSample nms
JOIN Method m ON nms.stackTrace$topMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY nms.stackTrace$topMethod, c.javaName, m.name, m.descriptor
ORDER BY COUNT(*) DESC`,

  `CREATE OR REPLACE VIEW "network-utilization" AS
SELECT
    networkInterface AS "Network Interface",
    format_memory(AVG(readRate) / 8) || '/s' AS "Avg. Read Rate",
    format_memory(MAX(readRate) / 8) || '/s' AS "Max. Read Rate",
    format_memory(AVG(writeRate) / 8) || '/s' AS "Avg. Write Rate",
    format_memory(MAX(writeRate) / 8) || '/s' AS "Max. Write Rate"
FROM NetworkUtilization
GROUP BY networkInterface
ORDER BY networkInterface ASC`,

  `CREATE OR REPLACE VIEW "object-statistics" AS
SELECT "Class", "Count", "Heap Space", "Increase"
FROM
(SELECT
    c.javaName AS "Class",
    LAST(count) AS "Count",
    format_memory(LAST(totalSize)) AS "Heap Space",
    LAST(totalSize) as h,
    format_memory(MAX(totalSize) - MIN(totalSize)) AS "Increase"
FROM (
    SELECT objectClass, count, totalSize FROM ObjectCountAfterGC
    UNION ALL
    SELECT objectClass, count, totalSize FROM ObjectCount
) ocg
JOIN Class c ON ocg.objectClass = c._id
GROUP BY c.javaName)
ORDER BY h DESC`,

  `CREATE OR REPLACE VIEW "pinned-threads" AS
SELECT
    (c.javaName || '.' || vtp.stackTrace$topApplicationMethod) AS "Method",
    COUNT(*) AS "Pinned Count",
    format_duration(MAX(vtp.duration)) AS "Longest Pinning",
    format_duration(SUM(vtp.duration)) AS "Total Time Pinned"
FROM VirtualThreadPinned vtp
JOIN Class c ON vtp.stackTrace$topApplicationClass = c._id
GROUP BY vtp.stackTrace$topApplicationMethod, vtp.stackTrace$topApplicationClass, c.javaName
ORDER BY SUM(vtp.duration) DESC`,

  `CREATE OR REPLACE VIEW "thread-count" AS
SELECT
startTime AS "Start Time",
activeCount AS "Active Threads",
daemonCount AS "Daemon Threads",
accumulatedCount AS "Accumulated Threads",
peakCount AS "Peak Threads"
FROM JavaThreadStatistics
ORDER BY startTime ASC`,

  `CREATE OR REPLACE VIEW "recording" AS
SELECT
    eventCount AS "Event Count",
    firstEvent AS "First Recorded Event",
    lastEvent AS "Last Recorded Event",
    format_duration(eventDurationSeconds) AS "Length of Recorded Events",
    dumpReason AS "Dump Reason"
FROM RecordingInfo`,

  `CREATE OR REPLACE VIEW "safepoints" AS
SELECT
    B.startTime AS "Start Time",
    format_duration(epoch(E.startTime - B.startTime)) AS "Duration",
    format_duration(S.duration) AS "State Synchronization",
    format_duration(C.duration) AS "Cleanup",
    jniCriticalThreadCount AS "JNI Critical Threads",
    totalThreadCount AS "Total Threads"
FROM SafepointBegin B
JOIN SafepointEnd E ON B.safepointId = E.safepointId
LEFT JOIN SafepointStateSynchronization S ON B.safepointId = S.safepointId
LEFT JOIN SafepointCleanup C ON B.safepointId = C.safepointId
ORDER BY B.startTime ASC`,

  `CREATE OR REPLACE VIEW "longest-compilations" AS
SELECT
    startTime AS "Start Time",
    format_duration(duration) AS "Duration",
    (c.javaName || '.' || m.name) AS "Method",
    compileLevel AS "Compile Level",
    Compilation.succeded AS "Succeeded"
FROM Compilation
JOIN Method m ON Compilation.method = m._id
JOIN Class c ON m.type = c._id
ORDER BY duration DESC
LIMIT 25`,

  `CREATE OR REPLACE VIEW "longest-class-loading" AS
SELECT
    startTime AS "Time",
    c.javaName AS "Loaded Class",
    format_duration(duration) AS "Load Time"
FROM ClassLoad cl
JOIN Class c ON cl.loadedClass = c._id
ORDER BY duration DESC
LIMIT 25`,

  `CREATE OR REPLACE VIEW "system-properties" AS
SELECT
    key AS "Key",
    value AS "Value"
FROM InitialSystemProperty
GROUP BY key, value
ORDER BY key ASC`,

  `CREATE OR REPLACE VIEW "socket-writes-by-host" AS
SELECT
    host AS "Host",
    COUNT(*) AS "Writes",
    format_memory(SUM(bytesWritten)) AS "Total Written"
FROM SocketWrite
GROUP BY host
ORDER BY SUM(bytesWritten) DESC`,

  `CREATE OR REPLACE VIEW "socket-reads-by-host" AS
SELECT
    host AS "Host",
    COUNT(*) AS "Reads",
    format_memory(SUM(bytesRead)) AS "Total Read"
FROM SocketRead
GROUP BY host
ORDER BY SUM(bytesRead) DESC`,

  `CREATE OR REPLACE VIEW "system-information" AS
SELECT
    format_memory(LAST(pm.totalSize)) AS "Total Physical Memory Size",
    LAST(osi.osVersion) AS "OS Version",
    LAST(vi.name) AS "Virtualization",
    LAST(cii.cpu) AS "CPU Type",
    LAST(cii.cores) AS "Number of Cores",
    LAST(cii.hwThreads) AS "Number of Hardware Threads",
    LAST(cii.sockets) AS "Number of Sockets",
    LAST(cii.description) AS "CPU Description"
FROM PhysicalMemory pm, OSInformation osi, CPUInformation cii, VirtualizationInformation vi`,

  `CREATE OR REPLACE VIEW "system-processes" AS
SELECT
    FIRST(startTime) AS "First Observed",
    LAST(startTime) AS "Last Observed",
    pid AS "PID",
    FIRST(commandLine) AS "Command Line"
FROM SystemProcess
GROUP BY pid
ORDER BY FIRST(startTime) ASC`,

  `CREATE OR REPLACE VIEW "tlabs" AS
SELECT * FROM (SELECT
    COUNT(tlabSize) AS "Inside Count",
    format_memory(MIN(tlabSize)) AS "Inside Minimum Size",
    format_memory(AVG(tlabSize)) AS "Inside Average Size",
    format_memory(MAX(tlabSize)) AS "Inside Maximum Size",
    format_memory(SUM(tlabSize)) AS "Inside Total Allocation"
FROM ObjectAllocationInNewTLAB),
(SELECT
    COUNT(allocationSize) AS "Outside Count",
    format_memory(MIN(allocationSize)) AS "Outside Minimum Size",
    format_memory(AVG(allocationSize)) AS "Outside Average Size",
    format_memory(MAX(allocationSize)) AS "Outside Maximum Size",
    format_memory(SUM(allocationSize)) AS "Outside Total Allocation"
FROM ObjectAllocationOutsideTLAB)`,

  `CREATE OR REPLACE VIEW "thread-allocation" AS
SELECT
    thread AS "Thread",
    LAST(allocated) AS "Allocated",
    format_percentage(
        LAST(allocated) * 1.0 / SUM(LAST(allocated)) OVER ()
    ) AS "Percentage"
FROM ThreadAllocationStatistics
GROUP BY thread
ORDER BY "Allocated" DESC`,

  `CREATE OR REPLACE VIEW "thread-cpu-load" AS
SELECT
    t.javaName AS "Thread",
    format_percentage(LAST(system)) AS "System",
    format_percentage(LAST(user)) AS "User"
FROM ThreadCPULoad
JOIN Thread t ON ThreadCPULoad.eventThread = t._id
GROUP BY t.javaName
ORDER BY LAST(user) DESC, LAST(system) DESC`,

  `CREATE OR REPLACE VIEW "thread-start" AS
SELECT
    CASE
        WHEN j.ts_start IS NOT NULL THEN j.ts_start
        ELSE NULL
    END AS "Start Time",
    CASE
        WHEN c.javaName IS NULL THEN m.name || m.descriptor
        ELSE (c.javaName || '.' || m.name || m.descriptor)
    END AS "Stack Trace",
    t.javaName AS "Thread",
    CASE
        WHEN j.ts_start IS NULL THEN 'unknown'
        WHEN j.te_start IS NULL THEN 'infinity'
        ELSE format_duration(epoch(j.te_start - j.ts_start))
    END AS "Duration"
FROM Thread t
JOIN (
    SELECT
        COALESCE(ts.eventThread, te.eventThread) AS eventThread,
        ts.startTime AS ts_start,
        te.startTime AS te_start,
        ts.stackTrace$topMethod
    FROM ThreadStart ts
    FULL OUTER JOIN ThreadEnd te
      ON ts.eventThread = te.eventThread
) j ON j.eventThread = t._id
LEFT JOIN Method m ON j.stackTrace$topMethod = m._id
LEFT JOIN Class c ON m.type = c._id
WHERE t.javaName IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY j.eventThread
    ORDER BY
        CASE
            WHEN j.ts_start IS NOT NULL AND j.te_start IS NOT NULL
                 AND j.te_start >= j.ts_start THEN 0
            WHEN j.ts_start IS NOT NULL AND j.te_start IS NULL THEN 1
            WHEN j.ts_start IS NULL AND j.te_start IS NOT NULL THEN 2
            ELSE 3
        END
) = 1
ORDER BY
    CASE
        WHEN j.te_start IS NULL AND j.ts_start IS NOT NULL THEN 0
        ELSE 1
    END,
    (j.te_start - j.ts_start) DESC NULLS LAST, j.ts_start ASC`,

  `CREATE OR REPLACE VIEW "vm-operations" AS
SELECT
    operation AS "VM Operation",
    format_duration(AVG(duration)) AS "Average Duration",
    format_duration(MAX(duration)) AS "Longest Duration",
    COUNT(*) AS "Count",
    format_duration(SUM(duration)) AS "Total Duration"
FROM ExecuteVMOperation
GROUP BY operation
ORDER BY SUM(duration) DESC`,
];
