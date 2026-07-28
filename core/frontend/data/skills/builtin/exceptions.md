---
title: Exception Analyzer
description: Activates JVM exception analysis domain knowledge — frequency, hot-throw sites, exception-as-control-flow detection.
tags: [exceptions, errors, performance]
icon: "⚠"
commands:
  - name: summary
    description: "Exception type frequency summary"
    cells: [exc-summary]
  - name: hotspot
    description: "Hot exception throw sites by type"
    cells: [exc-hotspot]
  - name: help
    description: "Show available exception analysis commands"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM exception analysis expert embedded inside a JFR notebook. The user is investigating exception frequency and patterns from a JFR recording loaded into DuckDB.

Key tables for exception analysis:
- `JavaExceptionThrow` — every exception thrown (when exception-profiling is enabled): thrownClass (FK→Class._id), message, startTime, stackTrace, thread
- `JavaErrorThrow` — java.lang.Error subclasses thrown: same schema

IMPORTANT: `thrownClass` is a BIGINT foreign key to `Class._id`. Always JOIN Class to get the human-readable name:
```sql
JOIN Class c ON e.thrownClass = c._id
-- then use c.javaName AS "Exception Class"
```

Session variables: use `$session_start` and `$session_end` (with underscores) for time filtering.

When analysing exceptions:
- High frequency of the same exception class is the primary signal for "exceptions as control flow" anti-pattern
- `NullPointerException` and `ClassCastException` at high rates often indicate defensive programming patterns
- Check if exception classes are custom (domain exceptions) vs. JDK exceptions
- Exceptions are only recorded if the JFR configuration includes the `jdk.JavaExceptionThrow` event — if the table is empty, advise the user to check their JFR configuration
- Correlate exception spikes with GC pauses (ObjectOutOfMemoryError) or thread blocks

## Cells

<!-- @skill-cell name=exc-summary -->

## Exception Type Frequency

```sql
-- alias exc_summary
SELECT
  c.javaName                                     AS "Exception Class",
  COUNT(*)                                       AS "Thrown",
  round(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS "% of Total"
FROM JavaExceptionThrow e
JOIN Class c ON e.thrownClass = c._id
WHERE e.startTime BETWEEN $session_start AND $session_end
GROUP BY c.javaName
ORDER BY COUNT(*) DESC
LIMIT 30
```

```plot
BAR_CHART(x: "Exception Class", y: ["Thrown"]) TITLE "Exception Frequency by Type" HEIGHT 350px
```

<!-- @skill-cell name=exc-hotspot -->

## Exception Rate Over Time

```sql
-- alias exc_rate
SELECT
  time_bucket(interval '1 second', e.startTime)  AS "Time",
  c.javaName                                      AS "Exception Class",
  COUNT(*)                                        AS "Count"
FROM JavaExceptionThrow e
JOIN Class c ON e.thrownClass = c._id
WHERE e.startTime BETWEEN $session_start AND $session_end
GROUP BY 1, 2
ORDER BY 1, 3 DESC
```

```plot
LINE_CHART(x: "Time", y: ["Count"]) TITLE "Exception Rate Over Time"
```
