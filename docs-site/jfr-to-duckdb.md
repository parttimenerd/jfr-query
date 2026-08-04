# JFR to DuckDB Mapping

JFR Query converts every event type in a recording into a DuckDB table, then creates a set of
SQL views and macros on top for common analyses. This page describes exactly how JFR data
structures are mapped to relational tables.

## Parsing with Jafar

The Java backend uses [**jafar**](https://github.com/btraceio/jafar), a zero-allocation JFR
parser that surfaces events as `Map<String, Object>` field maps. Structs within an event (such
as `StackTrace` or `Class`) arrive as nested `ComplexType` wrappers rather than materialised
Java objects, so the importer can process millions of events without heap pressure.

The web app runs the same importer code compiled to **WebAssembly** via GraalVM — see
[Browser Architecture](browser-architecture.md) for how that works.

## Table naming

Each JFR event type becomes a table. The event type name is normalised by stripping the
leading package prefix:

| JFR event type | Table name |
|----------------|------------|
| `jdk.GarbageCollection` | `GarbageCollection` |
| `jdk.ObjectAllocationSample` | `ObjectAllocationSample` |
| `jdk.ExecutionSample` | `ExecutionSample` |
| `jdk.types.Method` | `Method` |
| `jdk.types.Class` | `Class` |

Any `java.*`, `jfr.*`, or `jdk.*` prefix (including sub-packages like `jdk.types.*`) is
removed. Custom event types from application code keep their full name if no prefix matches.

## Primitive fields

Primitive JFR fields map directly to DuckDB types:

| JFR type | DuckDB column type | Notes |
|----------|--------------------|-------|
| `long` | `BIGINT` | |
| `int` | `INTEGER` | |
| `short` | `SMALLINT` | |
| `byte` | `TINYINT` | |
| `double` / `float` | `DOUBLE` | |
| `boolean` | `BOOLEAN` | |
| `char` | `USMALLINT` | Unicode code point |
| `java.lang.String` | `VARCHAR` | |
| Timestamp field (`@jdk.jfr.Timestamp`) | `TIMESTAMP` | Converted from epoch nanos |
| Timespan field (`@jdk.jfr.Timespan`) | `DOUBLE` | Seconds as fractional number |

JFR annotations such as `@jdk.jfr.Unsigned` and `@jdk.jfr.BooleanFlag` affect the display
metadata stored in table comments but not the column type. Semantic annotations like
`@jdk.jfr.MemoryAmount` and `@jdk.jfr.DataAmount` are recorded in the column comment as
`CONTENT_TYPE(MemoryAmount)` so frontends can format values appropriately.

## Struct fields: inlined vs. referenced

JFR events frequently embed nested struct values. The importer uses two strategies depending
on the struct's field composition:

### Inlined structs

A struct is **inlined** when all its fields are numeric primitives (or it has exactly one
field). Rather than creating a join table, the struct's fields are flattened into the parent
table using `$`-separated column names:

```
GCHeapSummary.heapSpace.start       → heapSpace$start        BIGINT
GCHeapSummary.heapSpace.committedSize → heapSpace$committedSize BIGINT
GCHeapSummary.heapSpace.reservedSize  → heapSpace$reservedSize  BIGINT
```

Single-field string structs (e.g. `Symbol{string}`, `GCWhen{when}`) are unwrapped to a plain
`VARCHAR` column.

### Referenced structs

A struct is **referenced** when it has multiple fields and at least one is non-numeric. These
become **separate tables** with an integer primary key `_id`. The parent table stores a
`UINTEGER` foreign key instead of the struct inline:

```
ExecutionSample.stackTrace  →  stackTrace  UINTEGER   (FK → StackTrace._id)
ExecutionSample.thread      →  thread      UINTEGER   (FK → Thread._id)
Method.type                 →  type        UINTEGER   (FK → Class._id)
Class.classLoader           →  classLoader UINTEGER   (FK → ClassLoader._id)
```

ID `0` is the null reference — it means the field was absent or null in the recording.

Foreign key relationships are not declared as SQL constraints (DuckDB does not enforce them),
but they are documented in **table comments** so tooling can discover them:

```sql
SELECT obj_description('ExecutionSample'::regclass);
-- Column "stackTrace": references "StackTrace"(_id)
-- Column "thread": references "Thread"(_id)
```

### Querying across structs

Use a standard SQL join:

```sql
SELECT e.startTime, m.name AS method, c.name AS class
FROM ExecutionSample e
JOIN StackTrace st ON e.stackTrace = st._id
JOIN Method m      ON st.topMethod = m._id
JOIN Class c       ON m.type       = c._id
ORDER BY e.startTime
LIMIT 20
```

Most analyses never need explicit joins because the built-in views and macros handle them — but
the schema is fully queryable when you need custom work.

## Stack traces

Stack traces deserve special treatment. Fully normalising them into a `Frame` table would
produce billions of rows for a typical recording and make even simple "hot methods" queries
very slow. Instead, each `stackTrace` field on an event creates **six flat columns**:

| Column | Type | Content |
|--------|------|---------|
| `stackTrace$topMethod` | `UINTEGER` | `Method._id` of the first JVM frame (most recent) |
| `stackTrace$topApplicationMethod` | `UINTEGER` | `Method._id` of the first non-bootstrap frame |
| `stackTrace$topNonInitMethod` | `UINTEGER` | `Method._id` of the first frame that is not `<init>` |
| `stackTrace$length` | `SMALLINT` | Number of frames recorded |
| `stackTrace$truncated` | `BOOLEAN` | `true` if the trace was cut at the recording depth limit |
| `stackTrace$methods` | `UINTEGER[]` | Array of `Method._id` for all frames (up to max depth) |

Native, C++, and kernel frames are excluded — only interpreted, JIT-compiled, and inlined
Java frames are stored. The default depth is 10; pass `--stack-depth N` to `serve` or
`import` to change it.

The three `top*` convenience columns cover the vast majority of "which method is hot" queries
without any array unnesting. For full stack analysis, `stackTrace$methods` can be unnested:

```sql
SELECT m.name, count(*) AS samples
FROM ExecutionSample e,
     unnest(e.stackTrace$methods) AS t(method_id)
JOIN Method m ON t.method_id = m._id
GROUP BY m.name
ORDER BY samples DESC
LIMIT 20
```

## Built-in views and macros

After the raw tables are created the importer registers a library of SQL **views** and
**macros** that hide the join complexity:

- **Views** are regular `CREATE VIEW` statements that pre-join common table combinations and
  apply sensible filters. For example `hot-methods` joins `ExecutionSample` → `StackTrace` →
  `Method` → `Class` and returns the top callers by sample count.
- **Macros** are parameterised SQL fragments (DuckDB `CREATE MACRO`) used as building blocks
  by the views.

Run `java -jar query.jar views` or `java -jar query.jar macros` to list them all. The full
reference is in [Built-in Views & Macros](views-macros.md).

## Column metadata in table comments

DuckDB does not support custom type annotations, so the importer stores rich metadata in
`COMMENT ON TABLE` strings. Each comment encodes:

- The event's `@jdk.jfr.Description` label.
- For each foreign-key column: `Column "name": references "TargetTable"(_id)`.
- For array FK columns: `Column "name": Array of references to "TargetTable"(_id) with CONTENT_TYPE(...)`.
- For content-type annotated columns: `Column "name": CONTENT_TYPE(MemoryAmount)`.

The web UI reads these comments to build the schema explorer and to render values with the
right units (bytes, milliseconds, etc.).

## The `.db` cache file

Importing a large JFR recording can take a few seconds. By default the importer writes the
finished DuckDB database to a `.db` file beside the original (e.g. `recording.jfr` →
`recording.db`). Subsequent `query` or `serve` invocations that find an up-to-date `.db` file
open it directly, skipping the import entirely. Pass `--no-cache` (`-n`) to suppress this.

## CJFR format

jfr-query also accepts **CJFR** (`.cjfr`) files produced by
[condensed-data](https://github.com/parttimenerd/condensed-data). CJFR is a compressed format
that can be 10–30× smaller than the equivalent `.jfr` file while preserving all event data.

The CJFR importer builds the same DuckDB schema as the JFR importer, so all views, macros, and
notebook templates work unchanged. There are two schema-level differences to be aware of:

### Struct fields: inlined instead of referenced

In a JFR recording, object reference types (`java.lang.Thread`, `java.lang.Class`,
`jdk.types.Method`, etc.) are normalised into separate lookup tables and stored as `UINTEGER`
foreign keys in event tables (see [Referenced structs](#referenced-structs) above).

In CJFR, the same fields are inlined as `VARCHAR` strings containing the most meaningful value
from the struct — for example, a thread field becomes the thread name, and a class field
becomes the Java class name. This makes ad-hoc queries easier (no joins needed for human-readable
values) but means you cannot join to the `Thread`, `Class`, or `Method` lookup tables.

| Field example | JFR | CJFR |
|---------------|-----|------|
| `eventThread` | `UINTEGER` (FK → `Thread._id`) | `VARCHAR` (thread name) |
| `method` | `UINTEGER` (FK → `Method._id`) | `VARCHAR` (qualified method name) |
| `objectClass` | `UINTEGER` (FK → `Class._id`) | `VARCHAR` (Java class name) |

The built-in views that reference these fields (e.g. `hot-methods`, `contention-by-site`) work
correctly with both formats because they already join through the struct tables when available
and fall back to direct columns otherwise.

### Numeric types

CJFR resolves `@Unsigned` annotations using the underlying primitive: an unsigned `long`
field becomes `BIGINT` (matching JFR) and an unsigned `int` becomes `INTEGER`. CJFR-only
compound types such as `uint2` (unsigned short) map to `SMALLINT`.

## See also

- [Browser Architecture](browser-architecture.md) — how the same importer runs in the browser via GraalVM WebAssembly
- [Built-in Views & Macros](views-macros.md) — the SQL library layered on top of the raw tables
- [CLI Commands](cli.md) — `import`, `query`, `serve` flags
