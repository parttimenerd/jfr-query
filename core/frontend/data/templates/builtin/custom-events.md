---
title: Custom JFR Events
description: How to analyse custom and application-defined JFR events. Uses synthetic GC ergonomics log events as a worked example — swap the seed cell for your real event table once you load a recording.
tags: [custom, gc, ergo, advanced]
license: MIT
priority: 90
variables:
  $tag_filter: "''"
  $limit: '50'
---

<!-- @cell name=intro -->

## Custom JFR Events — Worked Example

JFR lets any Java application define its own event types. When you load such a recording, the importer creates a DuckDB table named after the event class — e.g. `com.example.RequestLatency` → table `com_example_RequestLatency`.

This notebook demonstrates the full workflow using **GC ergonomics log events** (`GCErgonomicTrace`) as the example. These are low-level G1 GC decision events logged by the JVM itself — not application events, but structurally identical to what a custom event would look like.

**How to use this template:**

1. The first cell below seeds a synthetic `ergo_events` table with realistic fake data — this lets you explore the analysis immediately, without needing a real recording.
2. Run all cells to see the analysis working on synthetic data.
3. Once you load a JFR recording that contains `GCErgonomicTrace` events (requires `gc-details.jfc` profile), the `requires="GCErgonomicTrace"` cells at the bottom will also appear.

---

<!-- @cell name=seed-data -->

## Synthetic Event Data

Creates a fake `ergo_events` table that mirrors `GCErgonomicTrace` exactly. **Replace this cell** with a query against your real event table once you have a recording.

