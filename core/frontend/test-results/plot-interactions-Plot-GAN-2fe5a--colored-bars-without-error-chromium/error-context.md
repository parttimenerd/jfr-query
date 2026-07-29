# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plot-interactions.spec.ts >> Plot: GANTT color column >> GC1. GANTT with color= column renders colored bars without error
- Location: e2e/plot-interactions.spec.ts:1442:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('div[id^="result-container-"]').last().locator('text=GANTT Color')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('div[id^="result-container-"]').last().locator('text=GANTT Color')

```

```yaml
- banner:
  - heading "JFR Query Notebook" [level=1]
  - text: WASM JFR
  - button "$session_start Mar 15, 10:00 AM"
  - button "$session_end Mar 15, 10:19 AM"
  - button "Undo":
    - img
  - button "Redo" [disabled]:
    - img
  - button "Disable Auto-Run":
    - img
  - button "Run All Queries":
    - img
  - button "Collapse All":
    - img
  - button "Expand All":
    - img
  - button "Clear All Results":
    - img
  - button "Load Notebook":
    - img
  - button "New from template":
    - img
  - button "New GC Analysis Notebook":
    - img
  - button "Save Notebook":
    - img
  - button "Edit Raw Markdown":
    - img
  - button "Disable AI Features":
    - img
  - button "Presenter Mode":
    - img
  - link "Documentation":
    - /url: https://parttimenerd.github.io/jfr-query/docs/
    - img
  - button "Settings":
    - img
- heading "Schema Explorer" [level=2]:
  - img
  - text: Schema Explorer
- button "Reset Layout":
  - img
- button "Refresh Schema":
  - img
- img
- textbox "Search schema..."
- img
- heading "Tables" [level=3]
- text: (5)
- button "Sort alphabetically":
  - img
- button "Sort by row count":
  - img
- img
- list:
  - listitem:
    - button "GarbageCollection 20":
      - img
      - text: GarbageCollection 20
  - listitem:
    - button "GCHeapSummary 40":
      - img
      - text: GCHeapSummary 40
  - listitem:
    - button "GCPhasePause 40":
      - img
      - text: GCPhasePause 40
  - listitem:
    - button "HeapSnapshot 150":
      - img
      - text: HeapSnapshot 150
  - listitem:
    - button "ObjectAllocationSample 25":
      - img
      - text: ObjectAllocationSample 25
- img
- heading "Views" [level=3]
- text: (14)
- button "Show Internal Views":
  - img
- img
- list:
  - listitem:
    - button "allocation-by-class-detail":
      - img
      - text: allocation-by-class-detail
  - listitem:
    - button "allocation-rate":
      - img
      - text: allocation-rate
  - listitem:
    - button "gc":
      - img
      - text: gc
  - listitem:
    - button "gc-concurrent-phases-detail":
      - img
      - text: gc-concurrent-phases-detail
  - listitem:
    - button "gc-efficiency":
      - img
      - text: gc-efficiency
  - listitem:
    - button "gc-overhead":
      - img
      - text: gc-overhead
  - listitem:
    - button "gc-pause-distribution":
      - img
      - text: gc-pause-distribution
  - listitem:
    - button "gc-pauses":
      - img
      - text: gc-pauses
  - listitem:
    - button "gc-phase-breakdown":
      - img
      - text: gc-phase-breakdown
  - listitem:
    - button "gc-throughput":
      - img
      - text: gc-throughput
  - listitem:
    - button "gc-top-pauses":
      - img
      - text: gc-top-pauses
  - listitem:
    - button "gc-young-vs-old":
      - img
      - text: gc-young-vs-old
  - listitem:
    - button "heap-committed-vs-used":
      - img
      - text: heap-committed-vs-used
  - listitem:
    - button "heap-summary-over-time":
      - img
      - text: heap-summary-over-time
