export const initialNotebook: string = `# JFR SQL Notebook

Welcome! This notebook lets you query a loaded JFR recording (or any DuckDB database) using SQL, then visualize results as charts. Here's how it works:

- **Left sidebar** — Schema Explorer: browse tables, views, and macros in the database. Click any item to insert a query.
- **Each cell** has one or more SQL queries followed by a plot config that visualizes the results.
- **Run** a query with the ▶ button (or Cmd+Enter). The plot updates automatically.
- **Edit this cell** by clicking the **</>** icon to switch to raw Markdown mode.
- **Switch chart type** using the "switch to:" row below the plot editor — it auto-fills columns from your query results.
- **Column chips** appear above the plot editor — click any chip to copy the column name into your plot config.

---

## Step 1 — Your first query

Click **▶** below to run this query. It returns the 10 longest GC pauses. The result appears in the table.

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

Now change the plot config from \`TABLE()\` to a \`BAR_CHART\` to compare pause durations by GC cause. The x-axis is the category, y is the numeric value.

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

Use \`LINE_CHART\` for metrics over time. Add \`LINK_X($start, $end)\` to enable interactive **drag-to-pan** and **Shift+scroll to zoom**.

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

Use **+ Add SQL** below a cell to add more queries, or click **+ New Cell** at the bottom of the notebook to start fresh. Click **Plot syntax** beneath any plot block for the full reference guide.

Tip: open the **Schema Explorer** on the left and click any table or view to preview its columns and auto-insert a SELECT query.`;