```sql
CREATE OR REPLACE TABLE ergo_events AS
SELECT * FROM (VALUES
  -- gcId, tag,                  level,   startTime,                               message
  -- ── IHOP: occupancy+threshold in same message (2 byte fields + source text) ──
  (0,  'gc+ergo+ihop',   'info',  TIMESTAMPTZ '2024-03-15 10:00:01.000',  'GC(0) Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 6291456B threshold: 5767168B source: end of GC'),
  (0,  'gc+ergo+ihop',   'info',  TIMESTAMPTZ '2024-03-15 10:00:01.001',  'GC(0) Initiate concurrent cycle (concurrent cycle initiation requested)'),
  -- ── Adaptive IHOP: threshold with pct, alloc speed, concurrent cost (dense multi-field) ──
  (0,  'gc+ergo+ihop',   'debug', TIMESTAMPTZ '2024-03-15 10:00:01.010',  'GC(0) Adaptive IHOP information after GC#0 threshold: 5767168B (72.00%), margin: 0B (0.00%) internal target occupancy: 8011776B allocation speed: 4194304.00B/s concurrent mark GC cost: 1.23%'),
  -- ── CSet: pending cards + target pause (2 fields in same message) ──
  (0,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:01.050',  'GC(0) Start choosing CSet. Pending cards: 489 target pause time: 200.00ms'),
  (0,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:01.051',  'GC(0) Add young regions to CSet. Eden: 12 regions. Survivor: 2 regions.'),
  -- ── Heap: pause ratio + expand amount (2 fields) ──
  (0,  'gc+ergo+heap',   'debug', TIMESTAMPTZ '2024-03-15 10:00:01.120',  'GC(0) Heap expansion: short term pause time ratio 3.29% Expand by 8388608B to 268435456B'),
  (0,  'gc+ergo',        'debug', TIMESTAMPTZ '2024-03-15 10:00:01.200',  'GC(0) Running G1 Merge Heap Roots using 6 workers for 47 regions'),
  (1,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:05.000',  'GC(1) Start choosing CSet. Pending cards: 231 target pause time: 200.00ms'),
  (1,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:05.001',  'GC(1) Add young regions to CSet. Eden: 15 regions. Survivor: 3 regions.'),
  (1,  'gc+ergo+heap',   'debug', TIMESTAMPTZ '2024-03-15 10:00:05.080',  'GC(1) Heap expansion: short term pause time ratio 1.12% Expand by 4194304B to 272629760B'),
  -- ── IHOP with higher occupancy (threshold exceeded more) ──
  (2,  'gc+ergo+ihop',   'info',  TIMESTAMPTZ '2024-03-15 10:00:09.000',  'GC(2) Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 7340032B threshold: 5767168B source: end of GC'),
  (2,  'gc+ergo+ihop',   'debug', TIMESTAMPTZ '2024-03-15 10:00:09.002',  'GC(2) Adaptive IHOP information after GC#2 threshold: 5767168B (72.00%), margin: 0B (0.00%) internal target occupancy: 8011776B allocation speed: 5242880.00B/s concurrent mark GC cost: 1.87%'),
  (2,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:09.010',  'GC(2) Start choosing CSet. Pending cards: 612 target pause time: 200.00ms'),
  (2,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:09.011',  'GC(2) Add young regions to CSet. Eden: 18 regions. Survivor: 4 regions.'),
  (2,  'gc+ergo+refine', 'debug', TIMESTAMPTZ '2024-03-15 10:00:09.050',  'GC(2) Adjust refine threads: 4 => 6 (concurrent refinement activated)'),
  (3,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:13.000',  'GC(3) Start choosing CSet. Pending cards: 102 target pause time: 200.00ms'),
  -- ── Heap contraction: two byte fields (Shrink by NB to NB) ──
  (3,  'gc+ergo+heap',   'debug', TIMESTAMPTZ '2024-03-15 10:00:13.090',  'GC(3) Heap contraction: short term pause time ratio 0.88% Shrink by 4194304B to 268435456B'),
  (4,  'gc+ergo+ihop',   'info',  TIMESTAMPTZ '2024-03-15 10:00:17.000',  'GC(4) Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 8388608B threshold: 5767168B source: end of GC'),
  (4,  'gc+ergo+ihop',   'debug', TIMESTAMPTZ '2024-03-15 10:00:17.002',  'GC(4) Adaptive IHOP information after GC#4 threshold: 6291456B (78.00%), margin: 0B (0.00%) internal target occupancy: 8922112B allocation speed: 6291456.00B/s concurrent mark GC cost: 2.45%'),
  (4,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:17.010',  'GC(4) Start choosing CSet. Pending cards: 890 target pause time: 200.00ms'),
  (4,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:17.011',  'GC(4) Add young regions to CSet. Eden: 22 regions. Survivor: 5 regions.'),
  (4,  'gc+ergo+refine', 'debug', TIMESTAMPTZ '2024-03-15 10:00:17.070',  'GC(4) Adjust refine threads: 6 => 8 (heavy card write pressure)'),
  (5,  'gc+ergo+cset',   'trace', TIMESTAMPTZ '2024-03-15 10:00:21.000',  'GC(5) Start choosing CSet. Pending cards: 345 target pause time: 200.00ms'),
  (5,  'gc+ergo+heap',   'debug', TIMESTAMPTZ '2024-03-15 10:00:21.100',  'GC(5) Heap expansion: short term pause time ratio 4.51% Expand by 16777216B to 285212672B'),
  (5,  'gc+ergo+ihop',   'info',  TIMESTAMPTZ '2024-03-15 10:00:21.110',  'GC(5) Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 9437184B threshold: 6291456B source: end of GC'),
  (5,  'gc+ergo+ihop',   'debug', TIMESTAMPTZ '2024-03-15 10:00:21.115',  'GC(5) Adaptive IHOP information after GC#5 threshold: 6291456B (78.00%), margin: 0B (0.00%) internal target occupancy: 8922112B allocation speed: 7340032.00B/s concurrent mark GC cost: 3.12%')
) t(gcId, tag, level, startTime, message)
```

```sql
-- alias seed_preview
SELECT gcId AS "GC ID", replace(tag, '+', ',') AS "Tag", level AS "Level", startTime AS "Time", message AS "Message"
FROM ergo_events
ORDER BY startTime
LIMIT 10
```

```plot
TABLE() TITLE "Synthetic ergo_events — first 10 rows"
```

---

<!-- @cell name=event-overview -->

## Event Overview

How many events per tag category?

```sql
-- alias tag_counts
SELECT
    replace(tag, '+', ',')            AS "Tag",
    count(*)                          AS "Count",
    min(startTime)                    AS "First",
    max(startTime)                    AS "Last"
FROM ergo_events
GROUP BY tag
ORDER BY count(*) DESC
```

