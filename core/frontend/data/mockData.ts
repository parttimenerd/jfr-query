export const initialNotebook: string = `---
views:
  - name: 'LongestGC'
    sql: |
      SELECT "startTime", duration
      FROM "GarbageCollection"
      ORDER BY duration DESC
      LIMIT 10
macros:
  - name: 'duration_ms'
    sql: |
      duration / 1000000
---

## Welcome to the JFR SQL Notebook!

This is an interactive notebook for analyzing JFR data using DuckDB. Your database has been loaded.

Use the **Schema Explorer** on the left to see available tables and views, and the **AI Assistant** on the right to help you write queries.

Here is an example query to get you started. It shows the top 5 longest garbage collection pauses, using the local variable \`$limit\`.

\`\`\`variables
$limit = 5
\`\`\`

\`\`\`sql
SELECT duration, "startTime"
FROM "GarbageCollection"
ORDER BY duration DESC
LIMIT $limit;
\`\`\`

\`\`\`plot
TABLE()
\`\`\`

You can run the query by clicking the "Run" button. You can also add new SQL or plot blocks, or edit this entire cell as markdown. Happy analyzing!`;