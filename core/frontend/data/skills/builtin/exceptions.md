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
- `JavaExceptionThrow` — every exception thrown (when exception-profiling is enabled): exception (class name), message, startTime, stackTrace, thread
- `JavaErrorThrow` — java.lang.Error subclasses thrown: same schema

When analysing exceptions:
- High frequency of the same exception class is the primary signal for "exceptions as control flow" anti-pattern
- `NullPointerException` and `ClassCastException` at high rates often indicate defensive programming patterns
- Check if exception classes are custom (domain exceptions) vs. JDK exceptions
- Exceptions are only recorded if the JFR configuration includes the `jdk.JavaExceptionThrow` event — if the table is empty, advise the user to check their JFR configuration
- Correlate exception spikes with GC pauses (ObjectOutOfMemoryError) or thread blocks
- Note: stack traces are stored as references, not inline strings — the raw DuckDB schema may vary

When suggesting SQL:
- Group by `exception` (the class name) and ORDER BY COUNT(*) DESC for frequency analysis
- Time-bucket exceptions to see if they are constant-rate or burst-pattern
- Filter by `exception LIKE '%RuntimeException%'` to focus on unchecked exceptions

## Cells

<!-- @skill-cell name=exc-summary -->

## Exception Type Frequency

```sql
-- alias exc_summary
SELECT
  exception                                      AS "Exception Class",
  COUNT(*)                                       AS "Thrown",
  round(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS "% of Total"
FROM JavaExceptionThrow
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY exception
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
  time_bucket(interval '1 second', startTime)  AS "Time",
  exception                                      AS "Exception Class",
  COUNT(*)                                       AS "Count"
FROM JavaExceptionThrow
WHERE startTime BETWEEN $sessionStart AND $sessionEnd
GROUP BY 1, 2
ORDER BY 1, 3 DESC
```

```plot
LINE_CHART(x: "Time", y: ["Count"]) TITLE "Exception Rate Over Time"
```