- img
- heading "Macros" [level=3]
- text: (29)
- img
- list:
  - listitem:
    - button "after_gc":
      - img
      - text: after_gc
  - listitem:
    - button "before_gc":
      - img
      - text: before_gc
  - listitem:
    - button "view_sql":
      - img
      - text: view_sql
  - listitem:
    - button "time_since":
      - img
      - text: time_since
  - listitem:
    - button "rolling_sum":
      - img
      - text: rolling_sum
  - listitem:
    - button "rolling_avg":
      - img
      - text: rolling_avg
  - listitem:
    - button "relative_ms":
      - img
      - text: relative_ms
  - listitem:
    - button "recording_start":
      - img
      - text: recording_start
  - listitem:
    - button "recording_end":
      - img
      - text: recording_end
  - listitem:
    - button "P999":
      - img
      - text: P999
  - listitem:
    - button "P99":
      - img
      - text: P99
  - listitem:
    - button "P95":
      - img
      - text: P95
  - listitem:
    - button "P90":
      - img
      - text: P90
  - listitem:
    - button "normalized":
      - img
      - text: normalized
  - listitem:
    - button "macro_sql":
      - img
      - text: macro_sql
  - listitem:
    - button "in_range":
      - img
      - text: in_range
  - listitem:
    - button "HEAP_BEFORE_GC":
      - img
      - text: HEAP_BEFORE_GC
  - listitem:
    - button "HEAP_AFTER_GC":
      - img
      - text: HEAP_AFTER_GC
  - listitem:
    - button "format_percentage":
      - img
      - text: format_percentage
  - listitem:
    - button "format_memory":
      - img
      - text: format_memory
  - listitem:
    - button "format_human_duration":
      - img
      - text: format_human_duration
  - listitem:
    - button "format_hex":
      - img
      - text: format_hex
  - listitem:
    - button "format_duration":
      - img
      - text: format_duration
  - listitem:
    - button "format_decimals":
      - img
      - text: format_decimals
  - listitem:
    - button "duration_since_last_gc":
      - img
      - text: duration_since_last_gc
  - listitem:
    - button "diff":
      - img
      - text: diff
  - listitem:
    - button "COUNT_UNIQUE":
      - img
      - text: COUNT_UNIQUE
  - listitem:
    - button "bucket_ms":
      - img
      - text: bucket_ms
  - listitem:
    - button "stack_frames":
      - img
      - text: stack_frames
- img
- heading "Preview" [level=3]
- button "Show Search":
  - img
- button "Show Query Editor":
  - img
