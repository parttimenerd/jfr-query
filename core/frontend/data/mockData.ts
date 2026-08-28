export const jvmlogInitialNotebook: string = `# JVM GC Log Notebook

A quick-start notebook for JVM GC log analysis. All queries run against the tables parsed from your \`-Xlog:gc*\` log file.

**Quick navigation:** Load a file, then use **New GC Analysis Notebook** (⚗) in the toolbar for the full analysis, or explore below.

---

## GC Overview

Collector, JDK version, heap configuration, and GC algorithm detected at JVM startup.

\`\`\`sql
SELECT * FROM "jvmlog-gc-init-summary"
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## GC Pause Summary

P50, P90, P99, and max pause across all GC events — the key SLA check.

\`\`\`sql
SELECT * FROM "jvmlog-pause-percentiles"
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## Pause by GC Cause

Total events, average pause, and p99 pause grouped by trigger cause.

\`\`\`sql
SELECT * FROM "jvmlog-cause-pause-stats"
\`\`\`

\`\`\`plot
BAR(x="GC Cause", y="Avg Pause (ms)")
\`\`\`

---

## Heap Usage Over Time

Before-GC and after-GC heap sizes across all events — a steady rise in "After GC" indicates heap growth or a memory leak.

\`\`\`sql
SELECT * FROM "jvmlog-heap-timeline"
\`\`\`

\`\`\`plot
LINE(x=gcId, y="Heap Before (MB)")
\`\`\`

---

## GC Overhead

GC time as a percentage of elapsed time — sustained overhead above 5% means the JVM is spending too much time collecting garbage.

\`\`\`sql
SELECT * FROM "jvmlog-gc-overhead"
\`\`\`

\`\`\`plot
TABLE()
\`\`\`
`;

export const initialNotebook: string = `# JFR SQL Notebook

Welcome! This notebook lets you query a loaded JFR recording (or any DuckDB database) using SQL, then visualize results as charts. Here's how it works:

- **Left sidebar** — Schema Explorer: browse tables, views, and macros in the database. Click any item to preview it in the sidebar; double-click to copy its name to clipboard.
- **Each cell** has one or more SQL queries followed by a plot config that visualizes the results. Click the **›** chevron in the cell header to collapse/expand it; use **Collapse All** / **Expand All** in the toolbar.
- **Run** a query with the ▶ button (or Cmd+Enter). The plot updates automatically.
- **Add content** — use **+ sql** / **+ plot** / **+ prose** between blocks (hover any cell footer), or the **+ SQL / + Plot / + Markdown** bar at the bottom.
- **Variables** — declare \`$name = value\` in a variables block; reference them in SQL as \`$name\`. Notebook-wide variables use \`$$name\` in the Settings cell.
- **Column chips** appear above the plot editor — click any chip to copy the column name into your plot config.
- **Templates** — click **New from template** in the toolbar to start from a pre-built analysis (GC, allocation, threading, exceptions).
- **AI assistant** — the panel on the right answers questions and writes SQL. Click the speech-bubble icon on any query to open a per-cell chat.

---

## Step 1 — Your first query

This query returns the 10 longest GC pauses — results appear in the table below automatically.

\`\`\`sql
SELECT
  "startTime",
  round(duration * 1000, 3) AS "duration_ms",
  "cause"
FROM "GarbageCollection"
ORDER BY duration DESC
LIMIT 10;
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

---

## Step 2 — Visualize as a chart

Change the plot config from \`TABLE()\` to a \`BAR_CHART\` to compare pause durations by GC cause. The x-axis is the category, y is the numeric value. You can edit the plot config directly — column chips above the editor show available columns.

\`\`\`sql
SELECT
  "cause",
  COUNT(*) AS "count",
  round(AVG(duration * 1000), 3) AS "avg_ms"
FROM "GarbageCollection"
GROUP BY "cause"
ORDER BY "count" DESC;
\`\`\`

\`\`\`plot
BAR_CHART(x: "cause", y: ["count", "avg_ms"], layout: "grouped") TITLE "GC Causes"
\`\`\`

---

## Step 3 — Time series with zoom

Use \`LINE_CHART\` for metrics over time. \`LINK_X($start, $end)\` enables interactive **drag-to-pan** and **Shift+scroll to zoom**. The \`$limit\` variable below limits rows — change the value and the query re-runs automatically.

\`\`\`variables
$limit = 200
\`\`\`

\`\`\`sql
SELECT
  "startTime",
  round(duration * 1000, 3) AS "duration_ms"
FROM "GarbageCollection"
ORDER BY "startTime"
LIMIT $limit;
\`\`\`

\`\`\`plot
LINE_CHART(x: "startTime", y: ["duration_ms"]) LINK_X($start, $end) TITLE "GC Pause Duration Over Time"
\`\`\`

---

## Step 4 — Add your own analysis

- Hover any cell footer to reveal **+ sql / + plot / + prose** for adding blocks inline, or use the **+ SQL / + Plot / + Markdown** bar at the bottom for a new cell.
- Click **Plot syntax** beneath any plot block for the full chart reference (LINE_CHART, BAR_CHART, SCATTER_PLOT, HISTOGRAM, FLAMEGRAPH, and more).
- Click **</>** in the cell header to edit the prose above as raw Markdown.
- Try the **Schema Explorer** on the left — click a table to preview it, or search for a column name across all tables.
- Open **New from template** in the toolbar for ready-made GC, allocation, threading, and exception notebooks.`;
