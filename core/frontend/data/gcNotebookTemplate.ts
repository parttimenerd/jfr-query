export const gcAnalysisNotebook: string = `## GC Analysis Notebook

A ready-to-run analysis of garbage collection behavior from your JFR recording. Each cell runs automatically — scroll down to see results.

---

## Recording Overview

Basic recording timeline and total duration.

\`\`\`sql
SELECT
  recording_start() AS "Start",
  recording_end()   AS "End",
  round((epoch_ms(recording_end()) - epoch_ms(recording_start())) / 1000.0, 1) AS "Duration (s)"
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## GC Pause Summary

Count and total stop-the-world time by GC cause. The bar height shows how much wall-clock time each cause consumed.

\`\`\`sql
SELECT
  cause AS "Cause",
  COUNT(*) AS "Collections",
  round(SUM(sumOfPauses) * 1000, 1) AS "Total Pause (ms)",
  round(AVG(sumOfPauses) * 1000, 2) AS "Avg Pause (ms)",
  round(MAX(longestPause) * 1000, 2) AS "Max Pause (ms)"
FROM GarbageCollection
GROUP BY cause
ORDER BY SUM(sumOfPauses) DESC
\`\`\`

\`\`\`plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)"], layout: "grouped") TITLE "GC Pause Time by Cause"
\`\`\`

---

## Top GC Pauses

The 20 longest individual stop-the-world pauses. Scan for outliers.

\`\`\`sql
SELECT * FROM "gc-top-pauses"
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## Heap Usage Over Time

How heap occupancy changes before and after each GC event. Use **Shift+scroll** to zoom in on a burst.

\`\`\`sql
SELECT * FROM "heap-committed-vs-used" ORDER BY "Time"
\`\`\`

\`\`\`plot
LINE_CHART(x: "Time", y: ["Used MB"]) LINK_X($start, $end) TITLE "Heap Used (MB) Over Time"
\`\`\`

---

## Pause Distribution by Phase

Statistical percentiles for each GC phase. Tall p99/max bars relative to median indicate latency spikes.

\`\`\`sql
SELECT
  name AS "Phase",
  COUNT(*) AS "Count",
  round(MEDIAN(duration) * 1000, 3) AS "Median (ms)",
  round(quantile_cont(duration, 0.90) * 1000, 3) AS "P90 (ms)",
  round(quantile_cont(duration, 0.99) * 1000, 3) AS "P99 (ms)",
  round(MAX(duration) * 1000, 3) AS "Max (ms)"
FROM GCPhasePause
GROUP BY name
ORDER BY MAX(duration) DESC
\`\`\`

\`\`\`plot
BAR_CHART(x: "Phase", y: ["Median (ms)", "P90 (ms)", "P99 (ms)", "Max (ms)"], layout: "grouped") TITLE "Pause Percentiles by Phase"
\`\`\`

---

## Allocation Rate

Sampled object allocation rate over time. Spikes often precede GC events.

\`\`\`sql
SELECT * FROM "allocation-rate"
\`\`\`

\`\`\`plot
LINE_CHART(x: "Bucket", y: ["Sample MB/s"]) LINK_X($start, $end) TITLE "Allocation Rate (MB/s)"
\`\`\`

---

## Top Allocating Classes

Which classes account for the most heap allocation (from TLAB samples). Long tail is normal — focus on top 10.

\`\`\`sql
SELECT
  o.objectClass AS "Class",
  COUNT(*) AS "Samples",
  round(SUM(o.weight) / (1024.0 * 1024.0), 1) AS "Sampled MB",
  round(AVG(o.weight) / 1024.0, 1) AS "Avg KB/sample"
FROM ObjectAllocationSample o
GROUP BY o.objectClass
ORDER BY SUM(o.weight) DESC
LIMIT 15
\`\`\`

\`\`\`plot
BAR_CHART(x: "Class", y: ["Sampled MB"], horizontal: true) TITLE "Top Allocating Classes (Sampled MB)"
\`\`\`

---

## GC Efficiency

Megabytes reclaimed per second of GC pause per collection. Low values (short bars) indicate expensive pauses that reclaimed little memory.

\`\`\`variables
$limit = 20
\`\`\`

\`\`\`sql
SELECT
  g.gcId AS "GC ID",
  g.cause AS "Cause",
  round(g.sumOfPauses * 1000, 1) AS "Pause (ms)",
  round((before.heapUsed - after.heapUsed) / (1024.0 * 1024.0), 1) AS "Reclaimed (MB)",
  CASE WHEN g.sumOfPauses > 0 THEN
      round((before.heapUsed - after.heapUsed) / (1024.0 * 1024.0) / g.sumOfPauses, 1)
  ELSE 0 END AS "MB/s reclaimed"
FROM GarbageCollection g
JOIN GCHeapSummary before ON g.gcId = before.gcId AND before."when" = 'Before GC'
JOIN GCHeapSummary after  ON g.gcId = after.gcId  AND after."when"  = 'After GC'
ORDER BY g.gcId
LIMIT $limit
\`\`\`

\`\`\`plot
SCATTER_PLOT(x: "Pause (ms)", y: "Reclaimed (MB)", color: "Cause") TITLE "Reclaimed vs Pause Time"
\`\`\`

---

## Concurrent GC Phases

Non-stop-the-world (concurrent) GC work — these run alongside your application and don't add to pause time.

\`\`\`variables
$limit = 20
\`\`\`

\`\`\`sql
SELECT * FROM "gc-concurrent-phases-detail" LIMIT $limit
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## Drill-down: Single GC Event

Change \`$gc_id\` to inspect the phase breakdown of any specific collection.

\`\`\`variables
$gc_id = 1
\`\`\`

\`\`\`sql
SELECT
  "GC ID",
  "Phase",
  "Duration",
  "Start"
FROM "gc-phase-breakdown"
WHERE "GC ID" = $gc_id
ORDER BY "Start"
\`\`\`

\`\`\`plot
TABLE()
\`\`\``;