```plot
BAR_CHART(x: "Tag", y: "Count") TITLE "Events per Tag Category" AXIS_Y LABEL "events"
```

```plot
TABLE() TITLE "Tag Summary"
```

---

<!-- @cell name=event-timeline -->

## Event Timeline

All events on a single timeline, coloured by tag. Shows the rhythm of GC decision-making.

```sql
-- alias ergo_timeline
SELECT
    startTime                         AS "Time",
    gcId                              AS "GC ID",
    replace(tag, '+', ',')            AS "Tag",
    level                             AS "Level",
    regexp_replace(message, '^GC\(\d+\)\s+', '') AS "Message"
FROM ergo_events
WHERE $tag_filter = '' OR tag LIKE '%' || $tag_filter || '%'
ORDER BY startTime
LIMIT $limit
```

```plot
SCATTER_PLOT(x: "Time", y: "GC ID", color: "Tag") TITLE "GC Ergo Events Timeline" LINK_X($start, $end) ZOOM AXIS_Y LABEL "GC cycle"
```

```plot
TABLE() TITLE "All Ergo Events (filtered)"
```

---

<!-- @cell name=ihop-events -->

## IHOP Trigger Events

`gc+ergo+ihop` events record when G1 decides to initiate concurrent marking. The messages contain multiple fields in a single string: occupancy, threshold, and source — all extracted with the ergo helpers.

```sql
-- alias ihop_events
SELECT
    startTime                                                     AS "Time",
    gcId                                                          AS "GC ID",
    regexp_replace(message, '^GC\(\d+\)\s+', '')                  AS "Message",
    round(ergo_bytes(message, 'occupancy')   / 1048576.0, 2)      AS "Occupancy MB",
    round(ergo_bytes(message, 'threshold')   / 1048576.0, 2)      AS "Threshold MB",
    ergo_kv(message, 'source')                                    AS "Source"
FROM ergo_events
WHERE tag = 'gc+ergo+ihop'
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Occupancy MB", "Threshold MB"]) ON ihop_events TITLE "IHOP: Heap Occupancy vs Marking Threshold" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
TABLE() ON ihop_events TITLE "IHOP Trigger Events — parsed fields"
```

---

<!-- @cell name=ihop-adaptive -->

## Adaptive IHOP — Allocation Speed and Mark Cost

The `Adaptive IHOP information` messages contain **five fields in a single message**: threshold (bytes + pct), margin, internal target occupancy, allocation speed (B/s), and concurrent mark GC cost (%). Each is extracted independently with the ergo helpers.

```sql
-- alias ihop_adaptive
SELECT
    startTime                                                           AS "Time",
    gcId                                                                AS "GC ID",
    round(ergo_bytes(message, 'threshold')       / 1048576.0, 2)        AS "Threshold MB",
    ergo_pct_key(message, 'threshold')                                  AS "Threshold %",
    round(ergo_bytes(message, 'internal target occupancy') / 1048576.0, 2) AS "Target Occupancy MB",
    round(ergo_rate(message, 'allocation speed') / 1048576.0, 3)        AS "Alloc Speed MB/s",
    ergo_pct_key(message, 'concurrent mark GC cost')                    AS "Mark Cost %"
FROM ergo_events
WHERE message LIKE '%Adaptive IHOP%'
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Alloc Speed MB/s"]) ON ihop_adaptive TITLE "Allocation Speed Over Time (MB/s)" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB/s"
```

```plot
LINE_CHART(x: "Time", y: ["Threshold %", "Mark Cost %"]) ON ihop_adaptive TITLE "IHOP Threshold % vs Concurrent Mark GC Cost %" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"
```

```plot
TABLE() ON ihop_adaptive TITLE "Adaptive IHOP Fields — all 5 fields from one message"
```

---

<!-- @cell name=cset-events -->

## CSet Selection Events

`gc+ergo+cset` events record how G1 selects the collection set for each Young or Mixed GC.

