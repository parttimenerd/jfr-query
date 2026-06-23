# JFR Extended Query Language Grammar

## Overview
The JFR Extended Query Language is a SQL-like language designed for querying Java Flight Recorder (JFR) data with advanced features including time-aware operations, memory size handling, fuzzy joins, and GC correlation analysis.

## Grammar Definition

```
program         ::= statement*
statement       ::= assignment | query
assignment      ::= IDENTIFIER "=" query
query           ::= extendedQuery | legacyQuery | showQuery
extendedQuery   ::= "@" sqlQuery
legacyQuery     ::= "[" jfrQuery "]"
showQuery       ::= "SHOW" ("EVENTS" | "FIELDS" type)

sqlQuery        ::= [variables] [with] select from [where] [groupBy] [orderBy] [limit]
variables       ::= "WHERE" variable ("," variable)*
variable        ::= IDENTIFIER ":=" expression
with            ::= "WITH" cte ("," cte)*
cte             ::= IDENTIFIER "AS" "(" query ")"

select          ::= "SELECT" ("*" | selectItem ("," selectItem)*)
selectItem      ::= expression [alias]
expression      ::= term | binaryOp | functionCall | gcExpression
term            ::= IDENTIFIER | NUMBER | STRING | DURATION | TIMESTAMP | MEMORY_SIZE | RATE | BOOLEAN | "(" expression ")"
binaryOp        ::= expression operator expression
operator        ::= "+" | "-" | "*" | "/" | "%" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "AND" | "OR" | "LIKE" | "IN"
functionCall    ::= IDENTIFIER "(" (expression ("," expression)*)? ")"
gcExpression    ::= IDENTIFIER "." ("before_gc" | "after_gc")

from            ::= "FROM" source ("," source)* [joinClause]*
source          ::= (type | IDENTIFIER) [alias]
joinClause      ::= joinType "JOIN" source "ON" condition
joinType        ::= "INNER" | "LEFT" | "RIGHT" | "FULL" | "FUZZY"

where           ::= "WHERE" condition
condition       ::= expression | condition "AND" condition | condition "OR" condition | "(" condition ")"

groupBy         ::= "GROUP" "BY" expression ("," expression)*
orderBy         ::= "ORDER" "BY" orderItem ("," orderItem)*
orderItem       ::= expression ("ASC" | "DESC")?
limit           ::= "LIMIT" NUMBER

alias           ::= "AS" IDENTIFIER
type            ::= IDENTIFIER ("." IDENTIFIER)*

// Time-aware and memory-aware expressions
DURATION        ::= NUMBER ("ns" | "us" | "ms" | "s" | "m" | "h" | "d")
TIMESTAMP       ::= NUMBER | TIME_FORMAT
TIME_FORMAT     ::= DIGIT+ ":" DIGIT+ ":" DIGIT+ ("." DIGIT+)?
MEMORY_SIZE     ::= NUMBER ("B" | "KB" | "MB" | "GB" | "TB")
RATE            ::= NUMBER "/" ("s" | "m" | "h")

// Aggregate functions
AGGREGATE_FUNC  ::= "AVG" | "COUNT" | "DIFF" | "FIRST" | "LAST" | "LAST_BATCH" | "LIST" | "MAX" | "MEDIAN" | "MIN" | "P90" | "P95" | "P99" | "P999" | "STDEV" | "SUM" | "UNIQUE"
```

## Data Types

### Supported Cell Types
- **String**: Text values
- **Number**: Numeric values (integers and floating point)
- **Duration**: Time intervals with units (ns, us, ms, s, m, h, d)
- **Timestamp**: Absolute time points
- **Memory Size**: Memory values with units (B, KB, MB, GB, TB)
- **Rate**: Frequency values (e.g., 3/s, 10/m)
- **Boolean**: True/false values
- **Floating Point**: Decimal numbers

### GC Correlation
Events can be correlated with Garbage Collection events using special fields:
- `before_gc`: GC ID that occurred before this event
- `after_gc`: GC ID that occurred after this event

## Advanced Features

### Time-Aware Operations
```sql
@ SELECT * FROM ExecutionSample WHERE duration < 10ms
@ SELECT * FROM GarbageCollection WHERE startTime > 12:00:00
@ SELECT * FROM ThreadPark WHERE duration BETWEEN 1s AND 5s
```

### Memory-Aware Operations
```sql
@ SELECT * FROM ObjectAllocationInNewTLAB WHERE allocationSize > 1MB
@ SELECT * FROM GarbageCollection WHERE beforeMemory - afterMemory > 100MB
```

### GC Correlation
```sql
@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc = 10
@ SELECT * FROM ExecutionSample AS E WHERE E.before_gc IN P99(GarbageCollection, id, duration)
```

### Variables and Expressions
```sql
@ WHERE gc_threshold := P99(GarbageCollection, duration);
  SELECT * FROM ExecutionSample WHERE duration > gc_threshold
```

### Fuzzy Joins
```sql
@ SELECT * FROM ExecutionSample e 
  FUZZY JOIN ThreadPark p ON e.thread = p.thread AND ABS(e.startTime - p.startTime) < 1ms
```

### Nested Queries
```sql
@ SELECT * FROM ExecutionSample WHERE thread IN [
    SELECT thread FROM ThreadPark WHERE duration > 100ms
  ]
```

## Examples

### Basic Queries
```sql
@ SELECT * FROM GarbageCollection WHERE duration > 10ms
@ SELECT thread, COUNT(*) FROM ExecutionSample GROUP BY thread
@ SHOW EVENTS
@ SHOW FIELDS GarbageCollection
```

### Advanced Queries
```sql
@ WHERE slow_gcs := P99(GarbageCollection, id, duration);
  SELECT * FROM ExecutionSample AS E WHERE E.before_gc IN slow_gcs

@ WITH slow_threads AS (
    SELECT thread FROM ExecutionSample GROUP BY thread HAVING COUNT(*) > 1000
  )
  SELECT * FROM ThreadPark WHERE thread IN (SELECT thread FROM slow_threads)
```

### Assignment and Reuse
```sql
slow_gcs = @ SELECT * FROM GarbageCollection WHERE duration > P95(GarbageCollection, duration)
@ SELECT * FROM ExecutionSample WHERE before_gc IN (SELECT id FROM slow_gcs)
```