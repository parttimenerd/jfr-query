---
title: Exceptions & Errors
description: Exceptions thrown during the recording, grouped by class.
tags: [exceptions, errors]
license: MIT
variables:
  $limit: "20"
---

<!-- @cell name=intro -->

## Exceptions

JFR records `jdk.JavaExceptionThrow` for thrown exceptions and `jdk.JavaErrorThrow` for errors. Frequent exceptions are often a hot path that swallows control flow.

---

<!-- @cell name=exceptions-by-class -->

## Exceptions by Class

```sql
-- alias exceptions_by_class
SELECT
  thrownClass AS "Class",
  COUNT(*) AS "Throws"
FROM JavaExceptionThrow
GROUP BY thrownClass
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
  thrownClass AS "Class",
  COUNT(*) AS "Throws"
FROM JavaErrorThrow
GROUP BY thrownClass
ORDER BY COUNT(*) DESC
LIMIT $limit
```

```plot
TABLE()
```