```sql
-- alias cset_data
SELECT
    startTime                          AS "Time",
    gcId                               AS "GC ID",
    regexp_replace(message, '^GC\(\d+\)\s+', '') AS "Message",
    ergo_ms(message, 'target pause time')         AS "Target Pause ms",
    ergo_int(message, 'Pending cards')            AS "Pending Cards",
    ergo_int(message, 'Eden')                     AS "Eden Regions",
    ergo_int(message, 'Survivor')                 AS "Survivor Regions"
FROM ergo_events
WHERE tag = 'gc+ergo+cset'
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: ["Eden Regions", "Survivor Regions"]) ON cset_data TITLE "CSet Region Count per GC" LINK_X($start, $end) ZOOM AXIS_Y LABEL "regions"
```

```plot
TABLE() TITLE "CSet Selection Events"
```

---

<!-- @cell name=heap-events -->

## Heap Expansion and Contraction Events

`gc+ergo+heap` events record G1 heap resize decisions. The message contains **two fields in the same string**: the pause time ratio (the trigger) and the size delta (`Expand by NB` or `Shrink by NB`).

```sql
-- alias heap_data
SELECT
    startTime                          AS "Time",
    gcId                               AS "GC ID",
    CASE WHEN message LIKE '%expansion%' THEN 'Expand' ELSE 'Contract' END AS "Direction",
    regexp_replace(message, '^GC\(\d+\)\s+', '') AS "Message",
    ergo_pct(message)                            AS "Pause Time Ratio %",
    round(ergo_bytes(message, 'Expand by') / 1048576.0, 2) AS "Expand MB",
    round(ergo_bytes(message, 'Shrink by') / 1048576.0, 2) AS "Shrink MB"
FROM ergo_events
WHERE tag = 'gc+ergo+heap'
ORDER BY startTime
```

```plot
LINE_CHART(x: "Time", y: "Pause Time Ratio %") ON heap_data TITLE "Short-Term Pause Time Ratio for Heap Resize Decisions" LINK_X($start, $end) ZOOM AXIS_Y LABEL "%" FORMAT ".2f"
```

```plot
TABLE() ON heap_data TITLE "Heap Expansion/Contraction — two fields from one message"
```

---

<!-- @cell name=message-search -->

## Free-Text Message Search

Use the `$tag_filter` variable to filter by tag substring. Set it to a SQL string literal — e.g. `'ihop'`, `'cset'`, `'heap'`, `'refine'`. Leave as `''` to show all events.

```variables
$tag_filter = ''
$limit = 50
```

```sql
SELECT count(*) AS "Matching events"
FROM ergo_events
WHERE $tag_filter = '' OR tag LIKE '%' || $tag_filter || '%'
```

```plot
TABLE()
```

---

<!-- @cell name=real-data-note -->

## Using Real GCErgonomicTrace Data

When you load a JFR recording with G1 GC ergonomics logging enabled (requires `gc-details.jfc` or a custom profile with `jdk.GCErgonomicTrace` turned on), the `GCErgonomicTrace` table will be available. The cells below will automatically appear and query that table directly — the `GCErgoLog` built-in view wraps it with cleaner column names.

To enable GC ergonomics tracing in your recording:

```java
// In your JFR configuration or via JVM flag:
// -XX:StartFlightRecording:settings=gc-details.jfc
// or add to your .jfc file:
// <event name="jdk.GCErgonomicTrace">
//   <setting name="enabled">true</setting>
//   <setting name="threshold">0 ms</setting>
// </event>
```

---

<!-- @cell name=real-ergo-log requires="GCErgonomicTrace" -->

## Real GCErgoLog Data

This cell only appears when your recording contains `GCErgonomicTrace` events. The `GCErgoLog` view adds structured columns parsed from the message field.

```sql
-- alias real_ergo
SELECT "Time", "GC ID", "Tag", "Level", "Message",
       "Occupancy MB", "Threshold MB", "Ratio %",
       "Target Pause ms", "Pending Cards", "Eden Regions", "Survivor Regions"
FROM "GCErgoLog"
ORDER BY "Time"
LIMIT 200
```

```plot
TABLE() TITLE "GCErgoLog — structured parsed columns"
```

---

