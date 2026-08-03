---
title: Exceptions & Errors
description: Exceptions thrown during the recording, grouped by class.
tags: [exceptions, errors]
license: MIT
variables:
  $limit: "20"
cellConditions:
  exceptions-by-class: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'JavaExceptionThrow'"
  errors: "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'JavaErrorThrow'"
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

<!-- @cell name=exceptions-by-class -->

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

<!-- @cell name=errors -->

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