- img
- table:
  - rowgroup:
    - row "gcId name startTime duration ⏱ sumOfPauses ⏱ longestPause ⏱ cause":
      - columnheader "gcId":
        - button "gcId"
      - columnheader "name":
        - button "name"
      - columnheader "startTime":
        - button "startTime"
      - columnheader "duration ⏱":
        - button "duration ⏱"
      - columnheader "sumOfPauses ⏱":
        - button "sumOfPauses ⏱"
      - columnheader "longestPause ⏱":
        - button "longestPause ⏱"
      - columnheader "cause":
        - button "cause"
  - rowgroup:
    - row "1 G1GC 11:00:01.20 12 ms 12 ms 11.8 ms G1 Evacuation Pause":
      - cell "1"
      - cell "G1GC"
      - cell "11:00:01.20"
      - cell "12 ms"
      - cell "12 ms"
      - cell "11.8 ms"
      - cell "G1 Evacuation Pause"
    - row "2 G1GC 11:00:03.45 8.5 ms 8.5 ms 8.3 ms G1 Evacuation Pause":
      - cell "2"
      - cell "G1GC"
      - cell "11:00:03.45"
      - cell "8.5 ms"
      - cell "8.5 ms"
      - cell "8.3 ms"
      - cell "G1 Evacuation Pause"
    - row "3 G1GC 11:00:05.80 21.4 ms 21.4 ms 21.1 ms G1 Humongous Allocation":
      - cell "3"
      - cell "G1GC"
      - cell "11:00:05.80"
      - cell "21.4 ms"
      - cell "21.4 ms"
      - cell "21.1 ms"
      - cell "G1 Humongous Allocation"
    - row "4 G1GC 11:00:08.10 9.2 ms 9.2 ms 9 ms G1 Evacuation Pause":
      - cell "4"
      - cell "G1GC"
      - cell "11:00:08.10"
      - cell "9.2 ms"
      - cell "9.2 ms"
      - cell "9 ms"
      - cell "G1 Evacuation Pause"
    - row "5 G1GC 11:00:12.60 15.6 ms 15.6 ms 15.4 ms G1 Evacuation Pause":
      - cell "5"
      - cell "G1GC"
      - cell "11:00:12.60"
      - cell "15.6 ms"
      - cell "15.6 ms"
      - cell "15.4 ms"
      - cell "G1 Evacuation Pause"
    - row "6 G1GC 11:00:16.30 142 ms 142 ms 141.5 ms G1 Concurrent GC":
      - cell "6"
      - cell "G1GC"
      - cell "11:00:16.30"
      - cell "142 ms"
      - cell "142 ms"
      - cell "141.5 ms"
      - cell "G1 Concurrent GC"
    - row "7 G1GC 11:00:19.70 7.5 ms 7.5 ms 7.3 ms G1 Evacuation Pause":
      - cell "7"
      - cell "G1GC"
      - cell "11:00:19.70"
      - cell "7.5 ms"
      - cell "7.5 ms"
      - cell "7.3 ms"
      - cell "G1 Evacuation Pause"
    - row "8 G1GC 11:00:23.40 9.8 ms 9.8 ms 9.6 ms G1 Evacuation Pause":
      - cell "8"
      - cell "G1GC"
      - cell "11:00:23.40"
      - cell "9.8 ms"
      - cell "9.8 ms"
      - cell "9.6 ms"
      - cell "G1 Evacuation Pause"
    - row "9 G1GC 11:00:27.80 18.3 ms 18.3 ms 18 ms G1 Evacuation Pause":
      - cell "9"
      - cell "G1GC"
      - cell "11:00:27.80"
      - cell "18.3 ms"
      - cell "18.3 ms"
      - cell "18 ms"
      - cell "G1 Evacuation Pause"
    - row "10 G1GC 11:00:30.10 6.7 ms 6.7 ms 6.5 ms G1 Evacuation Pause":
      - cell "10"
      - cell "G1GC"
      - cell "11:00:30.10"
      - cell "6.7 ms"
      - cell "6.7 ms"
      - cell "6.5 ms"
      - cell "G1 Evacuation Pause"
    - row "11 G1GC 11:00:34.50 24.3 ms 24.3 ms 23.9 ms G1 Humongous Allocation":
      - cell "11"
      - cell "G1GC"
      - cell "11:00:34.50"
      - cell "24.3 ms"
      - cell "24.3 ms"
      - cell "23.9 ms"
      - cell "G1 Humongous Allocation"
    - row "12 G1GC 11:00:39.20 8.9 ms 8.9 ms 8.7 ms G1 Evacuation Pause":
      - cell "12"
      - cell "G1GC"
      - cell "11:00:39.20"
      - cell "8.9 ms"
      - cell "8.9 ms"
      - cell "8.7 ms"
      - cell "G1 Evacuation Pause"
    - row "13 G1GC 11:00:43.70 189 ms 189 ms 188.5 ms G1 Concurrent GC":
      - cell "13"
      - cell "G1GC"
      - cell "11:00:43.70"
      - cell "189 ms"
      - cell "189 ms"
      - cell "188.5 ms"
      - cell "G1 Concurrent GC"
    - row "14 G1GC 11:00:47.10 11.5 ms 11.5 ms 11.3 ms G1 Evacuation Pause":
      - cell "14"
      - cell "G1GC"
      - cell "11:00:47.10"
      - cell "11.5 ms"
      - cell "11.5 ms"
      - cell "11.3 ms"
      - cell "G1 Evacuation Pause"
    - row "15 G1GC 11:00:51.60 7.7 ms 7.7 ms 7.5 ms G1 Evacuation Pause":
      - cell "15"
      - cell "G1GC"
      - cell "11:00:51.60"
      - cell "7.7 ms"
      - cell "7.7 ms"
      - cell "7.5 ms"
      - cell "G1 Evacuation Pause"
    - row "16 G1GC 11:00:54.30 20.1 ms 20.1 ms 19.8 ms G1 Evacuation Pause":
      - cell "16"
      - cell "G1GC"
      - cell "11:00:54.30"
      - cell "20.1 ms"
      - cell "20.1 ms"
      - cell "19.8 ms"
      - cell "G1 Evacuation Pause"
    - row "17 G1GC 11:00:58.80 13.4 ms 13.4 ms 13.2 ms G1 Evacuation Pause":
      - cell "17"
      - cell "G1GC"
      - cell "11:00:58.80"
      - cell "13.4 ms"
      - cell "13.4 ms"
      - cell "13.2 ms"
      - cell "G1 Evacuation Pause"
    - row "18 G1GC 11:01:02.40 8.8 ms 8.8 ms 8.6 ms G1 Evacuation Pause":
      - cell "18"
      - cell "G1GC"
      - cell "11:01:02.40"
      - cell "8.8 ms"
      - cell "8.8 ms"
      - cell "8.6 ms"
      - cell "G1 Evacuation Pause"
    - row "19 G1GC 11:01:06.90 31.1 ms 31.1 ms 30.7 ms G1 Humongous Allocation":
      - cell "19"
      - cell "G1GC"
      - cell "11:01:06.90"
      - cell "31.1 ms"
      - cell "31.1 ms"
      - cell "30.7 ms"
      - cell "G1 Humongous Allocation"
    - row "20 G1GC 11:01:11.20 225 ms 225 ms 224.4 ms G1 Concurrent GC":
      - cell "20"
      - cell "G1GC"
      - cell "11:01:11.20"
      - cell "225 ms"
      - cell "225 ms"
      - cell "224.4 ms"
      - cell "G1 Concurrent GC"