<!-- @cell name=real-ergo-ihop requires="GCErgonomicTrace" -->

## Real Data — IHOP Marking Triggers

`gc+ergo+ihop` events show when G1 initiates concurrent marking and what occupancy/threshold values drove that decision.

```sql
-- alias ihop_data
SELECT * FROM "gc-ergo-ihop"
```

```plot
LINE_CHART(x: "Time", y: ["Occupancy MB", "Threshold MB"]) ON ihop_data TITLE "G1 IHOP: Heap Occupancy vs Marking Threshold" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

```plot
TABLE() ON ihop_data TITLE "IHOP Trigger Events"
```

---

<!-- @cell name=real-ergo-cset requires="GCErgonomicTrace" -->

## Real Data — CSet Selection

`gc+ergo+cset` events record how G1 selects the collection set for each Young or Mixed GC.

```sql
-- alias cset_real
SELECT * FROM "gc-ergo-cset"
```

```plot
LINE_CHART(x: "Time", y: ["Eden Regions", "Survivor Regions"]) ON cset_real TITLE "G1 CSet: Eden and Survivor Region Count per GC" LINK_X($start, $end) ZOOM AXIS_Y LABEL "regions"
```

```plot
TABLE() ON cset_real TITLE "CSet Selection Events"
```

---

<!-- @cell name=real-ergo-heap requires="GCErgonomicTrace" -->

## Real Data — Heap Expansion Decisions

`gc+ergo+heap` events record when G1 expands or shrinks the heap.

```sql
-- alias heap_real
SELECT * FROM "gc-ergo-heap"
```

```plot
LINE_CHART(x: "Time", y: "Pause Ratio %") ON heap_real TITLE "Short-Term Pause Ratio Driving Heap Expansion" LINK_X($start, $end) ZOOM AXIS_Y LABEL "%" FORMAT ".2f"
```

```plot
TABLE() ON heap_real TITLE "Heap Expansion / Contraction Events"
```

---

<!-- @cell name=real-ergo-by-tag requires="GCErgonomicTrace" -->

## Real Data — Events by Tag

```sql
-- alias ergo_by_tag
SELECT
    "Tag",
    count(*)          AS "Count",
    min("Time")       AS "First",
    max("Time")       AS "Last"
FROM "GCErgoLog"
GROUP BY "Tag"
ORDER BY count(*) DESC
```

```plot
BAR_CHART(x: "Tag", y: "Count") ON ergo_by_tag TITLE "Real GC Ergo Events per Tag"
```

```plot
TABLE() ON ergo_by_tag TITLE "Tag Summary"
```

---

<!-- @cell name=custom-event-pattern -->

## The Custom Event Pattern

When you define your own JFR event class in Java:

```java
@Name("com.example.DatabaseQuery")
@Label("Database Query")
@Description("Tracks slow database queries")
@StackTrace(false)
public class DatabaseQueryEvent extends Event {
    @Label("SQL") public String sql;
    @Label("Duration ms") public long durationMs;
    @Label("Table") public String tableName;
    @Label("Rows Returned") public int rowsReturned;
}
```

After loading a JFR recording that contains these events, you will have a table named `com_example_DatabaseQuery` (dots → underscores) with columns `sql`, `durationMs`, `tableName`, `rowsReturned`, plus the standard `startTime` and `duration` columns.

You can then query it directly:

```sql
-- This cell would work once you load a recording with DatabaseQuery events
-- SELECT sql AS "SQL", durationMs AS "Duration (ms)", tableName AS "Table"
-- FROM com_example_DatabaseQuery
-- WHERE durationMs > 100
-- ORDER BY durationMs DESC
-- LIMIT 20
```

Or wrap it in a custom view via **Settings → Views**:

```sql
-- Custom view: slow-queries
-- SELECT sql AS "SQL", durationMs AS "Duration (ms)", tableName AS "Table", rowsReturned AS "Rows"
-- FROM com_example_DatabaseQuery
-- WHERE durationMs > 100
-- ORDER BY durationMs DESC
```

Then reference the view in any cell:

```sql
-- SELECT * FROM "slow-queries" LIMIT 50
```
