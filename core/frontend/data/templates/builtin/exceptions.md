---
title: Exceptions & Errors
description: Exceptions thrown during the recording, grouped by class.
tags: [exceptions, errors]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## Exceptions & Errors

Which exception classes are thrown most often during the recording.

**What's here:**
- Exceptions by class (`jdk.JavaExceptionThrow`) — top thrown types
- Errors by class (`jdk.JavaErrorThrow`) — serious errors like `OutOfMemoryError`

**Required events:** `JavaExceptionThrow`, `JavaErrorThrow`

These events require `-XX:StartFlightRecording:settings=profile` (they're off in the default profile). Frequent exceptions on hot paths can cause significant overhead — look for surprising counts of `NullPointerException`, `SocketTimeoutException`, or similar control-flow exceptions.

**Interpreting results:** A few hundred exceptions per second is rarely a problem. Tens of thousands per second of `NullPointerException` or `IOException` used for control flow can add significant CPU overhead and GC pressure. `OutOfMemoryError` appearing even once is critical. Any exception type you don't recognise is worth investigating with a stack trace query.

---

<!-- @cell name=exceptions-by-class requires="JavaExceptionThrow" -->

## Exceptions by Class

```sql
-- alias exceptions_by_class
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Throws"
FROM JavaExceptionThrow e
JOIN Class c ON e.thrownClass = c._id
GROUP BY c.javaName
ORDER BY COUNT(*) DESC
LIMIT $limit
```

```plot
BAR_CHART(x: "Class", y: ["Throws"], horizontal: true) TITLE "Top Thrown Exceptions"
```

---

<!-- @cell name=errors requires="JavaErrorThrow" -->

## Errors

```sql
-- alias errors
SELECT
  c.javaName AS "Class",
  COUNT(*) AS "Throws"
FROM JavaErrorThrow e
JOIN Class c ON e.thrownClass = c._id
GROUP BY c.javaName
ORDER BY COUNT(*) DESC
LIMIT $limit
```

```plot
TABLE()
```

---

<!-- @cell name=exception-by-site requires="JavaExceptionThrow" -->

## Exception Throw Sites

Methods that throw the most exceptions. These are the call sites to investigate first — especially if the top site is a hot code path using exceptions for control flow.

```sql
SELECT * FROM "exception-by-site" LIMIT $limit
```

```plot
BAR_CHART(x: "Method", y: ["Count"], horizontal: true) TITLE "Top Exception Throw Sites"
```

```plot
TABLE() TITLE "Exception Throw Sites"
```

---

<!-- @cell name=exception-by-message requires="JavaExceptionThrow" -->

## Exception Messages

Most common exception messages across all types. Recurring messages from the same root cause are easier to fix than a scatter of unique messages.

```sql
SELECT * FROM "exception-by-message" LIMIT $limit
```

```plot
TABLE() TITLE "Most Common Exception Messages"
```

---

<!-- @cell name=exception-flamegraph requires="JavaExceptionThrow" -->

## Exception Flame Graph

Call-stack breakdown of all exception throw sites. Wide frames = many exceptions thrown through that code path. Use this to identify which parts of the call tree are exception-heavy.

*Requires stack trace capture in the recording (`stackDepth > 0`).*

```sql
SELECT * FROM "exception-flamegraph"
```

```plot
FLAME_GRAPH() TITLE "Exception Throw Flame Graph"
```