- button "Collapse sidebar":
  - img
- main:
  - heading "Notebook Settings · 2 vars" [level=3]:
    - img
    - text: Notebook Settings · 2 vars
  - img
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - heading "JFR SQL Notebook" [level=1]
  - paragraph: "Welcome! This notebook lets you query a loaded JFR recording (or any DuckDB database) using SQL, then visualize results as charts. Here's how it works:"
  - list:
    - listitem:
      - strong: Left sidebar
      - text: "— Schema Explorer: browse tables, views, and macros in the database. Click any item to preview it in the sidebar; double-click to copy its name to clipboard."
    - listitem:
      - strong: Each cell
      - text: has one or more SQL queries followed by a plot config that visualizes the results. Click the
      - strong: ›
      - text: chevron in the cell header to collapse/expand it; use
      - strong: Collapse All
      - text: /
      - strong: Expand All
      - text: in the toolbar.
    - listitem:
      - strong: Run
      - text: a query with the ▶ button (or Cmd+Enter). The plot updates automatically.
    - listitem:
      - strong: Add content
      - text: — use
      - strong: + Add SQL
      - text: /
      - strong: + Plot
      - text: /
      - strong: + Prose
      - text: between blocks, or
      - strong: + Add Cell
      - text: at the bottom.
    - listitem:
      - strong: Variables
      - text: — declare
      - code: $name = value
      - text: in a variables block; reference them in SQL as
      - code: $name
      - text: . Notebook-wide variables use
      - code: $$name
      - text: in the Settings cell.
    - listitem:
      - strong: Column chips
      - text: appear above the plot editor — click any chip to copy the column name into your plot config.
    - listitem:
      - strong: Templates
      - text: — click
      - strong: New from template
      - text: in the toolbar to start from a pre-built analysis (GC, allocation, threading, exceptions).
    - listitem:
      - strong: AI assistant
      - text: — the panel on the right answers questions and writes SQL. Click the speech-bubble icon on any query to open a per-cell chat.
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading "Step 1 — Your first query" [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - paragraph:
    - text: Click
    - strong: ▶
    - text: below to run this query. It returns the 10 longest GC pauses. The result appears in the table.
  - img
  - text: Query 1 6ms SELECT "startTime", round(duration * 1000, 3) AS "duration_m
  - button "Run query (Cmd+Enter)":
    - img
  - button "Format SQL":
    - img
  - button "Suggest plot with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Copy SQL":
    - img
  - button "Delete query block":
    - img
  - textbox
  - button "+ SQL"
  - button "+ Plot"
  - button "+ Prose"
  - img
  - text: Plot 1 TABLE()
  - button "Format plot":
    - img
  - button "Generate plot config with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Plot syntax reference":
    - img
  - button "Delete plot block":
    - img
  - text: "columns:"
  - button "startTime"
  - button "duration_ms"
  - button "cause"
  - text: — click to copy
  - textbox
  - button "Download as PNG":
    - img
  - img
  - textbox "Search..."
  - text: 10 rows
  - button "CSV ↓"
  - table:
    - rowgroup:
      - row "startTime duration_ms ⏱ cause":
        - columnheader "startTime":
          - button "startTime"
        - columnheader "duration_ms ⏱":
          - button "duration_ms ⏱"
        - columnheader "cause":
          - button "cause"
    - rowgroup:
      - row "11:01:11.20 225 ms G1 Concurrent GC":
        - cell "11:01:11.20"
        - cell "225 ms"
        - cell "G1 Concurrent GC"
      - row "11:00:43.70 189 ms G1 Concurrent GC":
        - cell "11:00:43.70"
        - cell "189 ms"
        - cell "G1 Concurrent GC"
      - row "11:00:16.30 142 ms G1 Concurrent GC":
        - cell "11:00:16.30"
        - cell "142 ms"
        - cell "G1 Concurrent GC"
      - row "11:01:06.90 31.1 ms G1 Humongous Allocation":
        - cell "11:01:06.90"
        - cell "31.1 ms"
        - cell "G1 Humongous Allocation"
      - row "11:00:34.50 24.3 ms G1 Humongous Allocation":
        - cell "11:00:34.50"
        - cell "24.3 ms"
        - cell "G1 Humongous Allocation"
      - row "11:00:05.80 21.4 ms G1 Humongous Allocation":
        - cell "11:00:05.80"
        - cell "21.4 ms"
        - cell "G1 Humongous Allocation"
      - row "11:00:54.30 20.1 ms G1 Evacuation Pause":
        - cell "11:00:54.30"
        - cell "20.1 ms"
        - cell "G1 Evacuation Pause"
      - row "11:00:27.80 18.3 ms G1 Evacuation Pause":
        - cell "11:00:27.80"
        - cell "18.3 ms"
        - cell "G1 Evacuation Pause"
      - row "11:00:12.60 15.6 ms G1 Evacuation Pause":
        - cell "11:00:12.60"
        - cell "15.6 ms"
        - cell "G1 Evacuation Pause"
      - row "11:00:58.80 13.4 ms G1 Evacuation Pause":
        - cell "11:00:58.80"
        - cell "13.4 ms"
        - cell "G1 Evacuation Pause"
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading "Step 2 — Visualize as a chart" [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - paragraph:
    - text: Change the plot config from
    - code: TABLE()
    - text: to a
    - code: BAR_CHART
    - text: to compare pause durations by GC cause. The x-axis is the category, y is the numeric value. You can edit the plot config directly — column chips above the editor show available columns.
  - img
  - text: Query 1 16ms SELECT "cause", COUNT(*) AS "count", round(AVG(duration * 10
  - button "Run query (Cmd+Enter)":
    - img
  - button "Format SQL":
    - img
  - button "Suggest plot with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Copy SQL":
    - img
  - button "Delete query block":
    - img
  - textbox
  - button "+ SQL"
  - button "+ Plot"
  - button "+ Prose"
  - img
  - text: "Plot 1 BAR_CHART(x: \"cause\", y: [\"count\", \"avg_ms\"], layout: \"group"
  - button "Format plot":
    - img
  - button "Generate plot config with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Plot syntax reference":
    - img
  - button "Delete plot block":
    - img
  - text: "columns:"
  - button "cause"
  - button "count"
  - button "avg_ms"
  - text: — click to copy
  - textbox
  - button "Download as PNG":
    - img
  - heading "GC Causes" [level=4]
  - list:
    - listitem:
      - img "avg ms legend icon"
      - text: avg ms
    - listitem:
      - img "count legend icon"
      - text: count
  - application: G1 Evacuation Pause G1 Humongous Allocation G1 Concurrent GC 3 103 185.333
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading "Step 3 — Time series with zoom" [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - paragraph:
    - text: Use
    - code: LINE_CHART
    - text: for metrics over time.
    - code: LINK_X($start, $end)
    - text: enables interactive
    - strong: drag-to-pan
    - text: and
    - strong: Shift+scroll to zoom
    - text: . The
    - code: "200"
    - text: variable below limits rows — change the value and the query re-runs automatically.
  - img
  - text: Variables (1)
  - button "Add":
    - img
    - text: Add
  - 'textbox "Cell-local variable: must start with $ (use $$ prefix in Notebook Settings for global scope)"': $limit
  - text: =
  - textbox: "200"
  - button:
    - img
  - img
  - text: Query 1 SELECT startTime, endTime, cause AS lane, cause AS color_col
  - button "Run query (Cmd+Enter)":
    - img
  - button "Format SQL":
    - img
  - button "Suggest plot with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Copy SQL":
    - img
  - button "Delete query block":
    - img
  - textbox
  - text: "Binder Error: Referenced column \"endTime\" not found in FROM clause! Candidate bindings: \"startTime\", \"duration\""
  - paragraph: "Tip: The column was not found in the query result. Verify the column name or add it to the SELECT list."
  - text: "Did you mean:"
  - button "startTime"
  - button "duration"
  - paragraph: AI suggestion loading…
  - button "+ SQL"
  - button "+ Plot"
  - button "+ Prose"
  - img
  - text: Plot 1 GANTT(start:"startTime", end:"endTime", lane:"lane", color:"
  - button "Format plot":
    - img
  - button "Generate plot config with AI":
    - img
  - button "Refine with AI":
    - img
  - button "Plot syntax reference":
    - img
  - button "Delete plot block":
    - img
  - textbox
  - button "Download as PNG":
    - img
  - text: Query has errors — see SQL editor above.
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading "Step 4 — Add your own analysis" [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - list:
    - listitem:
      - text: Click
      - strong: + Add SQL
      - text: below any cell to add another query, or
      - strong: + Add Cell
      - text: at the bottom to start fresh.
    - listitem:
      - text: Click
      - strong: Plot syntax
      - text: beneath any plot block for the full chart reference (LINE_CHART, BAR_CHART, SCATTER_PLOT, HISTOGRAM, FLAMEGRAPH, and more).
    - listitem:
      - text: Click
      - strong: </>
      - text: in the cell header to edit the prose above as raw Markdown.
    - listitem:
      - text: Try the
      - strong: Schema Explorer
      - text: on the left — click a table to preview it, or search for a column name across all tables.
    - listitem:
      - text: Open
      - strong: New from template
      - text: in the toolbar for ready-made GC, allocation, threading, and exception notebooks.
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Drag to reorder cell":
    - img
  - button "Collapse cell":
    - img
  - heading "New Cell" [level=2]
  - button "Raw Markdown":
    - img
  - button "Delete Cell":
    - img
  - button "Add Introduction":
    - img
    - text: Add Introduction
  - button "Add variable":
    - img
    - text: Add variable
  - button "Add Plot":
    - img
    - text: Add Plot
  - button "Add SQL":
    - img
    - text: Add SQL
  - button "Add Conclusion":
    - img
    - text: Add Conclusion
  - button "Add Cell":
    - img
    - text: Add Cell
- heading "AI Assistant" [level=2]:
  - img
  - text: AI Assistant
- button "New chat channel":
  - img
- button "Reset Conversation":
  - img
- text: See
- combobox "AI data visibility":
  - option "No data" [selected]
  - option "Sanitized"
  - option "Full"
- 'combobox "Mode: /normal — chat normally, mutations require approval Switch with /normal, /plan, or /btw."':
  - option "/normal" [selected]
  - option "/plan"
  - option "/btw"
- text: ·
- 'combobox "Model: t5-small-finetuned (browser) Switch with /model <name> or /provider <name>."':
  - option "plot-suggester-local"
  - option "t5-small-finetuned" [selected]
  - option "t5-small-finetuned-v2"
  - option "flan-t5-small"
  - option "t5-small"
  - option "qwen2.5-0.5b"
  - option "qwen2.5-coder-0.5b"
  - option "smollm2-360m"
  - option "t5-base"
- paragraph: Hello! I can help you analyze your JFR data. What would you like to investigate? For example, you could ask about CPU load or garbage collection pauses.
- paragraph:
  - text: Type
  - code: /help
  - text: to see available commands.
- button "Copy response":
  - img
- button "What GC events are in this recording?"
- button "Show me the longest GC pauses"
- button "Which threads are using the most CPU?"
- button "Summarize memory allocation hotspots"
- textbox "Ask for a query… or type / for commands, @ to mention a cell"
- button [disabled]:
  - img
- button "Expand Assistant":
  - img
```

# Test source

```ts
  1363 |     const hasError = await page.evaluate(() =>
  1364 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1365 |     );
  1366 |     expect(hasError).toBe(false);
  1367 |   });
  1368 | 
  1369 |   test('BA2. BAR_CHART layout:grouped renders without error', async () => {
  1370 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1371 |     await page.waitForTimeout(500);
  1372 | 
  1373 |     const sqlEd = await getLastSqlEditor(page);
  1374 |     if (!sqlEd) { test.skip(); return; }
  1375 |     await setCmContent(page, sqlEd,
  1376 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
  1377 |     await pressRun(page);
  1378 |     await page.waitForTimeout(1500);
  1379 | 
  1380 |     const plotEd = await getLastPlotEditor(page);
  1381 |     if (!plotEd) { test.skip(); return; }
  1382 |     await setCmContent(page, plotEd,
  1383 |       'BAR_CHART(x:"cause", y:["cnt"], layout:"grouped")\n  TITLE "Grouped Bar"');
  1384 |     await pressRun(page);
  1385 |     await page.waitForTimeout(2000);
  1386 | 
  1387 |     const container = page.locator('div[id^="result-container-"]').last();
  1388 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1389 |     const hasError = await page.evaluate(() =>
  1390 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1391 |     );
  1392 |     expect(hasError).toBe(false);
  1393 |   });
  1394 | 
  1395 |   test('BA3. BAR_CHART horizontal:true renders without error', async () => {
  1396 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1397 |     await page.waitForTimeout(500);
  1398 | 
  1399 |     const sqlEd = await getLastSqlEditor(page);
  1400 |     if (!sqlEd) { test.skip(); return; }
  1401 |     await setCmContent(page, sqlEd,
  1402 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
  1403 |     await pressRun(page);
  1404 |     await page.waitForTimeout(1500);
  1405 | 
  1406 |     const plotEd = await getLastPlotEditor(page);
  1407 |     if (!plotEd) { test.skip(); return; }
  1408 |     await setCmContent(page, plotEd,
  1409 |       'BAR_CHART(x:"cause", y:["cnt"], horizontal:true)\n  TITLE "Horizontal Bar"');
  1410 |     await pressRun(page);
  1411 |     await page.waitForTimeout(2000);
  1412 | 
  1413 |     const container = page.locator('div[id^="result-container-"]').last();
  1414 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1415 |     const hasError = await page.evaluate(() =>
  1416 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1417 |     );
  1418 |     expect(hasError).toBe(false);
  1419 |     // Horizontal bar uses a BarChart with layout="vertical" in recharts,
  1420 |     // which renders bar rectangles just like a normal bar chart
  1421 |     const hasBars = await container.locator('.recharts-bar').count();
  1422 |     expect(hasBars, 'bar elements rendered').toBeGreaterThan(0);
  1423 |   });
  1424 | });
  1425 | 
  1426 | // ---------------------------------------------------------------------------
  1427 | // Section 27: GANTT with color column
  1428 | // ---------------------------------------------------------------------------
  1429 | 
  1430 | test.describe.serial('Plot: GANTT color column', () => {
  1431 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  1432 | 
  1433 |   let page: Page;
  1434 | 
  1435 |   test.beforeAll(async ({ browser }) => {
  1436 |     page = await browser.newPage();
  1437 |     await gotoDemo(page);
  1438 |   });
  1439 | 
  1440 |   test.afterAll(async () => page.close());
  1441 | 
  1442 |   test('GC1. GANTT with color= column renders colored bars without error', async () => {
  1443 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1444 |     await page.waitForTimeout(500);
  1445 | 
  1446 |     const sqlEd = await getLastSqlEditor(page);
  1447 |     if (!sqlEd) { test.skip(); return; }
  1448 |     await setCmContent(page, sqlEd,
  1449 |       `SELECT startTime, endTime, cause AS lane, cause AS color_col
  1450 |        FROM GarbageCollection ORDER BY startTime LIMIT 8`);
  1451 |     await pressRun(page);
  1452 |     await page.waitForTimeout(1500);
  1453 | 
  1454 |     const plotEd = await getLastPlotEditor(page);
  1455 |     if (!plotEd) { test.skip(); return; }
  1456 |     await setCmContent(page, plotEd,
  1457 |       'GANTT(start:"startTime", end:"endTime", lane:"lane", color:"color_col")\n  TITLE "GANTT Color"');
  1458 |     await pressRun(page);
  1459 |     await page.waitForTimeout(2000);
  1460 | 
  1461 |     const container = page.locator('div[id^="result-container-"]').last();
  1462 |     await expect(container).toBeVisible({ timeout: 10_000 });
> 1463 |     await expect(container.locator('text=GANTT Color')).toBeVisible({ timeout: 5_000 });
       |                                                         ^ Error: expect(locator).toBeVisible() failed
  1464 |     const hasError = await page.evaluate(() =>
  1465 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1466 |     );
  1467 |     expect(hasError).toBe(false);
  1468 |   });
  1469 | });
  1470 | 
  1471 | // ---------------------------------------------------------------------------
  1472 | // Section 28: AXIS_X LABEL + DOMAIN
  1473 | // ---------------------------------------------------------------------------
  1474 | 
  1475 | test.describe.serial('Plot: AXIS_X LABEL and DOMAIN', () => {
  1476 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  1477 | 
  1478 |   let page: Page;
  1479 | 
  1480 |   test.beforeAll(async ({ browser }) => {
  1481 |     page = await browser.newPage();
  1482 |     await gotoDemo(page);
  1483 |   });
  1484 | 
  1485 |   test.afterAll(async () => page.close());
  1486 | 
  1487 |   test('AX1. AXIS_X LABEL renders the label text in SVG', async () => {
  1488 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1489 |     await page.waitForTimeout(500);
  1490 | 
  1491 |     const sqlEd = await getLastSqlEditor(page);
  1492 |     if (!sqlEd) { test.skip(); return; }
  1493 |     await setCmContent(page, sqlEd,
  1494 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
  1495 |     await pressRun(page);
  1496 |     await page.waitForTimeout(1500);
  1497 | 
  1498 |     const plotEd = await getLastPlotEditor(page);
  1499 |     if (!plotEd) { test.skip(); return; }
  1500 |     await setCmContent(page, plotEd,
  1501 |       'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "AXIS_X Label Test"\n  AXIS_X LABEL "GC Cause"');
  1502 |     await pressRun(page);
  1503 |     await page.waitForTimeout(2000);
  1504 | 
  1505 |     const container = page.locator('div[id^="result-container-"]').last();
  1506 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1507 |     const hasError = await page.evaluate(() =>
  1508 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1509 |     );
  1510 |     expect(hasError).toBe(false);
  1511 | 
  1512 |     // The AXIS_X label is rendered as an SVG <text> element
  1513 |     const hasLabel = await page.evaluate(() => {
  1514 |       const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
  1515 |       const c = cs[cs.length - 1];
  1516 |       if (!c) return false;
  1517 |       return [...c.querySelectorAll('text')].some(t => t.textContent?.trim() === 'GC Cause');
  1518 |     });
  1519 |     expect(hasLabel, 'AXIS_X label text in SVG').toBe(true);
  1520 |   });
  1521 | });
  1522 | 
  1523 | // ---------------------------------------------------------------------------
  1524 | // Section 29: LEGEND AT RIGHT / TOP
  1525 | // ---------------------------------------------------------------------------
  1526 | 
  1527 | test.describe.serial('Plot: LEGEND AT RIGHT and TOP', () => {
  1528 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  1529 | 
  1530 |   let page: Page;
  1531 | 
  1532 |   test.beforeAll(async ({ browser }) => {
  1533 |     page = await browser.newPage();
  1534 |     await gotoDemo(page);
  1535 |   });
  1536 | 
  1537 |   test.afterAll(async () => page.close());
  1538 | 
  1539 |   test('LR1. LEGEND AT RIGHT renders legend without error', async () => {
  1540 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1541 |     await page.waitForTimeout(500);
  1542 | 
  1543 |     const sqlEd = await getLastSqlEditor(page);
  1544 |     if (!sqlEd) { test.skip(); return; }
  1545 |     await setCmContent(page, sqlEd,
  1546 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
  1547 |     await pressRun(page);
  1548 |     await page.waitForTimeout(1500);
  1549 | 
  1550 |     const plotEd = await getLastPlotEditor(page);
  1551 |     if (!plotEd) { test.skip(); return; }
  1552 |     await setCmContent(page, plotEd,
  1553 |       'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "Legend Right"\n  LEGEND AT RIGHT');
  1554 |     await pressRun(page);
  1555 |     await page.waitForTimeout(2000);
  1556 | 
  1557 |     const container = page.locator('div[id^="result-container-"]').last();
  1558 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1559 |     const hasError = await page.evaluate(() =>
  1560 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1561 |     );
  1562 |     expect(hasError).toBe(false);
  1563 |     const legendCount = await container.locator('.recharts-legend-wrapper').count();
```